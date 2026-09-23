from datetime import date, datetime, timedelta

from app.config import TAIPEI
from etl.aggregate import county_observations, daily_observed
from etl.daily import daily_forecasts


def at(day: str, hour: int) -> str:
    moment = datetime.fromisoformat(f"{day}T00:00:00+08:00") + timedelta(hours=hour)
    return moment.isoformat(timespec="seconds")


def hourly_day(day: str, temperatures: dict[int, float], step: int = 3) -> list[dict]:
    return [{"time": at(day, h), "temperature": temperatures.get(h, 25.0), "pop": 10.0, "wx": None}
            for h in range(0, 24, step)]


def period(day: str, start: int, hours: int, low: float, high: float, pop=None, wx=None) -> dict:
    return {"startTime": at(day, start), "endTime": at(day, start + hours), "minT": low, "maxT": high, "pop": pop, "wx": wx, "wxCode": None}


def test_hourly_samples_give_exact_calendar_day():
    hourly = hourly_day("2026-09-24", {3: 21.0, 12: 33.0, 21: 26.0})
    (day,) = daily_forecasts(hourly, [])
    assert day == {"dataDate": "2026-09-24", "mint": 21.0, "maxt": 33.0, "pop": 10.0, "approx": 0, "wx": None, "wxCode": None}


def test_partial_hourly_day_falls_back_to_periods():
    # Fetched in the afternoon: the morning is gone from the hourly forecast.
    hourly = [row for row in hourly_day("2026-09-24", {}) if row["time"] >= at("2026-09-24", 15)]
    periods = [period("2026-09-23", 18, 12, 22, 27), period("2026-09-24", 6, 12, 26, 32, pop=20, wx="晴")]
    (day,) = [d for d in daily_forecasts(hourly, periods) if d["dataDate"] == "2026-09-24"]
    assert (day["mint"], day["maxt"], day["approx"], day["wx"]) == (22, 32, 1, "晴")


def test_evening_night_is_excluded_from_the_low():
    periods = [
        period("2026-09-24", 0, 6, 24, 26),
        period("2026-09-24", 6, 12, 25, 33),
        period("2026-09-24", 18, 12, 19, 28),  # its low falls on the 25th's morning
    ]
    day = next(d for d in daily_forecasts([], periods) if d["dataDate"] == "2026-09-24")
    assert (day["mint"], day["maxt"]) == (24, 33)


def test_day_without_coverage_is_omitted():
    # Only the last night period reaches 10/01; that is not enough to call a day.
    periods = [period("2026-09-30", 6, 12, 25, 30), period("2026-09-30", 18, 12, 24, 28)]
    dates = [d["dataDate"] for d in daily_forecasts([], periods)]
    assert "2026-10-01" not in dates


def test_gap_in_hourly_samples_uses_periods():
    hourly = [row for row in hourly_day("2026-09-24", {}) if row["time"] not in (at("2026-09-24", 9), at("2026-09-24", 12))]
    periods = [period("2026-09-24", 0, 6, 20, 24), period("2026-09-24", 6, 12, 24, 31)]
    day = next(d for d in daily_forecasts(hourly, periods) if d["dataDate"] == "2026-09-24")
    assert day["approx"] == 1


def test_real_sample_days(samples):
    from etl.parsers.forecast_3day import parse_forecast_3day
    from etl.parsers.forecast_week import parse_forecast_week

    hourly = parse_forecast_3day(samples("F-D0047-089"))["臺中市"]
    periods, _ = parse_forecast_week(samples("F-D0047-091"))
    days = daily_forecasts(hourly, periods["臺中市"])
    assert [d["dataDate"] for d in days] == [f"2026-09-{d}" for d in range(24, 31)]
    assert [d["approx"] for d in days] == [0, 0, 0, 0, 1, 1, 1]
    assert all(d["mint"] <= d["maxt"] for d in days)


def station(county, altitude, temperature, **extra):
    return {
        "stationId": f"{county}{altitude}{temperature}", "county": county, "altitude": altitude,
        "lat": 24.0, "lon": 121.0, "observedAt": "2026-09-24T00:30:00+08:00",
        "temperature": temperature, "humidity": 80.0, "pressure": None,
        "windSpeed": None, "windDir": None, "rain": 0.0, "weather": None, **extra,
    }


def test_county_value_ignores_mountain_stations():
    rows = county_observations([station("南投縣", 100, 28.0), station("南投縣", 500, 26.0), station("南投縣", 3800, 8.0)])
    assert rows[0]["temperature"] == 27.0 and rows[0]["stationCount"] == 2


def test_mountain_only_county_still_reports():
    rows = county_observations([station("南投縣", 2000, 12.0)])
    assert rows[0]["temperature"] == 12.0


def test_pressure_prefers_lowland_then_nearest_other_county():
    rows = county_observations([
        station("臺中市", 30, 28.0, pressure=1008.0, lat=24.15, lon=120.68),
        station("南投縣", 600, 25.0, lat=23.9, lon=120.7),
    ])
    by_county = {row["county"]: row for row in rows}
    assert by_county["臺中市"]["pressure"] == 1008.0
    assert by_county["南投縣"]["pressure"] == 1008.0  # nearest lowland station, across the border


def test_wind_direction_is_a_vector_mean():
    rows = county_observations([
        station("臺北市", 10, 25.0, windSpeed=2.0, windDir=350.0),
        station("臺北市", 10, 25.0, windSpeed=2.0, windDir=10.0, stationId="b"),
    ])
    assert rows[0]["windDir"] == 0  # not 180, the arithmetic mean


def test_lagging_station_is_left_out_of_the_slot():
    rows = county_observations([
        station("臺北市", 10, 25.0),
        station("臺北市", 10, 35.0, stationId="late", observedAt="2026-09-23T22:00:00+08:00"),
    ])
    assert rows[0]["temperature"] == 25.0


def test_daily_observed_summary():
    day = date(2026, 9, 23)
    start = datetime(2026, 9, 23, tzinfo=TAIPEI)
    samples = [
        {"observedAt": (start + timedelta(minutes=10 * i)).isoformat(), "temperature": 20 + i % 10,
         "humidity": 80.0, "pressure": 1010.0, "rain": float(i)}
        for i in range(144)
    ] + [{"observedAt": (start + timedelta(days=1)).isoformat(), "temperature": 5.0, "humidity": None, "pressure": None, "rain": 0.0}]
    summary = daily_observed("臺北市", day, samples)
    assert (summary["tmin"], summary["tmax"], summary["samples"]) == (20, 29, 144)
    assert summary["rainSum"] == 143.0

import pytest

from app.errors import WeatherParseError
from etl.counties import COUNTIES
from etl.parsers.astronomy import parse_astronomy
from etl.parsers.forecast_3day import parse_forecast_3day
from etl.parsers.forecast_week import parse_forecast_week
from etl.parsers.observation import parse_observations


def test_observations_cover_every_county_with_wgs84_and_taipei_time(samples):
    rows = parse_observations(samples("O-A0003-001"))
    assert len(rows) == 363
    assert {row["county"] for row in rows} == set(COUNTIES)
    keelung = next(row for row in rows if row["stationId"] == "466940")
    assert (keelung["lat"], keelung["lon"]) == (25.133314, 121.740475)  # WGS84, not TWD67
    assert keelung["observedAt"].endswith("+08:00")
    assert keelung["pressure"] == 1012.5 and keelung["altitude"] == 26.7


def test_missing_reading_becomes_none_without_dropping_station(samples):
    document = samples("O-A0003-001")
    station = document["records"]["Station"][0]
    station["WeatherElement"]["AirTemperature"] = "-99"
    station["WeatherElement"]["AirPressure"] = "-999.0"
    row = next(r for r in parse_observations(document) if r["stationId"] == station["StationId"])
    assert row["temperature"] is None and row["pressure"] is None
    assert row["humidity"] is not None


def test_duplicate_station_is_rejected(samples):
    document = samples("O-A0003-001")
    document["records"]["Station"].append(document["records"]["Station"][0])
    with pytest.raises(WeatherParseError):
        parse_observations(document)


@pytest.mark.parametrize("document", [{}, {"records": {}}, {"records": {"Station": []}}])
def test_observation_structure_errors(document):
    with pytest.raises(WeatherParseError):
        parse_observations(document)


def test_three_day_forecast_joins_periods_onto_hourly_points(samples):
    result = parse_forecast_3day(samples("F-D0047-089"))
    assert set(result) == set(COUNTIES)
    rows = result["臺中市"]
    assert len(rows) == 56
    assert rows[0]["time"] == "2026-09-24T00:00:00+08:00"
    # Every hour in a three-hour window shares that window's rain chance and weather.
    first_window = [row for row in rows if row["time"] < "2026-09-24T03:00:00+08:00"]
    assert len({(row["pop"], row["wx"]) for row in first_window}) == 1
    assert all(row["windSpeed"] is not None for row in rows)


def test_week_forecast_rows_and_missing_pop(samples):
    periods, invalid = parse_forecast_week(samples("F-D0047-091"))
    assert set(periods) == set(COUNTIES) and invalid == 0
    rows = periods["臺中市"]
    assert len(rows) == 15
    assert rows[1]["startTime"] == "2026-09-24T06:00:00+08:00" and rows[1]["maxT"] == 33
    # CWA sends "-" for rain chance after day three.
    assert rows[-1]["pop"] is None


def test_week_forecast_rejects_inverted_period(samples):
    document = samples("F-D0047-091")
    location = document["records"]["Locations"][0]["Location"][0]
    for element in location["WeatherElement"]:
        if element["ElementName"] == "最低溫度":
            element["Time"][1]["ElementValue"][0]["MinTemperature"] = "45"
    periods, invalid = parse_forecast_week(document)
    assert invalid == 1
    row = periods[location["LocationName"]][1]
    assert row["minT"] is None and row["maxT"] is None


def test_duplicate_forecast_county_is_rejected(samples):
    document = samples("F-D0047-091")
    locations = document["records"]["Locations"][0]["Location"]
    locations.append(locations[0])
    with pytest.raises(WeatherParseError):
        parse_forecast_week(document)


def test_astronomy_merges_sun_and_moon(samples):
    rows = parse_astronomy(samples("A-B0062-001"), samples("A-B0063-001"))
    assert len(rows) == 44
    taipei = next(row for row in rows if row["county"] == "臺北市" and row["date"] == "2026-09-24")
    assert taipei["sunrise"] == "05:43" and taipei["moonrise"]


def test_astronomy_drops_malformed_times(samples):
    sun = samples("A-B0062-001")
    sun["records"]["locations"]["location"][0]["time"][0]["SunRiseTime"] = "soon"
    rows = parse_astronomy(sun, samples("A-B0063-001"))
    county = sun["records"]["locations"]["location"][0]["CountyName"]
    row = next(r for r in rows if r["county"] == county and r["date"] == "2026-09-24")
    assert row["sunrise"] is None and row["sunset"]

import pytest

from app import overlays
from app.errors import APIRequestError, WeatherParseError
from etl.parsers import overlays as parse
from tests.conftest import FROZEN


def model_point(**current):
    return {"current": {"time": "2026-09-24T14:15", **current}}


@pytest.fixture
def fake_cwa(monkeypatch, samples):
    """Serve overlay datasets from the samples, and Open-Meteo from made-up
    points; count calls per dataset."""
    calls = []

    def fetch(dataset_id, params=None, timeout=None):
        calls.append((dataset_id, dict(params or {})))
        return samples(dataset_id)

    def open_meteo(url, points, params):
        calls.append((url, dict(params)))
        return [model_point(wind_speed_10m=5, wind_direction_10m=45, us_aqi=60, pm2_5=20, us_aqi_pm2_5=60) for _ in points]

    monkeypatch.setattr(overlays, "fetch_dataset", fetch)
    monkeypatch.setattr(overlays.opendata, "open_meteo", open_meteo)
    overlays.clear_cache()
    yield calls
    overlays.clear_cache()


def test_rain_gauges(samples):
    rows = parse.parse_rain(samples("O-A0002-001"))
    assert len(rows) == 1341
    assert all(set(row) >= {"lat", "lon", "r1h", "r24h"} for row in rows)
    assert sum(1 for row in rows if (row["r24h"] or 0) > 0) == 125


def test_hourly_stations_have_gusts_and_daily_range(samples):
    rows = parse.parse_hourly_stations(samples("O-A0001-001"))
    assert len(rows) == 876
    station = next(row for row in rows if row["id"] == "C0V360")
    assert station["t"] == 25.1 and station["hi"] == 25.6 and station["lo"] == 25.0
    assert station["gust"] is None  # CWA wrote -99


def test_typhoon_track_and_forecast(samples):
    (cyclone,) = parse.parse_typhoons(samples("W-C0034-005"))
    assert cyclone["name"] == "舒力基" and cyclone["nameEn"] == "SURIGAE"
    assert [f["hour"] for f in cyclone["forecast"]] == [6, 12, 18, 24, 36, 48, 72, 96, 120]
    assert cyclone["track"] == sorted(cyclone["track"], key=lambda p: p["time"])
    first = cyclone["forecast"][0]
    assert first["r70"] == 40 and first["time"] == "2026-09-24T08:00:00+08:00"
    assert first["dir"] == "WNW" and first["speed"] == 19
    now = cyclone["track"][-1]
    assert now["r15"] == 100 and now["dir"] == "WNW" and now["speed"] == 34
    # The storm radius appears once the forecast strengthens it.
    assert any(f["r25"] == 50 for f in cyclone["forecast"])


def test_no_active_typhoon_is_an_empty_list():
    assert parse.parse_typhoons({"records": {"TropicalCyclones": None}}) == []
    with pytest.raises(WeatherParseError):
        parse.parse_typhoons({"records": {}})


def test_heat_index_now_and_peak(samples):
    rows = parse.parse_heat(samples("M-A0085-001"), FROZEN)
    assert len(rows) == 368
    town = rows[0]
    assert town["index"] is not None and town["time"].endswith("+08:00")
    assert town["peak"] is None or town["peak"] >= 0


def test_uv_is_placed_by_station_id(samples):
    stations = {"467420": {"name": "永康", "county": "臺南市", "town": "永康區", "lat": 23.04, "lon": 120.24}}
    result = parse.parse_uv(samples("O-A0005-001"), stations)
    assert result["date"] == "2026-09-23"
    assert [(s["id"], s["town"]) for s in result["stations"]] == [("467420", "永康區")]  # unknown ids are skipped


def test_townships_pick_the_hour_at_hand(samples):
    rows = parse.parse_townships([samples("F-D0047-093")], FROZEN)
    assert {row["county"] for row in rows} == {"臺北市", "金門縣"}
    assert all(row["t"] is not None and row["wx"] for row in rows)


def test_overlay_routes_are_cached(client, loaded, fake_cwa):
    for name in overlays.NAMES:
        response = client.get(f"/api/overlays/{name}")
        assert response.status_code == 200, name
        assert f"s-maxage={overlays.TTL[name]}" in response.headers["Cache-Control"]
    uv = client.get("/api/overlays/uv").get_json()
    assert uv["stations"]  # placed using the Stations table the observation job filled
    before = len(fake_cwa)
    client.get("/api/overlays/rain")
    assert len(fake_cwa) == before  # served from memory


def test_townships_are_requested_five_counties_at_a_time(client, loaded, fake_cwa):
    client.get("/api/overlays/townships")
    batches = [params["locationId"].split(",") for dataset, params in fake_cwa if dataset == "F-D0047-093"]
    assert len(batches) == 5 and all(len(batch) <= 5 for batch in batches)
    assert sum(len(batch) for batch in batches) == 22


def test_unknown_overlay_and_cwa_failure(client, loaded, monkeypatch):
    assert client.get("/api/overlays/aurora").status_code == 404

    def down(*_args, **_kwargs):
        raise APIRequestError("無法連線中央氣象署，請稍後重試。")

    monkeypatch.setattr(overlays, "fetch_dataset", down)
    overlays.clear_cache()
    response = client.get("/api/overlays/rain")
    assert response.status_code == 503 and "中央氣象署" in response.get_json()["error"]
    overlays.clear_cache()


def test_wind_grid_is_east_and_north_components():
    grid = {"lon0": 120, "lat0": 22, "step": 1, "nx": 2, "ny": 2}
    points = parse.wind_points(grid)
    assert points == [(22, 120), (22, 121), (23, 120), (23, 121)]
    # From the north goes south; from the west goes east; a missing point stays missing.
    results = [model_point(wind_speed_10m=10, wind_direction_10m=0), model_point(wind_speed_10m=4, wind_direction_10m=270),
               model_point(wind_speed_10m=None, wind_direction_10m=None), model_point(wind_speed_10m=0, wind_direction_10m=90)]
    field = parse.parse_wind_grid(results, grid)
    assert field["u"][0] == pytest.approx(0) and field["v"][0] == -10
    assert field["u"][1] == 4 and field["v"][1] == pytest.approx(0)
    assert field["u"][2] is None and field["max"] == 10
    assert field["time"] == "2026-09-24T14:15:00+08:00"
    with pytest.raises(WeatherParseError):
        parse.parse_wind_grid([model_point()], grid)


def test_moenv_stations_skip_maintenance_and_name_counties_as_cwa_does():
    record = {"sitename": "豐原", "county": "台中市", "aqi": "112", "pollutant": "細懸浮微粒", "status": "對敏感族群不健康",
              "pm2.5": "41", "pm10": "60", "o3": "30.1", "longitude": "120.741711", "latitude": "24.256586",
              "siteid": "28", "publishtime": "2026/09/24 14:00:00"}
    payload = parse.parse_moenv_aqi({"records": [record, {**record, "aqi": "", "status": "設備維護"}]})
    (station,) = payload["stations"]
    assert station["county"] == "臺中市" and station["aqi"] == 112 and station["pm25"] == 41
    assert payload["source"] == "moenv" and payload["time"] == "2026-09-24T14:00:00+08:00"
    with pytest.raises(WeatherParseError):
        parse.parse_moenv_aqi({"records": []})


def test_model_air_names_the_pollutant_only_past_good():
    places = [("臺北市", 25.0, 121.5), ("高雄市", 22.6, 120.3)]
    results = [model_point(us_aqi=40, us_aqi_pm2_5=40, us_aqi_ozone=20),
               model_point(us_aqi=130, us_aqi_pm2_5=90, us_aqi_ozone=130, pm2_5=30)]
    taipei, kaohsiung = parse.parse_model_air(results, places)["stations"]
    assert taipei["status"] == "良好" and taipei["pollutant"] is None
    assert kaohsiung["status"] == "對敏感族群不健康" and kaohsiung["pollutant"] == "臭氧"


def test_air_uses_moenv_when_it_has_a_key(client, loaded, fake_cwa, monkeypatch):
    monkeypatch.setenv("MOENV_API_KEY", "key")
    record = {"sitename": "左營", "county": "高雄市", "aqi": "55", "longitude": "120.29", "latitude": "22.67"}
    monkeypatch.setattr(overlays.opendata, "moenv", lambda dataset: {"records": [record]})
    air = client.get("/api/overlays/air").get_json()
    assert air["source"] == "moenv" and air["stations"][0]["name"] == "左營"

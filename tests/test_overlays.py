import pytest

from app import overlays
from app.errors import APIRequestError, WeatherParseError
from etl.parsers import overlays as parse
from tests.conftest import FROZEN


@pytest.fixture
def fake_cwa(monkeypatch, samples):
    """Serve overlay datasets from the samples; count calls per dataset."""
    calls = []

    def fetch(dataset_id, params=None, timeout=None):
        calls.append((dataset_id, dict(params or {})))
        return samples(dataset_id)

    monkeypatch.setattr(overlays, "fetch_dataset", fetch)
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

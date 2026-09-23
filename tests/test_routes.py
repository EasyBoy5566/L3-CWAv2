from datetime import timedelta
from urllib.parse import quote

import pytest

from app.errors import APIRequestError
from tests.conftest import FROZEN

TAICHUNG = quote("臺中市")


def test_pages_render(client, loaded, monkeypatch):
    monkeypatch.setenv("CESIUM_ION_TOKEN", "browser-token")
    page = client.get("/")
    assert page.status_code == 200
    assert "cesium@1.145.0" in page.text and 'data-cesium-token="browser-token"' in page.text
    assert "s-maxage" in page.headers["Cache-Control"]
    assert client.get(f"/region/{TAICHUNG}").status_code == 200
    missing = client.get("/region/Atlantis")
    assert missing.status_code == 404 and "找不到" in missing.text


def test_meta_lists_upcoming_dates_and_freshness(client, loaded):
    meta = client.get("/api/meta").get_json()
    assert len(meta["counties"]) == 22
    assert meta["dates"][0] == "2026-09-24" and len(meta["dates"]) == 7
    assert meta["freshness"]["observations"]["level"] == "ok"
    assert meta["freshness"]["forecasts"]["level"] == "ok"


def test_meta_drops_past_dates(client, loaded, clock):
    clock(FROZEN + timedelta(days=2))
    assert client.get("/api/meta").get_json()["dates"][0] == "2026-09-26"


def test_map_layers(client, loaded):
    now = client.get("/api/map?layer=now").get_json()
    assert len(now["values"]) == 22 and now["values"]["臺中市"]["value"] is not None
    maxt = client.get("/api/map?layer=maxt&date=2026-09-25").get_json()
    assert maxt["values"]["臺北市"]["value"] == maxt["values"]["臺北市"]["maxt"]
    response = client.get("/api/map?layer=now")
    assert "s-maxage=60" in response.headers["Cache-Control"]


@pytest.mark.parametrize("url", ["/api/map?layer=wind", "/api/map?layer=maxt&date=tomorrow", f"/api/region/{TAICHUNG}/trend?days=5"])
def test_bad_parameters(client, loaded, url):
    response = client.get(url)
    assert response.status_code == 400 and response.get_json()["error"]


def test_region_detail(client, loaded):
    region = client.get(f"/api/region/{TAICHUNG}").get_json()
    assert region["current"]["temperature"] is not None
    assert region["current"]["pressure"] is not None
    assert len(region["week"]) == 7 and region["week"][4]["approx"] is True
    assert region["hourly"][0]["time"] >= "2026-09-23T23:40:00+08:00"
    assert region["astronomy"][0]["date"] == "2026-09-24"
    assert client.get("/api/region/Atlantis").status_code == 404


def test_old_observations_are_not_called_current(client, loaded, cwa, clock):
    cwa.overrides["O-A0003-001"] = APIRequestError("down")
    clock(FROZEN + timedelta(hours=4))
    region = client.get(f"/api/region/{TAICHUNG}").get_json()
    assert region["current"] is None


def test_history_and_future_dates(client, loaded):
    history = client.get(f"/api/region/{TAICHUNG}/history?date=2026-09-24").get_json()
    assert history["summary"]["partial"] is True
    assert len(history["revisions"]) == 1
    assert history["range"]["first"] == "2026-09-24"
    assert client.get(f"/api/region/{TAICHUNG}/history?date=2026-09-25").status_code == 400


def test_read_through_refreshes_stale_observations(client, loaded, cwa, clock):
    client.get("/api/map?layer=now")
    assert cwa.calls == []  # fresh: no CWA call
    clock(FROZEN + timedelta(minutes=30))
    client.get("/api/map?layer=now")
    assert cwa.calls == ["O-A0003-001"]
    client.get("/api/map?layer=now")
    assert cwa.calls == ["O-A0003-001"]  # just attempted: no retry storm


def test_read_through_failure_still_answers(client, loaded, cwa, clock):
    cwa.overrides["O-A0003-001"] = APIRequestError("down")
    clock(FROZEN + timedelta(minutes=30))
    response = client.get("/api/map?layer=now")
    assert response.status_code == 200 and len(response.get_json()["values"]) == 22


def test_health(client, loaded, cwa, clock):
    assert client.get("/api/health").status_code == 200
    cwa.overrides["O-A0003-001"] = APIRequestError("down")
    clock(FROZEN + timedelta(hours=13))
    response = client.get("/api/health")
    assert response.status_code == 503
    assert response.get_json()["forecasts"]["level"] == "warn"


def test_security_headers(client, loaded):
    response = client.get("/api/meta")
    assert response.headers["X-Content-Type-Options"] == "nosniff"
    assert response.headers["X-Frame-Options"] == "DENY"

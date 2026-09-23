import pytest

from app.errors import APIRequestError

SECRET = "cron-secret-value"


@pytest.fixture
def secret(monkeypatch):
    monkeypatch.setenv("CRON_SECRET", SECRET)


def auth(value=SECRET):
    return {"Authorization": f"Bearer {value}"}


def test_unconfigured_secret_refuses(client, database):
    assert client.post("/api/cron/observations", headers=auth()).status_code == 503


@pytest.mark.parametrize("headers", [{}, auth("wrong"), {"Authorization": SECRET}])
def test_wrong_secret_is_unauthorized(client, database, secret, cwa, headers):
    assert client.post("/api/cron/observations", headers=headers).status_code == 401
    assert cwa.calls == []


def test_runs_job(client, database, secret, cwa):
    response = client.post("/api/cron/observations", headers=auth())
    assert response.status_code == 200
    assert response.get_json()["rows"] == 363


def test_get_is_accepted_for_vercel_cron(client, database, secret, cwa):
    assert client.get("/api/cron/daily", headers=auth()).status_code == 200


def test_unknown_job(client, database, secret):
    assert client.post("/api/cron/everything", headers=auth()).status_code == 404


def test_cwa_failure_is_502_without_key(client, database, secret, cwa):
    cwa.overrides["F-D0047-089"] = APIRequestError("氣象署授權失敗，請檢查 API 授權碼。")
    response = client.post("/api/cron/forecasts", headers=auth())
    assert response.status_code == 502
    assert "授權失敗" in response.get_json()["error"]
    assert "test-key" not in response.text

from datetime import timedelta

import pytest

from app.errors import APIRequestError, DatabaseError, WeatherParseError
from etl.jobs import acquire_lock, release_lock, run_job
from tests.conftest import FROZEN


def count(database, table):
    return database.query(f"SELECT COUNT(*) AS n FROM {table}")[0]["n"]


def status(database, job):
    return database.query("SELECT * FROM JobStatus WHERE job = ?", (job,))[0]


def test_every_job_loads_data(loaded):
    assert count(loaded, "Stations") == 363
    assert count(loaded, "Observations") == 363
    assert count(loaded, "CountyObservations") == 22
    assert count(loaded, "ForecastRuns") == 1
    assert count(loaded, "TemperatureForecasts") == 22 * 7
    assert count(loaded, "LatestTemperatureForecasts") == 22 * 7
    assert count(loaded, "AstroDaily") == 44
    for job in ("observations", "forecasts", "daily"):
        assert status(loaded, job)["lastStatus"] == "ok"


def test_rerunning_jobs_writes_nothing_new(loaded):
    before = {table: count(loaded, table) for table in ("Observations", "ForecastRuns", "HourlyForecasts", "TemperatureForecasts", "AstroDaily")}
    assert run_job("forecasts", loaded)["status"] == "unchanged"
    run_job("observations", loaded)
    run_job("daily", loaded)
    assert {table: count(loaded, table) for table in before} == before
    assert status(loaded, "forecasts")["lastStatus"] == "unchanged"


def test_changed_forecast_becomes_new_run_and_latest(loaded, cwa, samples):
    document = samples("F-D0047-091")
    for location in document["records"]["Locations"][0]["Location"]:
        if location["LocationName"] == "臺北市":
            for element in location["WeatherElement"]:
                if element["ElementName"] == "最高溫度":
                    for entry in element["Time"]:
                        entry["ElementValue"][0]["MaxTemperature"] = "39"
    cwa.overrides["F-D0047-091"] = document
    assert run_job("forecasts", loaded)["runId"] == 2
    latest = loaded.query("SELECT maxt, runId FROM LatestTemperatureForecasts WHERE regionName = '臺北市' AND dataDate = '2026-09-29'")
    assert latest == [{"maxt": 39.0, "runId": 2}]
    # The first run is kept for the revision history.
    assert count(loaded, "TemperatureForecasts") == 22 * 7 * 2


def test_cwa_failure_keeps_old_data_and_records_error(loaded, cwa):
    cwa.overrides["O-A0003-001"] = APIRequestError("氣象署連線逾時，請稍後重試。")
    with pytest.raises(APIRequestError):
        run_job("observations", loaded)
    assert count(loaded, "Observations") == 363
    row = status(loaded, "observations")
    assert row["lastStatus"] == "error" and "逾時" in row["lastError"]
    assert row["lastSuccessAt"] is not None  # the earlier success is still on record


def test_missing_county_rejects_whole_forecast(database, cwa, samples):
    document = samples("F-D0047-089")
    document["records"]["Locations"][0]["Location"].pop()
    cwa.overrides["F-D0047-089"] = document
    with pytest.raises(WeatherParseError, match="缺少縣市"):
        run_job("forecasts", database)
    assert count(database, "ForecastRuns") == 0


def test_expired_forecast_is_rejected(database, cwa, clock):
    clock(FROZEN + timedelta(days=10))
    with pytest.raises(WeatherParseError, match="過期"):
        run_job("forecasts", database)


def test_astronomy_failure_does_not_block_daily_summary(loaded, cwa, clock):
    clock(FROZEN + timedelta(days=1))
    cwa.overrides["A-B0062-001"] = APIRequestError("無法連線中央氣象署，請稍後重試。")
    result = run_job("daily", loaded)
    assert result["status"] == "error" and result["dailyObserved"] == 22
    assert count(loaded, "DailyObserved") == 22


def test_lock_is_single_flight_and_expires(database, clock):
    token = acquire_lock(database, "observations")
    assert token and acquire_lock(database, "observations") is None
    assert run_job("observations", database)["status"] == "busy"
    clock(FROZEN + timedelta(minutes=5))
    assert acquire_lock(database, "observations")
    release_lock(database, "observations", token)  # a stale token releases nothing


def test_failed_batch_rolls_back(database):
    statements = [
        ("INSERT INTO Locks (name, until) VALUES ('a', 'x')", ()),
        ("INSERT INTO Locks (name, until) VALUES ('a', 'y')", ()),  # primary key clash
    ]
    with pytest.raises(DatabaseError):
        database.batch(statements)
    assert count(database, "Locks") == 0

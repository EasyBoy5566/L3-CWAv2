"""Every test runs against a fresh local SQLite file, a frozen Taipei clock,
and a fake CWA that serves the real samples in tests/samples/."""

import copy
from datetime import datetime
import json
from pathlib import Path

import pytest

from app import config

SAMPLES = Path(__file__).parent / "samples"
# The samples were fetched at 00:37 on this date.
FROZEN = datetime(2026, 9, 24, 0, 40, tzinfo=config.TAIPEI)


def load_sample(dataset: str) -> dict:
    return json.loads((SAMPLES / f"{dataset}.json").read_text(encoding="utf-8"))


@pytest.fixture(autouse=True)
def isolated(monkeypatch, tmp_path):
    for name in ("TURSO_DATABASE_URL", "TURSO_AUTH_TOKEN", "CRON_SECRET", "CESIUM_ION_TOKEN", "VERCEL"):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv("CWA_API_KEY", "test-key")
    monkeypatch.setattr(config, "LOCAL_DB_PATH", tmp_path / "weather.db")
    monkeypatch.setattr(config, "load_local_env", lambda: None)
    monkeypatch.setattr(config, "now", lambda: FROZEN)


@pytest.fixture
def clock(monkeypatch):
    """Move the frozen clock: clock(datetime)."""
    def set_time(moment: datetime):
        monkeypatch.setattr(config, "now", lambda: moment)
    return set_time


@pytest.fixture
def samples():
    cache = {}

    def get(dataset: str) -> dict:
        if dataset not in cache:
            cache[dataset] = load_sample(dataset)
        return copy.deepcopy(cache[dataset])
    return get


@pytest.fixture
def cwa(monkeypatch, samples):
    """Replace CWA with the samples. Returns the call log; set .overrides[dataset] to a document or exception."""
    from etl import jobs

    class FakeCWA:
        def __init__(self):
            self.calls = []
            self.overrides = {}

        def __call__(self, dataset_id, params=None, timeout=None):
            self.calls.append(dataset_id)
            override = self.overrides.get(dataset_id)
            if isinstance(override, Exception):
                raise override
            return copy.deepcopy(override) if override is not None else samples(dataset_id)

    fake = FakeCWA()
    monkeypatch.setattr(jobs, "fetch_dataset", fake)
    return fake


@pytest.fixture
def database():
    from app.db import get_database, init_schema

    db = get_database()
    init_schema(db)
    return db


@pytest.fixture
def loaded(database, cwa):
    """A database after one run of every job."""
    from etl.jobs import run_job

    for job in ("observations", "forecasts", "daily"):
        run_job(job, database)
    cwa.calls.clear()
    return database


@pytest.fixture
def client():
    from app import create_app

    return create_app().test_client()

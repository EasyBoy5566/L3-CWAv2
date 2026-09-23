"""The three scheduled jobs, and the lock that keeps each one single-flight.

Each job fetches, parses and validates everything before it writes, then
writes in one batch: a failure anywhere leaves the previous data untouched
and is recorded in JobStatus for the health check and the page banner.
"""

from datetime import timedelta
import hashlib
import json

from app import config
from app.db import get_database
from app.errors import WeatherError, WeatherParseError

from . import load
from .aggregate import county_observations, daily_observed
from .counties import COUNTIES
from .cwa import fetch_dataset
from .daily import daily_forecasts
from .parsers.astronomy import parse_astronomy
from .parsers.common import iso
from .parsers.forecast_3day import parse_forecast_3day
from .parsers.forecast_week import parse_forecast_week
from .parsers.observation import parse_observations


def acquire_lock(database, name: str) -> str | None:
    """Take the named lock unless someone holds an unexpired one. Returns a release token."""
    now = config.now()
    until = iso(now + timedelta(seconds=config.LOCK_SECONDS))
    taken = database.execute(
        """
        INSERT INTO Locks (name, until) VALUES (?, ?)
        ON CONFLICT(name) DO UPDATE SET until = excluded.until WHERE Locks.until < ?
        """,
        (name, until, iso(now)),
    )
    return until if taken else None


def release_lock(database, name: str, token: str) -> None:
    database.execute("DELETE FROM Locks WHERE name = ? AND until = ?", (name, token))


def _require_counties(found, label: str) -> None:
    missing = set(COUNTIES) - set(found)
    if missing:
        raise WeatherParseError(f"{label}缺少縣市：{'、'.join(sorted(missing))}。")


def refresh_observations(database, started, timeout=None) -> dict:
    stations = parse_observations(fetch_dataset(config.OBSERVATION_DATASET, timeout=timeout))
    counties = county_observations(stations)
    data_time = max(row["observedAt"] for row in counties)
    database.batch([
        *load.observation_statements(stations, counties),
        load.job_status("observations", "ok", iso(started), row_count=len(stations), data_time=data_time),
    ])
    return {"status": "ok", "rows": len(stations), "dataTime": data_time}


def refresh_forecasts(database, started, timeout=None) -> dict:
    hourly = parse_forecast_3day(fetch_dataset(config.FORECAST_3DAY_DATASET, timeout=timeout))
    periods, invalid = parse_forecast_week(fetch_dataset(config.FORECAST_WEEK_DATASET, timeout=timeout))
    _require_counties(hourly, "3 天預報")
    _require_counties(periods, "一週預報")
    last_period = max(row["endTime"] for rows in periods.values() for row in rows)
    if last_period < iso(started):
        raise WeatherParseError("氣象署回傳的預報已過期。")

    content = json.dumps({"hourly": hourly, "periods": periods}, sort_keys=True, ensure_ascii=False)
    content_hash = hashlib.sha256(content.encode("utf-8")).hexdigest()
    existing = database.query("SELECT fetchedAt FROM ForecastRuns WHERE contentHash = ?", (content_hash,))
    if existing:
        database.execute(*load.job_status(
            "forecasts", "unchanged", iso(started), row_count=0, data_time=existing[0]["fetchedAt"]
        ))
        return {"status": "unchanged", "dataTime": existing[0]["fetchedAt"]}

    daily = {region: daily_forecasts(hourly.get(region, []), periods.get(region, [])) for region in COUNTIES}
    # Runs are numbered here rather than by AUTOINCREMENT so every row of the
    # run can be written in the same batch; the job lock makes this safe.
    run_id = database.query("SELECT COALESCE(MAX(id), 0) + 1 AS next FROM ForecastRuns")[0]["next"]
    fetched_at = iso(started)
    rows = sum(len(rows) for rows in daily.values())
    database.batch([
        *load.forecast_statements(run_id, content_hash, fetched_at, hourly, periods, daily),
        load.job_status("forecasts", "ok", fetched_at, row_count=rows, data_time=fetched_at,
                        error=f"略過 {invalid} 個無效時段" if invalid else None),
    ])
    return {"status": "ok", "runId": run_id, "rows": rows, "invalidPeriods": invalid}


def refresh_daily(database, started, timeout=None) -> dict:
    """Sun and moon tables, yesterday's observed summary, and retention."""
    today = started.date()
    errors = []
    statements = []

    try:
        window = {
            "timeFrom": today.isoformat(),
            "timeTo": (today + timedelta(days=config.ASTRONOMY_PREFETCH_DAYS)).isoformat(),
        }
        astronomy = parse_astronomy(
            fetch_dataset(config.SUN_DATASET, window, timeout=timeout),
            fetch_dataset(config.MOON_DATASET, window, timeout=timeout),
        )
        statements += load.astronomy_statements(astronomy)
    except WeatherError as exc:
        errors.append(str(exc))
        astronomy = []

    yesterday = today - timedelta(days=1)
    samples = database.query(
        "SELECT * FROM CountyObservations WHERE observedAt >= ? AND observedAt < ?",
        (f"{yesterday.isoformat()}T00:00:00+08:00", f"{today.isoformat()}T00:00:00+08:00"),
    )
    by_county: dict[str, list[dict]] = {}
    for row in samples:
        by_county.setdefault(row["county"], []).append(row)
    summaries = [summary for county, rows in by_county.items()
                 if (summary := daily_observed(county, yesterday, rows)) is not None]
    statements += load.daily_observed_statements(summaries)

    statements += load.retention_statements(
        iso(started - timedelta(days=config.OBSERVATION_RETENTION_DAYS)),
        iso(started - timedelta(days=config.FORECAST_PERIOD_RETENTION_DAYS)),
    )
    status = "error" if errors else "ok"
    statements.append(load.job_status(
        "daily", status, iso(started), error="；".join(errors) or None,
        row_count=len(astronomy) + len(summaries), data_time=yesterday.isoformat(),
    ))
    database.batch(statements)
    return {"status": status, "astronomy": len(astronomy), "dailyObserved": len(summaries), "errors": errors}


RUNNERS = {
    "observations": refresh_observations,
    "forecasts": refresh_forecasts,
    "daily": refresh_daily,
}


def run_job(name: str, database=None, timeout: float | None = None) -> dict:
    """Run one job under its lock. Returns {"status": "busy"} if another run holds it."""
    if name not in RUNNERS:
        raise ValueError(f"unknown job: {name}")
    database = database or get_database()
    token = acquire_lock(database, name)
    if token is None:
        return {"job": name, "status": "busy"}
    started = config.now()
    try:
        return {"job": name, **RUNNERS[name](database, started, timeout)}
    except Exception as exc:
        message = str(exc) if isinstance(exc, WeatherError) else "未預期的錯誤。"
        try:
            database.execute(*load.job_status(name, "error", iso(started), error=message))
        except WeatherError:
            pass
        raise
    finally:
        try:
            release_lock(database, name, token)
        except WeatherError:
            pass

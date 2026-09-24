"""How old the data is, and the read-through refresh for observations.

The cron job is the primary refresh. If it has not run for a while, the
next visitor's request fetches observations itself, under the same lock,
so the page never shows a reading much older than CWA's own.
"""

from datetime import datetime

from app import config
from app.errors import WeatherError

# Do not retry CWA on every request while it is still publishing the next slot.
RETRY_AFTER_MINUTES = 2
# CWA publishes a slot every ten minutes and lists it 15-20 minutes late, so
# right after a successful fetch the newest reading can already look stale.
# Fetching again before the next slot could exist only makes the visitor wait.
FETCHED_WITHIN_MINUTES = 10


def _minutes_since(value: str | None, now: datetime) -> float | None:
    if not value:
        return None
    try:
        moment = datetime.fromisoformat(value)
    except ValueError:
        return None
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=config.TAIPEI)
    return (now - moment).total_seconds() / 60


def _level(age: float | None, warn: float, alert: float | None = None) -> str:
    if age is None:
        return "missing"
    if alert is not None and age > alert:
        return "alert"
    if age > warn:
        return "warn"
    return "ok"


def status(database) -> dict:
    """Per-dataset data time, age in minutes and a level for the page banner."""
    now = config.now()
    jobs = {row["job"]: row for row in database.query("SELECT * FROM JobStatus")}
    observations = jobs.get("observations", {})
    forecasts = jobs.get("forecasts", {})
    daily = jobs.get("daily", {})
    observation_age = _minutes_since(observations.get("dataTime"), now)
    forecast_age = _minutes_since(forecasts.get("lastSuccessAt"), now)
    return {
        "observations": {
            "dataTime": observations.get("dataTime"),
            "ageMinutes": None if observation_age is None else round(observation_age),
            "level": _level(observation_age, config.OBSERVATION_WARN_AFTER, config.OBSERVATION_ALERT_AFTER),
            "lastError": observations.get("lastError") if observations.get("lastStatus") == "error" else None,
        },
        "forecasts": {
            "dataTime": forecasts.get("dataTime"),
            "checkedAt": forecasts.get("lastSuccessAt"),
            "ageMinutes": None if forecast_age is None else round(forecast_age),
            "level": _level(forecast_age, config.FORECAST_WARN_AFTER),
            "lastError": forecasts.get("lastError") if forecasts.get("lastStatus") == "error" else None,
        },
        "daily": {
            "lastSuccessAt": daily.get("lastSuccessAt"),
            "lastError": daily.get("lastError"),
        },
    }


def refresh_observations_if_stale(database) -> bool:
    """Fetch observations inline when they are stale. Never raises; returns whether it ran."""
    now = config.now()
    rows = database.query("SELECT dataTime, lastAttemptAt, lastSuccessAt FROM JobStatus WHERE job = 'observations'")
    if rows:
        age = _minutes_since(rows[0]["dataTime"], now)
        since_attempt = _minutes_since(rows[0]["lastAttemptAt"], now)
        since_success = _minutes_since(rows[0]["lastSuccessAt"], now)
        if age is not None and age <= config.OBSERVATION_REFRESH_AFTER:
            return False
        if since_attempt is not None and since_attempt < RETRY_AFTER_MINUTES:
            return False
        if since_success is not None and since_success < FETCHED_WITHIN_MINUTES:
            return False
    from etl.jobs import run_job

    try:
        return run_job("observations", database, timeout=config.READ_THROUGH_TIMEOUT)["status"] == "ok"
    except WeatherError:
        return False

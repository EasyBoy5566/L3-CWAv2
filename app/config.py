"""Environment-backed configuration shared by the web app and the ETL jobs.

Values that come from the environment are read through functions, not module
constants, so tests can monkeypatch the environment and so a missing variable
surfaces where it is used rather than at import time.
"""

import os
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT_DIR = Path(__file__).resolve().parents[1]
LOCAL_DB_PATH = ROOT_DIR / "data" / "weather.db"
SCHEMA_PATH = ROOT_DIR / "db" / "schema.sql"

TAIPEI = ZoneInfo("Asia/Taipei")

CWA_API_BASE_URL = "https://opendata.cwa.gov.tw/api/v1/rest/datastore"
OBSERVATION_DATASET = "O-A0003-001"
FORECAST_3DAY_DATASET = "F-D0047-089"
FORECAST_WEEK_DATASET = "F-D0047-091"
SUN_DATASET = "A-B0062-001"
MOON_DATASET = "A-B0063-001"

# Map overlays, read through the server and cached rather than stored.
RAIN_DATASET = "O-A0002-001"
HOURLY_STATIONS_DATASET = "O-A0001-001"
TYPHOON_DATASET = "W-C0034-005"
HEAT_DATASET = "M-A0085-001"
UV_DATASET = "O-A0005-001"
TOWNSHIP_DATASET = "F-D0047-093"
# F-D0047-093 serves any mix of the per-county three-day township datasets,
# named by locationId: these are all 22 of them.
TOWNSHIP_LOCATION_IDS = [f"F-D0047-{n:03d}" for n in range(1, 86, 4)]
TOWNSHIP_ELEMENTS = ["溫度", "天氣現象", "3小時降雨機率"]

REQUEST_TIMEOUT = 15
# A visitor's request waits on this one, so it is shorter than the cron timeout.
READ_THROUGH_TIMEOUT = 8

# Freshness, in minutes. CWA republishes station readings every ten minutes.
OBSERVATION_REFRESH_AFTER = 15
OBSERVATION_WARN_AFTER = 30
OBSERVATION_ALERT_AFTER = 120
FORECAST_WARN_AFTER = 12 * 60
# The hourly cron checks forecasts; if it has not for this long, the next
# visitor's page load checks them instead (see freshness.py).
FORECAST_REFRESH_AFTER = 60

# Stations above this altitude are left out of a county's current value, so
# Yushan and Alishan do not drag Nantou and Chiayi down by ten degrees.
HIGH_ALTITUDE_METRES = 1500

OBSERVATION_RETENTION_DAYS = 30
FORECAST_PERIOD_RETENTION_DAYS = 90
ASTRONOMY_PREFETCH_DAYS = 30

LOCK_SECONDS = 120


def load_local_env() -> None:
    """Read .env outside Vercel. utf-8-sig tolerates a BOM left by Windows editors."""
    try:
        from dotenv import load_dotenv
    except ImportError:
        return
    load_dotenv(ROOT_DIR / ".env", encoding="utf-8-sig")


def _env(name: str) -> str:
    return os.getenv(name, "").strip()


def cwa_api_key() -> str:
    return _env("CWA_API_KEY")


def turso_database_url() -> str:
    return _env("TURSO_DATABASE_URL")


def turso_auth_token() -> str:
    return _env("TURSO_AUTH_TOKEN")


def on_vercel() -> bool:
    """Vercel sets VERCEL=1 in every build and function."""
    return _env("VERCEL") == "1"


def cron_secret() -> str:
    return _env("CRON_SECRET")


def cesium_ion_token() -> str:
    """A browser token by design; restrict its allowed URLs in the ion console."""
    return _env("CESIUM_ION_TOKEN")


def now() -> datetime:
    """The current Taipei time. Tests replace this to freeze the clock."""
    return datetime.now(TAIPEI)

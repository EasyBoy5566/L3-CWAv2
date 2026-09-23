"""Project-relative configuration, with environment taking precedence."""

import os
from pathlib import Path
from zoneinfo import ZoneInfo

from dotenv import load_dotenv

ROOT_DIR = Path(__file__).resolve().parents[1]
load_dotenv(ROOT_DIR / ".env")

CWA_API_BASE_URL = "https://opendata.cwa.gov.tw/api/v1/rest/datastore"
CWA_DATASET_ID = os.getenv("CWA_DATASET_ID", "F-D0047-091").strip()
DB_PATH = Path(os.getenv("WEATHER_DB_PATH", str(ROOT_DIR / "data" / "weather.db")))
REQUEST_TIMEOUT = 20
CACHE_TTL = 1800
TAIPEI = ZoneInfo("Asia/Taipei")


def get_api_key() -> str:
    """Support local dotenv and Streamlit Community Cloud secrets."""
    key = os.getenv("CWA_API_KEY", "").strip()
    if key:
        return key
    import streamlit as st
    from streamlit.errors import StreamlitSecretNotFoundError

    try:
        return str(st.secrets.get("CWA_API_KEY", "")).strip()
    except StreamlitSecretNotFoundError:
        return ""


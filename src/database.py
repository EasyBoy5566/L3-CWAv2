"""Short-lived SQLite connections and atomic forecast updates."""

from contextlib import contextmanager
from datetime import date, datetime
from pathlib import Path
import sqlite3

import numpy as np
import pandas as pd

from src import config
from src.errors import DatabaseError
from src.parser import COLUMNS


@contextmanager
def connection(db_path=None):
    path = Path(db_path or config.DB_PATH)
    conn = None
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(path, timeout=10)
        with conn:
            yield conn
    except (sqlite3.Error, OSError):
        raise DatabaseError("無法讀寫預報資料庫，請檢查檔案權限與磁碟空間。") from None
    finally:
        if conn is not None:
            conn.close()


def init_database(db_path=None) -> None:
    with connection(db_path) as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS weather_forecast (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                region_name TEXT NOT NULL,
                forecast_date TEXT NOT NULL,
                min_temp REAL NOT NULL,
                max_temp REAL NOT NULL,
                fetched_at TEXT NOT NULL,
                UNIQUE(region_name, forecast_date),
                CHECK(min_temp <= max_temp)
            )
        """)


def save_forecasts(df: pd.DataFrame, db_path=None, *, replace_snapshot=False) -> None:
    """UPSERT; optionally discard records absent from a complete new snapshot.

    Validation and transaction rollback preserve previous data on failure.
    """
    try:
        if df.empty or not set(COLUMNS).issubset(df.columns):
            raise ValueError
        clean = df[COLUMNS].copy()
        if clean.isna().any().any() or clean.duplicated(["region_name", "forecast_date"]).any():
            raise ValueError
        for field in ("min_temp", "max_temp"):
            clean[field] = pd.to_numeric(clean[field], errors="raise")
            if not np.isfinite(clean[field]).all():
                raise ValueError
        if (clean.min_temp > clean.max_temp).any():
            raise ValueError
        for row in clean.itertuples(index=False):
            if not isinstance(row.region_name, str) or not row.region_name.strip():
                raise ValueError
            if date.fromisoformat(row.forecast_date).isoformat() != row.forecast_date:
                raise ValueError
            if datetime.fromisoformat(row.fetched_at).tzinfo is None:
                raise ValueError
        records = list(clean.itertuples(index=False, name=None))
    except (ValueError, TypeError, KeyError, OverflowError):
        raise DatabaseError("預報資料不完整或格式不正確，已取消寫入。") from None

    with connection(db_path) as conn:
        conn.executemany("""
            INSERT INTO weather_forecast
                (region_name, forecast_date, min_temp, max_temp, fetched_at)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(region_name, forecast_date) DO UPDATE SET
                min_temp=excluded.min_temp,
                max_temp=excluded.max_temp,
                fetched_at=excluded.fetched_at
        """, records)
        if replace_snapshot:
            conn.execute("CREATE TEMP TABLE incoming_keys (region_name TEXT, forecast_date TEXT)")
            conn.executemany("INSERT INTO incoming_keys VALUES (?, ?)", [(r[0], r[1]) for r in records])
            conn.execute("""
                DELETE FROM weather_forecast WHERE NOT EXISTS (
                    SELECT 1 FROM incoming_keys AS incoming
                    WHERE incoming.region_name = weather_forecast.region_name
                      AND incoming.forecast_date = weather_forecast.forecast_date
                )
            """)


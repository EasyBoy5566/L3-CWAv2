"""Parameterized read-only queries; UI does not construct SQL."""

import pandas as pd

from src.database import connection
from src.parser import COLUMNS


def _select(where="", params=(), db_path=None) -> pd.DataFrame:
    with connection(db_path) as conn:
        cursor = conn.execute(
            "SELECT region_name, forecast_date, min_temp, max_temp, fetched_at "
            "FROM weather_forecast " + where + " ORDER BY region_name, forecast_date",
            params,
        )
        return pd.DataFrame(cursor.fetchall(), columns=COLUMNS)


def get_all_forecasts(db_path=None) -> pd.DataFrame:
    return _select(db_path=db_path)


def get_regions(db_path=None) -> list[str]:
    with connection(db_path) as conn:
        return [r[0] for r in conn.execute("SELECT DISTINCT region_name FROM weather_forecast ORDER BY region_name")]


def get_forecast_dates(db_path=None) -> list[str]:
    with connection(db_path) as conn:
        return [r[0] for r in conn.execute("SELECT DISTINCT forecast_date FROM weather_forecast ORDER BY forecast_date")]


def get_forecast_by_date(date: str, db_path=None) -> pd.DataFrame:
    return _select("WHERE forecast_date = ?", (date,), db_path)


def get_region_forecast(region: str, db_path=None) -> pd.DataFrame:
    return _select("WHERE region_name = ?", (region,), db_path)


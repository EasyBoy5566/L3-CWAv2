"""Fetch, validate and commit an entire snapshot before exposing it to the UI."""

from datetime import datetime

from src.config import TAIPEI
from src.cwa_api import fetch_weather_data
from src.database import init_database, save_forecasts
from src.errors import WeatherParseError
from src.locations import REGION_COORDINATES
from src.parser import parse_weather_data


def refresh_forecasts(db_path=None):
    raw = fetch_weather_data()
    frame = parse_weather_data(raw)
    expected = set(REGION_COORDINATES)
    if frame.attrs.get("invalid_periods") or set(frame.region_name) != expected:
        raise WeatherParseError("新預報有缺漏或無效時段，已保留上次成功資料；請稍後再更新。")
    if any(set(group.region_name) != expected for _, group in frame.groupby("forecast_date")):
        raise WeatherParseError("新預報的縣市日期範圍不一致，已取消更新。")
    today = datetime.now(TAIPEI).date().isoformat()
    if frame.forecast_date.max() < today:
        raise WeatherParseError("氣象署回傳的預報已過期，已保留上次成功資料。")
    init_database(db_path)
    save_forecasts(frame, db_path, replace_snapshot=True)
    return frame


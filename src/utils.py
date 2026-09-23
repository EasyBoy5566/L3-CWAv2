"""Presentation helpers shared by map, legend, and dashboard."""

import math
from datetime import datetime

from src.config import TAIPEI

TEMPERATURE_STYLES = {
    "Cold": {"color": "#397CBD", "label": "偏涼", "range": "低於 20°C"},
    "Cool": {"color": "#138A83", "label": "舒適", "range": "20 至未滿 25°C"},
    "Warm": {"color": "#C88A1B", "label": "溫暖", "range": "25–30°C"},
    "Hot": {"color": "#CF5146", "label": "炎熱", "range": "高於 30°C"},
}


def get_temperature_category(temp: float) -> str:
    if not math.isfinite(temp):
        raise ValueError("Temperature must be finite")
    if temp < 20:
        return "Cold"
    if temp < 25:
        return "Cool"
    if temp <= 30:
        return "Warm"
    return "Hot"


def format_update(value: str) -> str:
    return datetime.fromisoformat(value).astimezone(TAIPEI).strftime("%m/%d %H:%M")


def format_date(value: str) -> str:
    day = datetime.fromisoformat(value)
    weekday = "一二三四五六日"[day.weekday()]
    return f"{day:%m/%d}（{weekday}）"


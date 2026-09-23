"""Normalize A-B0062-001 (sun) and A-B0063-001 (moon) into one row per county and date.

These are precomputed civil tables. Times are local HH:MM strings kept as
text; a moon that does not rise or set on a date has an empty field.
"""

import re
from datetime import date

from app.errors import WeatherParseError

from .common import text

HHMM = re.compile(r"\d{2}:\d{2}")
SUN = {"SunRiseTime": "sunrise", "SunTransitTime": "sunTransit", "SunSetTime": "sunset"}
MOON = {"MoonRiseTime": "moonrise", "MoonTransitTime": "moonTransit", "MoonSetTime": "moonset"}


def _entries(raw_json: dict, label: str):
    try:
        found = raw_json["records"]["locations"]["location"]
        if not isinstance(found, list):
            raise ValueError
    except (KeyError, TypeError, ValueError):
        raise WeatherParseError(f"{label}格式不符：缺少 records.locations.location。") from None
    for location in found:
        county = text(location.get("CountyName")) if isinstance(location, dict) else None
        if not county:
            continue
        for entry in location.get("time") or []:
            if not isinstance(entry, dict):
                continue
            try:
                day = date.fromisoformat(entry.get("Date", "")).isoformat()
            except (TypeError, ValueError):
                continue
            yield county, day, entry


def parse_astronomy(sun_json: dict, moon_json: dict) -> list[dict]:
    rows: dict[tuple, dict] = {}
    for fields, document, label in ((SUN, sun_json, "日出日沒"), (MOON, moon_json, "月出月沒")):
        for county, day, entry in _entries(document, label):
            row = rows.setdefault((county, day), {
                "county": county, "date": day, **{name: None for name in (*SUN.values(), *MOON.values())}
            })
            for source, name in fields.items():
                value = text(entry.get(source))
                row[name] = value if value and HHMM.fullmatch(value) else None
    if not rows:
        raise WeatherParseError("日月資料中沒有有效的日期。")
    return [rows[key] for key in sorted(rows)]

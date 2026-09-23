"""Value helpers shared by every CWA parser.

CWA sends every value as a string and writes -99 or -999 where an instrument
or a forecast has nothing. Those become None so one missing reading never
discards the rest of a record.
"""

from datetime import datetime
import math

from app.config import TAIPEI

MISSING = {"", "-99", "-99.0", "-999", "-999.0", "-9999", "None", "null", "NaN", "nan", "X"}


def number(value, low: float = -math.inf, high: float = math.inf):
    if value is None or str(value).strip() in MISSING:
        return None
    try:
        result = float(value)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(result) or not low <= result <= high:
        return None
    return result


def text(value):
    if not isinstance(value, str):
        return None
    value = value.strip()
    return None if value in MISSING else value


def timestamp(value) -> datetime | None:
    """An aware datetime in Taipei time, or None for anything naive or malformed."""
    if not isinstance(value, str):
        return None
    try:
        parsed = datetime.fromisoformat(value)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        return None
    return parsed.astimezone(TAIPEI)


def iso(moment: datetime) -> str:
    return moment.astimezone(TAIPEI).isoformat(timespec="seconds")


def first_value(entry: dict) -> dict:
    """The single dict inside a forecast period's ElementValue list."""
    values = entry.get("ElementValue") if isinstance(entry, dict) else None
    if isinstance(values, list) and values and isinstance(values[0], dict):
        return values[0]
    return {}


def locations(raw_json: dict, label: str) -> list[dict]:
    """The Location list of an F-D0047 document, validated once for every parser."""
    from app.errors import WeatherParseError

    try:
        groups = raw_json["records"]["Locations"]
        if not isinstance(groups, list) or not groups:
            raise ValueError
    except (KeyError, TypeError, ValueError):
        raise WeatherParseError(f"{label}格式不符：缺少 records.Locations。") from None
    result = []
    for group in groups:
        entries = group.get("Location") if isinstance(group, dict) else None
        if not isinstance(entries, list) or not entries:
            raise WeatherParseError(f"{label}格式不符：缺少 Location。")
        result.extend(entry for entry in entries if isinstance(entry, dict))
    return result


def elements(location: dict) -> dict[str, list]:
    """ElementName → its Time list, for one forecast location."""
    found = {}
    for element in location.get("WeatherElement") or []:
        if isinstance(element, dict) and isinstance(element.get("Time"), list):
            found[element.get("ElementName")] = element["Time"]
    return found

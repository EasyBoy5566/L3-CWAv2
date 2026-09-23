"""Normalize the verified F-D0047-091 JSON, then aggregate by start date.

The forecast date is the Asia/Taipei date of StartTime. Night periods keep
their start date; these are available-period extremes, not observations or
guaranteed midnight-to-midnight daily extremes.
"""

from datetime import datetime
import math

import pandas as pd

from src.config import TAIPEI
from src.errors import WeatherParseError

COLUMNS = ["region_name", "forecast_date", "min_temp", "max_temp", "fetched_at"]
ELEMENTS = {"最低溫度": "MinTemperature", "最高溫度": "MaxTemperature"}


def _periods(element: dict) -> tuple[dict, int]:
    values = {}
    invalid = 0
    times = element.get("Time")
    if not isinstance(times, list) or not times:
        return values, 1
    for period in times:
        try:
            start = datetime.fromisoformat(period["StartTime"])
            end = datetime.fromisoformat(period["EndTime"])
            if start.tzinfo is None or end.tzinfo is None:
                raise ValueError
            if not 0 < (end - start).total_seconds() <= 86400:
                raise ValueError
            start, end = start.astimezone(TAIPEI), end.astimezone(TAIPEI)
            temp = float(period["ElementValue"][0][ELEMENTS[element["ElementName"]]])
            if not math.isfinite(temp) or not -90 <= temp <= 65:
                raise ValueError
        except (KeyError, TypeError, ValueError, IndexError, OverflowError):
            invalid += 1
            continue
        key = (start, end)
        if key in values and values[key] != temp:
            raise WeatherParseError("相同預報時段出現互相矛盾的溫度。")
        values[key] = temp
    return values, invalid


def parse_weather_data(raw_json: dict, *, fetched_at: str | None = None) -> pd.DataFrame:
    try:
        groups = raw_json["records"]["Locations"]
        if not isinstance(groups, list) or not groups:
            raise ValueError
    except (KeyError, TypeError, ValueError):
        raise WeatherParseError("預報格式不符：缺少 records.Locations。") from None

    rows = []
    invalid = 0
    regions = set()
    fetched_at = fetched_at or datetime.now(TAIPEI).isoformat()
    for group in groups:
        locations = group.get("Location") if isinstance(group, dict) else None
        if not isinstance(locations, list) or not locations:
            raise WeatherParseError("預報格式不符：缺少 Location。")
        for location in locations:
            if not isinstance(location, dict):
                invalid += 1
                continue
            name = location.get("LocationName")
            if not isinstance(name, str) or not name.strip() or name in regions:
                raise WeatherParseError("地區名稱缺少或重複。")
            name = name.strip()
            regions.add(name)
            elements = location.get("WeatherElement")
            if not isinstance(elements, list):
                invalid += 1
                continue
            temperatures = {}
            for element in elements:
                if isinstance(element, dict) and element.get("ElementName") in ELEMENTS:
                    if element["ElementName"] in temperatures:
                        raise WeatherParseError("同一地區出現重複溫度欄位。")
                    values, errors = _periods(element)
                    temperatures[element["ElementName"]] = values
                    invalid += errors
            low = temperatures.get("最低溫度", {})
            high = temperatures.get("最高溫度", {})
            invalid += len(low.keys() ^ high.keys())
            if not low or not high:
                invalid += 1
            for interval in sorted(low.keys() & high.keys()):
                if low[interval] > high[interval]:
                    invalid += 1
                    continue
                rows.append({
                    "region_name": name,
                    "forecast_date": interval[0].date().isoformat(),
                    "min_temp": low[interval],
                    "max_temp": high[interval],
                    "fetched_at": fetched_at,
                })
    if not rows:
        raise WeatherParseError("預報中沒有有效且可配對的最低／最高溫度。")
    frame = pd.DataFrame(rows).groupby(["region_name", "forecast_date"], as_index=False).agg(
        min_temp=("min_temp", "min"),
        max_temp=("max_temp", "max"),
        fetched_at=("fetched_at", "first"),
    )[COLUMNS].sort_values(["region_name", "forecast_date"]).reset_index(drop=True)
    frame.attrs["invalid_periods"] = invalid
    frame.attrs["source_regions"] = sorted(regions)
    return frame


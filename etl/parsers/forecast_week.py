"""Normalize F-D0047-091, the county forecast for the coming week.

Every element shares the same twelve-hour grid (06–18 and 18–06), except the
first period, which may be shorter, and the UV index, which only has daytime
periods. Rows are keyed by StartTime; a period whose low exceeds its high is
reported and its temperatures dropped.
"""

from app.errors import WeatherParseError

from .common import elements, first_value, iso, locations, number, text, timestamp

FIELDS = {
    "平均溫度": ("temperature", "Temperature", (-30, 50)),
    "最低溫度": ("minT", "MinTemperature", (-30, 50)),
    "最高溫度": ("maxT", "MaxTemperature", (-30, 50)),
    "平均相對濕度": ("humidity", "RelativeHumidity", (0, 100)),
    "12小時降雨機率": ("pop", "ProbabilityOfPrecipitation", (0, 100)),
    "風速": ("windSpeed", "WindSpeed", (0, 100)),
    "紫外線指數": ("uvIndex", "UVIndex", (0, 20)),
}
TEXT_FIELDS = {
    "天氣現象": (("wx", "Weather"), ("wxCode", "WeatherCode")),
    "風向": (("windDir", "WindDirection"),),
    "天氣預報綜合描述": (("description", "WeatherDescription"),),
}


def parse_forecast_week(raw_json: dict) -> tuple[dict[str, list[dict]], int]:
    """County → twelve-hour rows sorted by start, and the count of rejected periods."""
    result = {}
    invalid = 0
    for location in locations(raw_json, "一週預報"):
        name = text(location.get("LocationName"))
        if not name:
            raise WeatherParseError("一週預報的地區名稱缺少。")
        if name in result:
            raise WeatherParseError("一週預報的地區名稱重複。")
        rows: dict = {}
        for label, times in elements(location).items():
            for entry in times:
                if not isinstance(entry, dict):
                    continue
                start, end = timestamp(entry.get("StartTime")), timestamp(entry.get("EndTime"))
                if start is None or end is None or not 0 < (end - start).total_seconds() <= 86400:
                    invalid += 1
                    continue
                row = rows.setdefault(start, {"startTime": iso(start), "endTime": iso(end)})
                value = first_value(entry)
                if label in FIELDS:
                    key, field, bounds = FIELDS[label]
                    row[key] = number(value.get(field), *bounds)
                elif label in TEXT_FIELDS:
                    for key, field in TEXT_FIELDS[label]:
                        row[key] = text(value.get(field))
        ordered = []
        for start in sorted(rows):
            row = rows[start]
            for key, *_ in [*FIELDS.values(), *(pair for pairs in TEXT_FIELDS.values() for pair in pairs)]:
                row.setdefault(key, None)
            if row["minT"] is not None and row["maxT"] is not None and row["minT"] > row["maxT"]:
                invalid += 1
                row["minT"] = row["maxT"] = None
            ordered.append(row)
        result[name] = ordered
    if not any(row.get("maxT") is not None for rows in result.values() for row in rows):
        raise WeatherParseError("一週預報中沒有有效的最高／最低溫度。")
    return result, invalid

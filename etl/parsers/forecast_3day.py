"""Normalize F-D0047-089, the county forecast for the next three days.

Temperature, humidity and comfort are point values (DataTime): hourly for
about 36 hours, then three-hourly. Probability of precipitation and weather
are three-hour periods (StartTime/EndTime); wind is a point value on the
three-hour grid. Each point row takes the period that contains it and the
latest wind value at or before it.
"""

from app.errors import WeatherParseError

from .common import elements, first_value, iso, locations, number, text, timestamp

POINTS = {
    "溫度": ("temperature", "Temperature", (-30, 50)),
    "體感溫度": ("apparentTemperature", "ApparentTemperature", (-40, 60)),
    "露點溫度": ("dewPoint", "DewPoint", (-40, 40)),
    "相對濕度": ("humidity", "RelativeHumidity", (0, 100)),
}


def _points(times: list, field: str, bounds: tuple) -> dict:
    values = {}
    for entry in times:
        moment = timestamp(entry.get("DataTime")) if isinstance(entry, dict) else None
        if moment is not None:
            values[moment] = number(first_value(entry).get(field), *bounds)
    return values


def _periods(times: list) -> list[tuple]:
    periods = []
    for entry in times:
        if not isinstance(entry, dict):
            continue
        start, end = timestamp(entry.get("StartTime")), timestamp(entry.get("EndTime"))
        if start is not None and end is not None and start < end:
            periods.append((start, end, first_value(entry)))
    return sorted(periods, key=lambda period: period[0])


def _containing(periods: list[tuple], moment) -> dict:
    for start, end, value in periods:
        if start <= moment < end:
            return value
    return {}


def parse_forecast_3day(raw_json: dict) -> dict[str, list[dict]]:
    """County → hourly rows sorted by time."""
    result = {}
    for location in locations(raw_json, "3 天預報"):
        name = text(location.get("LocationName"))
        if not name:
            raise WeatherParseError("3 天預報的地區名稱缺少。")
        if name in result:
            raise WeatherParseError("3 天預報的地區名稱重複。")
        found = elements(location)
        series = {key: _points(found.get(label, []), field, bounds) for label, (key, field, bounds) in POINTS.items()}
        comfort = {}
        for entry in found.get("舒適度指數", []):
            moment = timestamp(entry.get("DataTime")) if isinstance(entry, dict) else None
            if moment is not None:
                comfort[moment] = text(first_value(entry).get("ComfortIndexDescription"))
        wind_speed = _points(found.get("風速", []), "WindSpeed", (0, 100))
        wind_dir = {}
        for entry in found.get("風向", []):
            moment = timestamp(entry.get("DataTime")) if isinstance(entry, dict) else None
            if moment is not None:
                wind_dir[moment] = text(first_value(entry).get("WindDirection"))
        pop = _periods(found.get("3小時降雨機率", []))
        weather = _periods(found.get("天氣現象", []))

        rows = []
        wind_times = sorted(wind_speed)
        for moment in sorted(series["temperature"]):
            if series["temperature"][moment] is None:
                continue
            wind_at = max((t for t in wind_times if t <= moment), default=None)
            wx = _containing(weather, moment)
            rows.append({
                "time": iso(moment),
                **{key: series[key].get(moment) for key in series},
                "comfort": comfort.get(moment),
                "pop": number(_containing(pop, moment).get("ProbabilityOfPrecipitation"), 0, 100),
                "wx": text(wx.get("Weather")),
                "wxCode": text(wx.get("WeatherCode")),
                "windSpeed": wind_speed.get(wind_at) if wind_at else None,
                "windDir": wind_dir.get(wind_at) if wind_at else None,
            })
        result[name] = rows
    if not any(result.values()):
        raise WeatherParseError("3 天預報中沒有有效的溫度。")
    return result

"""County values from station readings.

A county can hold dozens of stations from sea level to 3,000 m. The rules:

- Temperature and humidity: median of stations below HIGH_ALTITUDE_METRES,
  or of every station when the county has none (a mountain-only report is
  better than no report).
- Pressure: CWA reports station pressure, which falls about 12 hPa per 100 m,
  so only stations at 100 m or lower are used, then the county's lowest
  station that reports it. Only a few stations measure pressure and some
  counties (Nantou, Chiayi County, Hsinchu City) have none, so those take the
  nearest lowland station to the county's representative point; pressure
  varies slowly enough over that distance for a county-level figure.
- Wind: median speed; direction is the speed-weighted vector mean.
- Rain: median of each station's total since midnight.
- Weather: the most common description among stations that report one.

Readings more than 30 minutes older than a county's newest are ignored, so
one lagging station does not pull an old value into the current slot.
"""

from collections import Counter
from datetime import date, datetime, timedelta
import math
from statistics import median

from app.config import HIGH_ALTITUDE_METRES, TAIPEI

from .counties import COUNTIES

PRESSURE_ALTITUDE_METRES = 100
STALE_WITHIN_SLOT = timedelta(minutes=30)


def _median(values):
    values = [value for value in values if value is not None]
    return round(median(values), 1) if values else None


def _lowland(stations: list[dict], key: str) -> list[dict]:
    reporting = [station for station in stations if station.get(key) is not None]
    low = [station for station in reporting if (station.get("altitude") or 0) < HIGH_ALTITUDE_METRES]
    return low or reporting


def _pressure(stations: list[dict]):
    reporting = [station for station in stations if station.get("pressure") is not None]
    if not reporting:
        return None
    near_sea = [station for station in reporting if (station.get("altitude") or 0) <= PRESSURE_ALTITUDE_METRES]
    if near_sea:
        return _median(station["pressure"] for station in near_sea)
    return min(reporting, key=lambda station: station.get("altitude") or 0)["pressure"]


def _nearest_pressure(county: str, stations: list[dict]):
    if county not in COUNTIES:
        return None
    lat, lon = COUNTIES[county]
    lowland = [
        station for station in stations
        if station.get("pressure") is not None and (station.get("altitude") or 0) <= PRESSURE_ALTITUDE_METRES
    ]
    if not lowland:
        return None
    scale = math.cos(math.radians(lat))
    nearest = min(lowland, key=lambda station: (station["lat"] - lat) ** 2 + ((station["lon"] - lon) * scale) ** 2)
    return nearest["pressure"]


def _wind_direction(stations: list[dict]):
    east = north = 0.0
    for station in stations:
        speed, direction = station.get("windSpeed"), station.get("windDir")
        if speed and direction is not None:
            east += speed * math.sin(math.radians(direction))
            north += speed * math.cos(math.radians(direction))
    if east == 0 and north == 0:
        return None
    return round(math.degrees(math.atan2(east, north))) % 360


def county_observations(stations: list[dict]) -> list[dict]:
    """One row per county from one fetch of O-A0003-001."""
    by_county: dict[str, list[dict]] = {}
    for station in stations:
        by_county.setdefault(station["county"], []).append(station)
    rows = []
    for county, members in sorted(by_county.items()):
        newest = max(datetime.fromisoformat(station["observedAt"]) for station in members)
        current = [
            station for station in members
            if newest - datetime.fromisoformat(station["observedAt"]) <= STALE_WITHIN_SLOT
        ]
        temperature_stations = _lowland(current, "temperature")
        weathers = [station["weather"] for station in current if station.get("weather")]
        rows.append({
            "county": county,
            "observedAt": newest.isoformat(timespec="seconds"),
            "temperature": _median(station["temperature"] for station in temperature_stations),
            "humidity": _median(station["humidity"] for station in _lowland(current, "humidity")),
            "pressure": _pressure(current) or _nearest_pressure(county, stations),
            "windSpeed": _median(station.get("windSpeed") for station in current),
            "windDir": _wind_direction(current),
            "rain": _median(station.get("rain") for station in current),
            "weather": Counter(weathers).most_common(1)[0][0] if weathers else None,
            "stationCount": len(temperature_stations),
        })
    return rows


def daily_observed(county: str, day: date, samples: list[dict]) -> dict | None:
    """Summarise one county's ten-minute rows for a Taipei calendar day."""
    start = datetime.combine(day, datetime.min.time(), TAIPEI)
    end = start + timedelta(days=1)
    inside = [row for row in samples if start <= datetime.fromisoformat(row["observedAt"]) < end]
    temperatures = [row["temperature"] for row in inside if row.get("temperature") is not None]
    if not temperatures:
        return None

    def average(key):
        values = [row[key] for row in inside if row.get(key) is not None]
        return round(sum(values) / len(values), 1) if values else None

    # The midnight reading can still carry yesterday's total, so it is skipped.
    rain = [row["rain"] for row in inside if row.get("rain") is not None and datetime.fromisoformat(row["observedAt"]) > start]
    return {
        "county": county,
        "date": day.isoformat(),
        "tmin": min(temperatures),
        "tmax": max(temperatures),
        "tavg": round(sum(temperatures) / len(temperatures), 1),
        "humidityAvg": average("humidity"),
        "pressureAvg": average("pressure"),
        "rainSum": max(rain) if rain else None,
        "samples": len(inside),
    }

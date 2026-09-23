"""The optional map overlays: fetched from CWA on demand, reduced, and cached.

They are not written to the database. Each one is a live view of a single
dataset, so the function keeps the reduced payload in memory for a few
minutes and the edge caches the response for the same time: however many
visitors turn a layer on, CWA sees about one request per interval.
"""

from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
import threading
import time

from app import config
from app.errors import WeatherParseError
from etl.cwa import fetch_dataset
from etl.parsers import overlays as parse

# Seconds each overlay stays fresh, matched to how often CWA republishes it.
TTL = {
    "rain": 600,
    "stations": 600,
    "typhoon": 900,
    "heat": 3600,
    "uv": 3600,
    "townships": 1800,
}

_cache: dict[str, tuple[float, dict]] = {}
_lock = threading.Lock()


def _cached(name: str, build) -> dict:
    now = time.monotonic()
    with _lock:
        hit = _cache.get(name)
        if hit and now - hit[0] < TTL[name]:
            return hit[1]
    payload = build()
    with _lock:
        _cache[name] = (now, payload)
    return payload


def clear_cache() -> None:
    with _lock:
        _cache.clear()


def _rain() -> dict:
    stations = parse.parse_rain(fetch_dataset(config.RAIN_DATASET))
    return {"time": max((s["time"] for s in stations if s["time"]), default=None), "stations": stations}


def _stations() -> dict:
    stations = parse.parse_hourly_stations(fetch_dataset(config.HOURLY_STATIONS_DATASET))
    return {"time": max((s["time"] for s in stations if s["time"]), default=None), "stations": stations}


def _typhoon() -> dict:
    return {"cyclones": parse.parse_typhoons(fetch_dataset(config.TYPHOON_DATASET))}


def _heat() -> dict:
    return {"towns": parse.parse_heat(fetch_dataset(config.HEAT_DATASET), config.now())}


def _uv(database) -> dict:
    # UV readings carry only a station id; the observation job keeps the station table.
    rows = database.query("SELECT stationId, name, county, town, lat, lon FROM Stations")
    stations = {row["stationId"]: row for row in rows}
    return parse.parse_uv(fetch_dataset(config.UV_DATASET), stations)


def _townships() -> dict:
    """F-D0047-093 accepts at most five counties per request, so ask in parallel batches."""
    now = config.now().replace(minute=0, second=0, microsecond=0)
    window = {
        "timeFrom": now.strftime("%Y-%m-%dT%H:%M:%S"),
        "timeTo": (now + timedelta(hours=4)).strftime("%Y-%m-%dT%H:%M:%S"),
    }
    ids = config.TOWNSHIP_LOCATION_IDS
    batches = [ids[i:i + 5] for i in range(0, len(ids), 5)]
    with ThreadPoolExecutor(max_workers=len(batches)) as pool:
        documents = list(pool.map(
            lambda batch: fetch_dataset(config.TOWNSHIP_DATASET, {"locationId": ",".join(batch), **window}),
            batches,
        ))
    return {"towns": parse.parse_townships(documents, config.now())}


NAMES = ("rain", "stations", "typhoon", "heat", "uv", "townships")


def overlay(name: str, database) -> dict:
    builders = {
        "rain": _rain,
        "stations": _stations,
        "typhoon": _typhoon,
        "heat": _heat,
        "uv": lambda: _uv(database),
        "townships": _townships,
    }
    if name not in builders:
        raise WeatherParseError("沒有這個圖層。")
    return _cached(name, builders[name])

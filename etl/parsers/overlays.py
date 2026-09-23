"""Normalize the datasets behind the optional map overlays.

These are read through the server and cached, not stored: each parser
reduces a CWA document to the few fields the globe draws, as plain dicts with
short keys, because the station layers run to over a thousand points.
"""

from datetime import datetime, timedelta

from app.config import TAIPEI
from app.errors import WeatherParseError

from .common import elements, first_value, iso, number, text, timestamp
from .observation import _coordinates


def _stations(raw_json: dict, label: str) -> list[dict]:
    try:
        stations = raw_json["records"]["Station"]
        if not isinstance(stations, list) or not stations:
            raise ValueError
    except (KeyError, TypeError, ValueError):
        raise WeatherParseError(f"{label}格式不符：缺少 records.Station。") from None
    return [s for s in stations if isinstance(s, dict)]


def _place(station: dict) -> dict | None:
    geo = station.get("GeoInfo") if isinstance(station.get("GeoInfo"), dict) else {}
    coordinates = _coordinates(geo)
    identifier = text(station.get("StationId"))
    if coordinates is None or not identifier:
        return None
    observed = timestamp((station.get("ObsTime") or {}).get("DateTime"))
    return {
        "id": identifier,
        "name": text(station.get("StationName")),
        "county": text(geo.get("CountyName")),
        "town": text(geo.get("TownName")),
        "lat": coordinates[0],
        "lon": coordinates[1],
        "alt": number(geo.get("StationAltitude"), -100, 4000),
        "time": iso(observed) if observed else None,
    }


def parse_rain(raw_json: dict) -> list[dict]:
    """O-A0002-001: accumulated rain at 1,300+ gauges, in mm."""
    periods = {"r10m": "Past10Min", "r1h": "Past1hr", "r3h": "Past3hr", "r24h": "Past24hr", "r3d": "Past3days"}
    rows = []
    for station in _stations(raw_json, "雨量站"):
        place = _place(station)
        element = station.get("RainfallElement")
        if place is None or not isinstance(element, dict):
            continue
        for key, source in periods.items():
            place[key] = number((element.get(source) or {}).get("Precipitation"), 0, 3000)
        rows.append(place)
    if not rows:
        raise WeatherParseError("雨量資料中沒有有效的測站。")
    return rows


def parse_hourly_stations(raw_json: dict) -> list[dict]:
    """O-A0001-001: hourly readings at every weather station, with gusts and the day's range."""
    rows = []
    for station in _stations(raw_json, "逐時觀測"):
        place = _place(station)
        element = station.get("WeatherElement")
        if place is None or not isinstance(element, dict):
            continue
        extreme = element.get("DailyExtreme") if isinstance(element.get("DailyExtreme"), dict) else {}
        high = ((extreme.get("DailyHigh") or {}).get("TemperatureInfo") or {}).get("AirTemperature")
        low = ((extreme.get("DailyLow") or {}).get("TemperatureInfo") or {}).get("AirTemperature")
        place.update({
            "t": number(element.get("AirTemperature"), -30, 50),
            "rh": number(element.get("RelativeHumidity"), 0, 100),
            "p": number(element.get("AirPressure"), 500, 1100),
            "ws": number(element.get("WindSpeed"), 0, 120),
            "wd": number(element.get("WindDirection"), 0, 360),
            "gust": number((element.get("GustInfo") or {}).get("PeakGustSpeed"), 0, 150),
            "wx": text(element.get("Weather")),
            "hi": number(high, -30, 50),
            "lo": number(low, -30, 50),
        })
        rows.append(place)
    if not rows:
        raise WeatherParseError("逐時觀測中沒有有效的測站。")
    return rows


def _fix(fix: dict) -> dict | None:
    lat = number(fix.get("CoordinateLatitude"), -60, 60)
    lon = number(fix.get("CoordinateLongitude"), 0, 360)
    if lat is None or lon is None:
        return None
    return {
        "lat": lat,
        "lon": lon,
        "wind": number(fix.get("MaxWindSpeed"), 0, 150),
        "gust": number(fix.get("MaxGustSpeed"), 0, 200),
        "pressure": number(fix.get("Pressure"), 850, 1100),
        "r15": number((fix.get("Circle15ms") or {}).get("Radius"), 0, 2000),
    }


def parse_typhoons(raw_json: dict) -> list[dict]:
    """W-C0034-005: every active tropical cyclone's track and forecast. Empty when there are none."""
    try:
        cyclones = raw_json["records"]["TropicalCyclones"]
    except (KeyError, TypeError):
        raise WeatherParseError("颱風資料格式不符：缺少 TropicalCyclones。") from None
    cyclones = (cyclones or {}).get("TropicalCyclone") or []
    if isinstance(cyclones, dict):
        cyclones = [cyclones]
    result = []
    for cyclone in cyclones:
        if not isinstance(cyclone, dict):
            continue
        track = []
        for fix in (cyclone.get("AnalysisData") or {}).get("Fix") or []:
            point = _fix(fix) if isinstance(fix, dict) else None
            moment = timestamp(fix.get("DateTime")) if isinstance(fix, dict) else None
            if point and moment:
                point["time"] = iso(moment)
                point["moving"] = next((p.get("value") for p in fix.get("MovingPrediction") or []
                                        if isinstance(p, dict) and p.get("lang") == "zh-hant"), None)
                track.append(point)
        forecast = []
        for fix in (cyclone.get("ForecastData") or {}).get("Fix") or []:
            point = _fix(fix) if isinstance(fix, dict) else None
            start = timestamp(fix.get("InitialTime")) if isinstance(fix, dict) else None
            hours = number(fix.get("ForecastHour"), 0, 240) if isinstance(fix, dict) else None
            if point and start and hours is not None:
                point["hour"] = int(hours)
                point["time"] = iso(start + timedelta(hours=hours))
                point["r70"] = number(fix.get("Radius70PercentProbability"), 0, 2000)
                forecast.append(point)
        if not track:
            continue
        track.sort(key=lambda p: p["time"])
        forecast.sort(key=lambda p: p["hour"])
        result.append({
            "name": text(cyclone.get("CwaTyphoonName")) or text(cyclone.get("TyphoonName")),
            "nameEn": text(cyclone.get("TyphoonName")),
            "number": text(cyclone.get("CwaTyNo")) or text(cyclone.get("CwaTdNo")),
            "track": track,
            "forecast": forecast,
        })
    return result


def _local(value) -> datetime | None:
    """'2026-09-24 15:00:00', local Taipei time without an offset."""
    if not isinstance(value, str):
        return None
    try:
        return datetime.strptime(value.strip(), "%Y-%m-%d %H:%M:%S").replace(tzinfo=TAIPEI)
    except ValueError:
        return None


def parse_heat(raw_json: dict, now: datetime) -> list[dict]:
    """M-A0085-001: the heat-injury index per township, now and at its peak in the next day."""
    try:
        counties = raw_json["records"]["Locations"]
        if not isinstance(counties, list):
            raise ValueError
    except (KeyError, TypeError, ValueError):
        raise WeatherParseError("熱傷害指數格式不符：缺少 Locations。") from None
    rows = []
    horizon = now + timedelta(hours=24)
    for county in counties:
        for town in (county or {}).get("Location") or []:
            lat = number(town.get("Latitude"), 10, 27)
            lon = number(town.get("Longitude"), 114, 123)
            if lat is None or lon is None:
                continue
            slots = []
            for entry in town.get("Time") or []:
                moment = _local(entry.get("IssueTime")) if isinstance(entry, dict) else None
                values = entry.get("WeatherElements") if isinstance(entry, dict) else None
                if moment and isinstance(values, dict):
                    slots.append((moment, number(values.get("HeatInjuryIndex"), 0, 60), text(values.get("HeatInjuryWarning"))))
            slots.sort(key=lambda s: s[0])
            # The slot covering now is the latest one that has started.
            current = next((s for s in reversed(slots) if s[0] <= now), slots[0] if slots else None)
            upcoming = [s for s in slots if now <= s[0] <= horizon and s[1] is not None]
            peak = max(upcoming, key=lambda s: s[1]) if upcoming else None
            if current is None:
                continue
            rows.append({
                "county": text(county.get("CountyName")),
                "town": text(town.get("TownName")),
                "lat": lat,
                "lon": lon,
                "index": current[1],
                "warning": current[2],
                "time": iso(current[0]),
                "peak": peak[1] if peak else None,
                "peakTime": iso(peak[0]) if peak else None,
                "peakWarning": peak[2] if peak else None,
            })
    if not rows:
        raise WeatherParseError("熱傷害指數中沒有有效的鄉鎮。")
    return rows


def parse_uv(raw_json: dict, stations: dict[str, dict]) -> dict:
    """O-A0005-001: each staffed station's highest UV index of the day, placed by station id."""
    try:
        element = raw_json["records"]["weatherElement"]
        readings = element["location"]
    except (KeyError, TypeError):
        raise WeatherParseError("紫外線資料格式不符：缺少 weatherElement.location。") from None
    rows = []
    for reading in readings or []:
        identifier = text(reading.get("StationID")) if isinstance(reading, dict) else None
        station = stations.get(identifier or "")
        value = number(reading.get("UVIndex"), 0, 20) if isinstance(reading, dict) else None
        if station and value is not None:
            rows.append({"id": identifier, "name": station["name"], "county": station["county"],
                         "town": station.get("town"), "lat": station["lat"], "lon": station["lon"], "uv": value})
    return {"date": text(element.get("Date")), "stations": rows}


def parse_townships(documents: list[dict], now: datetime) -> list[dict]:
    """F-D0047-093: each township's temperature, weather and rain chance for the hour at hand."""
    rows = []
    for document in documents:
        for group in (document.get("records") or {}).get("Locations") or []:
            county = text(group.get("LocationsName"))
            for location in group.get("Location") or []:
                lat = number(location.get("Latitude"), 10, 27)
                lon = number(location.get("Longitude"), 114, 123)
                if lat is None or lon is None:
                    continue
                found = elements(location)

                def at_now(label, field):
                    best = None
                    for entry in found.get(label, []):
                        moment = timestamp(entry.get("DataTime") or entry.get("StartTime"))
                        if moment is None:
                            continue
                        if best is None or abs((moment - now).total_seconds()) < abs((best[0] - now).total_seconds()):
                            best = (moment, first_value(entry))
                    return (best[1].get(field) if best else None), best

                temperature, _ = at_now("溫度", "Temperature")
                pop, _ = at_now("3小時降雨機率", "ProbabilityOfPrecipitation")
                weather, slot = at_now("天氣現象", "Weather")
                rows.append({
                    "county": county,
                    "town": text(location.get("LocationName")),
                    "lat": lat,
                    "lon": lon,
                    "t": number(temperature, -30, 50),
                    "pop": number(pop, 0, 100),
                    "wx": text(weather),
                    "wxCode": text(slot[1].get("WeatherCode")) if slot else None,
                })
    if not rows:
        raise WeatherParseError("鄉鎮預報中沒有有效的鄉鎮。")
    return rows

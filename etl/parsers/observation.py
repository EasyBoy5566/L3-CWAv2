"""Normalize O-A0003-001 automatic station observations.

A station keeps its entry when one reading is missing; only that reading
becomes None, so a station with a working thermometer is never dropped
because its anemometer is offline.
"""

from app.errors import WeatherParseError

from .common import iso, number, text, timestamp

# WGS84 bounds covering every CWA station: the main island plus Penghu,
# Kinmen, Matsu and the South China Sea outposts on Pratas and Itu Aba.
LAT_RANGE = (10.0, 26.5)
LON_RANGE = (114.0, 122.5)


def _coordinates(geo: dict):
    """Prefer WGS84; the TWD67 pair in the same record is offset by ~800 m."""
    for entry in geo.get("Coordinates") or []:
        if isinstance(entry, dict) and entry.get("CoordinateName") == "WGS84":
            latitude = number(entry.get("StationLatitude"), *LAT_RANGE)
            longitude = number(entry.get("StationLongitude"), *LON_RANGE)
            if latitude is not None and longitude is not None:
                return latitude, longitude
    return None


def parse_observations(raw_json: dict) -> list[dict]:
    try:
        stations = raw_json["records"]["Station"]
        if not isinstance(stations, list) or not stations:
            raise ValueError
    except (KeyError, TypeError, ValueError):
        raise WeatherParseError("觀測格式不符：缺少 records.Station。") from None

    rows = []
    seen = set()
    for station in stations:
        if not isinstance(station, dict):
            continue
        identifier = text(station.get("StationId"))
        name = text(station.get("StationName"))
        geo = station.get("GeoInfo")
        element = station.get("WeatherElement")
        if not identifier or not name or not isinstance(geo, dict) or not isinstance(element, dict):
            continue
        if identifier in seen:
            raise WeatherParseError("觀測資料出現重複的測站代號。")
        county = text(geo.get("CountyName"))
        coordinates = _coordinates(geo)
        observed = timestamp((station.get("ObsTime") or {}).get("DateTime"))
        if not county or coordinates is None or observed is None:
            continue
        seen.add(identifier)
        now = element.get("Now") if isinstance(element.get("Now"), dict) else {}
        rows.append({
            "stationId": identifier,
            "stationName": name,
            "county": county,
            "town": text(geo.get("TownName")),
            "lat": coordinates[0],
            "lon": coordinates[1],
            "altitude": number(geo.get("StationAltitude"), -100, 4000),
            "observedAt": iso(observed),
            "temperature": number(element.get("AirTemperature"), -30, 50),
            "humidity": number(element.get("RelativeHumidity"), 0, 100),
            "pressure": number(element.get("AirPressure"), 500, 1100),
            "windSpeed": number(element.get("WindSpeed"), 0, 120),
            "windDir": number(element.get("WindDirection"), 0, 360),
            "weather": text(element.get("Weather")),
            # CWA's Now.Precipitation is the total since local midnight.
            "rain": number(now.get("Precipitation"), 0, 3000),
        })
    if not rows:
        raise WeatherParseError("觀測資料中沒有有效的測站。")
    rows.sort(key=lambda row: row["stationId"])
    return rows

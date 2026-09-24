"""Weather alerts for the top bar's ticker: one sentence each, most urgent first.

Two kinds:

- Official: CWA's own alerts. Rain (大雨/豪雨特報, W-C0033-003), low
  temperature (W-C0033-004) and high temperature (高溫資訊, W-C0033-005) come
  as CAP messages with a headline, a one-sentence description and the areas;
  any other warning in force (陸上強風, 濃霧, 颱風…) is read from the
  per-county list, W-C0033-001.
- Derived: what the stored forecasts and live readings imply, in the same
  plain words: thunderstorms and likely rain, apparent heat, strong wind, UV,
  cold and wide day-night swings, heavy rain falling now, the typhoon's
  closest approach; and, so the ticker is never empty, the day's hottest and
  wettest counties.

Each alert: {id, kind, category, level (1-3), title, text, counties, at, until}.
"""

import math
import threading
import time
from collections import defaultdict
from datetime import datetime, timedelta

from app import config, overlays
from app.errors import WeatherError
from etl.counties import COUNTIES
from etl.cwa import fetch_dataset
from etl.parsers.common import iso, timestamp

CAP_DATASETS = ("W-C0033-003", "W-C0033-004", "W-C0033-005")
WARNINGS_DATASET = "W-C0033-001"
TTL_SECONDS = 600

# CAP severity → level.
SEVERITY = {"Minor": 1, "Moderate": 2, "Severe": 3, "Extreme": 3}
# Beaufort 6 (strong breeze) and up, in m/s.
WINDY = 10.8
BEAUFORT = [0.3, 1.6, 3.4, 5.5, 8.0, 10.8, 13.9, 17.2, 20.8, 24.5, 28.5, 32.7]

_lock = threading.Lock()
_cache: dict = {}


# ---------- words ----------

def _part_of_day(hour: int) -> str:
    if hour < 5:
        return "凌晨"
    if hour < 8:
        return "清晨"
    if hour < 11:
        return "上午"
    if hour < 13:
        return "中午"
    if hour < 17:
        return "下午"
    if hour < 19:
        return "傍晚"
    return "晚上"


def when(moment: datetime, now: datetime, part: bool = True) -> str:
    """今天下午, 明天清晨, 9/28 晚上…"""
    days = (moment.date() - now.date()).days
    day = {0: "今天", 1: "明天", 2: "後天"}.get(days, f"{moment.month}/{moment.day}")
    return f"{day}{_part_of_day(moment.hour)}" if part else day


def places(counties: list[str]) -> str:
    ordered = [name for name in COUNTIES if name in set(counties)]
    if len(ordered) <= 3:
        return "、".join(ordered)
    return f"{'、'.join(ordered[:2])}等 {len(ordered)} 縣市"


def _beaufort(speed: float) -> int:
    return next((level for level, limit in enumerate(BEAUFORT) if speed < limit), 12)


def _county_of(area: str) -> str | None:
    """'臺南市玉井區' → '臺南市'."""
    return next((name for name in COUNTIES if area.startswith(name)), None)


def _first_sentence(text: str) -> str:
    text = " ".join((text or "").split())
    head, dot, _ = text.partition("。")
    return head + dot if head else ""


# ---------- official ----------

def parse_cap(raw: dict, now: datetime) -> list[dict]:
    """CAP messages (W-C0033-003/004/005) in force or starting later: not expired, not a lifting."""
    alerts = []
    infos = (raw.get("records") or {}).get("info") or []
    for info in infos if isinstance(infos, list) else [infos]:
        if not isinstance(info, dict):
            continue
        headline = (info.get("headline") or "").strip()
        expires = timestamp(info.get("expires"))
        if not headline or headline.startswith("解除") or info.get("urgency") == "Past":
            continue
        if expires is not None and expires <= now:
            continue
        params = {p.get("valueName"): p.get("value") for p in info.get("parameter") or [] if isinstance(p, dict)}
        areas = [a.get("areaDesc", "") for a in info.get("area") or [] if isinstance(a, dict)]
        counties = sorted({c for c in map(_county_of, areas) if c}, key=list(COUNTIES).index)
        title = params.get("severity_level") or params.get("alert_title") or headline
        onset = timestamp(info.get("onset")) or timestamp(info.get("effective"))
        # Our own words, from the alert's fields: CWA's description is dated
        # from the day it was issued ("明(25)日…") and reads wrong a day later.
        start = when(onset, now) if onset and onset > now else "目前"
        criteria = params.get("alert_criteria")
        text = f"{start} {places(counties)}{title}" + (f"，{criteria}" if criteria else "")
        alerts.append({
            "id": f"cap:{info.get('eventCode', {}).get('value', title)}:{info.get('effective')}",
            "kind": "official",
            "category": {"rainfall": "rain", "heat": "heat", "coldSurge": "cold"}.get((info.get("eventCode") or {}).get("value"), "warning"),
            "level": SEVERITY.get(info.get("severity"), 2),
            "title": title,
            "text": text,
            "counties": counties,
            "at": onset.isoformat() if onset else None,
            "until": expires.isoformat() if expires else None,
            "color": params.get("alert_color"),
            "detail": _first_sentence(info.get("description")),
        })
    return alerts


def parse_warnings(raw: dict, now: datetime) -> list[dict]:
    """W-C0033-001: every warning in force, per county, grouped by phenomenon."""
    groups: dict[tuple, dict] = {}
    for location in (raw.get("records") or {}).get("location") or []:
        county = location.get("locationName")
        if county not in COUNTIES:
            continue
        hazards = ((location.get("hazardConditions") or {}).get("hazards")) or []
        for hazard in hazards if isinstance(hazards, list) else [hazards]:
            info = (hazard or {}).get("info") or {}
            phenomena, significance = info.get("phenomena"), info.get("significance") or ""
            valid = (hazard or {}).get("validTime") or {}
            end = timestamp(valid.get("endTime"))
            if not phenomena or (end is not None and end <= now):
                continue
            group = groups.setdefault((phenomena, significance), {"counties": [], "end": end, "start": timestamp(valid.get("startTime"))})
            group["counties"].append(county)
    alerts = []
    for (phenomena, significance), group in groups.items():
        title = f"{phenomena}{significance}"
        until = f"，至 {group['end'].month}/{group['end'].day} {group['end']:%H:%M}" if group["end"] else ""
        alerts.append({
            "id": f"w:{title}",
            "kind": "official",
            "category": "rain" if "雨" in phenomena else "typhoon" if "颱風" in phenomena else "warning",
            "level": 3 if significance == "警報" or "豪雨" in phenomena else 2,
            "title": title,
            "text": f"{title}：{places(group['counties'])}{until}",
            "counties": group["counties"],
            "at": group["start"].isoformat() if group["start"] else None,
            "until": group["end"].isoformat() if group["end"] else None,
        })
    return alerts


# ---------- derived ----------

def _latest_run(database) -> int | None:
    rows = database.query("SELECT MAX(id) AS id FROM ForecastRuns")
    return rows[0]["id"] if rows else None


def _first_hits(rows: list[dict], test) -> dict[str, dict]:
    """The first row per county that passes `test`."""
    hits = {}
    for row in rows:
        if row["regionName"] not in hits and test(row):
            hits[row["regionName"]] = row
    return hits


def _grouped(hits: dict[str, dict], now: datetime, key) -> list[tuple[str, list[str], list[dict]]]:
    """Counties grouped by when their first hit falls: [(phrase, counties, rows)], soonest first."""
    groups = defaultdict(list)
    for county, row in hits.items():
        groups[when(timestamp(row["time"]), now, part=key == "part")].append((county, row))
    order = sorted(groups.items(), key=lambda item: min(timestamp(r["time"]) for _, r in item[1]))
    return [(phrase, [c for c, _ in members], [r for _, r in members]) for phrase, members in order]


def derived_from_forecasts(database, now: datetime) -> list[dict]:
    run = _latest_run(database)
    if run is None:
        return []
    horizon = now + timedelta(hours=30)
    hourly = database.query(
        "SELECT regionName, time, temperature, apparentTemperature, pop, wx, windSpeed FROM HourlyForecasts "
        "WHERE runId = ? AND time >= ? AND time <= ? ORDER BY time",
        (run, iso(now.replace(minute=0, second=0, microsecond=0)), iso(horizon)),
    )
    alerts = []

    thunder = _first_hits(hourly, lambda r: "雷" in (r["wx"] or "") and (r["pop"] or 0) >= 50)
    for phrase, counties, _ in _grouped(thunder, now, "part"):
        alerts.append({"category": "thunder", "level": 2, "title": "雷陣雨",
                       "text": f"{phrase} {places(counties)}可能有雷陣雨，外出注意", "counties": counties})

    rainy = _first_hits(hourly, lambda r: r["regionName"] not in thunder and (r["pop"] or 0) >= 70)
    for phrase, counties, rows in _grouped(rainy, now, "part"):
        top = max(r["pop"] for r in rows)
        alerts.append({"category": "rain", "level": 1, "title": "降雨",
                       "text": f"{phrase} {places(counties)}降雨機率 {round(top)}%，出門記得帶傘", "counties": counties})

    hot = {}
    for row in hourly:
        value = row["apparentTemperature"]
        if value is not None and value >= 36 and value > hot.get(row["regionName"], {}).get("apparentTemperature", 0):
            hot[row["regionName"]] = row
    for phrase, counties, rows in _grouped(hot, now, "part"):
        top = max(r["apparentTemperature"] for r in rows)
        alerts.append({"category": "heat", "level": 2 if top >= 38 else 1, "title": "體感炎熱",
                       "text": f"{phrase} {places(counties)}體感溫度達 {round(top)} 度，注意補水防中暑", "counties": counties})

    windy = _first_hits(hourly, lambda r: (r["windSpeed"] or 0) >= WINDY)
    for phrase, counties, rows in _grouped(windy, now, "part"):
        level = _beaufort(max(r["windSpeed"] for r in rows))
        alerts.append({"category": "wind", "level": 2 if level >= 8 else 1, "title": "風大",
                       "text": f"{phrase} {places(counties)}風力達 {level} 級，戶外與海邊活動注意安全", "counties": counties})

    # The week's twelve-hour periods: UV, cold nights, wide swings.
    periods = database.query(
        "SELECT regionName, startTime, endTime, minT, maxT, uvIndex FROM PeriodForecasts "
        "WHERE runId = ? AND endTime > ? AND startTime < ? ORDER BY startTime",
        (run, iso(now), iso(now + timedelta(days=3))),
    )
    daytime = [p for p in periods if timestamp(p["startTime"]).hour == 6]
    # UV is a daytime matter: today's until mid-afternoon, then tomorrow's.
    uv_day = now.date() if now.hour < 15 else (now + timedelta(days=1)).date()
    uv = [p for p in daytime if timestamp(p["startTime"]).date() == uv_day and (p["uvIndex"] or 0) >= 8]
    for danger in (True, False):
        counties = [p["regionName"] for p in uv if ((p["uvIndex"] >= 11) == danger)]
        if counties:
            day = when(datetime.combine(uv_day, datetime.min.time(), tzinfo=now.tzinfo), now, part=False)
            alerts.append({"category": "uv", "level": 2 if danger else 1, "title": "紫外線",
                           "text": f"{day} {places(counties)}紫外線達{'危險' if danger else '過量'}級，外出注意防曬", "counties": counties})

    nights = [p for p in periods if timestamp(p["startTime"]).hour == 18 and p["minT"] is not None and p["minT"] <= 12]
    by_night = defaultdict(list)
    for p in nights:
        by_night[timestamp(p["endTime"]).date()].append(p)
    for day, rows in sorted(by_night.items())[:1]:
        low = min(r["minT"] for r in rows)
        phrase = when(datetime.combine(day, datetime.min.time(), tzinfo=now.tzinfo).replace(hour=6), now)
        alerts.append({"category": "cold", "level": 2 if low <= 8 else 1, "title": "低溫",
                       "text": f"{phrase} {places([r['regionName'] for r in rows])}低溫 {round(low)} 度，注意保暖", "counties": [r["regionName"] for r in rows]})

    swings = [p for p in daytime if p["maxT"] is not None and p["minT"] is not None and p["maxT"] - p["minT"] >= 10]
    if swings:
        first_day = min(timestamp(p["startTime"]).date() for p in swings)
        rows = [p for p in swings if timestamp(p["startTime"]).date() == first_day]
        top = max(p["maxT"] - p["minT"] for p in rows)
        day = when(datetime.combine(first_day, datetime.min.time(), tzinfo=now.tzinfo), now, part=False)
        alerts.append({"category": "swing", "level": 1, "title": "溫差大",
                       "text": f"{day} {places([p['regionName'] for p in rows])}早晚溫差達 {round(top)} 度，留意添減衣物", "counties": [p["regionName"] for p in rows]})

    # So the ticker always has something: the day's hottest and wettest.
    today = [r for r in hourly if timestamp(r["time"]).date() == now.date()] or hourly
    if today:
        hottest = max((r for r in today if r["temperature"] is not None), key=lambda r: r["temperature"], default=None)
        if hottest:
            alerts.append({"category": "info", "level": 0, "title": "高溫",
                           "text": f"{when(timestamp(hottest['time']), now, part=False)}最高溫在{hottest['regionName']}，約 {round(hottest['temperature'])} 度", "counties": [hottest["regionName"]]})
        wettest = max(today, key=lambda r: r["pop"] or 0)
        if (wettest["pop"] or 0) >= 30:
            alerts.append({"category": "info", "level": 0, "title": "降雨機率",
                           "text": f"{when(timestamp(wettest['time']), now)} {wettest['regionName']}降雨機率最高，約 {round(wettest['pop'])}%", "counties": [wettest["regionName"]]})
    return alerts


def derived_from_rain(stations: list[dict]) -> list[dict]:
    """Heavy rain falling now, from the gauges (CWA's 大雨 thresholds)."""
    worst: dict[str, dict] = {}
    for s in stations:
        r1h, r24h = s.get("r1h") or 0, s.get("r24h") or 0
        if (r1h >= 40 or r24h >= 80) and r1h >= worst.get(s.get("county"), {}).get("r1h", -1):
            worst[s["county"]] = s
    alerts = []
    for county, s in sorted(worst.items(), key=lambda item: -(item[1].get("r1h") or 0))[:3]:
        heavy = (s.get("r24h") or 0) >= 200 or (s.get("r1h") or 0) >= 100
        amount = f"1 小時雨量 {round(s['r1h'])} 毫米" if (s.get("r1h") or 0) >= 40 else f"24 小時雨量 {round(s['r24h'])} 毫米"
        alerts.append({"category": "rain", "level": 3 if heavy else 2, "title": "豪雨" if heavy else "大雨",
                       "text": f"目前 {county}{s.get('town') or ''} {amount}，已達{'豪雨' if heavy else '大雨'}等級", "counties": [county]})
    return alerts


def _km(lat1, lon1, lat2, lon2):
    rad = math.pi / 180
    a = math.sin((lat2 - lat1) * rad / 2) ** 2 + math.cos(lat1 * rad) * math.cos(lat2 * rad) * math.sin((lon2 - lon1) * rad / 2) ** 2
    return 2 * 6371 * math.asin(math.sqrt(a))


def derived_from_typhoons(cyclones: list[dict], now: datetime) -> list[dict]:
    alerts = []
    for c in cyclones:
        points = [p for p in (c.get("forecast") or []) if p.get("lat") is not None] or (c.get("track") or [])[-1:]
        if not points:
            continue
        nearest = min(
            ((min(_km(p["lat"], p["lon"], la, lo) for la, lo in COUNTIES.values()), p) for p in points),
            key=lambda item: item[0],
        )
        distance, point = nearest
        moment = timestamp(point.get("time"))
        closest = f"{when(moment, now)}最接近臺灣，" if moment and moment > now else ""
        alerts.append({"category": "typhoon", "level": 3 if distance < 300 else 2 if distance < 700 else 1, "title": "颱風",
                       "text": f"{c.get('name') or '熱帶氣旋'}颱風{closest}距離約 {round(distance, -1):.0f} 公里", "counties": []})
    return alerts


# ---------- all ----------

def _fetch_all(database) -> list[dict]:
    now = config.now()
    official = []
    for dataset in CAP_DATASETS:
        try:
            official += parse_cap(fetch_dataset(dataset), now)
        except WeatherError:
            pass
    try:
        # CAP messages already cover rain and temperature; the county list adds the rest.
        covered = {a["category"] for a in official}
        official += [a for a in parse_warnings(fetch_dataset(WARNINGS_DATASET), now)
                     if not (a["category"] == "rain" and "rain" in covered) and not ("高溫" in a["title"] and "heat" in covered)]
    except WeatherError:
        pass

    derived = derived_from_forecasts(database, now)
    # Where CWA has spoken, its word stands: no derived heat next to its 高溫資訊.
    official_heat = {c for a in official if a["category"] == "heat" for c in a["counties"]}
    derived = [a for a in derived if not (a["category"] == "heat" and set(a["counties"]) <= official_heat)]
    try:
        derived += derived_from_rain(overlays.overlay("rain", database)["stations"])
    except (WeatherError, KeyError):
        pass
    try:
        derived += derived_from_typhoons(overlays.overlay("typhoon", database)["cyclones"], now)
    except (WeatherError, KeyError):
        pass

    for i, alert in enumerate(derived):
        alert.setdefault("id", f"d:{alert['category']}:{i}")
        alert.setdefault("kind", "derived")
    # Official first by level, then derived by level; the day's facts last.
    ranked = sorted(official, key=lambda a: -a["level"]) + sorted(derived, key=lambda a: -a["level"])
    return ranked


def alerts(database) -> dict:
    """The ticker's alerts, recomputed at most every TTL_SECONDS."""
    now = time.monotonic()
    with _lock:
        hit = _cache.get("alerts")
        if hit and now - hit[0] < TTL_SECONDS:
            return hit[1]
    payload = {"generatedAt": config.now().isoformat(timespec="seconds"), "alerts": _fetch_all(database)}
    with _lock:
        _cache["alerts"] = (now, payload)
    return payload


def clear_cache() -> None:
    with _lock:
        _cache.clear()

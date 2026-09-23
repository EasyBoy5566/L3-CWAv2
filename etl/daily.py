"""Daily low and high for a Taipei calendar day, 00:00 to 24:00.

Two sources, used in order:

1. F-D0047-089 point forecasts, when they cover the whole day: a sample at
   00:00, one at 21:00 or later, and no gap longer than three hours. The low
   and high are the extremes of those samples. approx = 0.
2. F-D0047-091 twelve-hour periods, when periods cover 00:00 to 18:00. The
   high is the highest maxT of every period touching the day. The low is the
   lowest minT of the periods touching 00:00–18:00; the night that starts at
   18:00 is left out because its low falls on the next morning. approx = 1.

A day neither source covers is omitted, so a run fetched in the afternoon
does not replace today's forecast with one that has lost the morning.
"""

from datetime import date, datetime, time, timedelta

from app.config import TAIPEI

MAX_GAP = timedelta(hours=3)


def _day_bounds(day: date) -> tuple[datetime, datetime]:
    start = datetime.combine(day, time(0), TAIPEI)
    return start, start + timedelta(days=1)


def _from_hourly(day: date, hourly: list[dict]):
    start, end = _day_bounds(day)
    samples = [
        (datetime.fromisoformat(row["time"]), row)
        for row in hourly
        if row.get("temperature") is not None and start <= datetime.fromisoformat(row["time"]) < end
    ]
    if not samples or samples[0][0] != start or samples[-1][0] < start + timedelta(hours=21):
        return None
    times = [moment for moment, _ in samples]
    if any(later - earlier > MAX_GAP for earlier, later in zip(times, times[1:])):
        return None
    temperatures = [row["temperature"] for _, row in samples]
    pops = [row["pop"] for _, row in samples if row.get("pop") is not None]
    return {
        "mint": min(temperatures),
        "maxt": max(temperatures),
        "pop": max(pops) if pops else None,
        "approx": 0,
    }


def _from_periods(day: date, periods: list[dict]):
    start, end = _day_bounds(day)
    evening = start + timedelta(hours=18)
    touching = []
    for row in periods:
        period_start = datetime.fromisoformat(row["startTime"])
        period_end = datetime.fromisoformat(row["endTime"])
        if period_start < end and period_end > start:
            touching.append((period_start, period_end, row))
    touching.sort(key=lambda item: item[0])

    covered = start
    for period_start, period_end, _ in touching:
        if period_start <= covered < period_end:
            covered = period_end
    if covered < evening:
        return None

    lows = [row["minT"] for period_start, _, row in touching if period_start < evening and row.get("minT") is not None]
    highs = [row["maxT"] for _, _, row in touching if row.get("maxT") is not None]
    if not lows or not highs:
        return None
    pops = [row["pop"] for _, _, row in touching if row.get("pop") is not None]
    return {
        "mint": min(lows),
        "maxt": max(highs),
        "pop": max(pops) if pops else None,
        "approx": 1,
    }


def _weather(day: date, periods: list[dict], hourly: list[dict]) -> tuple:
    """The daytime period's weather, else whatever covers noon."""
    start, _ = _day_bounds(day)
    noon = start + timedelta(hours=12)
    for row in periods:
        if datetime.fromisoformat(row["startTime"]) == start + timedelta(hours=6) and row.get("wx"):
            return row["wx"], row.get("wxCode")
    for row in periods:
        if datetime.fromisoformat(row["startTime"]) <= noon < datetime.fromisoformat(row["endTime"]) and row.get("wx"):
            return row["wx"], row.get("wxCode")
    near = [row for row in hourly if row.get("wx") and datetime.fromisoformat(row["time"]).date() == day]
    if near:
        best = min(near, key=lambda row: abs(datetime.fromisoformat(row["time"]) - noon))
        return best["wx"], best.get("wxCode")
    return None, None


def daily_forecasts(hourly: list[dict], periods: list[dict]) -> list[dict]:
    """One county's days, sorted by date."""
    days = {datetime.fromisoformat(row["time"]).date() for row in hourly}
    for row in periods:
        period_start = datetime.fromisoformat(row["startTime"])
        period_end = datetime.fromisoformat(row["endTime"])
        days.add(period_start.date())
        days.add((period_end - timedelta(seconds=1)).date())
    result = []
    for day in sorted(days):
        found = _from_hourly(day, hourly) or _from_periods(day, periods)
        if found is None or found["mint"] > found["maxt"]:
            continue
        wx, wx_code = _weather(day, periods, hourly)
        result.append({"dataDate": day.isoformat(), **found, "wx": wx, "wxCode": wx_code})
    return result

"""Every read the web layer makes. Routes call these; they never write SQL.

All dates are Taipei calendar dates and all timestamps carry +08:00, so the
bounds below are plain string comparisons on indexed text columns.
"""

from datetime import date, datetime, time, timedelta

from app import config
from etl.counties import COUNTIES

# County values older than this are not shown as "now".
CURRENT_WITHIN = timedelta(hours=3)


def _day_start(day: date) -> str:
    return datetime.combine(day, time(0), config.TAIPEI).isoformat(timespec="seconds")


def _iso(moment: datetime) -> str:
    return moment.astimezone(config.TAIPEI).isoformat(timespec="seconds")


def counties() -> list[dict]:
    return [{"name": name, "lat": lat, "lon": lon} for name, (lat, lon) in COUNTIES.items()]


def forecast_dates(database) -> list[str]:
    today = config.now().date().isoformat()
    rows = database.query(
        "SELECT DISTINCT dataDate FROM LatestTemperatureForecasts WHERE dataDate >= ? ORDER BY dataDate",
        (today,),
    )
    return [row["dataDate"] for row in rows]


def current_counties(database) -> dict[str, dict]:
    """Each county's newest ten-minute row, if it is recent enough to call current."""
    since = _iso(config.now() - CURRENT_WITHIN)
    rows = database.query(
        """
        SELECT c.*
        FROM CountyObservations c
        JOIN (
            SELECT county, MAX(observedAt) AS latest
            FROM CountyObservations
            WHERE observedAt >= ?
            GROUP BY county
        ) newest ON newest.county = c.county AND newest.latest = c.observedAt
        """,
        (since,),
    )
    return {row["county"]: row for row in rows}


def forecast_for_date(database, day: str) -> dict[str, dict]:
    rows = database.query(
        "SELECT regionName, dataDate, mint, maxt, pop, wx, wxCode, approx, fetchedAt "
        "FROM LatestTemperatureForecasts WHERE dataDate = ?",
        (day,),
    )
    return {row["regionName"]: row for row in rows}


def map_layer(database, layer: str, day: str | None) -> dict:
    """Values for colouring the 22 counties. ``layer`` is now, maxt, mint or pop."""
    if layer == "now":
        current = current_counties(database)
        values = {
            name: {
                "value": row["temperature"],
                "temperature": row["temperature"],
                "humidity": row["humidity"],
                "weather": row["weather"],
                "windSpeed": row["windSpeed"],
                "windDir": row["windDir"],
                "observedAt": row["observedAt"],
            }
            for name, row in current.items()
        }
        return {"layer": layer, "date": None, "values": values}
    forecast = forecast_for_date(database, day) if day else {}
    field = {"maxt": "maxt", "mint": "mint", "pop": "pop"}[layer]
    values = {
        name: {
            "value": row[field],
            "mint": row["mint"],
            "maxt": row["maxt"],
            "pop": row["pop"],
            "wx": row["wx"],
            "approx": bool(row["approx"]),
        }
        for name, row in forecast.items()
    }
    return {"layer": layer, "date": day, "values": values}


def _latest_run_id(database):
    rows = database.query("SELECT MAX(id) AS id FROM ForecastRuns")
    return rows[0]["id"] if rows else None


def region_detail(database, name: str) -> dict:
    now = config.now()
    today = now.date()
    run_id = _latest_run_id(database)

    current = database.query(
        "SELECT * FROM CountyObservations WHERE county = ? AND observedAt >= ? ORDER BY observedAt DESC LIMIT 1",
        (name, _iso(now - CURRENT_WITHIN)),
    )
    today_rows = database.query(
        "SELECT MIN(temperature) AS tmin, MAX(temperature) AS tmax, COUNT(*) AS samples "
        "FROM CountyObservations WHERE county = ? AND observedAt >= ?",
        (name, _day_start(today)),
    )
    hourly = database.query(
        "SELECT time, temperature, apparentTemperature, dewPoint, humidity, comfort, pop, wx, wxCode, windSpeed, windDir "
        "FROM HourlyForecasts WHERE runId = ? AND regionName = ? AND time >= ? ORDER BY time",
        (run_id, name, _iso(now - timedelta(hours=1))),
    ) if run_id else []
    periods = database.query(
        "SELECT startTime, endTime, temperature, minT, maxT, humidity, pop, wx, wxCode, windSpeed, windDir, "
        "uvIndex, description FROM PeriodForecasts WHERE runId = ? AND regionName = ? AND endTime > ? "
        "ORDER BY startTime",
        (run_id, name, _iso(now)),
    ) if run_id else []
    week = database.query(
        "SELECT dataDate, mint, maxt, pop, wx, wxCode, approx FROM LatestTemperatureForecasts "
        "WHERE regionName = ? AND dataDate >= ? ORDER BY dataDate",
        (name, today.isoformat()),
    )
    astronomy = database.query(
        "SELECT * FROM AstroDaily WHERE county = ? AND date >= ? ORDER BY date LIMIT 2",
        (name, today.isoformat()),
    )
    fetched = database.query("SELECT fetchedAt FROM ForecastRuns WHERE id = ?", (run_id,)) if run_id else []
    today_summary = today_rows[0] if today_rows and today_rows[0]["samples"] else None
    return {
        "name": name,
        "lat": COUNTIES[name][0],
        "lon": COUNTIES[name][1],
        "current": current[0] if current else None,
        "todayObserved": today_summary,
        "hourly": hourly,
        "periods": periods,
        "week": [{**row, "approx": bool(row["approx"])} for row in week],
        "astronomy": astronomy,
        "forecastFetchedAt": fetched[0]["fetchedAt"] if fetched else None,
    }


def region_trend(database, name: str, days: int) -> dict:
    """Hourly county observations for the last ``days`` days, plus each day's forecast."""
    now = config.now()
    since = now - timedelta(days=days)
    # One reading per hour keeps a 30-day chart at ~720 points.
    observed = database.query(
        "SELECT observedAt, temperature, humidity, pressure, rain FROM CountyObservations "
        "WHERE county = ? AND observedAt >= ? AND substr(observedAt, 15, 2) = '00' ORDER BY observedAt",
        (name, _iso(since)),
    )
    daily = database.query(
        "SELECT date, tmin, tmax, tavg, humidityAvg, pressureAvg, rainSum FROM DailyObserved "
        "WHERE county = ? AND date >= ? ORDER BY date",
        (name, since.date().isoformat()),
    )
    forecasts = database.query(
        "SELECT dataDate, mint, maxt, approx FROM LatestTemperatureForecasts "
        "WHERE regionName = ? AND dataDate >= ? AND dataDate < ? ORDER BY dataDate",
        (name, since.date().isoformat(), now.date().isoformat()),
    )
    return {"name": name, "days": days, "observed": observed, "daily": daily, "forecasts": forecasts}


def region_history(database, name: str, day: str) -> dict:
    """One past or current date: what was observed, and how its forecast changed."""
    start = datetime.combine(date.fromisoformat(day), time(0), config.TAIPEI)
    observed = database.query(
        "SELECT observedAt, temperature, humidity, pressure, rain FROM CountyObservations "
        "WHERE county = ? AND observedAt >= ? AND observedAt < ? ORDER BY observedAt",
        (name, _iso(start), _iso(start + timedelta(days=1))),
    )
    summary = database.query("SELECT * FROM DailyObserved WHERE county = ? AND date = ?", (name, day))
    revisions = database.query(
        "SELECT r.fetchedAt, t.mint, t.maxt, t.pop, t.approx FROM TemperatureForecasts t "
        "JOIN ForecastRuns r ON r.id = t.runId WHERE t.regionName = ? AND t.dataDate = ? ORDER BY t.runId",
        (name, day),
    )
    # Consecutive runs often agree; keep only the versions where the numbers changed.
    changes = []
    for row in revisions:
        key = (row["mint"], row["maxt"], row["pop"])
        if not changes or key != (changes[-1]["mint"], changes[-1]["maxt"], changes[-1]["pop"]):
            changes.append({**row, "approx": bool(row["approx"])})
    if summary:
        observed_summary = summary[0]
    elif observed:
        temperatures = [row["temperature"] for row in observed if row["temperature"] is not None]
        observed_summary = {
            "tmin": min(temperatures) if temperatures else None,
            "tmax": max(temperatures) if temperatures else None,
            "samples": len(observed),
            "partial": True,
        }
    else:
        observed_summary = None
    return {
        "name": name,
        "date": day,
        "observed": observed,
        "summary": observed_summary,
        "revisions": changes,
    }


def history_dates(database, name: str) -> dict:
    """The range a history date picker can offer for this county."""
    observed = database.query(
        "SELECT MIN(observedAt) AS first FROM CountyObservations WHERE county = ?", (name,)
    )
    forecast = database.query(
        "SELECT MIN(dataDate) AS first FROM TemperatureForecasts WHERE regionName = ?", (name,)
    )
    firsts = [value for value in (
        observed[0]["first"][:10] if observed and observed[0]["first"] else None,
        forecast[0]["first"] if forecast and forecast[0]["first"] else None,
    ) if value]
    return {"first": min(firsts) if firsts else None, "last": config.now().date().isoformat()}


def astronomy_for(database, name: str, day: str) -> dict | None:
    rows = database.query("SELECT * FROM AstroDaily WHERE county = ? AND date = ?", (name, day))
    return rows[0] if rows else None

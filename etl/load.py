"""SQL statements for each kind of write. Jobs run them inside one batch.

Every insert is idempotent: re-running a job on the same data writes nothing
new, and a row that has not changed is not rewritten (Turso bills row writes).
"""

from app.db import Statement, insert_rows


def job_status(job: str, status: str, at: str, *, error: str | None = None,
               row_count: int | None = None, data_time: str | None = None) -> Statement:
    succeeded = status in ("ok", "unchanged")
    return (
        """
        INSERT INTO JobStatus (job, lastAttemptAt, lastSuccessAt, lastStatus, lastError, lastRowCount, dataTime)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(job) DO UPDATE SET
            lastAttemptAt = excluded.lastAttemptAt,
            lastSuccessAt = COALESCE(excluded.lastSuccessAt, JobStatus.lastSuccessAt),
            lastStatus    = excluded.lastStatus,
            lastError     = excluded.lastError,
            lastRowCount  = COALESCE(excluded.lastRowCount, JobStatus.lastRowCount),
            dataTime      = COALESCE(excluded.dataTime, JobStatus.dataTime)
        """,
        (job, at, at if succeeded else None, status, error, row_count, data_time),
    )


def observation_statements(stations: list[dict], counties: list[dict]) -> list[Statement]:
    station_columns = ["stationId", "name", "county", "town", "lat", "lon", "altitude"]
    statements = insert_rows(
        "Stations",
        station_columns,
        [(s["stationId"], s["stationName"], s["county"], s["town"], s["lat"], s["lon"], s["altitude"]) for s in stations],
        """ON CONFLICT(stationId) DO UPDATE SET
            name = excluded.name, county = excluded.county, town = excluded.town,
            lat = excluded.lat, lon = excluded.lon, altitude = excluded.altitude
        WHERE Stations.name IS NOT excluded.name OR Stations.county IS NOT excluded.county
           OR Stations.town IS NOT excluded.town OR Stations.lat IS NOT excluded.lat
           OR Stations.lon IS NOT excluded.lon OR Stations.altitude IS NOT excluded.altitude""",
    )
    observation_columns = ["stationId", "observedAt", "temperature", "humidity", "pressure",
                           "windSpeed", "windDir", "weather", "rain"]
    statements += insert_rows(
        "Observations",
        observation_columns,
        [tuple(s[column] for column in observation_columns) for s in stations],
        "ON CONFLICT(stationId, observedAt) DO NOTHING",
    )
    county_columns = ["county", "observedAt", "temperature", "humidity", "pressure",
                      "windSpeed", "windDir", "rain", "weather", "stationCount"]
    statements += insert_rows(
        "CountyObservations",
        county_columns,
        [tuple(c[column] for column in county_columns) for c in counties],
        # A later fetch of the same slot can include stations that reported late.
        """ON CONFLICT(county, observedAt) DO UPDATE SET
            temperature = excluded.temperature, humidity = excluded.humidity,
            pressure = excluded.pressure, windSpeed = excluded.windSpeed,
            windDir = excluded.windDir, rain = excluded.rain,
            weather = excluded.weather, stationCount = excluded.stationCount
        WHERE excluded.stationCount > CountyObservations.stationCount""",
    )
    return statements


HOURLY_COLUMNS = ["time", "temperature", "apparentTemperature", "dewPoint", "humidity",
                  "comfort", "pop", "wx", "wxCode", "windSpeed", "windDir"]
PERIOD_COLUMNS = ["startTime", "endTime", "temperature", "minT", "maxT", "humidity", "pop",
                  "wx", "wxCode", "windSpeed", "windDir", "uvIndex", "description"]
DAILY_COLUMNS = ["dataDate", "mint", "maxt", "pop", "wx", "wxCode", "approx"]


def forecast_statements(run_id: int, content_hash: str, fetched_at: str,
                        hourly: dict[str, list[dict]], periods: dict[str, list[dict]],
                        daily: dict[str, list[dict]]) -> list[Statement]:
    statements = [(
        "INSERT INTO ForecastRuns (id, contentHash, fetchedAt) VALUES (?, ?, ?)",
        (run_id, content_hash, fetched_at),
    )]
    statements += insert_rows(
        "HourlyForecasts",
        ["runId", "regionName", *HOURLY_COLUMNS],
        [(run_id, region, *(row[c] for c in HOURLY_COLUMNS)) for region, rows in hourly.items() for row in rows],
    )
    statements += insert_rows(
        "PeriodForecasts",
        ["runId", "regionName", *PERIOD_COLUMNS],
        [(run_id, region, *(row[c] for c in PERIOD_COLUMNS)) for region, rows in periods.items() for row in rows],
    )
    statements += insert_rows(
        "TemperatureForecasts",
        ["runId", "regionName", *DAILY_COLUMNS],
        [(run_id, region, *(row[c] for c in DAILY_COLUMNS)) for region, rows in daily.items() for row in rows],
    )
    return statements


ASTRO_COLUMNS = ["county", "date", "sunrise", "sunTransit", "sunset", "moonrise", "moonTransit", "moonset"]


def astronomy_statements(rows: list[dict]) -> list[Statement]:
    return insert_rows(
        "AstroDaily",
        ASTRO_COLUMNS,
        [tuple(row[c] for c in ASTRO_COLUMNS) for row in rows],
        "ON CONFLICT(county, date) DO NOTHING",
    )


DAILY_OBSERVED_COLUMNS = ["county", "date", "tmin", "tmax", "tavg", "humidityAvg",
                          "pressureAvg", "rainSum", "samples"]


def daily_observed_statements(rows: list[dict]) -> list[Statement]:
    return insert_rows(
        "DailyObserved",
        DAILY_OBSERVED_COLUMNS,
        [tuple(row[c] for c in DAILY_OBSERVED_COLUMNS) for row in rows],
        """ON CONFLICT(county, date) DO UPDATE SET
            tmin = excluded.tmin, tmax = excluded.tmax, tavg = excluded.tavg,
            humidityAvg = excluded.humidityAvg, pressureAvg = excluded.pressureAvg,
            rainSum = excluded.rainSum, samples = excluded.samples
        WHERE excluded.samples >= DailyObserved.samples""",
    )


def retention_statements(observation_cutoff: str, forecast_cutoff: str) -> list[Statement]:
    old_runs = "SELECT id FROM ForecastRuns WHERE fetchedAt < ?"
    return [
        ("DELETE FROM Observations WHERE observedAt < ?", (observation_cutoff,)),
        (f"DELETE FROM HourlyForecasts WHERE runId IN ({old_runs})", (forecast_cutoff,)),
        (f"DELETE FROM PeriodForecasts WHERE runId IN ({old_runs})", (forecast_cutoff,)),
    ]

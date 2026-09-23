-- Shared by the local SQLite file and Turso (libSQL). Every statement is
-- idempotent so scripts/init_db.py can run against an existing database.
-- Timestamps are ISO 8601 in Asia/Taipei (+08:00), so text order is time order.

-- One row per job: last attempt, last success, and the newest data it holds.
CREATE TABLE IF NOT EXISTS JobStatus (
    job           TEXT PRIMARY KEY,
    lastAttemptAt TEXT,
    lastSuccessAt TEXT,
    lastStatus    TEXT,
    lastError     TEXT,
    lastRowCount  INTEGER,
    dataTime      TEXT
);

-- Keeps the cron job and a visitor's read-through refresh from calling CWA at once.
CREATE TABLE IF NOT EXISTS Locks (
    name  TEXT PRIMARY KEY,
    until TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS Stations (
    stationId TEXT PRIMARY KEY,
    name      TEXT NOT NULL,
    county    TEXT NOT NULL,
    town      TEXT,
    lat       REAL NOT NULL,
    lon       REAL NOT NULL,
    altitude  REAL
);

CREATE TABLE IF NOT EXISTS Observations (
    stationId   TEXT NOT NULL,
    observedAt  TEXT NOT NULL,
    temperature REAL,
    humidity    REAL,
    pressure    REAL,
    windSpeed   REAL,
    windDir     REAL,
    weather     TEXT,
    rain        REAL,
    PRIMARY KEY (stationId, observedAt)
);

CREATE INDEX IF NOT EXISTS idx_observations_time ON Observations (observedAt);

-- County values derived from station readings at ingest time, one row per
-- ten-minute report. Charts and the map read this instead of raw stations.
CREATE TABLE IF NOT EXISTS CountyObservations (
    county       TEXT NOT NULL,
    observedAt   TEXT NOT NULL,
    temperature  REAL,
    humidity     REAL,
    pressure     REAL,
    windSpeed    REAL,
    windDir      REAL,
    rain         REAL,
    weather      TEXT,
    stationCount INTEGER NOT NULL,
    PRIMARY KEY (county, observedAt)
);

-- CWA forecasts carry no issue time, so a run is identified by the hash of
-- its content: the same forecast fetched twice is stored once.
CREATE TABLE IF NOT EXISTS ForecastRuns (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    contentHash TEXT NOT NULL UNIQUE,
    fetchedAt   TEXT NOT NULL
);

-- F-D0047-089: hourly for about 36 hours, then three-hourly, for 3–4 days.
CREATE TABLE IF NOT EXISTS HourlyForecasts (
    runId               INTEGER NOT NULL,
    regionName          TEXT NOT NULL,
    time                TEXT NOT NULL,
    temperature         REAL,
    apparentTemperature REAL,
    dewPoint            REAL,
    humidity            REAL,
    comfort             TEXT,
    pop                 REAL,
    wx                  TEXT,
    wxCode              TEXT,
    windSpeed           REAL,
    windDir             TEXT,
    PRIMARY KEY (runId, regionName, time)
);

-- F-D0047-091: twelve-hour periods for a week.
CREATE TABLE IF NOT EXISTS PeriodForecasts (
    runId       INTEGER NOT NULL,
    regionName  TEXT NOT NULL,
    startTime   TEXT NOT NULL,
    endTime     TEXT NOT NULL,
    temperature REAL,
    minT        REAL,
    maxT        REAL,
    humidity    REAL,
    pop         REAL,
    wx          TEXT,
    wxCode      TEXT,
    windSpeed   REAL,
    windDir     TEXT,
    uvIndex     REAL,
    description TEXT,
    PRIMARY KEY (runId, regionName, startTime)
);

-- The course table, kept by name: each run's daily low and high for a
-- Taipei calendar day. approx = 1 when it comes from twelve-hour periods.
CREATE TABLE IF NOT EXISTS TemperatureForecasts (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    runId      INTEGER NOT NULL,
    regionName TEXT NOT NULL,
    dataDate   TEXT NOT NULL,
    mint       REAL,
    maxt       REAL,
    pop        REAL,
    wx         TEXT,
    wxCode     TEXT,
    approx     INTEGER NOT NULL DEFAULT 0,
    UNIQUE (runId, regionName, dataDate)
);

CREATE INDEX IF NOT EXISTS idx_temperature_forecasts_day
    ON TemperatureForecasts (regionName, dataDate, runId);

-- The newest run that covers each county and date. A date that later runs no
-- longer include (today, once its hours have passed) keeps its last forecast.
CREATE VIEW IF NOT EXISTS LatestTemperatureForecasts AS
SELECT t.*, r.fetchedAt
FROM TemperatureForecasts t
JOIN ForecastRuns r ON r.id = t.runId
WHERE t.runId = (
    SELECT MAX(t2.runId)
    FROM TemperatureForecasts t2
    WHERE t2.regionName = t.regionName AND t2.dataDate = t.dataDate
);

CREATE TABLE IF NOT EXISTS DailyObserved (
    county      TEXT NOT NULL,
    date        TEXT NOT NULL,
    tmin        REAL,
    tmax        REAL,
    tavg        REAL,
    humidityAvg REAL,
    pressureAvg REAL,
    rainSum     REAL,
    samples     INTEGER NOT NULL,
    PRIMARY KEY (county, date)
);

CREATE TABLE IF NOT EXISTS AstroDaily (
    county      TEXT NOT NULL,
    date        TEXT NOT NULL,
    sunrise     TEXT,
    sunTransit  TEXT,
    sunset      TEXT,
    moonrise    TEXT,
    moonTransit TEXT,
    moonset     TEXT,
    PRIMARY KEY (county, date)
);

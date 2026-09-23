import sqlite3

import pandas as pd
import pytest

from src.database import init_database, save_forecasts
from src.errors import DatabaseError
from src.queries import get_all_forecasts, get_forecast_by_date, get_forecast_dates, get_region_forecast, get_regions


@pytest.fixture
def database(tmp_path):
    path = tmp_path / "weather.db"
    init_database(path)
    return path


def test_create_upsert_and_filters(database, frame):
    assert get_all_forecasts(database).empty
    save_forecasts(frame, database)
    save_forecasts(frame, database)
    assert len(get_all_forecasts(database)) == len(frame)
    assert len(get_regions(database)) == 22
    dates = get_forecast_dates(database)
    assert dates == sorted(dates)
    assert len(get_forecast_by_date(dates[0], database)) == 22
    assert set(get_region_forecast("臺北市", database).region_name) == {"臺北市"}
    frame.loc[frame.region_name == "臺北市", "max_temp"] = 40.0
    save_forecasts(frame, database)
    assert (get_region_forecast("臺北市", database).max_temp == 40.0).all()
    assert get_region_forecast("' OR 1=1 --", database).empty


@pytest.mark.parametrize("issue", ["nan", "inverted", "missing", "duplicate"])
def test_invalid_write_retains_existing_data(database, frame, issue):
    save_forecasts(frame, database)
    before = get_all_forecasts(database)
    bad = frame.copy()
    if issue == "nan":
        bad.loc[0, "min_temp"] = float("nan")
    elif issue == "inverted":
        bad.loc[0, "min_temp"] = 60
    elif issue == "missing":
        bad = bad.drop(columns="fetched_at")
    else:
        bad = pd.concat([bad, bad.iloc[:1]])
    with pytest.raises(DatabaseError):
        save_forecasts(bad, database, replace_snapshot=True)
    pd.testing.assert_frame_equal(before, get_all_forecasts(database))


def test_snapshot_removes_withdrawn_records_only_after_success(database, frame):
    save_forecasts(frame, database)
    current = frame[frame.forecast_date != frame.forecast_date.min()]
    save_forecasts(current, database, replace_snapshot=True)
    assert len(get_all_forecasts(database)) == len(current)


def test_database_failure_rolls_back_entire_refresh(database, frame):
    save_forecasts(frame, database)
    before = get_all_forecasts(database)
    with sqlite3.connect(database) as conn:
        conn.execute("""CREATE TRIGGER force_failure BEFORE UPDATE ON weather_forecast
                        WHEN NEW.region_name = '臺北市'
                        BEGIN SELECT RAISE(ABORT, 'simulated failure'); END""")
    changed = frame.copy()
    changed["max_temp"] = 40.0
    with pytest.raises(DatabaseError):
        save_forecasts(changed, database, replace_snapshot=True)
    pd.testing.assert_frame_equal(before, get_all_forecasts(database))


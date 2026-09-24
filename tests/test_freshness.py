from datetime import timedelta

from app import config
from app.freshness import refresh_forecasts_if_stale, refresh_observations_if_stale
from tests.conftest import FROZEN


def test_no_refetch_right_after_a_fetch_even_if_cwa_lags(loaded, cwa, clock):
    # The samples' newest slot is 00:20, fetched at 00:40: already 20 minutes
    # old, yet a new slot cannot exist until ten minutes after that fetch.
    clock(FROZEN + timedelta(minutes=5))
    assert refresh_observations_if_stale(loaded) is False
    assert cwa.calls == []


def test_refetch_once_the_next_slot_can_exist(loaded, cwa, clock):
    clock(FROZEN + timedelta(minutes=11))
    assert refresh_observations_if_stale(loaded) is True
    assert cwa.calls == [config.OBSERVATION_DATASET]


def test_no_refetch_while_fresh(loaded, cwa):
    loaded.execute("UPDATE JobStatus SET dataTime = ?, lastSuccessAt = ? WHERE job = 'observations'",
                   ((FROZEN - timedelta(minutes=5)).isoformat(), (FROZEN - timedelta(hours=1)).isoformat()))
    assert refresh_observations_if_stale(loaded) is False
    assert cwa.calls == []


def test_forecasts_not_rechecked_within_the_hour(loaded, cwa, clock):
    clock(FROZEN + timedelta(minutes=config.FORECAST_REFRESH_AFTER - 5))
    assert refresh_forecasts_if_stale(loaded) is False
    assert cwa.calls == []


def test_forecasts_rechecked_once_the_cron_has_missed_an_hour(loaded, cwa, clock):
    clock(FROZEN + timedelta(minutes=config.FORECAST_REFRESH_AFTER + 5))
    assert refresh_forecasts_if_stale(loaded) is True
    assert config.FORECAST_3DAY_DATASET in cwa.calls
    assert config.FORECAST_WEEK_DATASET in cwa.calls


def test_failed_forecast_check_not_retried_at_once(loaded, cwa, clock):
    later = FROZEN + timedelta(hours=3)
    loaded.execute("UPDATE JobStatus SET lastAttemptAt = ? WHERE job = 'forecasts'",
                   ((later - timedelta(minutes=2)).isoformat(),))
    clock(later)
    assert refresh_forecasts_if_stale(loaded) is False
    assert cwa.calls == []

from datetime import timedelta

from app import config
from app.freshness import refresh_observations_if_stale
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

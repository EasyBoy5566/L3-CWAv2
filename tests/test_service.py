from datetime import datetime
from unittest.mock import Mock

import pandas as pd
import pytest

from src import service
from src.database import init_database, save_forecasts
from src.errors import APIRequestError, WeatherParseError
from src.queries import get_all_forecasts


@pytest.fixture
def frozen_time(monkeypatch):
    clock = Mock()
    clock.now.return_value = datetime.fromisoformat("2026-09-23T20:00:00+08:00")
    monkeypatch.setattr(service, "datetime", clock)


def test_refresh_real_schema_snapshot(tmp_path, sample, monkeypatch, frozen_time):
    monkeypatch.setattr(service, "fetch_weather_data", lambda: sample)
    path = tmp_path / "weather.db"
    result = service.refresh_forecasts(path)
    assert len(get_all_forecasts(path)) == len(result)


@pytest.mark.parametrize("problem", ["offline", "partial", "invalid"])
def test_failed_refresh_keeps_last_snapshot(tmp_path, sample, frame, monkeypatch, frozen_time, problem):
    path = tmp_path / "weather.db"
    init_database(path)
    save_forecasts(frame, path)
    before = get_all_forecasts(path)
    if problem == "offline":
        monkeypatch.setattr(service, "fetch_weather_data", Mock(side_effect=APIRequestError("offline")))
        error = APIRequestError
    else:
        if problem == "partial":
            sample["records"]["Locations"][0]["Location"].pop()
        else:
            sample["records"]["Locations"][0]["Location"][0]["WeatherElement"] = []
        monkeypatch.setattr(service, "fetch_weather_data", lambda: sample)
        error = WeatherParseError
    with pytest.raises(error):
        service.refresh_forecasts(path)
    pd.testing.assert_frame_equal(before, get_all_forecasts(path))


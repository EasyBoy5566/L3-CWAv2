from datetime import datetime, timedelta
from unittest.mock import Mock

import pytest
from streamlit.testing.v1 import AppTest

from src import config, service
from src.database import init_database, save_forecasts
from src.errors import APIRequestError, ConfigurationError


@pytest.fixture
def app_database(tmp_path, monkeypatch, frame):
    path = tmp_path / "weather.db"
    monkeypatch.setattr(config, "DB_PATH", path)
    now = datetime.now(config.TAIPEI)
    old_dates = sorted(frame.forecast_date.unique())
    mapping = {old: (now.date() + timedelta(days=i)).isoformat() for i, old in enumerate(old_dates)}
    frame["forecast_date"] = frame.forecast_date.map(mapping)
    frame["fetched_at"] = now.isoformat()
    init_database(path)
    save_forecasts(frame, path)
    return path


def test_dashboard_date_and_region_selection_keep_map_state(app_database, monkeypatch):
    fetch = Mock(side_effect=AssertionError("UI filter must not call API"))
    monkeypatch.setattr(service, "fetch_weather_data", fetch)
    app = AppTest.from_file(config.ROOT_DIR / "app.py", default_timeout=20).run()
    assert not app.exception
    assert app.title[0].value == "台灣天氣地圖"
    assert len(app.dataframe[0].value) == 22
    app.session_state["map_zoom"] = 9
    app.session_state["map_center"] = (24.2, 120.8)
    app.selectbox(key="selected_region").select("臺北市").run()
    assert not app.exception
    assert set(app.dataframe[0].value["地區"]) == {"臺北市"}
    assert len(app.dataframe[0].value) >= 7
    app.selectbox(key="selected_date").select_index(1).run()
    assert not app.exception
    assert app.session_state["map_zoom"] == 9
    assert app.session_state["map_center"] == (24.2, 120.8)
    fetch.assert_not_called()


def test_refresh_failure_still_displays_saved_data(app_database, monkeypatch):
    monkeypatch.setattr(service, "fetch_weather_data", Mock(side_effect=APIRequestError("網路離線")))
    app = AppTest.from_file(config.ROOT_DIR / "app.py", default_timeout=20).run()
    app.sidebar.button[0].click().run()
    assert not app.exception
    assert len(app.dataframe[0].value) == 22
    assert any("上次成功" in warning.value for warning in app.warning)


def test_empty_database_missing_key_is_actionable(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "DB_PATH", tmp_path / "empty.db")
    fetch = Mock(side_effect=ConfigurationError("尚未設定 CWA_API_KEY"))
    monkeypatch.setattr(service, "fetch_weather_data", fetch)
    app = AppTest.from_file(config.ROOT_DIR / "app.py", default_timeout=20).run()
    assert not app.exception
    assert any("CWA_API_KEY" in warning.value for warning in app.warning)
    assert not app.dataframe
    app.run()
    assert fetch.call_count == 1

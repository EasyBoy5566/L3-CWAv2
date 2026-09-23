from unittest.mock import Mock

import pytest
import requests

from src import config
from src.cwa_api import fetch_weather_data
from src.errors import APIRequestError, APIResponseError, ConfigurationError


@pytest.fixture(autouse=True)
def settings(monkeypatch):
    monkeypatch.setattr(config, "get_api_key", lambda: "test-secret")
    monkeypatch.setattr(config, "CWA_DATASET_ID", "F-D0047-091")


def test_api_keeps_auth_server_side_and_uses_timeout(monkeypatch):
    response = Mock(status_code=200)
    response.json.return_value = {"success": "true", "records": {}}
    get = Mock(return_value=response)
    monkeypatch.setattr(requests, "get", get)
    assert fetch_weather_data()["success"] == "true"
    assert get.call_args.kwargs["timeout"] > 0
    assert get.call_args.kwargs["allow_redirects"] is False
    assert get.call_args.kwargs["params"]["Authorization"] == "test-secret"


@pytest.mark.parametrize("error", [requests.Timeout, requests.ConnectionError])
def test_network_errors_do_not_expose_credentials(monkeypatch, error):
    monkeypatch.setattr(requests, "get", Mock(side_effect=error("url?Authorization=test-secret")))
    with pytest.raises(APIRequestError) as result:
        fetch_weather_data()
    assert "test-secret" not in str(result.value)
    assert result.value.__suppress_context__


@pytest.mark.parametrize("status", [401, 403, 429, 500])
def test_http_failure_is_sanitized(monkeypatch, status):
    response = Mock(status_code=status)
    response.raise_for_status.side_effect = requests.HTTPError("test-secret", response=response)
    monkeypatch.setattr(requests, "get", Mock(return_value=response))
    with pytest.raises(APIRequestError) as result:
        fetch_weather_data()
    assert "test-secret" not in str(result.value)


def test_bad_json(monkeypatch):
    response = Mock(status_code=200)
    response.json.side_effect = ValueError("test-secret")
    monkeypatch.setattr(requests, "get", Mock(return_value=response))
    with pytest.raises(APIResponseError):
        fetch_weather_data()


def test_missing_key_does_not_make_request(monkeypatch):
    monkeypatch.setattr(config, "get_api_key", lambda: "")
    get = Mock()
    monkeypatch.setattr(requests, "get", get)
    with pytest.raises(ConfigurationError):
        fetch_weather_data()
    get.assert_not_called()


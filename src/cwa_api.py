"""CWA client. Authentication stays on the server and out of errors."""

import re

import requests

from src import config
from src.errors import APIRequestError, APIResponseError, ConfigurationError


def fetch_weather_data() -> dict:
    key = config.get_api_key()
    if not key:
        raise ConfigurationError("尚未設定 CWA_API_KEY，請在 .env 或 Streamlit Secrets 中設定。")
    if not re.fullmatch(r"F-D0047-091", config.CWA_DATASET_ID):
        raise ConfigurationError("目前解析器支援 F-D0047-091，請檢查 CWA_DATASET_ID。")
    url = f"{config.CWA_API_BASE_URL}/{config.CWA_DATASET_ID}"
    try:
        response = requests.get(
            url,
            params={"Authorization": key, "format": "JSON"},
            timeout=config.REQUEST_TIMEOUT,
            allow_redirects=False,
        )
        response.raise_for_status()
    except requests.Timeout:
        raise APIRequestError("氣象署連線逾時，請稍後重試。") from None
    except requests.HTTPError as exc:
        status = exc.response.status_code if exc.response is not None else None
        if status in (401, 403):
            message = "氣象署授權失敗，請檢查 API 授權碼。"
        elif status == 429:
            message = "氣象署 API 使用次數已達限制，請稍後重試。"
        else:
            message = f"氣象署暫時無法提供資料（HTTP {status or 'error'}）。"
        raise APIRequestError(message) from None
    except requests.RequestException:
        raise APIRequestError("無法連線中央氣象署，請檢查網路後重試。") from None
    if response.status_code != 200:
        raise APIResponseError("氣象署回傳非預期的狀態。")
    try:
        document = response.json()
    except ValueError:
        raise APIResponseError("氣象署回傳內容不是有效的 JSON。") from None
    if not isinstance(document, dict) or document.get("success") not in (True, "true"):
        raise APIResponseError("氣象署回傳資料失敗，請稍後重試。")
    if not isinstance(document.get("records"), dict):
        raise APIResponseError("氣象署回傳內容缺少 records。")
    return document


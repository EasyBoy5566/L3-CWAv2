"""CWA client. Authentication stays on the server and out of errors.

The browser never sees CWA_API_KEY: it calls this project's own endpoints, and
only the server talks to opendata.cwa.gov.tw.
"""

import re

import requests

from app import config
from app.errors import APIRequestError, APIResponseError, ConfigurationError

DATASET_ID = re.compile(r"[A-Z]-[A-Z][0-9]{4}-[0-9]{3}")


def fetch_dataset(dataset_id: str, params: dict | None = None, timeout: float | None = None) -> dict:
    """Read one CWA open data resource.

    The dataset id is pattern-checked because it becomes part of the request
    path, and the authorization parameter is applied last so a caller-supplied
    parameter can never displace it.
    """
    key = config.cwa_api_key()
    if not key:
        raise ConfigurationError("伺服器尚未設定 CWA_API_KEY。")
    if not DATASET_ID.fullmatch(dataset_id):
        raise ConfigurationError("資料集代號格式不正確。")
    url = f"{config.CWA_API_BASE_URL}/{dataset_id}"
    try:
        response = requests.get(
            url,
            params={**(params or {}), "Authorization": key, "format": "JSON"},
            timeout=timeout or config.REQUEST_TIMEOUT,
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
        raise APIRequestError("無法連線中央氣象署，請稍後重試。") from None
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

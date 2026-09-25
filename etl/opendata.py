"""The sources beside CWA: Open-Meteo's model grids and MOENV's air quality.

Like the CWA client, only the server talks to them, and an API key (MOENV's)
never appears in an error.
"""

import requests

from app import config
from app.errors import APIRequestError, APIResponseError


def fetch_json(url: str, params: dict, source: str, timeout: float | None = None):
    """GET a JSON document; `source` names the service in the error a visitor may see."""
    try:
        response = requests.get(url, params=params, timeout=timeout or config.REQUEST_TIMEOUT, allow_redirects=False)
        response.raise_for_status()
    except requests.Timeout:
        raise APIRequestError(f"{source}連線逾時，請稍後重試。") from None
    except requests.HTTPError as exc:
        status = exc.response.status_code if exc.response is not None else None
        if status in (401, 403):
            message = f"{source}授權失敗，請檢查 API 金鑰。"
        elif status == 429:
            message = f"{source} API 使用次數已達限制，請稍後重試。"
        else:
            message = f"{source}暫時無法提供資料（HTTP {status or 'error'}）。"
        raise APIRequestError(message) from None
    except requests.RequestException:
        raise APIRequestError(f"無法連線{source}，請稍後重試。") from None
    try:
        return response.json()
    except ValueError:
        # MOENV answers a bad key with plain text ("api_key 不存在。") and status 200.
        raise APIResponseError(f"{source}回傳內容不是有效的 JSON。") from None


def open_meteo(url: str, points: list[tuple[float, float]], params: dict) -> list[dict]:
    """One Open-Meteo request for many (lat, lon) points: one result per point, in order."""
    document = fetch_json(url, {
        "latitude": ",".join(f"{lat:g}" for lat, _ in points),
        "longitude": ",".join(f"{lon:g}" for _, lon in points),
        "timezone": "Asia/Taipei",
        **params,
    }, "Open-Meteo")
    results = document if isinstance(document, list) else [document]
    if len(results) != len(points) or not all(isinstance(r, dict) for r in results):
        raise APIResponseError("Open-Meteo 回傳的格點數不符。")
    return results


def moenv(dataset: str, params: dict | None = None) -> dict:
    """One MOENV open data resource, such as aqx_p_432 (every station's AQI now)."""
    key = config.moenv_api_key()
    document = fetch_json(f"{config.MOENV_API_BASE_URL}/{dataset}",
                          {**(params or {}), "format": "json", "limit": 1000, "api_key": key}, "環境部")
    return {"records": document} if isinstance(document, list) else document

"""Run from repository root: python -m scripts.fetch_sample."""

import json

from src.config import ROOT_DIR, get_api_key
from src.cwa_api import fetch_weather_data
from src.errors import WeatherError


def main() -> None:
    try:
        document = fetch_weather_data()
        text = json.dumps(document, ensure_ascii=False, indent=2)
        key = get_api_key()
        if key and key in text:
            raise WeatherError("回應含有授權資訊，已停止儲存。")
        path = ROOT_DIR / "tests" / "sample_weather.json"
        path.write_text(text + "\n", encoding="utf-8")
        print("Saved tests/sample_weather.json (credential checked)")
    except WeatherError as exc:
        print(str(exc))
        raise SystemExit(1) from None


if __name__ == "__main__":
    main()


"""Save one real response per dataset to tests/samples/: python -m scripts.fetch_samples

Parsers are written and tested against these files, never against guesses
about the CWA schema. The key only travels in the query string, but every
file is still checked for it before it is written.
"""

import json
from datetime import datetime, timedelta

from app import config
from etl.cwa import fetch_dataset

SAMPLES = config.ROOT_DIR / "tests" / "samples"


def main() -> None:
    config.load_local_env()
    key = config.cwa_api_key()
    today = datetime.now(config.TAIPEI).date()
    window = {"timeFrom": today.isoformat(), "timeTo": (today + timedelta(days=2)).isoformat()}
    requests_ = {
        config.OBSERVATION_DATASET: {},
        config.FORECAST_3DAY_DATASET: {},
        config.FORECAST_WEEK_DATASET: {},
        config.SUN_DATASET: window,
        config.MOON_DATASET: window,
    }
    SAMPLES.mkdir(parents=True, exist_ok=True)
    for dataset, params in requests_.items():
        document = fetch_dataset(dataset, params)
        text = json.dumps(document, ensure_ascii=False, indent=1)
        if key and key in text:
            raise SystemExit(f"{dataset}: response contains the API key; not saved")
        (SAMPLES / f"{dataset}.json").write_text(text, encoding="utf-8")
        print(f"{dataset}: {len(text) // 1024} KB")


if __name__ == "__main__":
    main()

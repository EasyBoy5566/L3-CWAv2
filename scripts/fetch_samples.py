"""Save one real response per dataset to tests/samples/.

    python -m scripts.fetch_samples                 # every dataset
    python -m scripts.fetch_samples O-A0002-001 ... # only these

Parsers are written and tested against these files, never against guesses
about the CWA schema. The key only travels in the query string, but every
file is still checked for it before it is written. Existing samples pin the
test fixtures, so refresh them only on purpose.
"""

import json
import sys
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
        config.RAIN_DATASET: {},
        config.HOURLY_STATIONS_DATASET: {},
        config.TYPHOON_DATASET: {},
        config.HEAT_DATASET: {},
        config.UV_DATASET: {},
        # Two counties are enough to test the township parser and keep the file small.
        config.TOWNSHIP_DATASET: {
            "locationId": "F-D0047-061,F-D0047-085",
            "elementName": ",".join(config.TOWNSHIP_ELEMENTS),
        },
    }
    wanted = sys.argv[1:] or list(requests_)
    SAMPLES.mkdir(parents=True, exist_ok=True)
    for dataset in wanted:
        document = fetch_dataset(dataset, requests_[dataset], timeout=60)
        text = json.dumps(document, ensure_ascii=False, indent=1)
        if key and key in text:
            raise SystemExit(f"{dataset}: response contains the API key; not saved")
        (SAMPLES / f"{dataset}.json").write_text(text, encoding="utf-8")
        print(f"{dataset}: {len(text) // 1024} KB")


if __name__ == "__main__":
    main()

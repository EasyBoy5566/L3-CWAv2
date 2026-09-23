"""Run one ETL job by hand: python -m scripts.run_job observations|forecasts|daily|all"""

import json
import sys

from app import config
from etl.jobs import RUNNERS, run_job


def main() -> None:
    config.load_local_env()
    names = sys.argv[1:] or ["all"]
    if names == ["all"]:
        names = list(RUNNERS)
    for name in names:
        print(json.dumps(run_job(name), ensure_ascii=False))


if __name__ == "__main__":
    main()

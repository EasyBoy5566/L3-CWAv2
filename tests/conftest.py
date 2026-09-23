import json
from pathlib import Path

import pytest


@pytest.fixture
def sample():
    return json.loads((Path(__file__).parent / "sample_weather.json").read_text(encoding="utf-8"))


@pytest.fixture
def frame(sample):
    from src.parser import parse_weather_data

    return parse_weather_data(sample, fetched_at="2026-09-23T20:00:00+08:00")


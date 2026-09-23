import pytest

from src.errors import WeatherParseError
from src.parser import parse_weather_data


def elements(sample):
    location = sample["records"]["Locations"][0]["Location"][0]
    temps = {e["ElementName"]: e for e in location["WeatherElement"]}
    return location, temps


def test_real_sample_covers_22_regions_and_available_dates(frame):
    assert frame.region_name.nunique() == 22
    assert frame.forecast_date.nunique() >= 7
    assert not frame.duplicated(["region_name", "forecast_date"]).any()
    assert (frame.min_temp <= frame.max_temp).all()
    assert frame.attrs["invalid_periods"] == 0


def test_aggregation_night_stays_on_start_date_and_matches_by_interval(sample):
    location, temps = elements(sample)
    low = temps["最低溫度"]["Time"]
    high = temps["最高溫度"]["Time"]
    for periods, field, values in [(low, "MinTemperature", (21, 24)), (high, "MaxTemperature", (28, 33))]:
        periods[:] = periods[:2]
        for index, (start, end) in enumerate([
            ("2026-09-24T06:00:00+08:00", "2026-09-24T18:00:00+08:00"),
            ("2026-09-24T18:00:00+08:00", "2026-09-25T06:00:00+08:00"),
        ]):
            periods[index].update(StartTime=start, EndTime=end, ElementValue=[{field: str(values[index])}])
    high.reverse()
    sample["records"]["Locations"][0]["Location"] = [location]
    frame = parse_weather_data(sample)
    assert len(frame) == 1
    assert frame.iloc[0][["forecast_date", "min_temp", "max_temp"]].tolist() == ["2026-09-24", 21, 33]


@pytest.mark.parametrize("bad", ["", "not-a-number", "-99", "NaN", "Infinity"])
def test_bad_temperature_is_reported_without_poisoning_other_regions(sample, bad):
    _, temps = elements(sample)
    temps["最低溫度"]["Time"][0]["ElementValue"][0]["MinTemperature"] = bad
    frame = parse_weather_data(sample)
    assert frame.attrs["invalid_periods"] > 0
    assert frame.min_temp.notna().all()


def test_missing_element_retains_other_regions_with_warning(sample):
    location, _ = elements(sample)
    location["WeatherElement"] = [e for e in location["WeatherElement"] if e["ElementName"] != "最低溫度"]
    frame = parse_weather_data(sample)
    assert frame.region_name.nunique() == 21
    assert frame.attrs["invalid_periods"] > 0


@pytest.mark.parametrize("bad", ["bad-date", "2026-09-24T06:00:00"])
def test_invalid_or_ambiguous_time_reported(sample, bad):
    _, temps = elements(sample)
    temps["最低溫度"]["Time"][0]["StartTime"] = bad
    assert parse_weather_data(sample).attrs["invalid_periods"] > 0


@pytest.mark.parametrize("raw", [{}, {"records": {}}, {"records": {"Locations": []}}])
def test_changed_schema_fails_clearly(raw):
    with pytest.raises(WeatherParseError):
        parse_weather_data(raw)


def test_inverted_temperature_is_rejected(sample):
    _, temps = elements(sample)
    temps["最低溫度"]["Time"][0]["ElementValue"][0]["MinTemperature"] = "60"
    assert parse_weather_data(sample).attrs["invalid_periods"] > 0


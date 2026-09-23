import folium
import pytest

from src.locations import REGION_COORDINATES
from src.map_view import create_weather_map
from src.utils import get_temperature_category


@pytest.mark.parametrize("temp,category", [(19.9,"Cold"),(20,"Cool"),(24.9,"Cool"),(25,"Warm"),(30,"Warm"),(30.1,"Hot")])
def test_temperature_boundaries(temp, category):
    assert get_temperature_category(temp) == category


def test_map_has_one_marker_per_region_and_real_coordinates(frame):
    day = frame[frame.forecast_date == frame.forecast_date.min()]
    m = create_weather_map(day)
    group = next(v for v in m._children.values() if isinstance(v, folium.FeatureGroup))
    markers = [v for v in group._children.values() if isinstance(v, folium.CircleMarker)]
    assert len(markers) == 22
    assert set(day.region_name) == set(REGION_COORDINATES)
    html = m.get_root().render()
    assert "OpenStreetMap" in html
    assert "最低溫" in html and "最高溫" in html


def test_unknown_coordinate_does_not_crash(frame):
    day = frame[frame.forecast_date == frame.forecast_date.min()].copy()
    day.loc[day.index[0], "region_name"] = "未知地區"
    assert create_weather_map(day).get_root().render()

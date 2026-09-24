import json

from app import config
from scripts.build_geo import _distance, label_point

COUNTIES = json.loads((config.ROOT_DIR / "public" / "static" / "geo" / "taiwan-counties.json").read_text(encoding="utf-8"))["features"]
BY_NAME = {feature["properties"]["name"]: feature for feature in COUNTIES}


def test_every_county_has_its_label_point_inside_it():
    for feature in COUNTIES:
        lon, lat = feature["properties"]["label"]
        polygons = feature["geometry"]["coordinates"]
        # Inside one of its polygons, holes (a city within a county) excluded.
        assert any(_distance(lon, lat, polygon) > 0 for polygon in polygons), feature["properties"]["name"]


def test_stored_label_points_match_the_algorithm():
    for feature in COUNTIES:
        assert feature["properties"]["label"] == label_point(feature["geometry"]["coordinates"])


def test_long_southern_counties_are_labelled_low():
    # Their centroids, not the widest parts up north, so the bubbles above
    # them are not pushed north.
    assert BY_NAME["屏東縣"]["properties"]["label"][1] < 22.6
    assert BY_NAME["臺東縣"]["properties"]["label"][1] < 22.9


def test_counties_around_a_city_are_labelled_clear_of_it():
    # New Taipei's centroid falls inside Taipei, Chiayi County's near Chiayi City.
    lon, lat = BY_NAME["新北市"]["properties"]["label"]
    assert all(_distance(lon, lat, polygon) < 0 for polygon in BY_NAME["臺北市"]["geometry"]["coordinates"])
    lon, lat = BY_NAME["嘉義縣"]["properties"]["label"]
    assert all(_distance(lon, lat, polygon) < -0.05 for polygon in BY_NAME["嘉義市"]["geometry"]["coordinates"])

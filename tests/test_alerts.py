import json
from datetime import datetime

from app import config
from app.alerts import derived_from_rain, parse_cap, parse_warnings, places, when

SAMPLES = config.ROOT_DIR / "tests" / "samples"
HEAT = json.loads((SAMPLES / "W-C0033-005.json").read_text(encoding="utf-8"))  # 高溫資訊 for 9/25 13:00-17:00
RAIN = json.loads((SAMPLES / "W-C0033-003.json").read_text(encoding="utf-8"))  # a lifted 大雨特報
T = config.TAIPEI


def test_heat_alert_in_force_is_a_sentence_in_our_words():
    [alert] = parse_cap(HEAT, datetime(2026, 9, 25, 7, 0, tzinfo=T))
    assert alert["kind"] == "official" and alert["category"] == "heat"
    assert alert["counties"] == ["臺南市", "屏東縣"]
    assert alert["title"] == "高溫黃色燈號"
    # Relative to now, not to the day CWA wrote it on ("明(25)日").
    assert alert["text"].startswith("今天下午 臺南市、屏東縣高溫黃色燈號")
    assert "36度" in alert["text"]


def test_expired_alerts_are_dropped():
    assert parse_cap(HEAT, datetime(2026, 9, 25, 18, 0, tzinfo=T)) == []


def test_a_lifting_is_not_an_alert():
    assert parse_cap(RAIN, datetime(2026, 9, 22, 1, 55, tzinfo=T)) == []


def test_county_warnings_are_grouped_by_phenomenon():
    raw = {"records": {"location": [
        {"locationName": county, "hazardConditions": {"hazards": [
            {"info": {"phenomena": "陸上強風", "significance": "特報"},
             "validTime": {"startTime": "2026-09-25T08:00:00+08:00", "endTime": "2026-09-26T08:00:00+08:00"}},
        ]}} for county in ("澎湖縣", "金門縣")
    ] + [{"locationName": "臺北市", "hazardConditions": {"hazards": []}}]}}
    [alert] = parse_warnings(raw, datetime(2026, 9, 25, 9, 0, tzinfo=T))
    assert alert["title"] == "陸上強風特報"
    assert alert["counties"] == ["澎湖縣", "金門縣"]
    assert alert["text"] == "陸上強風特報：澎湖縣、金門縣，至 9/26 08:00"


def test_heavy_rain_now_from_gauges():
    stations = [
        {"county": "新北市", "town": "汐止區", "r1h": 52.0, "r24h": 90.0},
        {"county": "新北市", "town": "板橋區", "r1h": 12.0, "r24h": 30.0},
        {"county": "臺東縣", "town": "大武鄉", "r1h": 3.0, "r24h": 210.0},
        {"county": "臺中市", "town": "北屯區", "r1h": 5.0, "r24h": 20.0},
    ]
    alerts = derived_from_rain(stations)
    assert [a["counties"] for a in alerts] == [["新北市"], ["臺東縣"]]
    assert alerts[0]["text"] == "目前 新北市汐止區 1 小時雨量 52 毫米，已達大雨等級"
    assert alerts[1]["title"] == "豪雨" and alerts[1]["level"] == 3


def test_time_and_place_words():
    now = datetime(2026, 9, 25, 7, 0, tzinfo=T)
    assert when(datetime(2026, 9, 25, 14, 0, tzinfo=T), now) == "今天下午"
    assert when(datetime(2026, 9, 26, 6, 0, tzinfo=T), now) == "明天清晨"
    assert when(datetime(2026, 9, 29, 20, 0, tzinfo=T), now) == "9/29晚上"
    assert places(["屏東縣", "臺南市"]) == "臺南市、屏東縣"
    assert places(["臺北市", "新北市", "基隆市", "桃園市"]) == "基隆市、臺北市等 4 縣市"


def test_the_whole_ticker_over_the_sample_database(monkeypatch, loaded, clock):
    from app import alerts as module
    from app.errors import APIRequestError

    documents = {"W-C0033-005": HEAT, "W-C0033-003": RAIN}

    def fake_fetch(dataset_id, params=None, timeout=None):
        if dataset_id not in documents:
            raise APIRequestError("offline")
        return documents[dataset_id]

    def no_overlay(name, database):
        raise APIRequestError("offline")

    monkeypatch.setattr(module, "fetch_dataset", fake_fetch)
    monkeypatch.setattr(module.overlays, "overlay", no_overlay)
    module.clear_cache()
    clock(datetime(2026, 9, 25, 7, 0, tzinfo=T))
    payload = module.alerts(loaded)
    kinds = [a["kind"] for a in payload["alerts"]]
    # The official heat alert leads; CWA being partly unreachable costs only its part.
    assert payload["alerts"][0]["title"] == "高溫黃色燈號"
    assert kinds == sorted(kinds, key=lambda k: k != "official")
    assert all(a["text"] and a["id"] for a in payload["alerts"])
    module.clear_cache()


def test_gusts_now_skip_the_mountains():
    from app.alerts import derived_from_gusts

    stations = [
        {"county": "臺東縣", "town": "蘭嶼鄉", "alt": 324, "ws": 12, "gust": 25.1},
        {"county": "臺東縣", "town": "成功鎮", "alt": 30, "ws": 8, "gust": 18},
        {"county": "南投縣", "town": "信義鄉", "alt": 3844, "ws": 20, "gust": 30},  # 玉山
        {"county": "臺北市", "town": "中正區", "alt": 5, "ws": 3, "gust": 9},
    ]
    (alert,) = derived_from_gusts(stations)
    assert alert["counties"] == ["臺東縣"] and alert["level"] == 2
    assert alert["text"].startswith("目前 臺東縣蘭嶼鄉 陣風 10 級")


def test_unhealthy_air_is_grouped_by_category():
    from app.alerts import derived_from_air

    stations = [
        {"county": "高雄市", "aqi": 160, "pollutant": "細懸浮微粒"},
        {"county": "高雄市", "aqi": 120, "pollutant": "臭氧八小時"},
        {"county": "臺南市", "aqi": 105, "pollutant": "臭氧八小時"},
        {"county": "屏東縣", "aqi": 118, "pollutant": None},
        {"county": "臺北市", "aqi": 60, "pollutant": None},
    ]
    red, orange = derived_from_air({"source": "moenv", "stations": stations})
    assert red["counties"] == ["高雄市"] and red["level"] == 2
    assert red["text"] == "目前 高雄市空氣品質對所有族群不健康（AQI 160，主要為細懸浮微粒），所有人減少戶外活動，外出戴口罩"
    assert orange["counties"] == ["臺南市", "屏東縣"] and "（AQI 118）" in orange["text"] and "主要為" not in orange["text"]
    model = derived_from_air({"source": "model", "stations": stations[:1]})
    assert model[0]["text"].startswith("預估 ")

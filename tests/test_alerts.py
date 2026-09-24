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

"""Read-only JSON API for the globe and the region panel.

Responses carry ``s-maxage`` so Vercel's edge answers repeat requests
without touching the database; ``stale-while-revalidate`` keeps the page
fast while the next copy is fetched.
"""

from datetime import date, timedelta

from flask import Blueprint, abort, jsonify, request

from app import config, freshness, queries
from app.db import get_database
from app.errors import WeatherError
from app.routes import county_from_path
from etl.counties import DEFAULT_COUNTY

bp = Blueprint("api", __name__, url_prefix="/api")

LAYERS = ("now", "maxt", "mint", "pop")


def _cached(payload: dict, seconds: int):
    response = jsonify(payload)
    response.headers["Cache-Control"] = (
        f"public, max-age=0, s-maxage={seconds}, stale-while-revalidate={seconds * 5}"
    )
    return response


def _county(raw: str) -> str:
    name = county_from_path(raw)
    if name is None:
        abort(404)
    return name


def _date_param(name: str, default: str | None = None) -> str | None:
    value = request.args.get(name, default)
    if value is None:
        return None
    try:
        return date.fromisoformat(value).isoformat()
    except ValueError:
        abort(400, description="日期格式應為 YYYY-MM-DD。")


@bp.errorhandler(400)
def bad_request(error):
    return jsonify(error=error.description), 400


@bp.errorhandler(WeatherError)
def weather_error(error):
    # A read can only fail on the database: unreachable, or not configured.
    return jsonify(error=str(error)), 503


@bp.get("/meta")
def meta():
    database = get_database()
    return _cached({
        "counties": queries.counties(),
        "dates": queries.forecast_dates(database),
        "freshness": freshness.status(database),
        "now": config.now().isoformat(timespec="seconds"),
    }, 60)


@bp.get("/map")
def map_layer():
    layer = request.args.get("layer", "now")
    if layer not in LAYERS:
        abort(400, description=f"layer 必須是 {', '.join(LAYERS)} 之一。")
    database = get_database()
    if layer == "now":
        freshness.refresh_observations_if_stale(database)
    day = _date_param("date", config.now().date().isoformat())
    return _cached(queries.map_layer(database, layer, day), 60)


@bp.get("/region")
def region():
    name = _county(request.args.get("name", ""))
    database = get_database()
    freshness.refresh_observations_if_stale(database)
    return _cached(queries.region_detail(database, name), 60)


@bp.get("/region/trend")
def region_trend():
    name = _county(request.args.get("name", ""))
    try:
        days = int(request.args.get("days", 7))
    except ValueError:
        abort(400, description="days 必須是整數。")
    if days not in (1, 7, 30):
        abort(400, description="days 必須是 1、7 或 30。")
    return _cached(queries.region_trend(get_database(), name, days), 300)


@bp.get("/region/history")
def region_history():
    name = _county(request.args.get("name", ""))
    today = config.now().date()
    day = _date_param("date", (today - timedelta(days=1)).isoformat())
    if day > today.isoformat():
        abort(400, description="歷史日期不能晚於今天。")
    database = get_database()
    payload = queries.region_history(database, name, day)
    payload["range"] = queries.history_dates(database, name)
    # A finished day no longer changes; today's still does.
    return _cached(payload, 60 if day == today.isoformat() else 3600)


@bp.get("/astro")
def astro():
    name = request.args.get("county", DEFAULT_COUNTY)
    name = _county(name)
    day = _date_param("date", config.now().date().isoformat())
    return _cached({"county": name, "date": day, "times": queries.astronomy_for(get_database(), name, day)}, 3600)


@bp.get("/health")
def health():
    """503 when observations or forecasts are stale, for an uptime monitor."""
    try:
        status = freshness.status(get_database())
    except WeatherError as exc:
        return jsonify(ok=False, error=str(exc)), 503
    healthy = status["observations"]["level"] in ("ok", "warn") and status["forecasts"]["level"] == "ok"
    return jsonify(ok=healthy, **status), 200 if healthy else 503

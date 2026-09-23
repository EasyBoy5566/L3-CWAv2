"""HTML pages. Both are shells: the data comes from the JSON API, so the
globe's panel and the standalone region page render through the same code."""

from flask import Blueprint, abort, make_response, render_template

from app import config
from etl.counties import COUNTIES, is_county

bp = Blueprint("pages", __name__)


def _page(template: str, **context):
    response = make_response(render_template(
        template,
        counties=list(COUNTIES),
        cesium_token=config.cesium_ion_token(),
        **context,
    ))
    response.headers["Cache-Control"] = "public, max-age=0, s-maxage=300, stale-while-revalidate=3600"
    return response


@bp.get("/")
def index():
    return _page("index.html", region=None)


@bp.get("/region/<name>")
def region(name: str):
    if not is_county(name):
        abort(404)
    return _page("region.html", region=name)

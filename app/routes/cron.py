"""Scheduled job endpoints.

cron-job.org calls these every ten minutes and hourly with
``Authorization: Bearer <CRON_SECRET>``. Vercel Cron sends the same header
when CRON_SECRET is set, and it uses GET, so both methods are accepted.
"""

import hmac

from flask import Blueprint, jsonify, request

from app import config
from app.errors import WeatherError
from etl.jobs import RUNNERS, run_job

bp = Blueprint("cron", __name__)


def _authorized() -> bool:
    secret = config.cron_secret()
    supplied = request.headers.get("Authorization", "")
    return bool(secret) and hmac.compare_digest(supplied.encode(), f"Bearer {secret}".encode())


@bp.route("/api/cron/<job>", methods=["GET", "POST"])
def run(job: str):
    if not config.cron_secret():
        return jsonify(error="伺服器尚未設定 CRON_SECRET。"), 503
    if not _authorized():
        return jsonify(error="未授權。"), 401
    if job not in RUNNERS:
        return jsonify(error="沒有這個排程工作。"), 404
    try:
        result = run_job(job)
    except WeatherError as exc:
        return jsonify(job=job, status="error", error=str(exc)), 502
    return jsonify(result), 202 if result["status"] == "busy" else 200

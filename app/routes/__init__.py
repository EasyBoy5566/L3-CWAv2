"""Helpers shared by the page and API routes."""

from urllib.parse import unquote

from etl.counties import is_county


def county_from_path(raw: str) -> str | None:
    """The county named in a URL segment, or None.

    Locally Werkzeug hands routes the decoded name. Behind Vercel's Python
    runtime a non-ASCII segment can arrive still percent-encoded, or decoded
    as UTF-8 where WSGI expects Latin-1, which Werkzeug then turns into
    mojibake. Each form is tried until one names one of the 22 counties.
    """
    candidates = [raw, unquote(raw)]
    try:
        repaired = raw.encode("latin-1").decode("utf-8")
        candidates += [repaired, unquote(repaired)]
    except (UnicodeEncodeError, UnicodeDecodeError):
        pass
    return next((name for name in candidates if is_county(name)), None)

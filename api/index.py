"""Vercel entry point. Vercel's Flask support finds the WSGI ``app`` in this
module and sends every request to it with the original path; files under
public/ are served by the CDN before they reach Flask."""

import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from app import create_app  # noqa: E402

app = create_app()

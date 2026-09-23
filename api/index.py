"""Vercel entry point. vercel.json rewrites every non-static path here, and
Vercel's Python runtime serves the WSGI ``app`` it finds in this module."""

import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from app import create_app  # noqa: E402

app = create_app()

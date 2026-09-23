"""Refresh the local SQLite snapshot: python -m scripts.refresh_data."""

from src.errors import WeatherError
from src.service import refresh_forecasts


def main():
    try:
        frame = refresh_forecasts()
        print(f"Updated {len(frame)} records / {frame.region_name.nunique()} regions")
        print(f"Forecast dates: {frame.forecast_date.min()} to {frame.forecast_date.max()}")
        print(f"Fetched at: {frame.fetched_at.max()}")
    except WeatherError as exc:
        print(str(exc))
        raise SystemExit(1) from None


if __name__ == "__main__":
    main()


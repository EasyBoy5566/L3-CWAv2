# Taiwan Weather Map Dashboard

A full-screen global map with weather layers from the Windy Map Forecast API. Select a Taiwan county or city to open its CWA forecast, daily high/low temperatures, and one-week trend.

## Start the app

```powershell
.venv\Scripts\Activate.ps1
python -m streamlit run app.py
```

Install packages when setting up a new environment:

```powershell
python -m venv .venv
.venv\Scripts\python.exe -m pip install -r requirements.txt
```

## API keys

Copy `.env.example` to `.env`. Add your Central Weather Administration key to `CWA_API_KEY`, and your **Windy Map Forecast** browser key to `WINDY_API_KEY`. Windy Point Forecast and PWS/Open Data keys are separate and do not initialize the global map.

The Windy Map Forecast SDK uses its key in the browser. Restrict its allowed websites to the app's domains in Windy's key settings. A Windy testing key has limited layers and is for development use; check your Windy plan before deployment.

Choose the global layer from the floating panel. Search a world city to move the map, or choose a Taiwan county or city to display the matching CWA daily temperatures and trend. When the map key is missing, the app still shows a navigable OpenStreetMap world map and Taiwan CWA details. Refresh CWA forecast data from the panel.

## CWA dataset

The app uses [`F-D0047-091`](https://opendata.cwa.gov.tw/dataset/forecast/F-D0047-091), the CWA township forecast for the coming week. Forecast periods are grouped by `StartTime`'s Taiwan local calendar date; overnight periods are assigned to their starting date.

```text
python -m scripts.refresh_data
```

This downloads and saves the latest valid snapshot to `data/weather.db`. If the API response is incomplete, the app retains the previous snapshot. `.env`, Windy keys, and the SQLite database are excluded from Git.

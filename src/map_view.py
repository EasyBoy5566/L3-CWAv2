"""Map construction from a single forecast date."""

from html import escape
import math

import folium
import pandas as pd

from src.locations import MAP_CENTER, MAP_ZOOM, REGION_COORDINATES
from src.utils import TEMPERATURE_STYLES, format_update, get_temperature_category


def create_base_map() -> folium.Map:
    return folium.Map(
        location=MAP_CENTER, zoom_start=MAP_ZOOM, tiles="OpenStreetMap",
        control_scale=True, prefer_canvas=True, min_zoom=5, max_zoom=13,
        zoom_control=True, scroll_wheel_zoom=True,
    )


def create_weather_layer(weather_df: pd.DataFrame, selected_region: str | None = None):
    layer = folium.FeatureGroup(name="縣市預報")
    # Large white rims keep temperature dots legible against detailed base tiles.
    for row in weather_df.drop_duplicates("region_name").itertuples(index=False):
        coords = REGION_COORDINATES.get(row.region_name)
        if coords is None or not all(math.isfinite(v) for v in (row.min_temp, row.max_temp)):
            continue
        temp = (row.min_temp + row.max_temp) / 2
        style = TEMPERATURE_STYLES[get_temperature_category(temp)]
        selected = row.region_name == selected_region
        name = escape(row.region_name)
        popup = f"""
        <div style="font-family:system-ui,sans-serif;min-width:190px;padding:5px 3px;color:#18333D">
          <div style="font-size:11px;letter-spacing:1px;color:#657982">TAIWAN / FORECAST</div>
          <h3 style="margin:8px 0 4px;font-size:20px">{name}</h3>
          <div style="color:#657982;font-size:12px">{escape(row.forecast_date)}</div>
          <div style="display:flex;gap:28px;margin:16px 0">
            <div>最低溫<br><b style="font-size:25px">{row.min_temp:g}°</b></div>
            <div>最高溫<br><b style="font-size:25px;color:{style['color']}">{row.max_temp:g}°</b></div>
          </div>
          <div style="font-size:11px;color:#657982">資料擷取 {format_update(row.fetched_at)} · 台北時間</div>
        </div>"""
        if selected:
            folium.CircleMarker(
                coords, radius=16, color="#18333D", weight=2,
                fill=True, fill_color="#FFFFFF", fill_opacity=.7, interactive=False,
            ).add_to(layer)
        folium.CircleMarker(
            coords, radius=10 if selected else 8,
            color="#FFFFFF", weight=2, fill=True,
            fill_color=style["color"], fill_opacity=1,
            tooltip=folium.Tooltip(f"{name} · {row.min_temp:g}–{row.max_temp:g}°C", sticky=True),
            popup=folium.Popup(popup, max_width=270),
        ).add_to(layer)
    return layer


def create_weather_map(weather_df: pd.DataFrame, selected_region: str | None = None) -> folium.Map:
    m = create_base_map()
    create_weather_layer(weather_df, selected_region).add_to(m)
    return m

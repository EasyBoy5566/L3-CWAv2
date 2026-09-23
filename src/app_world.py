"""A quiet world map with a floating control panel."""

from datetime import datetime

import pandas as pd
import streamlit as st
import streamlit.components.v1 as components
from streamlit_folium import st_folium

from src.config import CACHE_TTL, DB_PATH, TAIPEI, get_windy_api_key
from src.database import init_database
from src.errors import WeatherError
from src.locations import MAP_CENTER, MAP_ZOOM, REGION_COORDINATES, WORLD_CITY_COORDINATES
from src.map_view import create_base_map, create_weather_layer
from src.queries import get_all_forecasts, get_region_forecast
from src.service import refresh_forecasts
from src.ui import apply_style, initialize_state, on_map_change, on_place_change, reset_map
from src.utils import format_date, format_update
from src.windy_view import build_windy_html


def main():
    st.set_page_config(page_title="全球天氣地圖", page_icon="◉", layout="wide", initial_sidebar_state="expanded")
    apply_style()

    @st.cache_data(ttl=CACHE_TTL, show_spinner=False)
    def load_forecasts(db_path: str, modified_ns: int):
        return get_all_forecasts(db_path)

    try:
        init_database()
        forecasts = load_forecasts(str(DB_PATH), DB_PATH.stat().st_mtime_ns)
    except WeatherError as exc:
        forecasts = pd.DataFrame(columns=["region_name", "forecast_date", "min_temp", "max_temp", "fetched_at"])
        st.session_state.refresh_error = str(exc)

    dates = sorted(forecasts.forecast_date.unique().tolist())
    regions = sorted(forecasts.region_name.unique().tolist())
    initialize_state(dates, regions)
    places = ["全球視圖", *WORLD_CITY_COORDINATES, *sorted(REGION_COORDINATES)]
    layer_names = {"wind": "風速", "temp": "溫度", "pressure": "氣壓"}

    with st.sidebar:
        st.markdown('<div class="weather-mark">◉ &nbsp; WORLD WEATHER</div>', unsafe_allow_html=True)
        st.caption("在地圖上探索天氣")
        st.divider()
        place = st.selectbox(
            "搜尋地區", places,
            index=places.index(st.session_state.selected_place) if st.session_state.selected_place in places else 0,
            key="selected_place", on_change=on_place_change,
        )
        overlay = st.selectbox(
            "地圖圖層", list(layer_names), format_func=layer_names.get,
            key="selected_layer", help="全球天氣圖由 Windy 提供。可用圖層依你的 Windy key 方案而異。",
        )

        region = st.session_state.get("selected_region", "")
        if region and region in regions:
            if st.session_state.get("selected_date") not in dates:
                today = datetime.now(TAIPEI).date().isoformat()
                st.session_state.selected_date = next((day for day in dates if day >= today), dates[-1])
            st.selectbox("CWA 預報日期", dates, key="selected_date", format_func=format_date)
            details = get_region_forecast(region)
            if not details.empty:
                chosen = details[details.forecast_date == st.session_state.selected_date]
                if not chosen.empty:
                    weather = chosen.iloc[0]
                    st.divider()
                    st.markdown(f'<div class="weather-place">{region}</div><div class="weather-update">中央氣象署 · {format_date(weather.forecast_date)}<br>更新於 {format_update(weather.fetched_at)}</div>', unsafe_allow_html=True)
                    first, second = st.columns(2)
                    first.metric("最低溫", f"{weather.min_temp:g}°")
                    second.metric("最高溫", f"{weather.max_temp:g}°")
                    st.caption("縣市一週趨勢")
                    chart = details[["forecast_date", "min_temp", "max_temp"]].copy()
                    chart["forecast_date"] = pd.to_datetime(chart.forecast_date)
                    chart = chart.rename(columns={"forecast_date": "日期", "min_temp": "最低溫", "max_temp": "最高溫"})
                    st.line_chart(chart, x="日期", y=["最低溫", "最高溫"], color=["#738987", "#c78463"], height=170, y_label="°C")
        elif place != "全球視圖" and st.session_state.get("selected_latlon"):
            latitude, longitude = st.session_state.selected_latlon
            st.divider()
            st.markdown(f'<div class="weather-place">{place}</div><div class="weather-update">{latitude:.3f}°, {longitude:.3f}°</div>', unsafe_allow_html=True)
            st.caption("點選地圖可開啟 Windy 天氣資訊檢視器。")

        if not get_windy_api_key():
            st.divider()
            st.caption("設定本機 WINDY_API_KEY 啟用全球天氣圖層。")
        if error := st.session_state.get("refresh_error"):
            st.warning(error)
        if notice := st.session_state.pop("refresh_notice", None):
            st.success(notice)
        st.divider()
        first, second = st.columns(2)
        first.button("回到全球", on_click=reset_map, width="stretch")
        if second.button("更新 CWA", width="stretch"):
            try:
                with st.spinner("更新台灣預報…"):
                    fresh = refresh_forecasts()
                load_forecasts.clear()
                st.session_state.refresh_notice = f"已更新 {fresh.region_name.nunique()} 個台灣縣市。"
                st.rerun()
            except WeatherError as exc:
                st.session_state.refresh_error = str(exc)
                st.rerun()
        map_source = "Windy" if get_windy_api_key() else "OpenStreetMap"
        st.markdown(f'<div class="weather-update" style="margin-top:8px">全球天氣：Windy<br>台灣縣市預報：CWA<br>地圖：{map_source}</div>', unsafe_allow_html=True)

    dates = sorted(forecasts.forecast_date.unique().tolist())
    if st.session_state.get("selected_date") not in dates and dates:
        future = [day for day in dates if day >= datetime.now(TAIPEI).date().isoformat()]
        st.session_state.selected_date = future[0] if future else dates[-1]
    region = st.session_state.get("selected_region", "")
    records = get_region_forecast(region) if region and region in regions else pd.DataFrame()
    day = records[records.forecast_date == st.session_state.selected_date] if not records.empty else pd.DataFrame()

    key = get_windy_api_key()
    if key:
        center = st.session_state.get("selected_latlon") or MAP_CENTER
        selected_place = st.session_state.get("selected_place", "全球視圖")
        document = build_windy_html(
            api_key=key,
            overlay=st.session_state.get("selected_layer", "wind"),
            place=selected_place, center=center,
            zoom=st.session_state.map_zoom if selected_place == "全球視圖" else max(6, st.session_state.map_zoom),
        )
        components.html(document, width=None, height=980, scrolling=False, tab_index=0)
    else:
        columns = ["region_name", "forecast_date", "min_temp", "max_temp", "fetched_at"]
        markers = day if region else pd.DataFrame(columns=columns)
        st_folium(
            create_base_map(st.session_state.map_center, st.session_state.map_zoom),
            feature_group_to_add=create_weather_layer(markers, region or None),
            key="weather_map", height=980, width=None,
            center=st.session_state.map_center, zoom=st.session_state.map_zoom,
            returned_objects=["last_object_clicked", "last_clicked", "last_object_clicked_count", "center", "zoom"],
            on_change=on_map_change,
        )

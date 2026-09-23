"""Minimal full-map canvas and reusable map interaction state."""

import streamlit as st

from src.locations import MAP_CENTER, MAP_ZOOM, REGION_COORDINATES


def apply_style():
    st.markdown("""<style>
      html, body, [data-testid="stAppViewContainer"], [data-testid="stMain"] { background:#f7f8f7; }
      [data-testid="stHeader"], [data-testid="stSidebarCollapseButton"], footer { display:none !important; }
      [data-testid="stAppViewContainer"] { display:block !important; }
      [data-testid="stMain"] { width:100% !important; margin:0 !important; }
      [data-testid="stMainBlockContainer"] { max-width:none !important; padding:0 !important; }
      section[data-testid="stSidebar"] {
        position:fixed !important; right:20px !important; left:auto !important; top:20px !important;
        bottom:20px !important; z-index:1000 !important; width:328px !important; min-width:328px !important;
        height:auto !important; visibility:visible !important; transform:none !important;
        background:transparent !important; border:0 !important; pointer-events:none;
      }
      section[data-testid="stSidebar"] > div:first-child {
        height:100% !important; max-height:100% !important; overflow-y:auto !important;
        border:1px solid rgba(28,45,48,.09) !important; border-radius:20px !important;
        background:rgba(255,255,255,.97) !important; box-shadow:0 16px 54px rgba(23,40,44,.13) !important;
        padding:22px 22px 18px !important; pointer-events:auto;
        scrollbar-width:thin; scrollbar-color:#d8dfdc transparent;
      }
      section[data-testid="stSidebar"] [data-testid="stSidebarContent"] { height:auto !important; }
      [data-testid="stSidebar"] hr { margin:17px 0; border-color:#edf0ee; }
      [data-testid="stSidebar"] label { font-size:12px !important; font-weight:600 !important; color:#425253 !important; }
      [data-testid="stSidebar"] [data-testid="stSelectbox"] { margin-bottom:12px; }
      .weather-mark {font-size:11px;letter-spacing:1.7px;font-weight:700;color:#58716b;margin-bottom:4px;}
      .weather-place {font-size:23px;font-weight:660;letter-spacing:-.04em;color:#213532;margin:3px 0 2px;}
      .weather-update {font-size:11px;line-height:1.7;color:#84908c;}
      .weather-data-label {font-size:11px;color:#73807c;}
      [data-testid="stMetric"] {padding:13px 14px;background:#f6f8f6;border:1px solid #edf0ee;border-radius:13px;}
      [data-testid="stMetricLabel"] {font-size:11px !important;}
      [data-testid="stMetricValue"] {font-size:23px !important;}
      [data-testid="stButton"] button[kind="secondary"] {border:1px solid #e8ece9;border-radius:11px;font-size:13px;}
      [data-testid="stSelectbox"] div[data-baseweb="select"] > div {border-radius:11px;border-color:#e6eae7;background:#fff;}
      [data-testid="stIFrame"] {width:100% !important;border:0 !important;}
      [data-testid="stElementContainer"]:has(iframe[title*="streamlit_folium"]) {padding:0 !important;}
      @media(max-width:640px) {
        section[data-testid="stSidebar"] {top:12px !important;right:12px !important;bottom:12px !important;width:min(318px,calc(100vw - 24px)) !important;min-width:0 !important;}
        section[data-testid="stSidebar"] > div:first-child {padding:17px !important;border-radius:17px !important;}
      }
    </style>""", unsafe_allow_html=True)


def initialize_state(dates: list[str], regions: list[str]):
    state = st.session_state
    if state.get("selected_date") not in dates:
        state.selected_date = dates[0]
    if state.get("selected_region") not in ["", *regions]:
        state.selected_region = ""
    state.setdefault("map_center", MAP_CENTER)
    state.setdefault("map_zoom", MAP_ZOOM)
    state.setdefault("map_click_count", 0)
    state.setdefault("selected_place", "🌍 全球視圖")
    state.setdefault("selected_latlon", None)


def on_map_change():
    state = st.session_state
    value = state.get("weather_map", {})
    center = value.get("center")
    if isinstance(center, dict) and "lat" in center and "lng" in center:
        state.map_center = (center["lat"], center["lng"])
    if value.get("zoom") is not None:
        state.map_zoom = value["zoom"]
    clicked = value.get("last_object_clicked")
    count = value.get("last_object_clicked_count") or 0
    if clicked and count != state.get("map_click_count", 0):
        for region, (lat, lon) in REGION_COORDINATES.items():
            if abs(clicked["lat"] - lat) < .00001 and abs(clicked["lng"] - lon) < .00001:
                state.selected_region = region
                state.selected_place = region
                state.selected_latlon = (lat, lon)
                break
    state.map_click_count = count


def on_place_change():
    from src.locations import WORLD_CITY_COORDINATES

    value = st.session_state.selected_place
    if value == "🌍 全球視圖":
        st.session_state.selected_region = ""
        st.session_state.selected_latlon = None
        st.session_state.map_center = MAP_CENTER
        st.session_state.map_zoom = MAP_ZOOM
    elif value in REGION_COORDINATES:
        st.session_state.selected_region = value
        st.session_state.selected_latlon = REGION_COORDINATES[value]
        st.session_state.map_center = REGION_COORDINATES[value]
        st.session_state.map_zoom = 7
    else:
        st.session_state.selected_region = ""
        st.session_state.selected_latlon = WORLD_CITY_COORDINATES.get(value)
        st.session_state.map_center = st.session_state.selected_latlon
        st.session_state.map_zoom = 6


def reset_map():
    st.session_state.map_center = MAP_CENTER
    st.session_state.map_zoom = MAP_ZOOM
    st.session_state.selected_region = ""
    st.session_state.selected_latlon = None
    st.session_state.selected_place = "🌍 全球視圖"

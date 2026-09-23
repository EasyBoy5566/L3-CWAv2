"""Reusable UI styling and map interaction state."""

import streamlit as st

from src.locations import MAP_CENTER, MAP_ZOOM, REGION_COORDINATES


def apply_style():
    st.markdown("""<style>
      .block-container {padding-top:4.5rem;padding-bottom:3rem;max-width:1500px;}
      [data-testid="stSidebar"] {border-right:1px solid #DFE8E9;}
      [data-testid="stSidebar"] .block-container {padding-top:2rem;}
      h1 {font-size:2rem !important;letter-spacing:-.04em;padding:0 0 .35rem !important;}
      h2 {font-size:1.25rem !important;letter-spacing:-.02em;}
      h3 {font-size:1.05rem !important;}
      .eyebrow {font-size:11px;font-weight:700;letter-spacing:2px;color:#087F8C;margin-bottom:10px;}
      .muted {color:#617982;font-size:14px;line-height:1.7;}
      .stamp {text-align:right;font-size:12px;color:#617982;padding-top:10px;line-height:1.9;}
      .legend-row {display:flex;align-items:center;gap:10px;margin:13px 0;font-size:13px;}
      .legend-dot {width:10px;height:10px;border-radius:50%;flex-shrink:0;}
      [data-testid="stMetric"] {background:white;border:1px solid #DFE8E9;border-radius:12px;padding:16px;}
      [data-testid="stMetricValue"] {font-size:1.7rem;}
      iframe {border-radius:10px;}
      [data-testid="stVerticalBlockBorderWrapper"] {border-radius:14px;}
      @media(max-width:640px) {.block-container{padding:4rem 1rem 1.5rem;} .stamp{text-align:left;padding-top:0;}}
    </style>""", unsafe_allow_html=True)


def initialize_state(dates: list[str], regions: list[str]):
    state = st.session_state
    if state.get("selected_date") not in dates:
        state.selected_date = dates[0]
    if state.get("selected_region") not in ["全臺總覽", *regions]:
        state.selected_region = "全臺總覽"
    state.setdefault("map_center", MAP_CENTER)
    state.setdefault("map_zoom", MAP_ZOOM)
    state.setdefault("map_click_count", 0)


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
                break
    state.map_click_count = count


def reset_map():
    st.session_state.map_center = MAP_CENTER
    st.session_state.map_zoom = MAP_ZOOM

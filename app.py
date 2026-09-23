"""Run: python -m streamlit run app.py."""

from datetime import datetime

import pandas as pd
import streamlit as st
from streamlit_folium import st_folium

from src.config import CACHE_TTL, DB_PATH, TAIPEI
from src.database import init_database
from src.errors import WeatherError
from src.locations import REGION_COORDINATES
from src.map_view import create_base_map, create_weather_layer
from src.queries import get_all_forecasts
from src.service import refresh_forecasts
from src.ui import apply_style, initialize_state, on_map_change, reset_map
from src.utils import TEMPERATURE_STYLES, format_date, format_update

st.set_page_config(page_title="Taiwan Weather Map", page_icon="🌤️", layout="wide")
apply_style()


@st.cache_data(ttl=CACHE_TTL, show_spinner=False)
def load_forecasts(db_path: str, modified_ns: int):
    return get_all_forecasts(db_path)


def read_forecasts():
    return load_forecasts(str(DB_PATH), DB_PATH.stat().st_mtime_ns)


def update_data():
    try:
        with st.spinner("正在取得最新預報…"):
            frame = refresh_forecasts()
        load_forecasts.clear()
        st.session_state.pop("refresh_error", None)
        st.session_state.refresh_notice = f"已更新 {frame.region_name.nunique()} 個縣市的預報。"
    except WeatherError as exc:
        st.session_state.refresh_error = str(exc)


with st.sidebar:
    st.markdown('<div class="eyebrow">TAIWAN / WEATHER</div>', unsafe_allow_html=True)
    st.markdown("### 今天，從哪裡開始？")
    st.caption("選一天、選一個地方，看看接下來的天氣。")
    refresh_clicked = st.button("更新氣象資料", type="primary", use_container_width=True)

try:
    init_database()
    all_data = read_forecasts()
except WeatherError as exc:
    st.error(str(exc))
    st.stop()

if refresh_clicked:
    update_data()
elif all_data.empty and not st.session_state.get("initial_fetch_attempted"):
    st.session_state.initial_fetch_attempted = True
    update_data()

try:
    all_data = read_forecasts()
except WeatherError as exc:
    st.error(str(exc))
    st.stop()

if st.session_state.get("refresh_error"):
    suffix = " 目前顯示上次成功取得的資料。" if not all_data.empty else " 目前尚無可用預報。"
    st.warning(st.session_state.refresh_error + suffix)
if notice := st.session_state.pop("refresh_notice", None):
    st.success(notice)

title_col, stamp_col = st.columns([3, 1])
with title_col:
    st.markdown('<div class="eyebrow">A WEEK AHEAD · 一週天氣探索</div>', unsafe_allow_html=True)
    st.title("台灣天氣地圖")
    st.markdown('<div class="muted">從海岸到城市，下一站的溫度，一眼掌握。</div>', unsafe_allow_html=True)

if all_data.empty:
    st.info("還沒有預報資料。設定氣象署授權碼後，按左側「更新氣象資料」開始。")
    st.stop()

last_update = all_data.fetched_at.max()
with stamp_col:
    st.markdown(f'<div class="stamp">資料更新<br><b>{format_update(last_update)}</b> · 台北時間<br>中央氣象署 CWA</div>', unsafe_allow_html=True)

now = datetime.now(TAIPEI)
today = now.date().isoformat()
current = all_data[all_data.forecast_date >= today].copy()
if current.empty:
    st.warning("儲存的預報已全部過期；以下是過期資料，請更新後再作為出行參考。")
    current = all_data.copy()
elif (now - datetime.fromisoformat(last_update)).total_seconds() > 21600:
    st.warning("這份預報已超過 6 小時未更新，請按「更新氣象資料」。")

dates = sorted(current.forecast_date.unique().tolist())
regions = sorted(current.region_name.unique().tolist())
initialize_state(dates, regions)
with st.sidebar:
    st.divider()
    st.selectbox("預報日期", dates, key="selected_date", format_func=format_date)
    st.selectbox("探索地區", ["全臺總覽", *regions], key="selected_region")
    st.button("回到全臺視角", on_click=reset_map, use_container_width=True)
    st.divider()
    st.markdown("**地圖溫度圖例**")
    for style in TEMPERATURE_STYLES.values():
        st.markdown(f'<div class="legend-row"><span class="legend-dot" style="background:{style["color"]}"></span><span>{style["label"]}</span><span style="margin-left:auto;color:#617982">{style["range"]}</span></div>', unsafe_allow_html=True)
    st.caption("顏色依最低與最高溫的中間值分級；點選圓點可查看完整預報。")
    st.divider()
    st.caption("預報依時段起始日彙整，跨夜時段歸起始日。首尾日期可能僅有部分時段。")
    st.markdown("[資料來源與說明 ↗](https://opendata.cwa.gov.tw/dataset/forecast/F-D0047-091)")

selected_date = st.session_state.selected_date
selected_region = st.session_state.selected_region
day = current[current.forecast_date == selected_date]
unmapped = set(day.region_name) - set(REGION_COORDINATES)
if unmapped:
    st.warning("以下地區缺少地圖座標，仍可從選單查看：" + "、".join(sorted(unmapped)))

with st.container(border=True):
    map_title, coverage = st.columns([3, 2])
    map_title.markdown(f"**{format_date(selected_date)} · 全臺預報**")
    coverage.caption(f"{len(day)} 個縣市　｜　{day.min_temp.min():g}–{day.max_temp.max():g}°C　｜　點選圓點探索")
    st_folium(
        create_base_map(),
        feature_group_to_add=create_weather_layer(day, selected_region),
        key="weather_map", height=530, use_container_width=True,
        center=st.session_state.map_center, zoom=st.session_state.map_zoom,
        returned_objects=["last_object_clicked", "last_object_clicked_count", "center", "zoom"],
        on_change=on_map_change,
    )

st.caption("各縣市代表點預報 · 單位 °C · 縮放地圖可分辨鄰近地區。")
if selected_region == "全臺總覽":
    st.subheader("當日地圖概覽")
    a, b, c = st.columns(3)
    a.metric("預報涵蓋", f"{len(day)} 縣市")
    b.metric("各地最低溫", f"{day.min_temp.min():g}°C", help="此日期各縣市最低預報溫度的最小值。")
    c.metric("各地最高溫", f"{day.max_temp.max():g}°C", help="此日期各縣市最高預報溫度的最大值。")
    st.info("點選地圖圓點，或從左側選擇縣市，查看當地一週溫度趨勢。", icon="↗️")
    table = day
else:
    st.subheader(f"{selected_region} · {format_date(selected_date)}")
    selected = day[day.region_name == selected_region]
    if selected.empty:
        st.info("此地區當日暫無預報資料。")
    else:
        row = selected.iloc[0]
        a, b, c = st.columns(3)
        a.metric("最低溫", f"{row.min_temp:g}°C")
        b.metric("最高溫", f"{row.max_temp:g}°C")
        c.metric("溫差", f"{row.max_temp - row.min_temp:g}°C")
        st.caption(f"資料更新：{format_update(row.fetched_at)}（台北時間）")
    table = current[current.region_name == selected_region].sort_values("forecast_date")
    with st.container(border=True):
        st.subheader("接下來幾天，溫度怎麼走？")
        chart = table[["forecast_date", "min_temp", "max_temp"]].copy()
        chart["forecast_date"] = pd.to_datetime(chart.forecast_date)
        chart = chart.rename(columns={"forecast_date": "日期", "min_temp": "最低溫", "max_temp": "最高溫"})
        st.line_chart(chart, x="日期", y=["最低溫", "最高溫"], color=["#087F8C", "#CF5146"], height=290, y_label="溫度（°C）")
        st.caption("每日期間內的最低／最高溫；跨夜預報歸起始日，非每日實測值。")

with st.expander("查看預報資料", expanded=True):
    renamed = table.rename(columns={"region_name":"地區", "forecast_date":"預報日期", "min_temp":"最低溫 °C", "max_temp":"最高溫 °C", "fetched_at":"資料擷取時間"})
    st.dataframe(renamed, hide_index=True, use_container_width=True,
                 column_config={"最低溫 °C":st.column_config.NumberColumn(format="%.1f"), "最高溫 °C":st.column_config.NumberColumn(format="%.1f")})
    st.download_button("下載 CSV", renamed.to_csv(index=False).encode("utf-8-sig"), file_name="taiwan-weather.csv", mime="text/csv")

st.caption("Taiwan Weather Map Dashboard · 氣象資料：中央氣象署 · 地圖：© OpenStreetMap contributors")

# Taiwan Weather Map Dashboard — Execution Plan

> 作業目標：建立一個**以台灣互動地圖為主畫面**的天氣預報 Web App。  
> 技術主軸：**CWA Open Data API → JSON → Pandas → SQLite → Streamlit → Folium → GitHub**  
> UI 原則：**Map-first**。使用者進入頁面後，主要視覺區域就是台灣地圖；圖表、表格與詳細天氣資訊都是地圖的輔助資訊。

---

## 0. Definition of Done

專案完成時，必須達成以下條件：

- [ ] 能從中央氣象署 CWA Open Data API 取得天氣預報 JSON
- [ ] API Key 不會寫死在程式碼或上傳至 GitHub
- [ ] 能正確解析指定地區的日期、最低溫、最高溫
- [ ] 將整理後資料寫入 SQLite
- [ ] SQLite 不因重複執行而產生大量重複資料
- [ ] Streamlit 能正常啟動
- [ ] 首頁以「台灣地圖」為主要 UI
- [ ] 地圖上有各地區 Marker
- [ ] Marker 顏色能依氣溫區間改變
- [ ] 點擊 Marker 可顯示該地區天氣資訊
- [ ] 可切換預報日期，地圖即時更新
- [ ] 可選擇地區，顯示該地區未來數日 MinT / MaxT 折線圖
- [ ] 可查看原始/整理後預報資料表
- [ ] 顯示資料最後更新時間
- [ ] API、資料庫或資料缺失時有錯誤處理
- [ ] GitHub repository 有清楚的 commit history
- [ ] README.md 完整說明安裝、執行、架構與功能

---

# 1. Final Product

## 1.1 App 名稱

**Taiwan Weather Map Dashboard**

副標題：

> Interactive weather forecast powered by CWA Open Data

---

## 1.2 核心使用流程

使用者開啟 App：

```text
開啟 App
   ↓
看到整張台灣互動地圖
   ↓
選擇預報日期
   ↓
地圖更新各地區溫度與顏色
   ↓
點擊某個地區 Marker
   ↓
查看 MinT / MaxT / 日期
   ↓
選擇該地區
   ↓
查看未來數日溫度折線圖與資料表
```

---

# 2. UI / UX Specification

## 2.1 Desktop Layout

桌面版首頁採 Map-first：

```text
┌───────────────────────────────────────────────────────────────┐
│ Taiwan Weather Map Dashboard                 Last update ...  │
├───────────────┬───────────────────────────────────────────────┤
│               │                                               │
│ Control Panel │                                               │
│               │                                               │
│ Date          │                                               │
│ [2026-xx-xx]  │              TAIWAN MAP                       │
│               │                                               │
│ Region        │       ● Taipei      ● Taichung                │
│ [All ▼]       │                                               │
│               │                     ● Kaohsiung               │
│ Legend        │                                               │
│ ● < 20°C      │                                               │
│ ● 20–25°C     │                                               │
│ ● 25–30°C     │                                               │
│ ● > 30°C      │                                               │
│               │                                               │
├───────────────┴───────────────────────────────────────────────┤
│ Selected Region                                               │
│ Taipei                                                        │
│ Min 24°C       Max 31°C                                       │
├───────────────────────────────────────────────────────────────┤
│ Forecast Temperature Trend                                    │
│             MinT / MaxT line chart                            │
├───────────────────────────────────────────────────────────────┤
│ Forecast Data Table                                           │
└───────────────────────────────────────────────────────────────┘
```

---

## 2.2 UI 優先順序

### Priority 1 — Map

地圖占主要視覺區域。

需求：

- 台灣置中
- 初始 zoom 約可完整看到台灣本島
- 每個預報地區都有 Marker
- Marker 顯示溫度狀態
- Marker popup 顯示詳細資料
- 選擇日期後全部 Marker 更新
- 地圖不要因 Streamlit rerun 失去主要狀態

### Priority 2 — Filters

控制區：

- 預報日期
- 地區
- 資料更新按鈕
- 溫度圖例

### Priority 3 — Selected Region Summary

顯示：

- 地區名稱
- 預報日期
- MinT
- MaxT
- 平均溫度（衍生值，可選）
- 最後更新時間

### Priority 4 — Trend Chart

選擇單一地區後：

```text
日期 →
MinT
MaxT
```

以折線圖顯示未來數日趨勢。

### Priority 5 — Data Table

放在頁面下方，不搶走地圖主視覺。

---

# 3. Temperature Map Design

## 3.1 Marker 溫度依據

Marker 顏色使用：

```text
display_temp = (min_temp + max_temp) / 2
```

只作為視覺分級用途。

原始 MinT / MaxT 必須保留。

---

## 3.2 Temperature Categories

第一版：

```text
< 20°C       → Cold
20–25°C      → Cool
25–30°C      → Warm
> 30°C       → Hot
```

注意：

- 分類應集中放在單一函式
- 不要散落在 UI 程式中
- 後續可修改區間而不影響其他模組

函式介面：

```python
def get_temperature_category(temp: float) -> str:
    ...
```

---

# 4. Technology Stack

| Layer | Technology | Purpose |
|---|---|---|
| Data Source | CWA Open Data API | 天氣資料 |
| HTTP | requests | API request |
| Data Format | JSON | API response |
| Data Processing | pandas | 清理與表格化 |
| Database | SQLite | 本地資料儲存 |
| SQL | sqlite3 | DB 操作 |
| Web App | Streamlit | Dashboard |
| Map | Folium | 互動地圖 |
| Streamlit Map Bridge | streamlit-folium | Folium integration |
| Chart | Streamlit / Pandas | 溫度折線圖 |
| Configuration | python-dotenv | API key |
| Version Control | Git + GitHub | 版本管理 |

---

# 5. Project Structure

建立以下專案：

```text
taiwan-weather-map/
│
├── app.py
│
├── README.md
├── plan.md
├── requirements.txt
├── .gitignore
├── .env.example
│
├── data/
│   └── weather.db
│
├── src/
│   ├── __init__.py
│   ├── config.py
│   ├── cwa_api.py
│   ├── parser.py
│   ├── database.py
│   ├── queries.py
│   ├── locations.py
│   ├── map_view.py
│   └── utils.py
│
└── tests/
    ├── test_parser.py
    └── test_database.py
```

---

# 6. Module Responsibilities

## `app.py`

只處理：

- Streamlit page config
- UI layout
- user interaction
- 呼叫各模組
- 顯示 map / chart / table

**不要在 app.py 裡直接寫大量 API parsing 或 SQL。**

---

## `src/config.py`

負責：

- API key
- CWA API base URL
- dataset ID
- DB path
- timeout
- UI constants

建議：

```python
CWA_API_KEY = ...
CWA_DATASET_ID = ...
DB_PATH = ...
REQUEST_TIMEOUT = 10
```

---

## `src/cwa_api.py`

負責：

- 建構 API request
- timeout
- HTTP status validation
- JSON response

介面：

```python
def fetch_weather_data() -> dict:
    ...
```

要求：

- 使用 `requests`
- 加入 timeout
- `raise_for_status()`
- API error 要轉成可理解 exception

---

## `src/parser.py`

負責：

```text
CWA JSON
   ↓
normalized records
   ↓
DataFrame
```

目標欄位：

```text
region_name
forecast_date
min_temp
max_temp
fetched_at
```

主要函式：

```python
def parse_weather_data(raw_json: dict) -> pd.DataFrame:
    ...
```

必要驗證：

- JSON key 是否存在
- MinT 是否存在
- MaxT 是否存在
- 日期是否可解析
- 溫度是否可轉為 numeric
- 缺值處理

---

## `src/database.py`

負責：

- DB connection
- CREATE TABLE
- INSERT / UPSERT
- transaction

函式：

```python
def init_database() -> None:
    ...

def save_forecasts(df: pd.DataFrame) -> None:
    ...
```

---

## `src/queries.py`

UI 不直接寫 SQL。

介面：

```python
def get_all_forecasts() -> pd.DataFrame:
    ...

def get_regions() -> list[str]:
    ...

def get_forecast_dates() -> list[str]:
    ...

def get_forecast_by_date(date: str) -> pd.DataFrame:
    ...

def get_region_forecast(region: str) -> pd.DataFrame:
    ...
```

---

## `src/locations.py`

保存地區座標：

```python
REGION_COORDINATES = {
    "...": (lat, lon),
}
```

重要：

- 地區名稱必須與 CWA API 資料一致
- 不要在多個檔案重複寫座標
- 第一版使用固定代表座標即可

---

## `src/map_view.py`

負責：

- 建立台灣地圖
- temperature category
- Marker
- popup
- legend 所需資訊

介面：

```python
def create_weather_map(
    weather_df: pd.DataFrame,
    selected_region: str | None = None
):
    ...
```

---

# 7. Database Schema

## Table: `weather_forecast`

```sql
CREATE TABLE IF NOT EXISTS weather_forecast (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    region_name TEXT NOT NULL,
    forecast_date TEXT NOT NULL,
    min_temp REAL,
    max_temp REAL,
    fetched_at TEXT NOT NULL,
    UNIQUE(region_name, forecast_date)
);
```

---

## Upsert Strategy

每次更新 API：

```sql
INSERT INTO weather_forecast (...)
VALUES (...)
ON CONFLICT(region_name, forecast_date)
DO UPDATE SET
    min_temp = excluded.min_temp,
    max_temp = excluded.max_temp,
    fetched_at = excluded.fetched_at;
```

目的：

避免：

```text
Taipei 2026-09-24
Taipei 2026-09-24
Taipei 2026-09-24
```

重複累積。

---

# 8. API Configuration

建立 `.env`：

```text
CWA_API_KEY=YOUR_KEY
CWA_DATASET_ID=YOUR_DATASET_ID
```

建立 `.env.example`：

```text
CWA_API_KEY=
CWA_DATASET_ID=
```

`.gitignore`：

```gitignore
.env
.venv/
__pycache__/
*.pyc
data/*.db
.streamlit/secrets.toml
```

---

# 9. Dataset Validation — Must Do Before Coding Parser

目前不要猜 CWA dataset ID。

第一階段必須先確認老師指定或實際要使用的資料集。

完成以下驗證：

```text
1. dataset ID
2. endpoint
3. API authentication method
4. JSON root structure
5. 地區名稱所在欄位
6. MinT elementName
7. MaxT elementName
8. 日期/time structure
9. 預報時間範圍
10. 是否涵蓋需要的台灣地區
```

取得一份真實 API response，保存開發用 sample：

```text
sample_weather.json
```

注意：

- sample 不得包含敏感 API key
- parser 優先使用 sample 開發與測試
- 不要每修改一次 parser 都重新打 API

---

# 10. Execution Phases

---

## Phase 1 — Repository & Environment

### Tasks

- [ ] 建立 `taiwan-weather-map`
- [ ] 建立 Python virtual environment
- [ ] 建立 project structure
- [ ] 安裝 dependencies
- [ ] 建立 `.gitignore`
- [ ] 建立 `.env.example`
- [ ] 建立 Git repository
- [ ] First commit

### Commands

```bash
mkdir taiwan-weather-map
cd taiwan-weather-map

python -m venv .venv
```

Windows：

```bash
.venv\Scripts\activate
```

Install：

```bash
pip install requests pandas streamlit folium streamlit-folium python-dotenv pytest
```

建立：

```bash
pip freeze > requirements.txt
```

### Acceptance Criteria

```bash
python --version
```

正常。

```bash
streamlit hello
```

正常。

---

## Phase 2 — CWA API Prototype

### Goal

成功取得真實 JSON。

### Tasks

- [ ] 取得 API Key
- [ ] 確認 Dataset ID
- [ ] 建立 `.env`
- [ ] 完成 `config.py`
- [ ] 完成 `cwa_api.py`
- [ ] request timeout
- [ ] HTTP error handling
- [ ] JSON decode handling

### Temporary Test

```python
data = fetch_weather_data()
print(type(data))
print(data.keys())
```

### Acceptance Criteria

```text
HTTP 200
JSON decode successful
API key 不出現在 terminal error / GitHub
```

Commit：

```text
feat: add CWA weather API client
```

---

## Phase 3 — JSON Exploration & Parser

### Goal

將 API JSON 轉為標準 DataFrame。

### Expected Output

```text
region_name   forecast_date   min_temp   max_temp   fetched_at
Taipei        2026-xx-xx      24         31         ...
Taichung      2026-xx-xx      23         32         ...
```

### Tasks

- [ ] 查看 JSON hierarchy
- [ ] 找出 region path
- [ ] 找出 MinT path
- [ ] 找出 MaxT path
- [ ] 找出 date path
- [ ] 建立 parser
- [ ] numeric conversion
- [ ] missing value handling
- [ ] duplicate handling
- [ ] sort by region/date

### Acceptance Criteria

```python
assert not df.empty
assert "region_name" in df.columns
assert "forecast_date" in df.columns
assert "min_temp" in df.columns
assert "max_temp" in df.columns
```

且：

```text
min_temp <= max_temp
```

對有效資料成立。

Commit：

```text
feat: parse CWA forecast JSON into dataframe
```

---

## Phase 4 — SQLite

### Goal

資料可以可靠寫入與查詢。

### Tasks

- [ ] create DB
- [ ] create table
- [ ] UPSERT
- [ ] SELECT
- [ ] region query
- [ ] date query
- [ ] sort query

### Acceptance Test

同一份 DataFrame 寫入兩次：

```python
save_forecasts(df)
save_forecasts(df)
```

資料筆數不得變成兩倍。

Commit：

```text
feat: add SQLite weather persistence
```

---

## Phase 5 — Map Prototype

### Goal

**先完成地圖，再做其他 UI。**

### Tasks

- [ ] 建立 Taiwan-centered Folium map
- [ ] 建立 region coordinate mapping
- [ ] 將 DB 中單日資料畫成 marker
- [ ] marker popup
- [ ] marker temperature category
- [ ] Streamlit 顯示地圖

### Prototype

```python
m = create_weather_map(df)
st_folium(m, width=None, height=650)
```

### Popup

至少：

```text
Region
Forecast Date
MinT
MaxT
```

### Acceptance Criteria

- 台灣完整出現在視窗
- 每個有資料的 region 只有一個 marker
- Marker popup 資料正確
- marker 不會因缺一筆資料讓整張 map crash

Commit：

```text
feat: add interactive Taiwan weather map
```

---

## Phase 6 — Map-first Streamlit UI

### Goal

建立正式主畫面。

### Sidebar / Control Panel

```text
Forecast Date
Region
Refresh Data
Legend
```

### Main Area

```text
Map
↓
Selected Region Metrics
↓
Trend Chart
↓
Table
```

### Streamlit Config

```python
st.set_page_config(
    page_title="Taiwan Weather Map",
    page_icon="🌤️",
    layout="wide"
)
```

### Acceptance Criteria

使用者不需 scroll：

**第一個 viewport 就應該看到地圖主要區域。**

Commit：

```text
feat: build map-first Streamlit dashboard
```

---

## Phase 7 — Date Interaction

### Goal

日期控制地圖資料。

Flow：

```text
select date
   ↓
query DB
   ↓
get date dataframe
   ↓
rebuild markers
   ↓
rerender map
```

### Acceptance Criteria

切換日期：

- marker 數值會改
- popup 日期會改
- selected region summary 會同步

Commit：

```text
feat: add forecast date filtering
```

---

## Phase 8 — Region Detail

### Goal

地圖是總覽，Region Detail 是深入資訊。

選 Region 後：

```text
Region Name

MinT
MaxT

7-day / available-period trend

Data table
```

### Chart

X：

```text
forecast_date
```

Y：

```text
min_temp
max_temp
```

### Acceptance Criteria

不同地區的 chart 資料不得混在一起。

Commit：

```text
feat: add regional forecast detail view
```

---

## Phase 9 — Refresh Data

### Goal

讓 App 可更新 CWA 最新資料。

Button：

```text
更新 CWA 資料
```

流程：

```text
button
 ↓
fetch API
 ↓
parse JSON
 ↓
upsert SQLite
 ↓
clear Streamlit cache
 ↓
rerun
```

### 必須處理

- network failure
- API timeout
- invalid JSON
- missing forecast fields
- database failure

失敗時：

```text
保留 SQLite 中最後一次成功資料
```

**不能因 API 暫時失敗讓 App 完全無法使用。**

Commit：

```text
feat: add safe weather data refresh
```

---

# 11. Error Handling

至少區分：

```python
APIRequestError
APIResponseError
WeatherParseError
DatabaseError
```

UI：

```python
try:
    ...
except APIRequestError:
    st.error("無法連線中央氣象署，目前顯示最後一次成功更新的資料。")
```

原則：

```text
External API failure
        ↓
Do not destroy local data
        ↓
Fallback to SQLite cache
```

---

# 12. Streamlit State Strategy

需要保存：

```text
selected_date
selected_region
```

可使用：

```python
st.session_state
```

避免：

```text
點一下 UI
↓
整個狀態全部重置
```

---

# 13. Caching

API 不應每次 widget rerun 都重新呼叫。

建議：

```python
@st.cache_data(ttl=1800)
```

用於讀取或處理適合 cache 的資料。

DB connection 要依 Streamlit 使用模式審慎管理。

第一版以：

```text
每次 query 建立短連線 → query → close
```

為優先，避免 connection lifecycle 問題。

---

# 14. Core Functions Checklist

最終至少應有以下函式：

```python
fetch_weather_data()

parse_weather_data()

init_database()

save_forecasts()

get_regions()

get_forecast_dates()

get_forecast_by_date()

get_region_forecast()

get_temperature_category()

create_weather_map()
```

---

# 15. Testing Plan

## Parser Test

使用固定 sample JSON：

```text
tests/sample_weather.json
```

測：

- MinT parsing
- MaxT parsing
- region parsing
- date parsing
- missing element

---

## Database Test

使用 temporary SQLite DB。

測：

```text
CREATE
INSERT
UPSERT
SELECT
duplicate prevention
```

---

## Manual UI Test

測試：

```text
1. App startup
2. default map
3. date change
4. region change
5. popup
6. trend chart
7. refresh button
8. API offline
9. DB has no data
10. incomplete region coordinate
```

---

# 16. Git Workflow

不要最後一次 commit 全部程式。

建議：

```text
chore: initialize project structure

feat: add CWA weather API client

feat: parse CWA forecast JSON into dataframe

feat: add SQLite weather persistence

feat: add weather query layer

feat: add interactive Taiwan weather map

feat: build map-first Streamlit dashboard

feat: add forecast date filtering

feat: add regional temperature trend

feat: add safe data refresh

fix: handle missing weather records

docs: add setup and usage instructions
```

---

# 17. README Required Content

README 最少包含：

## Project Overview

說明：

```text
CWA API
→ JSON
→ Pandas
→ SQLite
→ Streamlit
→ Folium
```

## Features

- Taiwan weather map
- Date selector
- Temperature marker
- Region popup
- Forecast trend
- Data table
- SQLite persistence

## Installation

```bash
git clone ...
cd taiwan-weather-map
python -m venv .venv
pip install -r requirements.txt
```

## Environment

```text
CWA_API_KEY=
CWA_DATASET_ID=
```

## Run

```bash
streamlit run app.py
```

## Architecture

加入：

```text
CWA API
   ↓
Parser
   ↓
SQLite
   ↓
Query Layer
   ↓
Streamlit
   ↓
Folium
```

## Screenshot

至少：

- 主地圖
- Marker popup
- Region chart

---

# 18. MVP Boundary

第一版只做：

```text
MinT
MaxT
Date
Region
Map
Chart
Table
SQLite
```

**不要在 MVP 尚未完成前加入：**

- LLM
- LINE Bot
- machine learning
- push notification
- complex animation
- multiple CWA datasets
- historical climate analysis

---

# 19. Optional Phase — Weather Expansion

MVP 完成後才能做。

可加入：

```text
PoP / 降雨機率
Wx / 天氣現象
RH / 相對濕度
Weather icon
Wind
Comfort index
```

資料庫再依實際 CWA dataset schema 擴充。

---

# 20. Optional Phase — AI Feature

AI 不直接取代 CWA data。

正確架構：

```text
Structured Weather Data
        ↓
Rule / AI Summary
        ↓
Natural language explanation
```

例如：

```text
台中明日最高溫 32°C、最低 25°C。
日夜溫差約 7°C。
```

AI 僅負責解釋，不負責製造氣象數值。

---

# 21. Recommended Implementation Order

嚴格依下列順序：

```text
[01] Environment
      ↓
[02] Confirm CWA Dataset
      ↓
[03] API Request
      ↓
[04] Save Sample JSON
      ↓
[05] Understand JSON
      ↓
[06] Parser
      ↓
[07] DataFrame Validation
      ↓
[08] SQLite Schema
      ↓
[09] UPSERT
      ↓
[10] Query Layer
      ↓
[11] Taiwan Coordinates
      ↓
[12] Folium Prototype
      ↓
[13] Streamlit Map-first UI
      ↓
[14] Date Selector
      ↓
[15] Region Selector
      ↓
[16] Metrics
      ↓
[17] Trend Chart
      ↓
[18] Data Table
      ↓
[19] Refresh / Error Handling
      ↓
[20] Tests
      ↓
[21] UI Polish
      ↓
[22] README
      ↓
[23] GitHub Final Check
```

---

# 22. Final Folder Validation

交作業前：

```text
taiwan-weather-map/
│
├── app.py                    ✓
├── README.md                 ✓
├── plan.md                   ✓
├── requirements.txt          ✓
├── .gitignore                ✓
├── .env.example              ✓
│
├── data/
│   └── weather.db            local only
│
├── src/
│   ├── __init__.py           ✓
│   ├── config.py             ✓
│   ├── cwa_api.py            ✓
│   ├── parser.py             ✓
│   ├── database.py           ✓
│   ├── queries.py            ✓
│   ├── locations.py          ✓
│   ├── map_view.py           ✓
│   └── utils.py              ✓
│
└── tests/
    ├── test_parser.py         ✓
    └── test_database.py       ✓
```

---

# 23. Final Acceptance Test

執行：

```bash
streamlit run app.py
```

確認：

1. App 無 exception
2. 第一畫面看得到台灣地圖
3. 地圖是 UI 主體
4. 日期 selector 可正常使用
5. Marker 顯示正確
6. Popup MinT / MaxT 正確
7. Region filter 正確
8. Trend chart 正確
9. Table 正確
10. Refresh API 成功
11. API 失敗時仍能顯示 DB 舊資料
12. GitHub 沒有 API key
13. README 可讓另一台電腦依說明成功啟動

---

# 24. Agent Execution Rules

如果使用 Codex CLI、Claude Code 或其他 coding agent 執行本計畫：

1. 一次只完成一個 Phase。
2. 每個 Phase 完成後先執行測試。
3. 不得假設 CWA JSON schema；必須根據真實 sample。
4. 不得將 API Key 寫入 source code。
5. 不得將所有程式集中在 `app.py`。
6. UI 必須維持 Map-first。
7. 地圖完成前不要花時間做 AI 功能。
8. 每次修改 DB schema 後重新驗證 query。
9. 每次修改 parser 後重新跑 parser tests。
10. 每個 Phase 成功後建立一個語意清楚的 Git commit。
11. 遇到不確定的 CWA 欄位時停止猜測，檢查 sample JSON。
12. 優先完成可執行 MVP，再進行視覺優化。

---

# 25. First Action

專案的第一個實際工作項目不是寫 Streamlit。

先取得並確認：

```text
CWA Dataset ID
+
一份真實 API JSON sample
```

完成後才能精確定義：

```text
parser.py
database schema
region naming
forecast date mapping
```

**第一個 milestone：**

> `fetch_weather_data()` 能成功取得資料，且 `sample_weather.json` 已保存並確認不含 API key。

完成此 milestone 後，進入 Phase 3。

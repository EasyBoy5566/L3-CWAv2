# Taiwan 3D Weather — Execution Plan

> 作業目標：建立一個**以 3D 台灣地形為主畫面**的氣象網站，部署在 Vercel，以線上網址驗收。
> 技術主軸：**CWA Open Data API → JSON → Python ETL → SQLite（Turso / libSQL）→ Flask → CesiumJS → Vercel → GitHub**
> UI 原則：**Globe-first**。進入網站看到 3D 台灣、真實位置的太陽與月亮；點擊縣市，滑出該地區的完整天氣資訊。
> 驗收方式：直接操作已部署的網站（桌機瀏覽器）。

---

## 0. Definition of Done

### 資料
- [ ] 從 CWA Open Data API 取得觀測、3 天預報、一週預報、日月出沒四類資料
- [ ] CWA API Key、Turso token、Cron secret 不出現在 source code、Git 歷史、瀏覽器或錯誤訊息中
- [ ] 所有資料寫入 SQLite（正式環境為 Turso，本機為 `data/weather.db`），重複執行不產生重複資料
- [ ] 保存**預報歷史**（每一版預報），首頁預設顯示**最新一版**
- [ ] 觀測資料每 10 分鐘自動更新，預報每小時檢查一次
- [ ] 「一天」定義為台北時間 00:00–24:00

### 網站
- [ ] 首頁是 3D 台灣地形，縣市依溫度著色
- [ ] 天空中有依真實時間計算的太陽與月亮，地形有日照明暗
- [ ] 點擊 3D 縣市 → 右側滑出面板，網址同步變成 `/region/<縣市>`
- [ ] 面板 / 詳細頁顯示：即時溫度、濕度、氣壓、風、天氣；逐時預報；一週預報；趨勢圖；日出日落、月出月落
- [ ] 可查詢過去日期的實測資料、預報修正歷程、預報 vs 實測
- [ ] 頁面顯示資料時間，資料過期時有明確警示
- [ ] 頁面開著不動，資料也會自動更新
- [ ] 任一外部服務（CWA / Cesium ion）失敗時，網站仍可開啟並顯示最後一次成功的資料

### 工程
- [ ] 部署於 Vercel，公開網址可用
- [ ] pytest 覆蓋 parser、寫入、查詢、路由、排程驗證
- [ ] GitHub 有清楚的 commit history
- [ ] README 說明架構、環境變數、本機執行、部署、課程步驟對照

---

## 實作紀錄（2026-09-24）

### 進度

| Phase | 狀態 |
|---|---|
| 0 清場與技術驗證 | ✅ 本機完成；⏳ Vercel、Turso、Cesium ion、cron-job.org 需使用者建立帳號後部署驗證 |
| 1 資料管線 | ✅ 四類資料 parser、job、排程端點；本機以真實 CWA 資料驗證 |
| 2 縣市詳細頁 | ✅ |
| 3 3D 臺灣 | ✅ 無 ion token 時以 Esri 影像驗證；地形需 token |
| 4 太陽與月亮 | ✅ 日照、時間軸、陰影開關、月相 |
| 5 即時體驗 | ✅ 讀取時補抓、輪詢、health、edge cache |
| 6 歷史 | ✅ 實測 vs 預報、預報修正歷程 |
| 7 收尾 | ✅ 62 個測試、README；⏳ 線上截圖與效能量測待部署後 |

### Phase 0 驗證結果與設計調整

| 項目 | 原計畫 | 實作 | 原因 |
|---|---|---|---|
| Turso 連線 | `libsql` 套件，失敗再改 HTTP | **直接用 Turso HTTP API**（`requests`） | 無原生套件、無狀態，最適合 serverless；`libsql` 的 remote 模式無法在沒有帳號時驗證 |
| 預報版本 | `FetchRuns.issuedAt` 去重 | `ForecastRuns.contentHash` 去重 + `JobStatus` 記錄每個 job 狀態 | **CWA 預報 JSON 沒有發布時間欄位**（已以 sample 確認） |
| 精確天數 | 089 前 3 天 | **前 4 天**精確（`approx = 0`） | 089 溫度前 36 小時逐時、之後每 3 小時，涵蓋到第 4 天 21:00 |
| 12 小時推估的最低溫 | 所有重疊時段的最小值 | 只取 00:00–18:00 涵蓋的時段 | 18:00 起的夜間時段，最低溫落在隔天清晨 |
| 縣市即時值 | 每次查詢時計算 | 寫入時算好存入 `CountyObservations` | 地圖與趨勢圖不必每次掃描數百個測站，也節省 Turso 讀取額度 |
| 氣壓 | 中位數 | 海拔 100 m 以下測站；縣內沒有則取最近的平地測站 | 363 站中只有少數量測氣壓，南投縣、嘉義縣、新竹市一站都沒有 |
| 面板網址 | `pushState` 到 `/region/<縣市>` | 地圖上用 `/?region=<縣市>`，面板另附「完整頁面」連結到 `/region/<縣市>` | 重新整理時保留 3D 地圖與面板，而不是跳到獨立頁 |
| 圖表 | ECharts | ECharts **5.6.0**（最新為 6.x） | 固定使用 API 已確認的版本 |
| 縣市邊界 | 自行下載 shapefile + mapshaper | taiwan-atlas（內政部資料集 7442 的簡化 TopoJSON）→ `scripts/build_geo.py` 轉 GeoJSON，426 KB | 本機沒有 node；來源與授權相同 |
| 每日排程 | cron-job.org | Vercel Cron（免費方案每天一次正好足夠）；觀測與預報仍用 cron-job.org | |

---

## 1. 系統架構

```text
                     ┌──────────────────────────────────────────┐
cron-job.org ───────►│ POST /api/cron/observations   每 10 分鐘 │
 (Bearer CRON_SECRET)│ POST /api/cron/forecasts      每 1 小時  │
                     │ POST /api/cron/daily          每天 1 次  │
                     └──────────────┬───────────────────────────┘
                                    │ Flask on Vercel (hnd1)
                     CWA Open Data ◄┤ etl/: fetch → parse → validate → UPSERT
                                    ▼
                     ┌──────────────────────────────────────────┐
                     │ Turso (libSQL = SQLite)  aws-ap-northeast-1│
                     └──────────────┬───────────────────────────┘
                                    │ app/queries.py（UI 不直接寫 SQL）
                                    ▼
             Flask 頁面（Jinja）+ JSON API（edge cache: s-maxage）
                                    │
                                    ▼
      瀏覽器：CesiumJS 3D 地球 ─ 點擊縣市 ─► 側邊面板（ECharts）
              每 2–5 分鐘輪詢 JSON API，只更新數字
```

### 關鍵設計決策

| 決策 | 選擇 | 理由 |
|---|---|---|
| 網站框架 | Flask（Vercel Python runtime） | 符合技術要求；單一 app 管理頁面、API、排程端點；本機 `flask run` 與正式環境同一份程式 |
| 資料庫 | Turso（libSQL） | Vercel function 檔案系統唯讀，無法寫入本地 SQLite；Turso 與 SQLite SQL 相容 |
| 本機 / 測試資料庫 | `data/weather.db`（標準 sqlite3） | 測試不連網、不碰正式資料；同一份 schema |
| 排程 | cron-job.org（外部） | Vercel Hobby Cron 一天一次；GitHub Actions cron 常延遲，達不到 10 分鐘 |
| 即時性 | 排程 + 讀取時補抓 + 前端輪詢 + edge cache | CWA 觀測本身 10 分鐘更新一次，這是即時性上限；WebSocket 在 serverless 不可行也無必要 |
| 3D 引擎 | CesiumJS（CDN） | 內建地形、依時間計算的太陽 / 月亮位置、日照與陰影 |
| 地形 | Cesium World Terrain（ion 免費帳號） | `verticalExaggeration = 2~3` 讓台灣山脈可辨識 |
| 縣市邊界 | 內政部國土測繪中心縣市界 → GeoJSON（mapshaper 簡化 < 500 KB） | 22 個可點擊、可著色的多邊形 |
| 圖表 | ECharts（CDN） | 雙軸（溫度 + 濕度 / 降雨機率）、時間軸 |
| pandas | 只在 `notebooks/explore.ipynb` | 保留課程第 7 步；不打包進 Vercel function（冷啟動與體積） |
| 部署區域 | Vercel `hnd1` + Turso 東京 | 避免每個查詢跨太平洋 |

---

## 2. 資料來源

> **實作 parser 前，必須先抓真實 sample 確認欄位名稱與結構。下表欄位為預期，以 sample 為準。**

| 資料集 | 內容 | CWA 更新 | 本系統抓取 | 用途 |
|---|---|---|---|---|
| `O-A0003-001` 自動氣象站觀測 | 溫度、相對濕度、**氣壓**、風速風向、天氣、雨量、測站海拔 | 10 分鐘 | 每 10 分鐘 | 即時資料、實測歷史、每日實測最高 / 最低 |
| `F-D0047-089` 縣市 3 天預報 | 逐時溫度、相對濕度、體感溫度、3 小時降雨機率、天氣現象、風 | 一天數次 | 每小時檢查，`issuedAt` 未變則跳過 | 逐時預報；第 1–3 天精確的 00–24 最高 / 最低 |
| `F-D0047-091` 縣市一週預報 | 12 小時最高 / 最低溫、平均相對濕度、12 小時降雨機率、天氣現象、紫外線 | 一天數次 | 同上 | 一週預報；第 4–7 天最高 / 最低（近似） |
| `A-B0062-001` 日出日沒 | 日出、日中、日沒 | 年表 | 每天，預抓 30 天 | 面板與頁首 |
| `A-B0063-001` 月出月沒 | 月出、月中、月沒 | 年表 | 每天，預抓 30 天 | 面板與頁首 |

### 資料語意規則

- **一天** = 台北時間 00:00–24:00。所有日期計算使用 `Asia/Taipei`（Vercel 執行在 UTC）。
- **第 1–3 天** 的每日最高 / 最低：由 089 逐時溫度計算，`approx = 0`。
- **第 4–7 天** 的每日最高 / 最低：取 091 中與當天 00–24 有重疊的所有 12 小時時段，最低取最小、最高取最大，`approx = 1`，UI 標示「約」。
- **氣壓** 只有實測值，預報資料集不提供。
- **縣市即時溫度** = 該縣市海拔 < 1,500 m 的測站中位數；若無則用全部測站中位數。濕度、氣壓同規則。
- CWA 缺值（`-99`、`-999`、空字串）→ `NULL`，不丟棄整個測站。
- 縣市名稱以 CWA 用字為準（`臺`），GeoJSON 屬性需對應一致。

---

## 3. 資料庫 Schema

檔案：`db/schema.sql`（本機與 Turso 共用）

> 以下為初稿。實作以 `db/schema.sql` 為準：`FetchRuns` 拆成 `ForecastRuns`（內容雜湊）與 `JobStatus`，
> 新增 `CountyObservations`，`ForecastPeriods` 拆成 `HourlyForecasts`（089）與 `PeriodForecasts`（091）。

```sql
-- 每次抓取的紀錄：去重、監控、除錯
CREATE TABLE IF NOT EXISTS FetchRuns (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    dataset     TEXT NOT NULL,              -- O-A0003-001 / F-D0047-089 / ...
    issuedAt    TEXT,                       -- 預報發布時間；觀測為資料時間
    fetchedAt   TEXT NOT NULL,
    status      TEXT NOT NULL,              -- running / ok / skipped / error
    rowCount    INTEGER,
    error       TEXT,                       -- 已去除敏感資訊的錯誤訊息
    UNIQUE(dataset, issuedAt)
);

CREATE TABLE IF NOT EXISTS Stations (
    stationId   TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    county      TEXT NOT NULL,
    lat         REAL NOT NULL,
    lon         REAL NOT NULL,
    altitude    REAL
);

CREATE TABLE IF NOT EXISTS Observations (
    stationId   TEXT NOT NULL REFERENCES Stations(stationId),
    observedAt  TEXT NOT NULL,
    temperature REAL,
    humidity    REAL,
    pressure    REAL,
    windSpeed   REAL,
    windDir     REAL,
    weather     TEXT,
    rain        REAL,
    PRIMARY KEY (stationId, observedAt)
);

-- 逐時 / 12 小時預報原始時段（保存 90 天）
CREATE TABLE IF NOT EXISTS ForecastPeriods (
    runId       INTEGER NOT NULL REFERENCES FetchRuns(id),
    regionName  TEXT NOT NULL,
    startTime   TEXT NOT NULL,
    endTime     TEXT NOT NULL,
    temp        REAL,
    minT        REAL,
    maxT        REAL,
    humidity    REAL,
    pop         REAL,                       -- 降雨機率 %
    wx          TEXT,
    wxCode      TEXT,
    windSpeed   REAL,
    PRIMARY KEY (runId, regionName, startTime)
);

-- 沿用課程命名：每一版預報的每日最高 / 最低（永久保存）
CREATE TABLE IF NOT EXISTS TemperatureForecasts (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    runId       INTEGER NOT NULL REFERENCES FetchRuns(id),
    regionName  TEXT NOT NULL,
    dataDate    TEXT NOT NULL,              -- YYYY-MM-DD（台北時間）
    mint        REAL,
    maxt        REAL,
    pop         REAL,
    approx      INTEGER NOT NULL DEFAULT 0,
    UNIQUE(runId, regionName, dataDate)
);

-- 首頁預設：每個縣市、每個日期的最新一版
CREATE VIEW IF NOT EXISTS LatestTemperatureForecasts AS
SELECT t.*
FROM TemperatureForecasts t
JOIN FetchRuns r ON r.id = t.runId
WHERE r.status = 'ok'
  AND r.issuedAt = (
      SELECT MAX(r2.issuedAt)
      FROM TemperatureForecasts t2 JOIN FetchRuns r2 ON r2.id = t2.runId
      WHERE r2.status = 'ok'
        AND t2.regionName = t.regionName
        AND t2.dataDate = t.dataDate
  );

-- 每日實測彙總（永久保存）
CREATE TABLE IF NOT EXISTS DailyObserved (
    county      TEXT NOT NULL,
    date        TEXT NOT NULL,
    tmin        REAL,
    tmax        REAL,
    tavg        REAL,
    humidityAvg REAL,
    pressureAvg REAL,
    rainSum     REAL,
    PRIMARY KEY (county, date)
);

CREATE TABLE IF NOT EXISTS AstroDaily (
    county      TEXT NOT NULL,
    date        TEXT NOT NULL,
    sunrise     TEXT,
    sunTransit  TEXT,
    sunset      TEXT,
    moonrise    TEXT,
    moonTransit TEXT,
    moonset     TEXT,
    PRIMARY KEY (county, date)
);

-- 防止排程與讀取補抓同時打 CWA
CREATE TABLE IF NOT EXISTS Locks (
    name        TEXT PRIMARY KEY,
    until       TEXT NOT NULL
);
```

### 保存策略

| 資料 | 保存 |
|---|---|
| `Observations` 原始 | 30 天，由每日排程刪除 |
| `ForecastPeriods` | 90 天 |
| `TemperatureForecasts`、`DailyObserved`、`AstroDaily`、`FetchRuns` | 永久 |

> Phase 0 需確認 Turso 免費方案的儲存與寫入額度，必要時調整保存天數。

### 寫入規則

- 每個 job 一個 transaction：失敗即 rollback，**舊資料不受影響**。
- 預報：先查 `FetchRuns(dataset, issuedAt)`，已存在 → 記錄 `skipped`，不重複寫入。
- 觀測：`INSERT ... ON CONFLICT(stationId, observedAt) DO NOTHING`。
- 所有 SQL 使用參數化查詢。

---

## 4. 專案結構

```text
L3-CWAv2/
├── api/
│   └── index.py                 # Vercel 進入點：app = create_app()
├── app/                         # 讀取端 + 路由（Vercel 執行）
│   ├── __init__.py              # create_app()
│   ├── config.py                # 環境變數、常數、時區、門檻值
│   ├── db.py                    # 連線：Turso（libsql）或本機 sqlite3
│   ├── queries.py               # 所有讀取 SQL
│   ├── freshness.py             # 資料新鮮度判斷、讀取時補抓
│   ├── routes/
│   │   ├── pages.py             # /、/region/<name>
│   │   ├── api.py               # /api/*
│   │   └── cron.py              # /api/cron/*
│   └── templates/
│       ├── base.html
│       ├── index.html           # 3D 地球
│       └── region.html          # 縣市詳細頁
├── etl/                         # 寫入端
│   ├── cwa.py                   # CWA client（沿用現有）
│   ├── errors.py                # 例外類別（沿用現有）
│   ├── counties.py              # 22 縣市名稱、代表座標
│   ├── parsers/
│   │   ├── observation.py
│   │   ├── forecast_3day.py
│   │   ├── forecast_week.py
│   │   └── astronomy.py
│   ├── daily.py                 # 00–24 每日最高 / 最低計算
│   ├── load.py                  # UPSERT、transaction
│   └── jobs.py                  # refresh_observations / refresh_forecasts / run_daily
├── public/                      # Vercel CDN 直接提供
│   └── static/
│       ├── js/  globe.js  panel.js  charts.js  poll.js  scale.js
│       ├── css/ style.css
│       └── geo/ taiwan-counties.json
├── db/
│   └── schema.sql
├── scripts/
│   ├── init_db.py               # 建立本機或 Turso schema
│   ├── run_job.py               # 本機手動跑 job：python -m scripts.run_job observations
│   └── fetch_samples.py         # 抓 sample 並去除 key
├── notebooks/
│   └── explore.ipynb            # pandas 資料探索（課程第 5–7 步）
├── tests/
│   ├── samples/                 # 四個資料集的真實 sample
│   ├── conftest.py
│   ├── test_parsers.py
│   ├── test_daily.py
│   ├── test_load.py
│   ├── test_queries.py
│   ├── test_routes.py
│   └── test_cron.py
├── vercel.json                  # regions: hnd1、rewrites → api/index.py
├── requirements.txt             # flask、requests（僅正式環境需要的套件）
├── requirements-dev.txt         # pytest、python-dotenv、pandas、jupyter
├── .env.example
├── .python-version
├── README.md
└── plan.md
```

**原則：** `app/` 只讀、`etl/` 只寫，唯一的交會點是 `app/routes/cron.py` 與 `app/freshness.py` 呼叫 `etl/jobs.py`。

---

## 5. 環境變數

```text
CWA_API_KEY=               # 只在伺服器端使用
TURSO_DATABASE_URL=        # 未設定 → 使用本機 data/weather.db
TURSO_AUTH_TOKEN=
CRON_SECRET=               # cron-job.org 以 Authorization: Bearer 帶入
CESIUM_ION_TOKEN=          # 瀏覽器可見；必須在 ion 後台限制網域
```

`.gitignore` 必須包含：`.env`、`.env.*`（保留 `.env.example`）、`data/*.db`、`.venv/`、`__pycache__/`、`.ipynb_checkpoints/`。

---

## 6. 路由與 API

### 頁面

| 路由 | 內容 |
|---|---|
| `GET /` | 3D 地球主畫面 |
| `GET /region/<name>` | 縣市詳細頁（可直接分享；與側邊面板使用相同渲染程式） |

### JSON API

| 路由 | 回傳 | 快取 |
|---|---|---|
| `GET /api/meta` | 縣市清單、可選日期、各資料集最後更新時間與新鮮度、色階設定 | 60 s |
| `GET /api/map?layer=now\|maxt\|mint\|pop&date=` | 22 縣市的著色數值 | 60 s |
| `GET /api/region/<name>` | 即時觀測、逐時預報（3 天）、一週預報、日月、近 7 天實測 | 60 s |
| `GET /api/region/<name>/history?from=&to=` | 每日實測 + 當時最新預報（預報 vs 實測） | 600 s |
| `GET /api/region/<name>/revisions?date=` | 指定日期的每一版預報（修正歷程） | 600 s |
| `GET /api/astro?date=` | 頁首用的日月時間（預設臺北市） | 3600 s |
| `GET /api/health` | 各資料集距上次成功的時間；過期回 503（供監控） | no-store |

快取一律 `Cache-Control: public, max-age=0, s-maxage=N, stale-while-revalidate=N*5`。

### 排程端點

| 路由 | 頻率 | 工作 |
|---|---|---|
| `POST /api/cron/observations` | 每 10 分鐘 | 抓 O-A0003-001 → 更新 Stations、寫入 Observations |
| `POST /api/cron/forecasts` | 每 1 小時 | 抓 089、091；`issuedAt` 未變則跳過；寫入 ForecastPeriods、TemperatureForecasts |
| `POST /api/cron/daily` | 每天 00:30 | 日月資料（預抓 30 天）、昨日 DailyObserved、清理過期資料 |

- 驗證：`hmac.compare_digest` 比對 `Authorization: Bearer <CRON_SECRET>`，失敗回 401。
- 回傳：`{status, dataset, issuedAt, rowCount}`，錯誤訊息不含 key。
- 同一 job 以 `Locks` 表加鎖（條件式 UPDATE，有效 2 分鐘），避免重疊執行。

### 讀取時補抓

`/api/map` 與 `/api/region/*` 被呼叫時，若最新觀測超過 **15 分鐘**：
1. 嘗試取得 `observations` 鎖，拿不到就直接回傳現有資料
2. 拿到 → 呼叫 CWA（timeout 8 秒）→ 寫入 → 回傳新資料
3. 失敗 → 回傳現有資料，並附 `stale: true`

---

## 7. UI 規格

### 7.1 主畫面

```text
┌───────────────────────────────────────────────────────────────────┐
│ Taiwan 3D Weather   ☀ 05:48↑ 17:52↓  ☾ 上弦 12:10↑   資料 14:20（3 分鐘前）│
├───────────────────────────────────────────────────────────────────┤
│                                                                   │
│            3D 台灣地形（地形誇張 2–3 倍，日照明暗）                  │
│            縣市多邊形依圖層數值著色，滑鼠移過顯示名稱與數值           │
│            天空中的太陽與月亮位於真實位置                            │
│                                                                   │
│ ┌圖層───────────┐                              ┌圖例──────────┐    │
│ │● 即時氣溫      │                              │ 連續色階      │    │
│ │○ 預報最高溫    │                              │ 10 ─── 35 °C │    │
│ │○ 預報最低溫    │                              └─────────────┘    │
│ │○ 降雨機率      │    [日期 ◀ 9/24 ▶]  [時間軸：太陽 / 月亮模擬]      │
│ └───────────────┘                                   [2D / 3D]     │
└───────────────────────────────────────────────────────────────────┘
```

- 初始視角：從東南方斜看台灣本島，能看到中央山脈立體感
- 色階改用**連續色階**（每 1°C 漸層），定義集中在 `scale.js`，由 `/api/meta` 提供範圍；不再使用 4 級分類（夏季全島同色的問題）
- 資料過期警示：觀測 > 30 分鐘 → 黃色；> 2 小時 → 紅色；預報 > 12 小時 → 黃色
- 首次載入顯示進度畫面；Cesium 或 ion 失敗時退回 2D（OpenStreetMap 影像）而非白畫面

### 7.2 縣市面板 / 詳細頁

點擊縣市 → 右側滑出面板（約 40% 寬），`history.pushState` 將網址改為 `/region/臺中市`；按上一頁關閉面板。直接開啟 `/region/臺中市` 則顯示全頁版本。

```text
┌──────────────── 臺中市 ────────────────────┐
│ 現在  28.3°C  多雲                         │
│ 濕度 72%   氣壓 1008.2 hPa   風 3.2 m/s 東北 │
│ 觀測時間 14:20（中位數，12 站）              │
├───────────────────────────────────────────┤
│ 逐時預報（72 小時）  溫度線 + 降雨機率柱      │
├───────────────────────────────────────────┤
│ 一週預報  日期 / 天氣 / 最高 / 最低 / 降雨    │
├───────────────────────────────────────────┤
│ 趨勢 [7 天 | 30 天]  實測最高/最低 vs 預報   │
│ 濕度、氣壓實測曲線                           │
├───────────────────────────────────────────┤
│ 歷史  [選日期]  當日實測 / 預報修正歷程       │
├───────────────────────────────────────────┤
│ ☀ 日出 05:48  日落 17:52                   │
│ ☾ 月出 12:10  月落 23:31  月相 上弦          │
└───────────────────────────────────────────┘
```

### 7.3 太陽與月亮

- `viewer.scene.globe.enableLighting = true`，開啟地形陰影
- Cesium 時鐘預設為現在時間；時間軸可拖曳模擬一天中的日照變化
- 月相：依日期計算，以文字與圖示顯示（Cesium 月亮渲染是否呈現盈虧需 Phase 4 驗證）
- 日出日落等時間以 CWA 資料為準，Cesium 只負責視覺

### 7.4 自動更新

- 頁面每 3 分鐘輪詢 `/api/meta`；若資料時間變動，重新取 `/api/map`（與開啟中的面板資料），只更新顏色與數字，不重建地球
- 分頁在背景時暫停輪詢（`visibilitychange`）

---

## 8. 錯誤處理

| 例外 | 來源 | 處理 |
|---|---|---|
| `ConfigurationError` | 缺少環境變數 | 啟動時記錄；API 回 500，訊息不含值 |
| `APIRequestError` | CWA 連線、逾時、401/403/429 | job 記錄 `FetchRuns.status = error`；頁面照常顯示舊資料 |
| `APIResponseError` | CWA 回傳非 JSON 或 `success != true` | 同上 |
| `WeatherParseError` | 欄位缺失、縣市清單不符、預報已過期 | 同上；整批不寫入 |
| `DatabaseError` | Turso 連線或寫入失敗 | transaction rollback；讀取失敗時 API 回 503 與友善訊息 |

原則：

```text
外部服務失敗 → 不破壞既有資料 → 顯示最後一次成功的資料 + 明確的資料時間與警示
```

---

## 9. 安全

- CWA key、Turso token、Cron secret 只存在 Vercel 環境變數與本機 `.env`
- CWA 錯誤訊息不含 URL 參數（沿用現有 `cwa.py` 的做法）
- Cesium ion token 會出現在瀏覽器：在 ion 後台限制 Allowed URLs 為正式網域與 `localhost`
- 縣市名稱參數以 22 縣市白名單驗證；日期參數以 `date.fromisoformat` 驗證
- 所有 SQL 參數化
- 回應加上 `X-Content-Type-Options: nosniff`、`Referrer-Policy: same-origin`
- 無公開的寫入端點；排程端點需 `CRON_SECRET`

---

## 10. 執行階段

每個 Phase 結束時：測試通過 → commit → **部署到 Vercel 並在線上確認**。
任何時間點中斷，最後一個完成的 Phase 都是可以交的版本。

---

### Phase 0 — 清場與技術驗證

**目標：** 先確認最可能卡住的技術，再開始寫功能。

Tasks：
- [ ] 處理目前未 commit 的 staged 變更：刪除 Streamlit、舊 `src/`、舊測試、`scripts/dev_server.py`；保留 `cwa.py`、`errors.py`、`locations.py` 與 parser 可沿用的邏輯
- [ ] 建立新專案結構（第 4 節）
- [ ] Flask hello world 部署到 Vercel（`api/index.py` + rewrites），`public/static` 由 CDN 提供
- [ ] `libsql` 套件在 Vercel 上可安裝並連上 Turso；**若失敗，改用 `requests` 呼叫 Turso HTTP API**，在本節記錄結論
- [ ] Vercel region 設為 `hnd1`；Turso 建在 `aws-ap-northeast-1`；量測一次查詢延遲
- [ ] 建立 Cesium ion 帳號，測試頁能載入 Cesium World Terrain 並看到台灣地形與太陽
- [ ] 確認 Turso 免費方案額度，估算每月寫入量（第 3 節保存策略）
- [ ] `scripts/fetch_samples.py` 抓四個資料集的 sample 存入 `tests/samples/`，確認不含 key
- [ ] 從 sample 確認：觀測的氣壓 / 海拔欄位名、089 的逐時結構、兩個預報的 `issuedAt` 欄位、縣市名稱用字

驗收：
```text
線上網址回應 Flask 頁面
線上 /api/_probe 能對 Turso 執行 SELECT 1
Cesium 測試頁在線上顯示台灣 3D 地形
tests/samples/ 有四份 sample，grep 不到 API key
```

Commits：
```text
chore: remove streamlit implementation and reset structure
chore: deploy flask skeleton to vercel
chore: verify turso connection and cesium terrain
chore: add cwa dataset samples
```

---

### Phase 1 — 資料管線

**目標：** 資料每 10 分鐘自動流入資料庫。

Tasks：
- [ ] `db/schema.sql`、`scripts/init_db.py`（本機與 Turso）
- [ ] `app/db.py`：依 `TURSO_DATABASE_URL` 切換 Turso / 本機 sqlite3，介面一致
- [ ] 四個 parser（依 sample 撰寫，輸出純 dict / list，不用 pandas）
- [ ] `etl/daily.py`：00–24 每日最高 / 最低（089 精確、091 近似）
- [ ] `etl/load.py`：transaction、去重、UPSERT
- [ ] `etl/jobs.py`：三個 job，寫入 `FetchRuns`
- [ ] `app/routes/cron.py`：三個端點、Bearer 驗證、`Locks`
- [ ] `scripts/run_job.py` 可在本機手動執行
- [ ] 部署；在 cron-job.org 設定三個排程
- [ ] `notebooks/explore.ipynb`：用 pandas 讀 sample 與資料庫做探索（課程第 5–7、10、12 步）

驗收：
```text
同一份 sample 寫入兩次，資料筆數不變
同一個 issuedAt 的預報第二次執行記錄為 skipped
部署後 1 小時內 FetchRuns 有 6 筆以上 observations ok
CWA 模擬失敗時 FetchRuns 記錄 error，既有資料筆數不變
錯誤的 CRON_SECRET 回 401
```

Commits：
```text
feat: add sqlite schema shared by local and turso
feat: parse cwa observation, forecast and astronomy datasets
feat: compute taipei calendar-day temperature extremes
feat: add transactional loaders with run deduplication
feat: add authenticated cron endpoints
docs: add pandas exploration notebook
```

---

### Phase 2 — 縣市詳細頁（2D）

**目標：** 先完成氣象網站的核心內容。即使 3D 失敗，網站也能驗收。

Tasks：
- [ ] `app/queries.py`：縣市即時值（中位數規則）、逐時預報、一週預報、近期實測、日月
- [ ] `GET /api/region/<name>`、`GET /api/meta`
- [ ] `GET /region/<name>` 全頁版：即時、逐時、一週、趨勢、日月（第 7.2 節，歷史區塊先留空）
- [ ] `panel.js` / `charts.js`：同一套渲染程式供全頁與面板使用
- [ ] 過期警示、`approx` 標示「約」
- [ ] 暫時首頁：22 縣市清單連到詳細頁

驗收：
```text
線上 /region/臺中市 顯示即時溫度、濕度、氣壓、風，數值與 CWA 官網相近
逐時預報 72 小時、一週預報 7 天
不存在的縣市回 404；缺資料的區塊顯示「暫無資料」而非錯誤
```

Commits：
```text
feat: add region query layer
feat: add region json api
feat: add region detail page with forecast charts
```

---

### Phase 3 — 3D 台灣

**目標：** Globe-first 主畫面，點擊縣市開啟面板。

Tasks：
- [ ] 下載內政部縣市界，mapshaper 轉 GeoJSON、簡化、統一縣市名稱用字 → `public/static/geo/taiwan-counties.json`（README 註明授權與出處）
- [ ] `globe.js`：Cesium Viewer、World Terrain、`verticalExaggeration`、初始視角
- [ ] 縣市多邊形貼地、依 `/api/map` 著色、hover 顯示名稱與數值
- [ ] 點擊 → 面板滑出、`pushState`；上一頁關閉
- [ ] 圖層切換（即時 / 最高 / 最低 / 降雨）與日期切換
- [ ] 連續色階與圖例（`scale.js`）
- [ ] 載入畫面；Cesium 失敗時退回 2D

驗收：
```text
線上首頁 5 秒內（一般筆電、快取後）看到 3D 台灣
22 個縣市都可點擊，面板資料與 /region/<name> 一致
切換圖層與日期，顏色正確更新，視角不重置
```

Commits：
```text
feat: add simplified taiwan county boundaries
feat: render 3d taiwan terrain with cesium
feat: color counties by weather layer
feat: open region panel from globe selection
```

---

### Phase 4 — 太陽與月亮

Tasks：
- [ ] 日照光影、地形陰影
- [ ] 時間軸：拖曳模擬當天日照變化；「回到現在」按鈕
- [ ] 頁首日出日落、月出月落（`/api/astro`）與月相
- [ ] 面板日月區塊

驗收：
```text
現在時間為白天時，台灣面向太陽一側明亮；拖曳時間軸到夜晚，地形變暗
日出日落時間與 CWA 資料一致
```

Commit：
```text
feat: add sun and moon lighting with time control
```

---

### Phase 5 — 即時體驗

Tasks：
- [ ] `app/freshness.py`：讀取時補抓（第 6 節）
- [ ] `poll.js`：3 分鐘輪詢、背景暫停、只更新變動部分
- [ ] `GET /api/health`；外部監控（cron-job.org 或 UptimeRobot）
- [ ] 所有 API 加上 edge cache headers

驗收：
```text
暫停 cron 30 分鐘後開啟頁面，觀測資料在一次請求內補齊
頁面開著 20 分鐘不動，資料時間自動前進
並發 10 個請求，CWA 只被呼叫一次（Locks 生效）
```

Commits：
```text
feat: refresh stale observations on read
feat: poll for new data without reloading the globe
feat: add health endpoint and cache headers
```

---

### Phase 6 — 歷史

Tasks：
- [ ] `/api/region/<name>/history`：每日實測 vs 當日最後一版預報
- [ ] `/api/region/<name>/revisions`：同一日期各版預報的最高 / 最低
- [ ] 面板歷史區塊：選日期、預報修正折線、預報 vs 實測誤差
- [ ] 趨勢 7 天 / 30 天切換

驗收：
```text
累積 3 天以上資料後，可看到某日的多版預報與實測值
DailyObserved 的最高 / 最低與 Observations 當日極值一致
```

Commit：
```text
feat: add forecast revision and verification history
```

---

### Phase 7 — 收尾

Tasks：
- [ ] 測試補齊（第 11 節）
- [ ] 效能：GeoJSON 大小、首次載入、API 回應時間
- [ ] README（第 13 節）、截圖
- [ ] 最終檢查（第 15 節）

Commits：
```text
test: cover queries, routes and cron flows
perf: reduce initial globe load
docs: add setup, architecture and course mapping
```

---

## 11. 測試計畫

| 檔案 | 內容 |
|---|---|
| `test_parsers.py` | 四個 sample 的欄位、缺值 `-99` → None、縣市清單、時區 |
| `test_daily.py` | 00–24 邊界：跨午夜時段、第一天只有部分時段、`approx` 標記 |
| `test_load.py` | 重複寫入不增加、`issuedAt` 去重、失敗 rollback |
| `test_queries.py` | 最新一版 view、中位數與海拔排除、日期過濾（台北時區） |
| `test_routes.py` | 頁面 200 / 404、JSON 結構、快取 header、縣市白名單 |
| `test_cron.py` | 401、鎖、補抓在 CWA 失敗時回傳舊資料 |

- 測試一律使用暫存的本機 SQLite，CWA 以 mock 取代，不連網
- Turso 行為以 Phase 0 / Phase 1 線上驗收確認

### 線上手動測試（每個 Phase 部署後）

```text
1. 首頁載入與 3D 地形
2. 點擊縣市 → 面板 → 上一頁
3. 直接開啟 /region/<name>
4. 圖層、日期、時間軸
5. 資料時間與過期警示
6. 模擬 CWA 失敗（錯誤 key 的 preview 部署）仍顯示舊資料
7. 模擬 Cesium 失敗 → 2D 退回
```

---

## 12. 課程步驟對照

| 課程 | 本專案 |
|---|---|
| 1–3 課程、天氣、CWA 平台 | README 背景說明 |
| 4 Requests 取得 JSON | `etl/cwa.py` |
| 5 JSON 結構解析 | `notebooks/explore.ipynb`、`etl/parsers/` |
| 6 取出最高 / 最低溫 | `etl/parsers/forecast_*.py`、`etl/daily.py` |
| 7 Pandas 整理預覽 | `notebooks/explore.ipynb` |
| 8–9 建立 SQLite、`TemperatureForecasts` | `db/schema.sql`（沿用表名與欄位名） |
| 10 SQL 查詢驗證 | notebook 與 `app/queries.py` |
| 11 Streamlit 入門 | → Flask（`app/`） |
| 12 從資料庫讀取 | `app/queries.py` |
| 13 下拉選單選地區 | 3D 點擊縣市 + 圖層 / 日期選單 |
| 14 折線圖 | ECharts 趨勢圖 |
| 15 資料表格 | 一週預報表 |
| 16 整合介面 | 主畫面 + 面板 |
| 17–18 Folium 地圖、日期 | → CesiumJS 3D 地圖、日期切換 |
| 19 成果展示 | Vercel 線上網址 |
| 20 程式品質 | 模組分層、錯誤處理、去重、測試 |
| 21 GitHub | commit history |
| 22 延伸應用 | 即時觀測、日月、預報歷史 |

---

## 13. README 必要內容

- 專案簡介與線上網址、截圖（主畫面、面板、日月時間軸）
- 架構圖（第 1 節）與資料流
- 資料來源與授權（CWA、內政部縣市界、Cesium）
- 資料語意：一天的定義、`approx`、縣市即時值的計算方式
- 環境變數、本機執行（`flask run` + 本機 SQLite）、`scripts/init_db.py`、`scripts/run_job.py`
- 部署步驟：Vercel、Turso、cron-job.org、Cesium ion 網域限制
- 課程步驟對照（第 12 節）
- 已知限制：即時性上限 10 分鐘、第 4–7 天為近似、氣壓無預報

---

## 14. 範圍邊界

**不做（除非全部 Phase 完成）：**
- 鄉鎮層級預報
- 雷達、衛星雲圖、地震
- LINE Bot、AI 摘要
- 手機版版面
- Google Photorealistic 3D Tiles、Windy 圖層
- 使用者帳號

**可選延伸（Phase 7 後）：**
- 雷達回波疊圖
- AI 以結構化資料產生天氣摘要（只負責解釋，不產生數值）
- 手機版

---

## 15. 最終驗收（線上）

1. 首頁無錯誤，3D 台灣與日月正常顯示
2. 22 縣市皆可點擊，面板資料正確
3. 即時資料時間在 20 分鐘以內
4. 逐時、一週預報與 CWA 官網相近
5. 趨勢與歷史可查
6. 過期警示正確
7. GitHub 無任何 key（含歷史）
8. README 能讓另一台電腦依說明在本機跑起來
9. 外部監控顯示近 24 小時排程成功率

---

## 16. Agent 執行規則

1. 一次只做一個 Phase；完成後測試、commit、部署、線上確認。
2. 不得假設 CWA JSON 結構；以 `tests/samples/` 為準，不確定就停下來查 sample。
3. 不得把 key 或 token 寫入程式碼、sample、錯誤訊息或 log。
4. `app/` 不直接寫 SQL 以外的寫入邏輯；寫入只在 `etl/`。
5. 正式環境依賴只放 `requirements.txt`；pandas、pytest 等只放 `requirements-dev.txt`。
6. 修改 schema 後重跑全部測試，並在 Turso 上執行 migration。
7. 所有日期時間計算明確使用 `Asia/Taipei`。
8. 3D 相關工作不得早於 Phase 2 完成。
9. 遇到 Phase 0 驗證失敗（libsql、Cesium、Turso 額度），先更新本計畫再繼續。
10. 每個 commit 訊息語意清楚，一個 commit 只做一件事。

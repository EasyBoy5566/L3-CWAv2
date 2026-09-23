# 臺灣 3D 氣象

以 3D 地形呈現臺灣 22 縣市的即時觀測與天氣預報。首頁是可旋轉的 3D 臺灣，太陽與月亮依真實時間出現在天空中；點擊任一縣市，右側會滑出該地的即時天氣、逐時與一週預報、趨勢圖、預報歷史，以及日出日落和月相。

資料來自[中央氣象署開放資料平臺](https://opendata.cwa.gov.tw/)，每 10 分鐘自動更新，存放在 SQLite（正式環境使用 Turso 託管的 libSQL）。

```text
CWA API → requests → JSON 解析 → SQLite / Turso → Flask → CesiumJS + ECharts → Vercel
```

## 功能

- **3D 臺灣**：Cesium World Terrain 地形（高度放大 2.5 倍），每個縣市上方浮著玻璃數值泡泡，可切換「即時氣溫／預報最高／預報最低／降雨機率」與預報日期
- **縣市邊界**：以影像方式鋪在地形上，放大的山脈不會遮住邊界；選取的縣市沿山脊發光
- **太陽與月亮**：依目前時間計算的日照明暗，拖曳時間軸可模擬一天的日照變化，也可開啟地形陰影
- **縣市面板**：即時溫度、濕度、氣壓、風、今日累積雨量；72 小時逐時預報；一週預報；1／7／30 天趨勢；任一天的實測與預報比較、預報修正歷程；日出日落、月出月落、月相
- **獨立頁面**：`/region/臺中市` 可直接分享
- **自動更新**：觀測每 10 分鐘、預報每小時檢查；頁面每 3 分鐘自動取得新資料，不需重新整理
- **資料時效提示**：頁首顯示觀測與預報時間，延遲或過期時變色警示

## 架構

```text
cron-job.org ──► /api/cron/observations  每 10 分鐘
             ──► /api/cron/forecasts     每 1 小時
Vercel Cron  ──► /api/cron/daily         每天 00:30（台北時間）
                        │
                        ▼  etl/：抓取 → 解析 → 驗證 → 在同一個 transaction 寫入
                  Turso（libSQL）
                        │
                        ▼  app/queries.py
      Flask on Vercel ── 頁面（Jinja）＋ JSON API（edge 快取 60 秒）
                        │
                        ▼
      瀏覽器：CesiumJS 3D 地球 ─ 點擊縣市 ─► 面板（ECharts）
```

| 目錄 | 內容 |
|---|---|
| `app/` | Flask app、設定、資料庫介面（本機 SQLite 或 Turso HTTP）、查詢、路由 |
| `etl/` | CWA client、四類資料的 parser、每日最高／最低計算、縣市彙總、排程 job |
| `db/schema.sql` | 資料表定義，本機與 Turso 共用 |
| `public/static/` | 前端 JS、CSS、縣市邊界 GeoJSON（由 Vercel CDN 直接提供） |
| `scripts/` | 初始化資料庫、手動執行 job、抓 sample、產生縣市邊界 |
| `notebooks/explore.ipynb` | 用 pandas 探索 JSON 結構與資料庫內容 |
| `tests/` | pytest，使用真實 CWA sample 與暫存 SQLite |

### 資料庫

| 資料表 | 內容 |
|---|---|
| `TemperatureForecasts` | 每一版預報的每日最低（`mint`）、最高（`maxt`）、降雨機率、天氣，沿用課程命名 |
| `LatestTemperatureForecasts`（view） | 每個縣市、每一天最新一版的預報，首頁預設讀這個 |
| `ForecastRuns` | 每一版預報。CWA 預報沒有發布時間欄位，所以用內容雜湊判斷是否為新版本 |
| `HourlyForecasts`／`PeriodForecasts` | 3 天逐時與一週 12 小時預報原始時段（保留 90 天） |
| `Stations`／`Observations` | 363 個測站與每 10 分鐘的觀測（原始資料保留 30 天） |
| `CountyObservations` | 每 10 分鐘的縣市彙總值，供地圖與趨勢圖使用 |
| `DailyObserved` | 每日實測最高、最低、平均（永久保存） |
| `AstroDaily` | 日出日落、月出月落 |
| `JobStatus`／`Locks` | 排程狀態與防止重複執行的鎖 |

所有寫入都是冪等的：同一筆資料重複寫入不會增加筆數，CWA 或資料驗證失敗時整批不寫入，舊資料保持不變。

## 資料來源與計算方式

| 資料集 | 用途 |
|---|---|
| `O-A0003-001` 自動氣象站觀測 | 即時資料、實測趨勢、每日實測最高／最低 |
| `F-D0047-089` 縣市 3 天預報 | 逐時溫度、體感、濕度、降雨機率 |
| `F-D0047-091` 縣市一週預報 | 一週最高／最低、天氣、降雨機率 |
| `A-B0062-001`／`A-B0063-001` | 日出日沒、月出月沒 |

- **一天** 為台北時間 00:00–24:00。前 4 天由逐時預報精確計算；第 5–7 天由 12 小時預報推估，頁面標示「約」。推估時，最低溫取當天 00:00–18:00 所涵蓋時段，因為 18:00 開始的夜間時段，最低溫落在隔天清晨。
- **縣市即時值** 取海拔 1,500 公尺以下測站的中位數，避免玉山、阿里山等高山站拉低縣市溫度。
- **氣壓** 是測站氣壓，只取海拔 100 公尺以下的測站。南投縣、嘉義縣、新竹市沒有平地測站測量氣壓，改用距離最近的平地測站。預報資料沒有氣壓。
- **即時性上限**：CWA 自動站每 10 分鐘發布一次，網站資料延遲約在 10–20 分鐘內。

縣市邊界：內政部國土測繪中心「直轄市、縣市界線(TWD97經緯度)」（[data.gov.tw 7442](https://data.gov.tw/dataset/7442)，政府資料開放授權條款第 1 版），經 [taiwan-atlas](https://github.com/dkaoster/taiwan-atlas) 簡化。

## 本機執行

```powershell
python -m venv .venv
.venv\Scripts\python.exe -m pip install -r requirements-dev.txt
copy .env.example .env        # 填入 CWA_API_KEY，其餘可先留空

.venv\Scripts\python.exe -m scripts.init_db        # 建立 data/weather.db
.venv\Scripts\python.exe -m scripts.run_job all    # 抓一次所有資料
.venv\Scripts\python.exe -m flask --app api/index.py run
```

打開 <http://127.0.0.1:5000>。沒有 `CESIUM_ION_TOKEN` 時，地圖改用 Esri 衛星影像，沒有 3D 地形，其餘功能正常。

測試：

```powershell
.venv\Scripts\python.exe -m pytest
```

## 環境變數

| 變數 | 說明 |
|---|---|
| `CWA_API_KEY` | 氣象署授權碼，只在伺服器端使用 |
| `TURSO_DATABASE_URL`、`TURSO_AUTH_TOKEN` | Turso 資料庫。未設定時使用本機 `data/weather.db` |
| `CRON_SECRET` | 排程端點的密碼，以 `Authorization: Bearer <值>` 傳入 |
| `CESIUM_ION_TOKEN` | Cesium ion 瀏覽器 token，會出現在網頁中，務必在 ion 後台限制網域 |

## 部署

1. **Turso**：建立資料庫，區域選 `aws-ap-northeast-1`（東京），取得 URL 並建立 token。把兩個值填進本機 `.env`，執行 `python -m scripts.init_db` 和 `python -m scripts.run_job all`，建立資料表並寫入第一批資料。
2. **Cesium ion**：建立 access token，在 Allowed URLs 加入正式網域與 `http://localhost:5000`。
3. **Vercel**：匯入 GitHub repository（Framework 選 Flask），在 Environment Variables 設定上表五組變數後部署。`vercel.json` 已經設定部署區域 `hnd1` 與每日排程；Vercel 會自動偵測 `api/index.py` 裡的 Flask `app`。
4. **cron-job.org**：建立兩個工作，Method 選 POST，Header 加上 `Authorization: Bearer <CRON_SECRET>`：
   - `https://<網域>/api/cron/observations`，每 10 分鐘
   - `https://<網域>/api/cron/forecasts`，每小時
5. **監控**（選用）：用 UptimeRobot 監看 `https://<網域>/api/health`，資料過期時會回傳 503。

## 已知限制

- 即時資料受限於 CWA 每 10 分鐘的發布頻率
- 第 5–7 天的最高／最低溫是推估值；第 4 天之後 CWA 不提供降雨機率
- 預報沒有氣壓，只顯示實測氣壓
- 歷史與趨勢需要時間累積，剛部署時只有當天的資料
- 以桌機瀏覽器為主要目標，未針對手機調整版面

## 課程步驟對照

| 課程 | 本專案 |
|---|---|
| 4 Requests 取得 JSON | `etl/cwa.py` |
| 5–7 JSON 解析、取出最高／最低溫、pandas 整理 | `notebooks/explore.ipynb`、`etl/parsers/`、`etl/daily.py` |
| 8–10 SQLite、`TemperatureForecasts`、SQL 驗證 | `db/schema.sql`、notebook |
| 11–16 Web App、下拉選單、折線圖、表格 | Flask（`app/`）、縣市選單與 3D 點選、ECharts、一週預報表 |
| 17–18 地圖、選日期 | CesiumJS 3D 地圖、圖層與日期切換 |
| 19 成果展示 | Vercel 線上網址 |
| 20 程式品質 | 分層、冪等寫入、錯誤處理、62 個測試 |
| 22 延伸 | 即時觀測、日月、預報歷史 |

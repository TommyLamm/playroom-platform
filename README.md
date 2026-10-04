# PLAYROOM / 小遊戲集合所

可自行部署的小遊戲平台。玩家可以免登入遊玩，也可以註冊玩家帳號；管理員從公開 GitHub Release 匯入靜態網頁遊戲。遊戲可獨立開發、更新及回退，不需重新建置平台。

## 帳號與角色

大廳右上角提供註冊及登入。註冊後自動登入，帳號固定為 `player`；只有 `admin` 的導覽及帳號選單會顯示「管理後台」。玩家不能使用任何 `/api/v1/admin/*` API，也不能透過註冊指定管理員角色。

玩家帳號為 3–32 個英文字母、數字或 `_ . -`，不分大小寫；密碼為 12–256 字元，以 scrypt 雜湊保存。登入與註冊有 IP 頻率限制，session 有效期為 8 小時。玩家帳號目前用於登入與權限識別，遊戲存檔和分數仍由各款遊戲自行處理。

管理員由主機上的 `npm run admin:init -- admin` 初始化，不開放網頁註冊為管理員。如果玩家已使用同名帳號，初始化時需選另一個管理員名稱。既有第一版資料庫會自動升級至 schema v2，保留原管理員帳號、密碼、session 和遊戲資料；不需重新初始化。升級前可先使用原版備份指令保留資料，舊 schema v1 備份也能還原並升級。

## 本機啟動

需要 Node.js 24+。預設平台網址為 `http://localhost:3000`，遊戲來源為 `http://127.0.0.1:3001`。請使用 `localhost` 開啟平台；兩者刻意使用不同主機名稱來隔離 Cookie。

```sh
npm ci
npm run build
npm run admin:init -- admin
npm run demo:seed
npm start
```

`admin:init` 會要求輸入隱藏的密碼，至少 12 字元。也接受 `ADMIN_PASSWORD` 環境變數以便自動化；完成後應移除該變數。既有管理員不會被覆寫。初始化與範例資料指令應在平台停止時執行。

開發時執行 `npm run dev`，網頁網址改為 `http://localhost:5173`，API 在 3000，遊戲在 3001。修改環境變數可改用其他連接埠；`PORT` 與 `PLATFORM_ORIGIN`、`GAMES_PORT` 與 `GAMES_ORIGIN` 必須成對更新。Vite 的 proxy 目標預設為 3000。

範例有「光點反應」與「色彩尋蹤」兩款可玩遊戲；它們只儲存各自瀏覽器的最佳分數，沒有平台排行榜或雲端資料。正式環境不會自動加入範例。

僅供本機試用的快速初始化可執行 `npx tsx scripts/preview-setup.ts`：它建立隨機管理員密碼，寫到被 Git 忽略且不會由網站提供的 `data/local-admin.txt`，並加入範例遊戲。正式部署請使用上面的互動式初始化。

## Docker 部署

需要 Docker Engine + Compose v2、可連入的 80/443 連接埠，以及兩個 DNS 記錄，例如 `play.example.com` 和 `games.example.com`，都指向同一台主機。

1. 將 `.env.example` 複製為 `.env`，填入 `PLATFORM_HOST`、`GAMES_HOST`、`ACME_EMAIL`。
2. 執行以下指令建置、建立管理員與啟動服務。

```sh
docker compose build
docker compose run --rm --no-deps app npm run admin:init -- admin
docker compose up -d
docker compose ps
```

Caddy 會申請並更新 TLS 憑證。只有 Caddy 對主機公開連接埠；平台容器的 3000/3001 僅供 Compose 網路使用。`NODE_ENV=production` 強制 HTTPS。不要把 `.env`、資料目錄或 GitHub token 提交到版本庫。

可選的範例初始化應在 app 尚未啟動時執行：

```sh
docker compose run --rm --no-deps app npm run demo:seed
```

資料保存在 `playroom-data` named volume，憑證保存在 Caddy volumes。重建或重啟容器不會清除資料；**不要執行 `docker compose down -v`**，除非確定要刪除 volumes。

一般更新：先備份，再執行 `docker compose up -d --build`。資料庫使用 `PRAGMA user_version` 追蹤 migration，啟動時自動建立或升級至 schema v2；讀到較新 schema 的舊版程式會拒絕啟動。此版本只有單個 app 實例，不應增加 replicas。

## 平台 OTA 更新

另提供 `compose.ota.yaml` 啟用獨立更新服務。admin 可在「平台更新」檢查指定 GitHub 分支的新提交、確認部署、查看進度及失敗紀錄。新映像先建置與測試，再停止 app 做備份；健康檢查失敗時還原備份至新 volume 並啟動舊映像。帳號與遊戲資料不會因映像替換而清除。

部署設定與安全邊界見 [平台 OTA 更新指南](docs/platform-updates.md)。此功能只更新 app，基礎設施與 updater 的變更需在主機上手動維護。未啟用更新服務的本機版會顯示未設定狀態。

## 發布遊戲

1. 開發者在自己的公開 GitHub repository 開發遊戲，產出可直接用瀏覽器開啟的靜態檔案。
2. 在成品根目錄放置 `game.json`，入口與資源皆使用相對 URL。
3. 建立附有 `game.zip` 的 GitHub Release。
4. 管理員在後台按「匯入遊戲」，填寫 `owner/repository` 或 GitHub repository 網址，選擇 Release 並匯入。
5. 在匯入紀錄查看結果，從「遊戲與版本」開啟預覽，再發布。

平台只列出最近 100 個非草稿 Releases，也顯示 prerelease 標籤。沒有 `game.zip` 的 Release 不能選取。可選的 `GITHUB_TOKEN` 只在伺服器端存取 GitHub API，下載公開附件不會轉送 token。沒有 GitHub 連線時，已匯入遊戲仍可遊玩。

每個 repository 對應一個遊戲 ID。更新時保留 ID、提高版本號，發布新 Release。匯入過的 `id + version` 不可覆寫，即使 GitHub 附件被替換也不會改寫平台上的成品。

在版本選單選擇舊的已發布版本，再按「回退到此版本」，即可切換大廳顯示的版本。遊戲保持上架時，過往已發布版本的資源仍可存取，讓已開啟的遊戲繼續運行；下架會封鎖該遊戲所有公開版本的新資源請求。已經載入記憶體的遊戲無法遠端撤回。

完整接入規格見 [遊戲開發指南](docs/game-development.md)。

## 備份與還原

備份包含 SQLite snapshot、snapshot 引用的所有版本檔案，以及 SHA-256 檔案清單。版本檔案不可修改，因此可在服務運行時備份；未完成匯入不包含在內。備份會清除 session 與預覽授權，還原後需重新登入。

本機備份：

```sh
npm run backup -- backups/2026-10-04
```

Docker 備份（`BACKUP_DIR` 預設為主機的 `./backups`）：

```sh
mkdir -p backups
# Linux 上讓容器內 UID 1000 可寫入備份目錄；僅針對此新建目錄。
sudo chown 1000:1000 backups
docker compose exec app npm run backup -- /backups/2026-10-04
```

備份目標必須是尚不存在的目錄。請將完整備份另存到其他裝置，並限制存取，因為其中包含管理員密碼雜湊。

還原只接受空的資料目錄／新 volume，拒絕覆寫既有資料。先停止 app；保留原 volume，再還原到新 volume：

```sh
docker compose stop app
DATA_VOLUME_NAME=playroom-restored docker compose run --rm --no-deps app npm run restore -- /backups/2026-10-04
# 將 .env 的 DATA_VOLUME_NAME 改為 playroom-restored，再啟動。
docker compose up -d
```

PowerShell 本機還原範例：

```powershell
$env:DATA_DIR = '.\data-restored'
npm run restore -- backups/2026-10-04
npm start
```

還原前會驗證所有備份檔案雜湊、資料庫完整性及入口／封面是否存在。Caddy 憑證不在平台備份內；可保留 Caddy volume，或讓 Caddy 重新申請。

## 安全與維護邊界

- 平台預期接收可信任合作開發者的遊戲；不提供任意使用者上傳或伺服器端程式碼執行。
- 平台與遊戲分開主機名稱、Fastify listener 及路由。遊戲來源沒有管理 API，管理員 Cookie 是 host-only、HttpOnly，正式環境使用 Secure 與 `__Host-` 前綴。
- 修改 API 必須有正確 Origin；登入後另外驗證 CSRF token。登入限制為每 IP 15 分鐘最多 10 次，註冊最多 5 次。公開註冊只建立玩家，管理 API 逐次檢查資料庫中的 admin 角色。
- 每包最多 64 MiB、解壓後 256 MiB、10,000 個 ZIP entries，拒絕越界路徑、大小寫重複路徑、符號連結與加密檔案。下載最多 120 秒，只允許 GitHub 及其指定附件主機。
- 同時只處理一個匯入，最多 10 個待處理任務。重新啟動後，中斷任務會標示失敗，需要重新提交。
- 預覽 URL 是 15 分鐘有效的 bearer grant，只授權一個版本，含相對資源路徑。知道連結的人可在期限內預覽；勿分享。預覽回應不快取，遊戲資源 listener 不記錄 URL，避免 token 進入日誌。
- 所有遊戲共用遊戲來源，可共享該來源的瀏覽器儲存空間；這不是遊戲之間的安全隔離。請為各遊戲的 localStorage keys 加上自己的 ID。
- 正式版沒有自動刪除歷史版本。需監控主機剩餘磁碟空間，並定期備份。健康檢查為 `/api/v1/health`；服務日誌可用 `docker compose logs --tail=100 app` 查看。

若斷電恰好發生在檔案移入版本庫與資料庫登記之間，可能留下未登記的版本目錄。停止 app、備份資料後，確認該 `id + version` **不在**後台或資料庫 `versions` 表，再將對應的 `data/games/<id>/<version>` 移到資料目錄之外保留，便可重新匯入。不要移動已登記的版本。

## 檢查與專案結構

```sh
npm run typecheck
npm run build
npm test
npm run test:e2e
npm audit
```

瀏覽器測試預設使用已安裝的 Chrome。Linux CI 或沒有 Chrome 時：

```sh
npx playwright install --with-deps chromium
PLAYWRIGHT_CHANNEL=chromium npm run test:e2e
```

E2E 使用臨時資料庫與測試用 GitHub adapter，不會更動本機平台資料或發布 GitHub Release。測試涵蓋真實 ZIP 匯入與完整 UI；GitHub adapter 另測限流、下載中斷與下載來源限制。測試用帳號只存在臨時資料庫中。

| 目錄                | 用途                                      |
| ------------------- | ----------------------------------------- |
| `client/`           | React 介面與樣式                          |
| `server/`           | API、遊戲資源、匯入、登入、CLI 與備份還原 |
| `shared/`           | 遊戲 manifest 驗證與共用 TypeScript 型別  |
| `examples/starter/` | 完整靜態遊戲範本與實際遊戲封面            |
| `scripts/`          | 打包、驗證、封面截圖與 Docker smoke test  |
| `templates/`        | 開發者可複用的 GitHub Actions workflow    |
| `tests/`            | 後端整合、安全邊界與 Playwright 測試      |

後續擴充可在 `/api/v1` 加入玩家身份、存檔 SDK 與分數服務；多人遊戲伺服器以獨立容器和授權介面接入。這些功能尚未實作。

# 平台 Git / OTA 更新

遊戲版本仍以各遊戲的 GitHub Release 匯入。此功能更新的是平台的 React / API 程式，不會自動匯入遊戲。

## 部署與啟用

Linux 上需要 Docker Engine 與 Compose v2+。平台來源 repository 必須公開，部署主機以 HTTPS 讀取指定分支；不把 GitHub 寫入憑證放到伺服器。可使用 main，或指定獨立的 production 分支。只有 repository 寫入者能改變伺服器執行的程式，請保護該分支並檢查 CI。

在固定部署路徑（例如 `/opt/playroom-platform`）clone repository。建立 `.env`，除了正常部署的兩個 HTTPS 主機名稱，增加：

```dotenv
DEPLOY_DIR=/opt/playroom-platform
COMPOSE_PROJECT_NAME=playroom
UPDATE_REPOSITORY=https://github.com/TommyLamm/playroom-platform.git
UPDATE_BRANCH=main
UPDATER_TOKEN=<openssl rand -hex 32 的結果>
APP_COMMIT=<git rev-parse HEAD 的結果>
```

DEPLOY_DIR 必須是主機上的絕對路徑，不能是容器路徑。備份建議使用預設 `BACKUP_DIR=./backups`，建立 backups 後 `chown 1000:1000 backups`。保護 `.env` 和 `ota-state` 的主機存取權限。不要公開 updater 的 3090 連接埠。

```sh
mkdir -p ota-state backups
chmod 700 ota-state
chown 1000:1000 backups
printf '%s\n' '{"services":{"app":{}}}' > ota-state/active.json
docker compose -f compose.yaml -f compose.ota.yaml -f ota-state/active.json build
docker compose -f compose.yaml -f compose.ota.yaml -f ota-state/active.json run --rm --no-deps app npm run admin:init -- admin
docker compose -f compose.yaml -f compose.ota.yaml -f ota-state/active.json up -d
```

`active.json` 只在第一次部署時建立，之後不能覆寫。OTA 更新後的啟停、備份及維護，都必須帶上這三個 Compose 檔案，否則可能退回最初的映像或錯誤的資料 volume。

## 管理後台

登入 admin，在「管理後台 → 平台更新」查看目前與最新 Git commit。每五分鐘背景檢查一次，也能手動「檢查更新」。有新提交時按「更新平台」，確認後部署已檢查的完整 commit SHA。每次 Git push 不會自動中斷玩家，必須由管理員確認部署。

1. 取得公開 repository 指定分支，鎖定 commit，不接受瀏覽器指定 URL、分支或任意指令。
2. 建置新的 Docker 映像，執行型別檢查、建置與後端測試。此時舊平台繼續服務。
3. 停止單一 app，製作包含帳號、所有遊戲版本與 SHA-256 清單的備份；完成後才替換 app。
4. 啟動新映像，等待 Docker health check 並驗證運行中的 commit。Caddy 與 updater 不會被重新部署。
5. 失敗時保留錯誤紀錄；若已做備份，驗證並還原到新的 named volume，以舊映像啟動。原 volume 不會刪除，留供人工檢查。回復後 session 清除，需重新登入。

切換與備份期間網站會短暫離線，網頁會自動重試讀取更新狀態。不是零停機更新；維護期間匯入中的任務可能中斷，需重新匯入。SQLite migration 可能不可逆，因此不能只換回舊映像而忽略資料庫回復。備份和映像不會自動刪除，需監控磁碟與定期清理已確認不需的版本。

更新工作與回復資訊持久化在 `ota-state/status.json`。更新服務重新啟動時會處理未完成的部署；回復失敗時拒絕新的更新並記錄錯誤，須由主機管理員處理。請保留整個 ota-state，尤其 active.json；其檔案與 backups 不應提交 Git。

## 安全與更新範圍

普通玩家與未登入者不能使用更新 API。POST 使用既有 Origin / CSRF 驗證。平台以 server-side bearer token 與內部 updater 溝通，token 不回傳瀏覽器。

updater 持有 Docker socket，因此具有主機等級的權限，只能由可信任管理員及 repository 維護者操作。網頁 app 不掛載 Docker socket。建置的 Dockerfile 與原始碼仍是可信任的部署內容，不能把更新來源設成陌生人的倉庫。

OTA 只更新 app 的映像。Compose、Caddy、updater 本身、環境變數、外部系統套件及新的基礎設施需求，必須由主機管理員檢查後手動維護。這避免正在執行的更新服務把自身替換。更改 `.env` 後需 recreate updater 與 app。

```sh
docker compose -f compose.yaml -f compose.ota.yaml -f ota-state/active.json logs --tail=100 updater app
docker compose -f compose.yaml -f compose.ota.yaml -f ota-state/active.json exec app npm run backup -- /backups/manual-backup
```

手動回復時先停止 app，保留原資料 volume，依 README 的還原流程還原備份到新 volume，再將 active.json 的 app image 和 /data volume 指向舊映像與新 volume。先確認主機路徑與備份完整性，不可使用 `down -v` 清除資料。

相關指令依據：[Git fetch](https://git-scm.com/docs/git-fetch)、[Docker Compose up](https://docs.docker.com/reference/cli/docker/compose/up/)。

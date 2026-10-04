# 驗證紀錄

驗證日期：2026-10-04。環境為 Windows、Node.js 24.11.1、Chrome；手機測試使用 Chromium 的 iPhone 13 viewport 與觸控模擬。

| 項目                          | 結果                                                                                   |
| ----------------------------- | -------------------------------------------------------------------------------------- |
| TypeScript 前後端型別檢查     | 通過                                                                                   |
| 正式前後端 build              | 通過                                                                                   |
| Node 整合／安全邊界測試       | 29 項通過，含註冊、角色、舊帳號升級、Release tag 一致性及 OTA 工作狀態／權限／失敗回復 |
| Playwright                    | 6 個情境通過；2 個不適用於該 viewport 的重複情境依設定跳過                             |
| 桌面／手機截圖檢查            | 大廳、遊戲、註冊、玩家選單與管理後台；封面正常、無水平溢出；手機遊戲按鈕至少 44px      |
| GitHub 真實 API               | 成功讀取 vitejs/vite 公開資訊與 100 個 Releases                                        |
| 遊戲成品 ZIP 打包與完整驗證   | 通過                                                                                   |
| 本機 CLI 線上備份與空目錄還原 | 實際執行成功                                                                           |
| 備份損壞檢查                  | 修改檔案後，還原被拒絕                                                                 |
| 本機程序重新啟動              | 遊戲、版本與管理員資料保留                                                             |
| 本機既有資料庫升級            | 重啟後 schema v2、原 admin 帳號及兩款遊戲 v1.0.1 保留，SQLite integrity check 通過     |
| 舊版備份相容性                | 升級前建立備份，實際還原至獨立空目錄並自動升級成功                                     |
| npm audit                     | 安裝依賴修正後無已知漏洞；production audit 亦為 0                                      |

瀏覽器管理流程使用測試用 GitHub adapter 提供兩個 Release，經過真實 ZIP 解壓、資料庫、資源伺服器及 UI 完成匯入、預覽、發布、更新、回退和下架。尚未以實際開發者的 game.zip Release 進行外網端到端匯入，因為本次沒有指定該 repository。

帳號測試涵蓋公開註冊只能建立 `player`、拒絕註冊注入 `admin`、帳號不分大小寫、重複／並發註冊、密碼雜湊、註冊限流、玩家不能使用任何管理 API、登出及 session 過期、角色降級後立即撤銷管理權限、v1→v2 升級保留管理員及 session，以及新版備份還原保留玩家角色。瀏覽器另驗證玩家登入後無後台入口、直接進入 `/admin` 被阻擋，admin 登入後顯示管理入口。

## Ubuntu / Docker / OTA

初次部署的歷史紀錄：已在使用者指定的 Ubuntu 26.04.1 LTS 主機實際測試 Docker Engine 29.8.2、Compose 5.6.0，並完成 app、Caddy 與 updater 部署。當時平台及遊戲使用不同的測試主機名稱，Caddy 成功取得公網 HTTPS 憑證，只有 Caddy 公開 80/443。現行部署已改為自行管理反向代理，見 [Nginx 部署指南](reverse-proxy.md)。

GitHub Actions 已執行並通過型別檢查、建置、29 項後端測試、桌面／手機 Playwright、Docker build、named-volume 備份／還原及容器重啟保留遊戲資料。

另在獨立 `playroom-ota-smoke` 專案實際做故障注入：候選映像把資料庫 user_version 改成 99 後退出；更新工作偵測不健康，驗證舊備份並還原至新 named volume，再以舊映像啟動。確認 schema 回到 2、SQLite integrity_check=ok、1 個 admin 與 2 款已上架遊戲保留。測試專案已停止，未修改正式測試網站的資料 volume。

公網瀏覽器實測 admin 登入、平台更新頁籤、確認視窗、觸發真實 Git 提交的 OTA 工作與更新完成狀態；確認運行 commit 已切換、管理員 session 與兩款遊戲保留。更新期間有預期的短暫 502，頁面之後自行恢復。桌面及 390px 手機截圖正常，手機頁面沒有水平溢出。

實際部署測試修正了容器內資料鎖的位置與舊 SQLite WAL snapshot 的回復相容性。`scripts/ota-recovery-smoke.mjs` 僅允許指定隔離測試專案，不可對線上部署執行。

目前沒有執行 Safari、Firefox、多人負載或跨主機測試。平台維持第一版的單主機、可信任開發者範圍。

## 移除 Caddy / 外部 Nginx 接入

2026-10-04 依使用者要求移除 Compose 的 Caddy 服務與 Caddyfile，將 app 發布連接埠限定至主機 `127.0.0.1:3000/3001`。型別檢查與 29 項後端測試再次通過；在 Ubuntu 主機驗證 Compose 設定、初始化腳本 Bash 語法，並以臨時自簽憑證及一次性 Nginx 容器執行 `nginx -t` 通過，沒有安裝或啟動 Nginx 服務。

先完成平台資料備份 `pre-proxy-removal-20261004T114350Z` 及受限權限的部署設定快照，再移除 Caddy 容器並重新建立 app/updater 的容器設定。保留當前 app 映像與 OTA active.json，沒有觸發程式 OTA；兩個容器健康。主機的 80/443 已無 listener，從外網連線舊 HTTPS 入口及主機 3000 皆不可達。

新域名尚未指定，運行中的 origin 暫為 `https://play.example.invalid`、`https://games.example.invalid`，保持 production HTTPS、Host、來源與 Cookie 安全限制。舊平台 Host 回覆 421，健康檢查正常，未登入管理 API 回覆 401，4 款已發布遊戲的入口可在主機診斷請求下正常讀取，updater 的授權狀態 API 正常。

直接比對切換前備份與現有資料庫的 users、games、versions、repositories，內容一致；SQLite schema 2、integrity_check=ok，保留 2 個帳號、4 款上架遊戲及 6 個版本，另驗證 36 個遊戲檔案 SHA-256 與備份一致。原有 Caddy 憑證 volumes 僅留存，未再掛載或使用；沒有清除任何平台資料 volume。

尚未驗證使用者自行部署的新域名、憑證或 Nginx 端到端瀏覽器流程，待其部署後按 Nginx 部署指南驗收。

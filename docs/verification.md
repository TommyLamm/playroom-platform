# 驗證紀錄

## Cloudflare Proxy 真實 IP 部署（2026-10-05）

已透過 SSH 在 `103.199.19.41` 部署。實際反向代理為 Nginx Proxy Manager 2.16.0（`nginx-app-1`），原本讀取 X-Real-IP；現以持久化 `/root/nginx/data/nginx/custom/server_proxy.conf` 明確信任 Cloudflare 官方 IPv4／IPv6 網段，改讀 CF-Connecting-IP，套用至 playroom.party 與 games.playroom.party。Nginx 語法檢查及 reload 成功；沒有 pull／build 或重啟 app、updater，也沒有部署尚未提交的 GitHub 來源管理改版。設定備份保存在主機 `/root/nginx/maintenance-cloudflare-backup-20261005/`。

驗證包含 Cloudflare IPv4／IPv6 的訪客 API 寫入、伺服器公網 IPv4 與 Cloudflare trace／SQLite IP 完全相符、偽造 X-Forwarded-For／X-Real-IP 不影響記錄，以及非 Cloudflare 網段直連偽造 CF-Connecting-IP／forwarding headers 仍記錄真正連線 IP。地區正確顯示 HK／VN。平台健康檢查及現有 mini-dungeon 1.2.0 遊戲入口皆回覆 200，app／updater 保持 healthy。12 筆本次測試事件按完整 requestId 及專用 User-Agent 精確備份後移除，避免影響正式訪客統計；保留其他訪客資料。既有訪客相關 9 項後端測試亦通過。

## GitHub 遊戲來源與批量匯入（2026-10-05）

型別檢查、正式 build、完整 100 項後端／SDK／工具測試通過。既有 Playwright 回歸 20 個桌面／手機情境通過，2 個依 viewport 設定跳過；手機來源卡片修正後，受影響的管理匯入及手機情境再次通過。production npm audit 為 0 個已知漏洞。本次未新增依賴。

新增後端測試涵蓋全部來源／批次 API 的管理員權限、Origin／CSRF、多帳號與組織、探索分頁及已加入標記、URL 正規化與去重、缺少唯一 game.zip／無效 tag／預發布的版本選擇、檢查失敗保留快取、封存與恢復、50 款逐項匯入與部分失敗、60 項進度不受 overview 50 筆限制、批次 requestId 冪等及不同內容衝突、已匯入跳過、等待中任務沿用、100 個任務容量、重啟中斷與重試。批次關聯寫入故障會回滾任務，只有 transaction commit 後才啟動下載，不產生孤立匯入。schema v6→v7 保留來源及訪客資料，新版備份還原保留常用帳號、來源檢查、批次與全部任務關聯；既有舊版 migration／還原測試通過。

另外使用 Playwright CLI、獨立臨時資料庫與測試 GitHub adapter，實測保存 alice／bob／team 三個帳號、探索載入 100＋10 個 repositories、搜尋第 110 個來源並加入；加入來源期間不讀取 Release。多行貼上 50 個來源、重複 URL、無效格式與不存在的來源，去重及逐項回報正確；加入與檢查請求的最大並行數實測為 3。53 個來源檢查中模擬一款 GitHub 額度失敗，顯示錯誤並可重試；開發者／狀態篩選、25 筆分頁、封存及恢復正常。

實際透過新版三步流程匯入 50 款，預設正式版、手動改選一款預發布，無效 tag／缺少附件的版本不可選。等待期間關閉視窗並重新整理，仍可開啟完整批次；最後 49 款成功、1 款 tag／Manifest 不符，單獨重試後成功，原批次 50 項歷史保留。由批次直接開啟預覽並開始遊玩，公開遊戲數仍為原本 2 款，確認匯入及預覽不自動上架。

1440px 桌面與 390px 手機截圖已檢視；版本確認的主要操作保持可見。手機來源表格曾受既有 620px 最小寬度影響，已覆寫：卡片及容器實測皆寬 303px，所有欄位完整顯示，document scrollWidth 375px 不超過 390px viewport，並加入真正量測表格／容器寬度的回歸檢查。截圖保存在 `output/playwright/sources-desktop.png`、`sources-mobile.png`、`import-versions-desktop.png` 及 `import-versions-mobile.png`。

README、開發指南及遊戲 Agent 範本已同步，線上規格連結仍追蹤 main。部署可沿用 OTA，資料庫自動升級至 schema v7，沒有修改 Compose／updater。回退不支援 v7 的舊平台須使用升級前備份。本次未部署、推送或修改正式資料。

## 訪客統計與活動記錄（2026-10-05）

型別檢查、正式 build 與完整 88 項後端／SDK／工具測試通過。既有 Playwright 回歸測試 20 個桌面／手機情境通過，另 2 個依既有 viewport 設定跳過。完整及 production npm audit 均為 0 個已知漏洞。

訪客後端涵蓋匿名及登入活動串連、Cookie 去重與重試冪等、伺服器取得 IP、IPv4／IPv6 國家推算、內網未知、可信代理與偽造 forwarding／國家欄位、管理員查閱限制、Origin、嚴格事件與篩選輸入、排除管理員／預覽、已發布版本限制及下架歷史、UTC 7／30 天區間、確定排序與分頁、每 IP 限流、90 天清理與 Secure host-only Cookie。schema v5→v6 保留帳號及遊戲，新版備份還原完整保留訪客事件；既有 v1–v4 migration／備份相容測試通過。

另外以 Playwright CLI 在臨時資料庫實測訪客從大廳、詳情進入遊戲，僅記一筆開啟，登入管理員後排除活動；模擬訪客 API 503，仍可重新載入並開始遊戲。第二個訪客經測試代理 IP 顯示美國，後台國家／IP／遊戲／活動組合篩選只返回相符開啟事件；38 筆記錄分為 25／13 筆兩頁，點選訪客可篩選同一瀏覽器。7／30 天切換正常，匿名直接讀取活動 API 回覆 401。

1440px 桌面與 390px 手機截圖已檢視；手機 document scrollWidth 為 390px，表格在區塊內橫向捲動。CLI 截圖保存在 `output/playwright/visitors-desktop.png`、`output/playwright/visitors-mobile.png` 與 `output/playwright/visitors-mobile-filtered.png`。開發指南及遊戲 Agent 範本已同步，線上規格連結仍追蹤 main。

訪客資料從功能上線後累積，不回補舊匿名活動；國家為 IP 推算，開啟不代表完成局次。記錄自動保留 90 天，備份另保留當時快照。GeoIP 資料庫需隨套件更新／重建部署，依賴的舊 ip-address 已覆寫為修正版 10.7.3。本次未部署、推送或修改正式資料。

## 帳號設定與營運概況（2026-10-05）

型別檢查、正式 build 與完整 79 項後端／SDK／工具測試通過。完整 Playwright 執行後，修正新增營運測試未等登入完成與登出後頁面判斷錯誤，受影響的桌面／手機情境重跑通過；合計 20 個情境通過、2 個依既有 viewport 設定跳過。

帳號後端驗證本人設定權限、Origin／CSRF、嚴格輸入、公開範圍跨帳號隔離、limited 活動欄位隱藏、private 對訪客與其他管理員回傳 404、排行榜仍公開、改密碼旋轉目前 session 並撤銷其他 session、撤銷其他裝置保留目前登入、每帳號共用敏感操作限流，以及非同步驗證期間登出／密碼改變的競態。schema v4→v5 保留帳號、session、收藏與成績，新版備份還原保留隱私設定並撤銷 session；既有 v1–v4 相容測試亦通過。

營運後端驗證管理員權限與嚴格期間查詢、UTC 7／30 天活動區間與下架歷史、真實提交回應的成功／拒絕／伺服器錯誤、重複及重試計數、排除訪客及他人局次、磁碟測量快取與未知值。備份完成後才記錄成功，失敗保留最近成功時間；還原快照的進行中狀態不會永久顯示正在備份，舊版沒有營運狀態表的備份仍相容。

瀏覽器在桌面與手機完成登入、limited／private 生涯切換與訪客檢查、排行榜維持公開、登出其他裝置、密碼確認不一致、成功修改密碼、舊密碼及舊 session 失效、新密碼登入及設定保留。管理員實測真實成績成功／無效／重複提交的統計、7／30 天切換、儲存空間與備份顯示、登出後 API 拒絕。帳號設定與營運概況的手機截圖已檢視，沒有頁面水平溢出，寬表格在區塊內捲動。

資料庫升級至 schema v5，備份還原支援 v1–v5；回退舊版平台需使用升級前備份。營運提交失敗指標從上線後累積，未到達伺服器的離線請求不計。測試皆使用臨時資料，本次未部署、推送、建立 Release 或修改正式資料。

## SDK 預覽診斷與生涯進步（2026-10-05）

型別檢查、正式 build、63 項後端／SDK／發布工具測試通過。完整 Playwright 執行後，修正新增趨勢表格造成的既有逐局表格選擇器重複，受影響的兩個桌面／手機情境重跑通過；合計 16 個情境通過、2 個依既有 viewport 設定跳過。手機表格換行與 SVG 標籤調整後，另重跑新增桌面／手機流程及手機驗收通過。

後端新增驗證私人進步 API 的帳號隔離、嚴格查詢、空資料、零分、首次起點、嚴格突破、同分、升降序、跨版本與換榜、最近 30 局仍參考完整歷史、同時間確定排序、下架／登入失效，以及排行榜前 100 名之外的下一組名次差距。SDK 六項測試涵蓋訪客／一般預覽／獨立模式不提交、診斷預覽不宣稱保存、正式模式保存、來源／協定／連線偽造、錯誤與逾時處理。

瀏覽器實測私人趨勢、突破標記、錯誤重試、切換遊戲、排行榜差距、其他玩家不載入私人趨勢；管理預覽完成一局並檢查診斷事件、拒絕超範圍分數及偽造來源訊息、清除與重新開始。已確認預覽沒有記錄 API 寫入，管理員生涯前後相同。桌面及手機截圖已檢視，手機進步表格可直接顯示全部欄位且沒有水平溢出。

範例升至 v1.2.0 以交付支援預覽診斷的新 SDK，原有已匯入版本不改寫；沿用 classic 榜單。資料庫維持 schema v4。測試使用臨時資料，未部署、推送或建立 Release；正式範例需停服後執行 demo:seed 安裝新版本。

## 最近遊玩、收藏與完整發布 CI（2026-10-04）

本次型別檢查、正式 build、48 項後端及發布工具測試通過。完整 Playwright 執行後修正既有登入測試的重複連結選擇器，重跑受影響的桌面／手機測試皆通過；合計 12 個情境通過，2 個依既有 viewport 設定跳過。

新增驗證包括私人清單、收藏重複操作、跨 session 同步、帳號隔離、最近遊玩去重與 12 款限制、下架處理、限流、schema v3→v4 保留資料及 v4 備份還原。瀏覽器實測清單讀取及收藏保存失敗後重試、直接開玩並回到大廳、另一個瀏覽器登入與取消收藏、切換帳號清除舊清單。桌面及手機截圖確認沒有頁面水平溢出。

Release workflow 的版本檢查程式已測正常／錯誤 tag、含 shell 字串的 tag 與越界成品路徑；實際打包及驗證工具通過含空格路徑的範例成品，拒絕大小寫碰撞 ZIP 和缺失入口。YAML 解析與文件格式檢查通過。尚未在 GitHub Actions runner 執行整份 workflow，未建立 Release、推送程式或部署；測試皆使用臨時資料，不修改既有正式資料。

## 帳號生涯與排行榜（2026-10-04）

本次在 Windows、Node.js 24.11.1 與 Chrome 完成型別檢查、正式 build、39 項後端測試及完整 Playwright：10 個桌面／手機情境通過，2 個依既有 viewport 設定跳過。範例 `signal-tap` v1.1.0 成品 ZIP 打包及完整驗證通過。

後端新增驗證：帳號與 session 歸屬、Origin／CSRF、私人紀錄、零分及分數範圍、重複請求與不可覆寫、最佳成績、同分並列、升降序、跨版本沿用及換榜、前 100 名之外的本人名次、前景／暫停心跳及過期中斷、下架、帳號限流、schema v1/v2→v3，以及新版備份還原保留記錄並撤銷 session。

瀏覽器實測登入遊玩、保存失敗後重試、公開摘要／本人逐局資料分離、排行榜連到生涯、另一個瀏覽器登入後查到相同成績、訪客遊玩、偽造訊息來源／連線、背景停止計時、登入失效與切換帳號。另確認管理預覽不產生記錄，未接入的匯入遊戲仍能記錄開啟次數及繼續遊玩。手機生涯截圖沒有頁面水平溢出，逐局表格在區塊內捲動。

測試使用臨時資料庫與遊戲檔案；本次未部署至遠端主機、未修改既有正式資料或建立 GitHub Release。範例新版本需由 `demo:seed` 安裝；遊戲開發範本追蹤平台 `main` 分支的最新規格，相關規格及 SDK 需推送至 `main` 後才可透過線上連結讀取。以下段落為先前部署與驗證的歷史紀錄。

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

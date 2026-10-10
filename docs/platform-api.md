# 平台 API 與管理後台參考

本文件供平台開發與管理使用；獨立遊戲的必要接入要求見 [遊戲開發與發布標準](game-development.md)。遊戲只透過 SDK 提交帳號成績，不直接呼叫下列 API。

## 平台 API 摘要

所有 JSON API 位於平台來源的 `/api/v1`。錯誤格式是 `{ "error": "說明" }`；遊戲來源只提供靜態遊戲資源。

後台角色分為 `admin`（平台管理員）、`game_manager`（遊戲管理者）、`analyst`（數據分析員）。普通 `player` 不可進入後台，公開註冊只建立玩家。遊戲管理者可管理全部遊戲的來源、匯入、預覽、發布與下架；分析員只讀彙總統計。帳號權限、訪客個人明細、磁碟／備份狀態及平台更新只供平台管理員。角色由平台管理員在帳號權限頁指派，API 每次讀取目前角色；角色變更不改變私人逐局成績僅供本人的限制。遊戲不應取得管理角色或直接呼叫管理 API。

| 方法與路徑 | 功能 |
| --- | --- |
| `GET /games`、`GET /games/:id` | 已上架遊戲及完整遊玩／封面 URL |
| `GET /session` | 登入狀態；登入後回傳 `username`、`role`、CSRF token |
| `POST /register` | `{username,password}`，建立 `player` 並登入；不接受 `role` |
| `POST /login` | `{username,password}`，設定 session cookie |
| `POST /logout` | 登出並撤銷目前 session |
| `POST /visits` | 平台頁面用：`{requestId,kind,path,gameId?,version?,referrer?}`，kind 為 page_view／game_open；需要正確 Origin，不要求登入或 CSRF，每 IP 每分鐘最多 120 次；遊戲不得直接呼叫 |
| `GET /me/settings` | 本人設定 `{careerVisibility,otherSessions}`；otherSessions 只計有效的其他 session，不接受指定其他帳號 |
| `POST /me/settings` | `{careerVisibility}`，值為 public／limited／private，回傳更新後的本人設定 |
| `POST /me/password` | `{currentPassword,newPassword}`，驗證目前密碼後更新；新密碼 12–256 字元，撤銷全部舊 session 並為本裝置建立新 session，回傳 `{ok:true,session}` |
| `POST /me/sessions/revoke` | `{currentPassword}`，驗證後撤銷其他 session，保留目前登入，回傳 `{revoked}` |
| `GET /players/:username/career` | 依公開範圍回傳摘要與 `activityVisible`；limited 活動欄位為 null、private 非本人為 404；不含逐局成績、session 或憑證 |
| `GET /me/results` | 本人逐局成績；選填 `gameId`、`page`（預設 1）、`pageSize`（預設 20，上限 100）；不接受指定其他帳號 |
| `GET /me/progress` | 本人進步；必填 `gameId`、`boardId`，回傳最近 30 局、歷來最佳、總局數及突破次數；不接受指定其他帳號 |
| `GET /games/:id/leaderboards` | 已發布榜單及 `activeBoardId` |
| `GET /games/:id/leaderboards/:boardId` | 前 100 名、已登入玩家自己的最佳成績／名次及 `nextTarget`（最近的嚴格較佳分數組之名次、分數與差距；沒有目標時為 null） |
| `POST /games/:id/plays` | 大廳用：`{version,requestId}`，回傳 `{playId}`；requestId 為 UUID，同 session 重試不重複開啟次數 |
| `POST /plays/:playId/heartbeat` | 大廳用：`{active}`；前景具有焦點時 active=true，失焦時送 false，恢復時重新啟動計時 |
| `POST /plays/:playId/runs` | 大廳用：`{requestId}`，回傳 `{runId}`；同遊玩記錄重試不重複建立局次 |
| `POST /runs/:runId/finish` | 大廳用：`{score}`，回傳保存結果 |
| `GET /admin/overview` | 遊戲、版本、repository 與最近 50 筆匯入紀錄 |
| `GET /admin/analytics` | 選填 `days=7`（預設）或 `30`；UTC 區間、活躍玩家／開啟／完成／熱門遊戲及成績提交／每日指標；admin／analyst 可讀，storage／backup 欄位僅對 admin 回傳 |
| `GET /admin/visitors` | 選填 `days=7`（預設）或 `30`；訪客、瀏覽、遊戲開啟總數、每日趨勢、國家分佈與前 10 款訪客熱門遊戲；admin／analyst 可讀 |
| `GET /admin/visitors/records` | 選填 `days=7`／`30`、`page`、`country`（ISO 國家碼或 unknown）、`ip`、`gameId`、`kind`、`visitor`（完整雜湊）；每頁 25 筆，包含 IP／國家／帳號／頁面／遊戲／來源／User-Agent；只供管理員 |
| `POST /admin/repositories` | `{fullName:"owner/repository"}`，亦接受 GitHub repository URL；大小寫及重複來源正規化 |
| `GET /admin/github-owners` | 常用 GitHub 帳號／組織 |
| `POST /admin/github-owners` | `{login}`，檢查並保存公開帳號／組織 |
| `POST /admin/github-owners/:login/remove` | `{}`，移除常用帳號，不刪除來源 |
| `GET /admin/github-owners/:login/repositories` | 選填 `page`（預設 1），每次最多 100 個公開 repositories、`added` 及 `hasMore` |
| `GET /admin/sources` | 遊戲來源、封存狀態、保存的 Release 檢查結果及已匯入版本 |
| `POST /admin/repositories/:id/check` | `{}`，更新 Release 檢查與時間，失敗保留快取並回傳 `checkError`；限流立即回報暫停，由背景到期重試，不讓 HTTP 請求等到額度恢復 |
| `POST /admin/source-checks` | `{force?}`，預設 true，啟動或沿用所有未封存來源的檢查，回傳 202 與 `check`；後台進入時傳 false，沿用五分鐘內的成功結果 |
| `GET /admin/source-checks/current` | `check` 含 id／status／total／completed／failed／startedAt／finishedAt／retryAt，無本次檢查時為 null |
| `POST /admin/repositories/:id/state` | `{archived}`，封存／恢復；匯入中的來源不可封存 |
| `POST /admin/import-batches` | `{requestId,items:[{repositoryId,releaseId}]}`，UUID requestId，同批次冪等，最多 100 項，回傳 202 與 `batch` |
| `GET /admin/import-batches` | 最近 50 個批次的總數、完成／跳過、失敗及等待中數量 |
| `GET /admin/import-batches/:id` | 批次完整項目、任務狀態及錯誤，不受 overview 50 筆限制 |
| `GET /admin/repositories/:id/releases` | 最近 100 個 Release 與 game.zip 資訊 |
| `POST /admin/imports` | `{repositoryId,releaseId}`，回傳 202 與 `jobId` |
| `POST /admin/games/:id/preview` | `{version}`，回傳 `url`、`expiresAt` |
| `POST /admin/games/:id/review` | `{version,approved}`，保存確認者及時間或撤銷；管理版本回應含 reviewedBy／reviewedAt |
| `POST /admin/games/:id/publish` | `{version}`，首次發布要求版本已預覽確認，且已有目前版本時必須高於該版本；已公開版本可回退 |
| `POST /admin/publish-batches` | `{items:[{gameId,version,expectedActiveVersion,expectedPublished}]}`，最多 100 款、遊戲不可重複；逐款回傳 published／skipped／failed 與 error，上架狀態變更或更新版本低於目前版本時拒絕該款，已是目前上架版本則略過 |
| `POST /admin/games/:id/unpublish` | `{}`，封鎖所有公開版本資源 |
| `GET /admin/accounts` | 僅 admin；選填 search（帳號文字）、page（預設 1），每頁 20 個帳號，回傳 id／username／role／createdAt，不含密碼或 session |
| `POST /admin/accounts/:id/role` | 僅 admin；`{role,expectedRole}`，立即變更角色；目前角色與 expectedRole 不符或將最後一位 admin 降級時回傳 409 |

`/me/progress` 只查登入帳號的已完成局次。`points` 依完成時間從舊到新排列，最多 30 筆；完成時間相同時按局次 ID 排序。每筆含 `previousBest` 與 `personalBest`；首次成績的 previousBest 為 null、personalBest 為 false，同分不算突破。最佳成績及突破次數以整個榜單的歷史計算，早於最近 30 局的成績也會影響判斷；沿用榜單 ID 的版本合併，不同 ID 分開。生涯公開摘要不包含這些逐局趨勢，下架後本人仍可查看。

所有 POST 必須附正確平台 Origin。`/login` 與 `/register` 不需既有 session；`/logout`、帳號設定、遊玩、心跳、局次及成績寫入需任一登入角色及 `X-CSRF-Token`；遊戲來源／匯入／預覽／發布及下架操作需 `admin` 或 `game_manager` session；彙總統計需 `admin` 或 `analyst`；訪客明細、帳號權限及平台更新需 `admin`，修改操作另外需 `X-CSRF-Token`。玩家登入不授予管理能力。遊戲不應直接呼叫平台 API，使用 SDK 由大廳代為提交。寫入限流以帳號計算：每分鐘最多 30 次建立遊玩記錄、20 次心跳、60 次開始局次、60 次完成提交及 30 次公開範圍更新；修改密碼與撤銷其他 session 共用每帳號 15 分鐘最多 5 次的限制，重新登入不繞過限制。匯入任務狀態為 `queued`、`running`、`completed` 或 `failed`；後台每三秒更新狀態，失敗時重新提交即可；同時只執行一款匯入，等待及處理中合計最多 100 款。

營運指標的期間從 UTC 今天往前 6／29 天的 00:00 起算，至回應產生時間，包含今天；活躍玩家是期間內有開啟、心跳或完成事件的登入帳號，訪客與預覽不納入。熱門遊戲以開啟次數排序，最多 10 款，保留已下架遊戲的歷史活動。成績提交只統計伺服器收到且屬於有效登入 session 的本人局次：2xx 為 `success`、4xx 為 `rejected`、5xx 為 `server_error`；重複提交及重試再次計數，完成局數不重複。`failureRate` 為（拒絕＋伺服器錯誤）／提交次數，沒有提交時為 null；離線或未到達伺服器的失敗不計。指標上線後開始累積，不補算過往失敗。

平台管理員與數據分析員可在 `/api/v1/admin/visitors` 查看匿名及登入玩家的彙總訪客統計（UTC 7／30 天），`/api/v1/admin/visitors/records` 的個人活動明細僅平台管理員可讀。訪客 Cookie 由平台簽發並以雜湊識別；記錄保留 90 天，國家由伺服器按 IP 的本機 GeoIP 資料推算，未知或內網不強行指定國家。平台頁面負責送出瀏覽及公開遊戲 iframe 載入事件，無 SDK 遊戲亦能記開啟；遊戲本身不得取得訪客 IP／Cookie、直接呼叫 `/api/v1/visits` 或另行提交平台訪客統計。後台角色活動及預覽不納入，訪客開啟不代表完成一局或保存帳號成績，亦不改變生涯與成績 API 的權限。

營運回應的磁碟總容量／可用空間與資料／遊戲檔案用量最多快取 30 秒，讀取失敗回傳 null，介面顯示「未知」；測量不追蹤符號連結。備份狀態為 `never`、`running`、`success` 或 `failed`，只表示平台備份指令記錄的狀態，不驗證備份目的地仍可用。schema v9 備份保留公開範圍設定、營運指標、訪客記錄、常用 GitHub 帳號、來源檢查、匯入批次與版本預覽確認，支援 schema v1–v9 還原；快照中的進行中狀態會轉為 failed 並提醒還原後重新備份。源資料庫在快照、檔案與雜湊清單全部完成後才記錄 success，避免宣稱尚未完成的備份成功。舊平台版本回退需使用升級前備份。

## 管理後台流程

「遊戲更新」整合來源加入、開發者探索、檢查及封存／恢復；不再設置獨立來源頁。可按開發者、使用中／已封存及更新狀態篩選，跨頁及跨篩選勾選保留，工具列列出各操作可處理數量。封存不改變已匯入遊戲的版本或上架狀態，已封存來源需恢復後才能匯入；原有版本仍可在「遊戲與版本」管理。

「遊戲與版本」使用搜尋、篩選與分頁表格，每頁預設 20 款（可選 50／100），點選「管理版本」開啟側邊詳情；手機為全螢幕詳情。版本可搜尋且每頁 10 筆，預覽及確認返回後保留所選版本。歷史回退、下架及來源／校驗資訊沿用原有規則。

「遊戲更新」集中顯示目前版本、最新正式 Release、待發布版本及確認狀態，支援搜尋、篩選與跨頁勾選。伺服器預設每小時檢查未封存來源（`GAME_RELEASE_CHECK_INTERVAL_SECONDS=3600`），進入後台時沿用五分鐘內的成功結果，其餘來源重新檢查；「立即檢查」強制檢查。手動與背景共用最多三個請求，相同來源及整輪檢查合併。限流依 GitHub 回應暫停，到期後連同被限流的來源自動重試，完成後清除錯誤；暫停中的來源不算完成或最終失敗，成功快取保留。Release 請求帶 ETag，GitHub 回傳 304 時沿用清單。這只檢查，不自動匯入或發布。最新候選沿用按發布時間排序的有效正式版，若已匯入或版本不高於目前版本，不自動推薦其他舊版。待發布選單只列出高於目前版本的未發布版本，較新的預發布版本需手動選擇；未發布舊版不列為待更新，歷史回退使用「遊戲與版本」。

日常流程為「勾選更新 → 確認整批 Release → 批量匯入 → 連續預覽確認 → 批量發布」。每批最多 100 款；確認視窗列出版本變更及首次／重新上架。批量發布獨立處理各款、略過已是目標版本的項目，拒絕目前版本或上架狀態已變更的項目，失敗需刷新重新確認，不影響其他款。管理者的來源／匯入／預覽／確認／發布 API 均不可由遊戲直接呼叫。

平台管理員或遊戲管理者可在「管理後台 → 遊戲更新 → 加入來源」保存多位開發者的 GitHub 帳號／組織，探索公開 repositories 並勾選批量加入，或一次貼上多行 URL／owner/repo；來源列表可搜尋、按帳號及狀態篩選，封存不下架或刪除遊戲。從來源列表多選匯入，或由「匯入遊戲」搜尋選取來源，再確認各款 Release 並等待驗證完成。每批最多 100 款，預設最新有效正式版，預發布需手動選擇；已匯入 Release 跳過、相同等待中任務沿用。批次進度可重新開啟，失敗或重啟中斷可批量重試，匯入完成不會自動上架。

# 06 — 操作衝突檢查與機器錯誤碼

狀態：已完成，相關驗收通過；完整整合驗證另記於交付紀錄及 [最新進度](README.md#2026-10-11-最新進度)。優先程度：高。

02 已接入共用 HTTP code/details 傳輸，存檔區分 SAVE_FORMAT_INCOMPATIBLE、SAVE_REVISION_CONFLICT、REQUEST_ID_REUSED；數字 SDK code 保留。本次已在此基礎上完成發布／下架預期狀態、共用 mutation DTO 及逐項批量機器碼。

## 規劃時現況與目標

批量發布帶入預期目前版本與上架狀態，單款發布沒有同等檢查；下架直接更新資料。錯誤主要是 HTTP status 加中文訊息，不同衝突都可能是 409。前端 `api<T>` 的泛型也不能保證各呼叫端自行填寫的回應型別正確。

目標是讓不同入口使用一致業務規則，讓 UI 與 SDK 能可靠決定刷新、重試、重新登入或停止操作。

## 子任務

- [x] **06.1 列出操作契約。**盤點單款／批量發布、回退、下架、預覽確認、存檔、角色變更的輸入、預期狀態、成功結果及錯誤類型。
- [x] **06.2 統一發布服務。**單款與批量呼叫同一服務，傳入操作者與預期狀態；回退仍保留只允許既有公開版本的規則，首次發布仍需人工確認。
- [x] **06.3 統一衝突檢查。**單款發布及下架加入預期狀態檢查，在同一資料庫交易內完成比對與寫入。已有 revision 的存檔繼續使用 revision，不改為比對畫面文字。
- [x] **06.4 定義重複操作。**已處於目標狀態的操作如何回覆，沿用既有發布略過語義並測試；遇到非目標的外部修改則回報衝突，不自動接受刷新後的新狀態繼續提交。
- [x] **06.5 加入穩定錯誤碼。**保留現有 error 文字，新增機器可讀 code；區分狀態過期、存檔 revision 衝突、requestId 重用、相容性不足、權限失效與限流。不得將資料庫訊息直接外露。
- [x] **06.6 保留 SDK 相容性。**舊 SDK 使用的數字錯誤碼及 HTTP status 行為不突然改型；新機器碼使用附加欄位，由 01 的協定定義統一傳遞。
- [x] **06.7 集中操作型別。**請求驗證 schema、回應 DTO 和錯誤碼在 shared 中提供單一來源，重點先覆蓋本輪修改的 API，避免一次要求所有端點重寫。
- [x] **06.8 統一前端處理。**ApiError 保存 status、code 及必要的安全 details；各功能依 code 決定動作，禁止比對中文訊息判斷衝突類型。批量結果仍逐項回報。

## 驗證與驗收

- [x] 兩個管理者同時發布不同版本時，後提交的過期操作不覆蓋先完成操作。
- [x] 單款及批量對相同輸入、權限、預期狀態產生一致結果。
- [x] 下架與發布互相競爭時不能無提示覆蓋已變更狀態。
- [x] 首次發布確認、撤銷確認、歷史回退、防止批量降版等規則保留。
- [x] 存檔衝突與 requestId 重用有不同 code，重試不靠訊息文字辨識。
- [x] 舊 SDK／舊回應消費端仍能顯示錯誤；新消費端可正確處理新增機器碼。
- [x] 確認到提交之間角色被撤銷時，伺服器仍拒絕操作；Origin／CSRF 保護不變。

## 依賴與交付

服務位置配合 04；錯誤傳輸與 01 共同確定；存檔與發布相容性錯誤供 02 使用；03 沿用刷新與衝突處理。交付共用操作／錯誤契約、服務整合、競爭情境測試與 API 文件。

若改變遊戲發布／回退或 SDK 處理要求，同步 `templates/game-agent-template.md`；對舊單款管理 API 的必要輸入變更需在文件中明確標示。

## 2026-10-11 交付

操作盤點、成功／錯誤／重試契約見 `docs/command-contracts.md`；schemas 與 DTO 集中於 shared/commands.ts，存檔維持 shared/cloud-save.ts 的 revision／requestId 規則。單款與批量統一使用 server/game-commands.ts，發布／下架／確認及角色變更於 immediate 交易內重新檢查操作者。低層 library.publish 保留給維護 fixture，管理 HTTP 不繞過操作服務。

單款管理 API 必填 expectedActiveVersion／expectedPublished，缺少為 400 VALIDATION_ERROR；兩名管理者發布競爭、發布／下架雙向競爭均回覆 STATE_CONFLICT，不更動失敗款。目標已上架時 skipped；下架 skipped 仍要求 activeVersion 未變。單款歷史回退與批量不可降版的刻意差異、確認／撤銷和重複確認語義已文件化。

穩定碼另含 REVIEW_REQUIRED、VERSION_NOT_NEWER、LAST_ADMIN_REQUIRED、CSRF_INVALID 與 ORIGIN_REJECTED。前端保存安全 primitive details，依 code 刷新狀態／session 或停止／等待；關閉過期確認，不自動重送。舊 error-only 消費端及 frozen SDK 的數字 Error.code 保持相容。程式／資料庫錯誤回覆 INTERNAL_ERROR，交易失敗會回滾發布時間及上架狀態，批量其他款仍能完成。

新增 tests/command-contracts.test.ts、game-updates 的操作競爭／權限／限流／例外測試，以及 desktop/mobile command-conflicts E2E；使用不同語言錯誤文字驗證 UI 由 code 刷新，第二次必須重新確認。純資料庫操作測試不執行無關的檔案匯入，既有安裝／備份 fixture 與測試保留。完整 E2E 的少數登入測試改用獨立測試來源，保留正式限流；版本選取測試等待非同步詳情及 checked 狀態。

版本 radio／選取行立即反映本地選取值，避免讀取尚未完成時回彈到上一份詳情的版本；操作仍使用已載入的版本詳情及人工確認。新增的下架競爭測試覆蓋刷新後重新選取目前版本。

限制：預期狀態是版本／上架二元組，不偵測先改後改回的 ABA；沒有新增發布 requestId 日誌、預覽驗收 revision 或全部 API 的 DTO 重寫。06 交付當時，04 後端拆分與 07 尚待實作；後續均已完成，見 [04 交付紀錄](04-module-boundaries.md#2026-10-11-後端拆分交付) 與 [07 交付紀錄](07-import-recovery.md#2026-10-11-交付記錄)。規格、平台 API、SDK 版本文件和遊戲 Agent 範本同次同步，線上文件仍追蹤 main。沒有提交 commit、對外發布工具 Release 或部署線上服務。

驗證：`npm test` 177／177；完整 `npm run test:e2e` desktop/mobile 70 通過／4 裝置限定跳過；`npm run typecheck`、`npm run build`、`npm run sdk:check`、`npm run check:boundaries`（112 檔）與 diff whitespace 檢查通過。完整 Windows E2E 使用目前設定的 Chrome，未當作 Linux Chromium CI 已完成；未重新 npm ci。

## 後續遠端驗證（使用者批准後）

使用者明確批准上傳排除資料／.env／憑證／.git／node_modules 的原始碼快照。SHA-256 `6d4569c77205aeaa044c4e67c1cf32fb2747d981b3c220a532e60e8ba12eabeb` 已在主機核對；所有操作位於 `/root/playroom-validation-06.vyNNQo`，沒有更動 `/root/playroom-platform` 或線上服務。初次自動審批拒絕已由此明確授權解除，不再是阻擋。

Node v24.21.0／npm 11.19.0／Docker 29.8.2，使用 Node 24 Bookworm slim 映像。正式 Dockerfile 執行 npm ci、typecheck、build、177 項單元／整合測試及 prune 全部成功；原有持久化 smoke script 使用專用映像 tag，demo seed、backup、restore 及容器重啟後的遊戲持久化檢查成功。測試容器和三個臨時 volumes 由 script 清理。

保留開發依賴的獨立 CI 映像另通過 SDK check、模組邊界檢查（112 檔）、完整 177 測試與 Chromium 安裝。Linux E2E 在不映射 host ports 的容器執行，記憶體上限 1536 MiB、共享記憶體 256 MiB；桌面階段先限制 1 CPU，手機階段調整為 1.5 CPU（主機共 2 CPU），測試 timeout 保持原值；完整 E2E 70 通過／4 裝置限定跳過（10.1 分鐘）。這是本次原始碼的 Linux CI 指令驗證，沒有觸發 GitHub Actions。

06 快照的驗證 logs／runtime／audit JSON 保存於本機 `output/verification-06/`。當時 npm audit 的開發依賴圖回報 concurrently 與其 shell-quote 依賴共 2 個 critical 條目；正式映像 `npm audit --omit=dev` 回報 0。package-lock.json 在 06 階段未更動，當時開發依賴告警另待處理，沒有以 npm audit fix 改動驗證中的依賴。後續依賴狀態以 [最新進度](README.md#2026-10-11-最新進度) 為準。

遠端驗證結果：CI 所列的 npm ci、SDK check、typecheck、build、npm test、Chromium 安裝、完整 E2E、Docker build 與持久化 smoke 全部通過；額外模組邊界檢查也通過。GitHub Actions 尚未實際觸發。`.last-run.json` 保存 passed／空 failedTests，原 checkout status 為空，已確認無本次測試容器／smoke volumes 殘留並清理兩個專用 image tags；原始碼快照及 logs 保留於獨立驗證目錄。所有程式驗證對應上述快照 hash，後續僅更新驗證文件，沒有提交 commit 或發布工具 Release。

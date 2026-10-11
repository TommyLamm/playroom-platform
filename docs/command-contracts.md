# 管理操作與錯誤契約

請求 schema 與成功 DTO 的單一來源是 `shared/commands.ts`；存檔使用 `shared/cloud-save.ts`，錯誤碼、安全 details 型別及處理分類使用 `shared/errors.ts`。平台 UI 使用型別化 gameCommand／publishBatch／changeRole，避免各呼叫端另填成功型別。這輪只集中以下操作，不代表全部 API 都已改為型別化命令。

## 操作盤點

以下管理路徑省略 `/api/v1/admin`；存檔路徑省略 `/api/v1`。所有修改要求平台 Origin、有效 session、CSRF；伺服器每次檢查角色，發布／下架／確認／角色變更另在寫入交易內重新讀取操作者權限。

| 操作 | 輸入／預期狀態 | 成功 | 業務限制／錯誤 |
| --- | --- | --- | --- |
| `POST /games/:id/publish` 發布或回退 | `{version,expectedActiveVersion,expectedPublished}` | `{ok:true,status:"published"或"skipped"}` | 首次公開需驗收確認，缺確認為 REVIEW_REQUIRED；未曾公開版本需高於目前版本，否則 VERSION_NOT_NEWER；單款可切換已公開歷史版本；SAVE_FORMAT_INCOMPATIBLE 阻擋已知不相容存檔 |
| `POST /publish-batches` | `{items:[{gameId,version,expectedActiveVersion,expectedPublished}]}`；1–100 款，不可重複 gameId | `{results:[{gameId,version,status,error,code,details?}]}`；成功 error/code 均為 null | 與單款共用服務；批量不能降版，已下架的目前版本可以重新上架；失敗逐款回報，不回滾其他成功款 |
| `POST /games/:id/unpublish` | `{expectedActiveVersion,expectedPublished}` | `{ok:true,status:"unpublished"或"skipped"}` | 保留 activeVersion 和所有版本，封鎖公開資源；STATE_CONFLICT 不更動資料 |
| `POST /games/:id/preview` | `{version}`；無預期發布狀態 | `{url,expiresAt}` | 僅發出短效預覽憑證，不授予發布許可、不保存正式 SDK 資料 |
| `POST /games/:id/review` | `{version,approved}`；無 expectedReviewedAt | `{version:StoredVersion}` | 明確的版本驗收決定；相同 approved 狀態重複操作保留原確認者／時間，反向決定按交易順序套用。撤銷會阻擋尚未公開版本，已公開歷史版本可回退 |
| `POST /games/:id/save` | `{version,requestId,data,revision,formatVersion}`；revision 為目前值 | `{saved:true,...ProgressSave}` | SAVE_REVISION_CONFLICT、REQUEST_ID_REUSED、SAVE_FORMAT_INCOMPATIBLE；相同成功請求可重試，規則見[存檔規格](save-compatibility.md) |
| `POST /games/:id/save/restore` | `{snapshotId,revision,requestId}`；本人目前 revision | `{saved:true,...ProgressSave}` | 恢復增加 revision，不回退 revision；本人限定及相容性限制同存檔規格 |
| `POST /accounts/:id/role` | `{role,expectedRole}`；僅 admin | `{account:ManagedAccount}` | 角色預期值不符為 STATE_CONFLICT，即使目標角色已相同仍拒絕；降級最後一位 admin 為 LAST_ADMIN_REQUIRED |

## 狀態競爭與重試

單款發布、回退和下架的兩個預期欄位**必填**；舊 `{version}`／`{}` 管理請求回傳 400 VALIDATION_ERROR，不能先讀最新狀態再替舊請求補欄位。請先讀單款摘要、讓操作者確認該狀態，再提交保存在確認視窗的值。未知欄位同樣回傳 400。此必要輸入變更僅影響管理 API，遊戲 SDK 呼叫不變。

服務使用 SQLite immediate 交易，檢查權限、讀取狀態、驗收／版本／存檔相容性檢查及更新在同一交易內完成。低層 `library.publish` 保留給維護／demo fixture 使用，管理 HTTP 入口均經 game-commands。它不代表 CLI 維護也需要畫面預期狀態。

發布若目前已上架目標版本，沿用 skipped 語義，無須比對舊預期值，但仍先檢查目前權限及版本存在。下架只有在目前已下架且 activeVersion 與預期相同時 skipped；已下架另一版本仍是衝突。其他預期值不符回傳 409 STATE_CONFLICT，details 只含目前 activeVersion／published。相同目標略過不重新寫 publishedAt，也不再次檢查存檔格式或驗收。這是狀態冪等，不是請求日誌；兩個狀態值不偵測曾修改後又改回相同狀態的 ABA。

兩名管理者競爭不同發布版本，或發布與下架互相競爭，後執行者若已過期就停止。UI 按 code 刷新資料及關閉過期確認，下一次操作需重新開啟確認，不代操作者接受新狀態、不自動重送。批量結果仍逐項顯示；刷新不重新提交失敗項目。

## 錯誤與相容性

HTTP 保留 status 和中文 `error`，附加 `{code,details?}`。details 僅為少量 primitive 值，不含私人存檔、帳號憑證或資料庫訊息。未預期的資料庫／程式例外記錄於伺服器，回傳 500 INTERNAL_ERROR；批量則該項 failed／INTERNAL_ERROR。

| code | 一般 HTTP status | 消費端動作 |
| --- | --- | --- |
| STATE_CONFLICT、REVIEW_REQUIRED、VERSION_NOT_NEWER | 409 | 刷新狀態並重新人工確認；不自動提交 |
| SAVE_REVISION_CONFLICT | 409 | 重新讀取本人存檔，再決定選擇／合併 |
| REQUEST_ID_REUSED | 409 | 停止以原 ID 提交不同內容 |
| SAVE_FORMAT_INCOMPATIBLE | 409 | 停止寫入／發布／恢復，檢查格式支援 |
| AUTH_REQUIRED | 401 | 刷新 session，必要時重新登入 |
| PERMISSION_DENIED、CSRF_INVALID | 403 | 刷新 session／權限或 CSRF，原操作不自動重送 |
| ORIGIN_REJECTED | 403 | 停止請求，修正來源，不當成角色失效 |
| RATE_LIMITED | 429 | 等待可重試時間，沒有自動修改重試 |
| LAST_ADMIN_REQUIRED | 409 | 先保留／指派另一位 admin |
| VALIDATION_ERROR、NOT_FOUND、INTERNAL_ERROR | 400／404／500 | 顯示安全說明，檢查輸入／資源或另行重試 |

完整集合另含 SDK 能力、連線、同時請求與 timeout 碼。前端不得比對中文訊息。ApiError 保留 status、可選 code 和通過 primitive 檢查的 details；舊回應只有 error 時仍顯示原文字，未知 code 保守停止。舊 SDK 的 Error.code 和 wire errorCode 仍為數字，machineCode 是附加欄位，沒有新增 SDK 方法或變更 protocol 版本。

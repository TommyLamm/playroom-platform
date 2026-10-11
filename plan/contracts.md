# 本輪共用外部契約

本文件是 01、02、06 的實作基準。protocol v1 的名稱、JSON wire 格式及 SDK 數字 `error.code` 保留。

實作範圍：01、02 已落地，平台廣告 saveFormats。06 已加入共用操作 schema／DTO、交易內權限與發布／下架預期狀態檢查、逐項批量機器碼，以及前端依 code 刷新／重新確認。完整操作及限制見 docs/command-contracts.md。

- SDK 發行 `1.1.0`、protocol `1`、最新 Manifest schema `2`、game tools `1.1.0` 分別版本化。既有 schema 1 / SDK v1 可繼續使用。
- `hello` 可附加 `sdkVersion` 與 `capabilities`；`init` 保留 `scoring`、`progress`、`diagnostics`，可附加 `capabilities`。能力缺少時由既有旗標推導；新 SDK 無能力的操作回傳 `null`，永不回報 saved。預覽始終不保存正式資料。
- Manifest schema 2 新增可選 `cloudSave: { readableFormats: number[], writeFormat: number }`，正整數、最多 32 個唯一格式，且 writeFormat 必須在 readableFormats。schema 1 不接受這個欄位。缺少宣告一律是相容性未知，保留舊行為，不假定只讀格式 1。以遊戲版本儲存的 Manifest 為權威。
- 02 使用 `manifest.cloudSave` 與 `cloudSaveCompatibility(manifest, format)`（shared/manifest.ts）。已宣告版本只能寫 `writeFormat`；讀取／覆寫現有存檔須支援現有 format，不能用新 revision 繞過限制。schema 2 的新遊戲自行驗證 data 並遷移。
- 寫入結果也須讓目前上架版本可讀，防止回退後仍開啟的新版本寫回不支援格式；GET 可指定已公開 version，橋接固定為執行中版本。格式改變與本人恢復在交易中先保存舊資料，保留最新 20 份／帳號／遊戲，恢復使用目前 revision 並加 1，禁止管理員代讀／代恢復。完整契約見 docs/save-compatibility.md。
- HTTP 保留 `{ error: string }`，附加 `code: string` 與安全 `details`。SDK wire 保留 `errorCode: number`，另加 `machineCode: string` 與 `details`，SDK Error 保留 `code` 數字並附加 `machineCode`。
- shared/errors.ts 機器碼：`STATE_CONFLICT`、`SAVE_REVISION_CONFLICT`、`REQUEST_ID_REUSED`、`SAVE_FORMAT_INCOMPATIBLE`、`CAPABILITY_UNAVAILABLE`、`AUTH_REQUIRED`、`PERMISSION_DENIED`、`RATE_LIMITED`、`VALIDATION_ERROR`、`NOT_FOUND`、`INTERNAL_ERROR`、`REQUEST_TIMEOUT`、`REQUEST_IN_FLIGHT`、`CONNECTION_INVALID`。新未知碼可以由 SDK 透傳；禁止前端比對中文文字。
- 06 發布／回退／下架必填 `expectedActiveVersion: string | null` 與 `expectedPublished: boolean`，與批量欄位一致。在交易內比對；目標已上架回覆 skipped；下架 skipped 仍需相同 activeVersion；非目標外部變更回覆 STATE_CONFLICT。缺預期欄位的舊管理請求為 400。機器码另含 REVIEW_REQUIRED、VERSION_NOT_NEWER、LAST_ADMIN_REQUIRED、CSRF_INVALID、ORIGIN_REJECTED。
- SDK `ready/startRun/finishRun/loadProgress/saveProgress` 名稱保留。ready 8 秒 fallback，request 15 秒 timeout；沒有自動重試。相同 snapshot 的 saveProgress 重試沿用 UUID requestId；不同 method/payload 重用 ID 必須被拒絕。握手與回應限定 parent/source、origin、connection。

工具發布使用自包含 archive、版本 metadata 與 SHA-256；遊戲 workflow 明確固定版本與校驗值。文件讀取仍追蹤平台 main，已發布遊戲 ZIP 不回寫。

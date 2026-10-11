# SDK、協定與工具版本

版本常數來自 `shared/versions.ts`。SDK 1.1.0、protocol 1、Manifest schema 2、game tools 1.1.0 是不同用途；平台 package version 或 SQLite user_version 均不能替代它們。

| 使用組合 | 支援行為 |
| --- | --- |
| 舊 SDK + 本平台 | v1 hello/init/request/response、成績及舊有能力旗標繼續支援；數字 error.code 保留 |
| SDK 1.1.0 + 舊 v1 平台 | 缺 capabilities 時沿用 scoring/progress/diagnostics 旗標；progress/diagnostics 缺少時操作回傳 null，ready 顯示不可用 |
| SDK 1.1.0 + 本平台 | ready 提供 sdkVersion/protocolVersion/capabilities；錯誤附加 machineCode/details |
| schema 1 + 本平台 | 舊遊戲正常驗證，未宣告存檔格式是 unknown |
| schema 2 + 舊平台或舊驗證工具 | 舊 schema 驗證拒絕，須先升級平台／工具；不能假定新存檔宣告已生效 |

01 的 schema 2 宣告及傳輸契約與 02 的正式格式檢查、遷移快照、本人恢復與發布／回退檢查已提供。平台廣告 `saveFormats`，完整限制與保留規則見[存檔相容性](save-compatibility.md)。格式宣告不能取代遊戲 data 驗證。發布／下架已統一預期狀態檢查與機器碼，管理操作見 [操作契約](command-contracts.md)；舊平台缺機器碼時以原數字 status 保守處理。

protocol v1 的 `hello` 由遊戲送 parent，唯一允許 `*` 的訊息；`init` 回覆 UUID connection、authenticated/guest/preview、scoring，以及可選 progress/diagnostics/capabilities。SDK 固定父來源、parent window 與 connection。`request` 包含 UUID requestId、method 與 payload；`response` 保留 result/error/errorCode，另附機器碼 machineCode 與安全 details。共同型別及 runtime 驗證位於 `shared/protocol.ts`；payload 規則位於 `shared/sdk-payloads.ts`。

| 方法 | payload | 成功／不可用 |
| --- | --- | --- |
| startRun | {} | {runId} / null |
| finishRun | {runId,score} | {saved:true,runId,score,finishedAt} / null |
| loadProgress | {} | {data,revision,formatVersion,gameVersion,updatedAt} / null |
| saveProgress | {data,revision,formatVersion} | {saved:true,...progress} / null |

`ready` 最多等 8 秒，之後提供 standalone fallback；請求 15 秒逾時，SDK 不自動重試。相同保存快照回應遺失時使用原 requestId；同時重複送相同 ID 回報 REQUEST_IN_FLIGHT，不同 method/payload 重用回報 REQUEST_ID_REUSED。橋接重試成功回覆沿用原結果，失敗後同 payload 可重试；伺服器仍做 revision 和 idempotency 檢查。讀取拒絕與成功 null 不可混淆。訪客／standalone 不保存；預覽只模擬並始終回傳 null 作為保存結果。

HTTP 錯誤保留中文字 `error` 與 status，加 `code`；SDK Error.code 繼續是數字 status，新增 Error.machineCode。遊戲應根據 SAVE_REVISION_CONFLICT 重新讀取／合併、REQUEST_ID_REUSED 停止重試該 ID、SAVE_FORMAT_INCOMPATIBLE 停止覆寫、AUTH_REQUIRED/PERMISSION_DENIED 停止帳號操作。舊平台缺機器碼時使用原數字 code 的保守流程。

## 產出与固定工具

正式 SDK 原始碼在 `sdk/index.ts`。執行 `npm run sdk:build` 產出相同 JS/d.ts 至 `examples/starter` 與 `artifacts/sdk/1.1.0`；`npm run sdk:check` 驗證提交的生成檔未漂移，CI 亦執行。遊戲僅複製 JS/d.ts，以相對 ES module 匯入，不需安裝平台 runtime。

平台 checkout 先 `npm ci` 固定依賴，再執行 `npm run sdk:build`、`npm run game:schema`、`npm run game:tools`，產出 `artifacts/playroom-game-tools-1.1.0.zip`、SHA-256 sidecar、`templates/game-tools.lock.json`。工具 ZIP 包含自包含 Node 24 pack/validate CLI、SDK、Schema 與 metadata；不需 npm runtime 依賴。metadata 記錄工具／SDK／協定／Schema 版本、來源與 lockfile 雜湊及各檔 SHA-256。打包使用固定檔案順序、時間及權限，相同內容的 ZIP 不受檔案 mtime 影響。

第一次接入工具需要在平台 checkout 本地產生經驗證產物，將工具 ZIP 複製至遊戲 repo `.playroom/tools/playroom-game-tools-1.1.0.zip`，lock 複製至 `.playroom/game-tools.lock.json`，兩者一起 commit；工具 ZIP 放成品目錄之外。workflow 使用已固定工具，驗證整包 SHA-256、metadata 版本與逐檔雜湊，記錄版本及 SHA-256，通過後才發布 game.zip。範本不依賴尚未發布的遠端資產。更新平台 main 不改變遊戲 repo 固定的驗證器；升級工具需以版本＋ZIP＋lock 的明確 commit 進行。

平台管理者可另將已驗證工具 ZIP、SHA-256 與 SDK 發布成 `game-tools-v1.1.0` 不可覆寫 Release。首次公開 Release 尚需管理者明確發布；本輪本地生成不代表遠端已存在。已公開的工具版本不可重建後更換 checksum；工具規則變更須增加 GAME_TOOLS_VERSION，再生成及發布新版本。最新開發規格的連結始終讀 main，與執行工具固定版本分開。

## 升級方式

只需要 capability/error 提示時更新包內 SDK 並提高遊戲 version，保留 schema 1 亦可；不回寫既有已發布 ZIP。使用新存檔格式保障時，先確認平台完成 02 且 init 宣告 saveFormats，再升級 tools，把 Manifest 改 schema 2 並宣告 cloudSave readableFormats/writeFormat。可讀格式必須包含寫入格式；遊戲仍需驗證私人 data，遷移後不能把不支援的新格式覆蓋回舊格式。schema 1 或未宣告能力不代表已驗證相容。

遊戲版本回退不回退玩家資料；已知存檔不相容時拒絕發布／回退。本人登入後的快照恢復使用目前 revision，成功後 revision 增加，保留最新 20 份快照。localStorage 仍由遊戲負責，不在雲端保障範圍。

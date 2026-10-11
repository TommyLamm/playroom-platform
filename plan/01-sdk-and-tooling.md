# 01 — SDK、協定及驗證工具版本化

狀態：已完成，SDK／工具／舊 SDK 與桌面／手機預覽相容性驗證通過。優先程度：高。

## 現況與目標

原先 SDK 位於 `examples/starter/playroom-sdk.js`，型別另存為 `.d.ts`，平台橋接自行定義驗證，Release workflow 每次取得平台 main 工具。現由 `sdk/index.ts` 與 shared 純協定來源生成 SDK，工具版本與 SHA-256 lock 固定於遊戲 repository。

目標是讓已發布遊戲能持續運作，讓 SDK 與驗證工具的來源、版本及支援能力可辨識、可重現。

## 子任務

- [x] **01.1 盤點現行契約。**列出 hello／init／request／response、四個 SDK 方法、訪客／登入／預覽行為、逾時及重試語義，建立 protocol v1 的相容基準。
- [x] **01.2 分清版本用途。**分別定義 SDK 發行版本、通訊協定版本、Manifest schema 版本及驗證工具版本；記錄與平台版本的支援關係，禁止把這些版本混成一個數字。
- [x] **01.3 建立共用協定來源。**將訊息型別與驗證規則放到獨立的契約模組，供 SDK 產物與平台橋接使用。遊戲 ZIP 內仍能使用自包含、相對路徑載入的 ES module。
- [x] **01.4 建立可重現產物。**由正式 SDK 原始碼產出 JS 與 `.d.ts`，範例使用同一產物；提供帶版本的 SDK／驗證工具發布方式，避免要求所有遊戲安裝整個平台的執行期依賴。
- [x] **01.5 補齊能力協商。**保留現行 v1 行為，新增 SDK 版本與能力資訊時以相容方式處理缺少欄位的舊 SDK。缺少功能須明確回報不可用，不能誤顯示已保存。
- [x] **01.6 調整 Release workflow。**遊戲的發布流程明確指定驗證工具版本，記錄使用的版本及校驗資訊；升級工具需是可追蹤變更。開發者仍從 `main` 閱讀最新規格。
- [x] **01.7 建立升級指引。**說明何時只更新 SDK、何時必須升級平台、何時需變更 Manifest；保留已發布 ZIP，不回寫既有遊戲版本。

## 介面與相容性要求

- 初期保留 `ready`、`startRun`、`finishRun`、`loadProgress`、`saveProgress` 的對外名稱與現行保存語義。
- 機器錯誤碼沿用 06 的統一設計；存檔能力宣告與 02 一起定義。
- 不以強制載入線上最新版 SDK 取代遊戲包內固定版本，避免平台更新立即改變所有遊戲行為。
- 若新增必要能力導致舊平台無法支援，匯入或接入時給出清楚原因，不允許靜默部分成功。

## 驗證與驗收

- [x] 保留代表性舊 SDK fixture，驗證舊 SDK 搭配新平台仍可遊玩及提交成績。
- [x] 驗證新 SDK 遇到不支援存檔或診斷的平台時能正確降級。
- [x] 驗證錯誤來源、錯誤 connection、逾時與相同 requestId 重試。
- [x] 驗證型別宣告與實際 SDK 產物一致，範例不再維護另一份手寫實作。
- [x] 固定工具版本後，相同遊戲成品的打包與驗證結果可重現；更新 `main` 不應自行改變該版本的驗證行為。
- [x] SDK、開發指南、Release workflow 與 `templates/game-agent-template.md` 同步更新；線上規格連結仍指向 `main`。

## 依賴與交付

與 02、06 先共同確定契約；橋接內部拆分配合 04。交付內容包括共用契約、版本化 SDK／工具產物、相容矩陣、舊版本 fixture 及升級文件。本項不要求先拆出新的 repository 或公開 npm 套件。

## 2026-10-11 交付與證據

- 共用基準在 plan/contracts.md；版本軸在 shared/versions.ts；v1 wire guard 在 shared/protocol.ts；payload驗證在 shared/sdk-payloads.ts。Manifest v1保留，v2接受可選cloudSave讀／寫宣告，沒有宣告是unknown。
- 正式SDK原始碼sdk/index.ts；sdk:build生成JS及d.ts，sdk:check與CI檢查漂移。凍結舊SDK fixture在tests/fixtures-sdk-v1.js，真實跨來源legacy SDK已通過桌面／手機遊玩及帳號成績提交。
- game:tools生成自包含Node24工具archive、SDK／schema、metadata檔案和來源校驗資訊、SHA256 sidecar與game-tools.lock.json。香港／Honolulu時區及不同mtime的相同遊戲內容產生相同ZIP；archive連續生成兩次相同hash；temp外部目錄無npm runtime執行pack/validate通過。workflow驗證固定archive／metadata，錯checksum、路徑或版本皆拒絕；無main工具下載。
- 34項相關unit/integration全部通過，涵蓋SDK、contracts、schema、release、archive、cloud-save（包含子測試）。最終tool metadata調整另重跑8項全部通過。sdk:check通過；build在sandbox外通過；check:boundaries通過（106檔）。
- 最終共享工作區npm run typecheck及sdk:check均通過；並行03編輯期間出現的兩處typeerror已由owner修正。E2E：桌面／手機正式雲存檔重試與隔離、舊SDK提交成績、生涯共6項通過；另外4個admin preview流程在並行03讀取API／component整合後由frontend owner同輪重跑全部通過（cloud-save失敗載入／暫存預覽及SDK診斷各兩裝置）。本項10個必要瀏覽器情境均已有通過證據，03其餘整組E2E失敗由owner另記錄；不能把本項結果當成完整CI通過。
- Windows sandbox阻擋Vite realpath與GitBash namedobject；核准sandbox外相同build／release測試成功，未以跳過測試掩蓋問題。

01 交付當時限制：工具／SDK僅本地產生、沒有建立公開GitHub Release；第一次bootstrap需複製生成ZIP及lock到遊戲repo。當時 02 存檔保障與 06 HTTP 業務服務未實作。後續 02 已補格式限制、快照／本人恢復與發布相容性檢查，並廣告 saveFormats；06 已補交易內發布／下架預期狀態、DTO／機器碼與前端重新確認，進度與驗證以各項交付紀錄為準。

01 階段完成時依使用者要求停止，當時未開始 06／04 後端。該階段產物 `artifacts/playroom-game-tools-1.1.0.zip` 的 SHA-256 為 `771927dae11f12a1cc6d048cb89b2c1a6646e1133e44378c2417ee02a9fa48c6`，當時與 lock 一致；此值是歷史紀錄。當前產物校驗值以 `artifacts/playroom-game-tools-1.1.0.zip.sha256` 與 [工具 lock](../templates/game-tools.lock.json) 為準。後續 04、06、07 均已完成，完整整合驗證見 [最新進度](README.md#2026-10-11-最新進度)。

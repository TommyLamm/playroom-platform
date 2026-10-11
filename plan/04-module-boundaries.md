# 04 — 前後端功能模組與責任拆分

狀態：已完成前端／橋接及 04.6–04.8 後端拆分，回歸與邊界驗證通過。優先程度：高。

## 規劃時現況與目標

`client/main.tsx` 約 1,454 行，混合路由、帳號、大廳、播放器、後台與平台更新；`client/admin-sources.tsx` 約 1,170 行。後端已按部分功能拆檔，但不少 register 函式仍同時處理 HTTP、業務規則及 SQL。

目標是按功能責任降低修改範圍，讓 HTTP、React 或資料庫細節不成為共用業務規則的必要依賴；不以單一檔案行數作為成功指標。

## 子任務

- [x] **04.1 記錄模組邊界。**劃分帳號／權限、遊戲目錄、來源／匯入／發布、遊玩／成績、雲端存檔、營運統計、平台維護。每個模組記錄擁有的資料、對外操作及允許依賴。
- [x] **04.2 縮小前端入口。**將各頁面移出 main，入口只保留掛載、路由與頂層 provider。先維持既有路徑、畫面和功能，再做行為變更。
- [x] **04.3 拆出共用環境。**Session、通知與共用 UI 放到明確位置，功能頁不能反向匯入應用入口；權限仍使用既有共用 permission 定義。
- [x] **04.4 拆分後台流程狀態。**來源新增、批次進度、遊戲列表、預覽佇列及發布確認各自管理狀態。只有跨頁選取等確實共用的狀態才上移；不把所有 state 搬進另一個超大 hook。
- [x] **04.5 拆分遊戲橋接。**把訊息契約、正式操作、預覽模擬及 React 生命週期分開；共享資料驗證與計分規則，避免預覽與正式各維護一套邏輯。
- [x] **04.6 縮小後端 app 組裝器。**登入／session、遊戲目錄、遊戲資源與 OTA 代理按模組註冊；保留全域安全 hook、依賴建立和關閉順序於組裝層。
- [x] **04.7 抽出業務操作。**優先整理發布、下架、確認、存檔與匯入。HTTP 層只負責輸入、身份與回應，服務層決定規則及交易，資料查詢集中在各模組內。
- [x] **04.8 限制跨模組直接操作。**其他模組透過明確服務或讀取介面存取資料，不任意修改別人的表；複雜報表可以保留 SQL，避免為抽象而建立通用 repository 框架。
- [x] **04.9 加入輕量邊界檢查。**使用既有工具或簡單檢查阻止循環依賴、功能頁匯入 main、shared 匯入 server，以及底層模組匯入 UI。

## 重構安全要求

- 純搬移提交不修改 API 回應、資料表、權限或發布政策；行為改動在後續提交單獨驗收。
- 保留播放器 identity、session 切換、取消請求、事件 listener 和計時器清理行為。
- 保留後台頁面條件、關閉視窗後任務繼續、角色切換清除畫面等既有使用體驗。
- 不建立目前沒有消費端的泛用插件系統、事件匯流排或多層抽象。

## 驗證與驗收

- [x] 型別檢查、建置與既有相關整合測試通過。
- [x] 登入／登出、大廳、播放器、匯入、預覽、發布、回退與權限 E2E 行為不變。
- [x] 同一業務操作由單款及批量入口呼叫同一服務。
- [x] 預覽與正式路徑共用契約和驗證，但預覽依然不寫入正式資料。
- [x] 模組圖及入口清楚，沒有新增循環依賴；新增一種發布入口不必複製發布規則。

## 依賴與交付

此項可先做純搬移，後續配合 01、02、03、06、07 逐步抽出服務。交付責任說明、模組入口、邊界檢查與既有行為的回歸結果。純內部搬移不必改變遊戲接入文件；若實際改變外部行為，仍須遵守範本同步要求。

## 2026-10-11 前端純搬移階段紀錄

入口與責任圖見 `docs/module-boundaries.md`。`main.tsx` 剩掛載／路由／providers，各功能、來源流程、預覽佇列與操作確認已獨立。此階段保留既有全量 overview、輪詢與 API，03 的資料行為變更另記錄；API error 新增 code/details 的相容傳遞屬 06 接入。

`npx tsc --noEmit`、`npm run check:boundaries`（100 檔）、`npm run build` 通過。桌面 Playwright：platform、admin-ui、game-updates、progress-preview 共 11 通過／1 因僅適用手機而跳過。涵蓋登入登出、大廳、播放器、來源新增／封存、跨頁選取、匯入、連續預覽、發布／回退／下架與角色導航。當時完整 CI／手機／其餘 E2E 尚待整合交付，因此尚未勾選整體驗收；後續完成證據見下節及 [最新進度](README.md#2026-10-11-最新進度)。

Windows sandbox 首次阻止 Vite realpath 與 fixture rename；同一 build／E2E 在核准的 sandbox 外重跑成功。沒有改寫測試規避檔案權限限制。

03 整合後 typecheck／build／邊界檢查（106 檔）通過；後台相關後端 25 測試通過，desktop/mobile 平台／來源／更新／分頁生命週期共 20 通過／2 裝置限定跳過。SDK 與正式／預覽的 cloud-save、progress-preview 8 項 desktop/mobile 測試全部曾通過；01 的 34 相關單元及 frozen SDK 證據見 01 文件。當時 04.6–04.8 及統一發布服務尚未實作，包含這些要求的綜合模組驗收維持未勾；完整 CI 與 Docker 未因相關測試通過而視為已執行。

06 後續已抽出 game-commands 的發布／下架／確認服務及 command-context 交易內權限檢查，單款和批量共用發布服務並完成競爭驗收，因此勾選該項。06 交付當時，04.6–04.8 其餘帳號／資源／OTA 組裝及匯入模組責任仍未全部完成；其後完成證據見下節。

## 2026-10-11 後端拆分交付

04.6–04.8 本次完成。`app.ts` 保留依賴建立、全域安全／錯誤 hook、靜態前端、health 與原關閉順序；帳號／session、遊戲目錄、assets、OTA 各有註冊入口。登入／session persistence、預覽授權、存檔／快照／恢復、來源與匯入批次規則移至不依賴 Fastify 的服務；ImportQueue 從 library 分離，仍呼叫 library 的版本安裝。單款／批量共用 queue 及 06 發布服務，批次 transaction commit 後才啟動下載。管理讀取 SQL 集中至 admin-data-service，保留舊讀取 export。

成績／收藏／訪客事件透過帳號與遊戲的明確讀取介面取得資料。資料表寫入擁有者列於邊界檢查，唯讀跨表報表 SQL 保留；migration、CLI 管理員初始化及備份 sanitation 是明列例外。邊界檢查加入 CI，新增負向驗證確實阻止跨表寫入（SQL／Drizzle alias）及服務匯入 HTTP／路由直接 persistence；動態 SQL、動態 import 與間接 alias 仍需要人工 review，不宣稱完整語意檢查。

驗證：最終 `npm test` 178／178 通過，`npm run typecheck`、`npm run build`、`npm run sdk:check`、`npm run check:boundaries`（125 檔）與 diff whitespace 通過。完整 desktop/mobile Chrome E2E 70 通過／4 裝置限定跳過；最後的讀取介面搬移另以最終原始碼重跑 career、player-library、settings-analytics 共 10 項 desktop/mobile E2E，全部通過。涵蓋登入／登出、權限／session 競爭、來源／匯入批次／關閉、預覽／發布／回退／下架、存檔／快照／備份還原及 OTA。

首次 sandbox 內測試受到 Windows fixture rename、localhost／子程序限制；相同既有測試在核准的 sandbox 外通過，未改寫 production 或測試來迴避限制。可重現命令與結果在 `output/verification-04-unit.log`、`verification-04-build.log`、`verification-04-e2e.log`、`verification-04-readers-e2e.log`。

依先前原始碼上傳驗證授權，於 `/root/playroom-validation-06.vyNNQo/validation-04` 上傳 268 檔快照（排除資料、環境、憑證、Git 及 dependencies）；SHA256 `f8bf26792f7d08b1468173c29c1c12aa4578f2560778d82888c5a9de4f8ccddd`。實際 Dockerfile build 的 Linux Node 24 typecheck／build／178 測試全部通過；驗證專用 build stage 的 SDK／125 檔邊界檢查通過。原 smoke script 僅改用專用 tag，demo seed、備份、還原與重啟後兩款遊戲持久化全部通過。測試容器、volume、兩個專用映像標籤已清理；原 `/root/playroom-platform` checkout 仍乾淨。快照與日誌保留於獨立目錄，證據已下載至 `output/verification-04` 及 `verification-04-docker.log`。

本次沒有重跑 Linux Chromium E2E，瀏覽器驗證為上述本機 desktop/mobile Chrome 結果；06 的 Linux Chromium 結果只代表先前快照。未觸發 GitHub Actions、未提交 commit、未部署或對外發布。純內部拆分沒有變更遊戲接入／發布要求，已檢查 game-agent-template，無須修改外部規格。

04 交付當時，下一項為 07 安裝日誌、中斷恢復與版本保留，仍保留原本匯入重啟標記失敗和人工維護政策。後續 [07 已完成](07-import-recovery.md#2026-10-11-交付記錄)，並通過完整 Linux Chromium E2E；最新整合證據見 [最新進度](README.md#2026-10-11-最新進度)。其他既有模組內部（例如成績或帳號設定）不因本次拆分而引入多層架構。

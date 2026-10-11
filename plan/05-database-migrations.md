# 05 — 資料庫 schema 與 migration 整理

狀態：已完成，歷史 v1–v10 驗證通過；後續 v11／v12 升級與備份還原驗證見 [02](02-save-compatibility.md#2026-10-11-交付與驗證) 與 [07](07-import-recovery.md#2026-10-11-交付記錄)。優先程度：中；新增資料表前完成必要基礎。

## 規劃時現況與目標

`server/db.ts` 同時放置部分 Drizzle 定義、連線初始化與 v1–v10 migration。部分新資料表只有 SQL 定義，部分資料庫約束未完整反映於 ORM。備份還原另外維護可接受 schema 版本清單。

目標是讓既有資料可靠升級，避免新增表或調整約束時漏改另一處版本資訊。保留 SQLite 與目前的資料內容。

## 子任務

- [x] **05.1 建立現行結構清單。**從全新 v10 資料庫列出表、索引、外鍵、唯一性、COLLATE 及 CHECK 約束，對照程式定義，記錄差異。
- [x] **05.2 拆分 migration。**將既有升級按版本抽成有順序的單位，由 runner 統一執行。保留每次升級的交易邊界，以及 v8 重建 users 時的外鍵處理順序。
- [x] **05.3 凍結歷史語義。**不得順手修寫已發布 migration 的效果；新的實質結構變更使用下一個版本。由 v0 建庫也沿用同一條受測路徑。
- [x] **05.4 集中版本資訊。**統一定義目前 schema 版本與可支援的舊版本範圍，供啟動、備份還原及測試使用。舊程式遇到較新版本仍拒絕開啟，不嘗試降級。
- [x] **05.5 明確結構權威。**以執行 migration 得到的實際結構為部署真相；補齊程式端表定義及約束說明。複雜查詢可保留 raw SQL，不強制全部轉寫 ORM。
- [x] **05.6 偵測結構漂移。**比較全新建庫與代表性舊版本升級後的結構，檢查約束和索引而不只檢查 user_version；確認 ORM 使用到的表／欄位存在。
- [x] **05.7 明確失敗與恢復。**測試 migration 中斷或失敗後版本標記、交易與連線清理；重新啟動不得把未完成升級當成成功。升級前備份及舊版回退需還原備份的要求保留。

## 驗證與驗收

- [x] 全新建庫與受支援舊版本逐級升級後，最終 schema 相同。
- [x] 代表性舊資料 fixture 包含帳號、角色、session、遊戲、版本、收藏、生涯及存檔；適用欄位與資料保留。
- [x] 使用符合當時結構的 fixture，不只把最新版資料庫的 user_version 改小冒充舊版本。
- [x] 大小寫不敏感帳號唯一性、角色 CHECK、外鍵、複合唯一性及自增 ID 行為保留。
- [x] `foreign_key_check` 與完整性檢查通過，較新 schema 被清楚拒絕。
- [x] 所有仍宣告支援的備份版本可驗證及還原；session／預覽 grant 仍不恢復為有效授權。
- [x] 抽離 migration 本身不需要改寫現有使用者資料，不造成無必要的 schema 升版。

## 依賴與交付

05.2–05.4 是 02 快照與 07 安裝日誌的前置基礎。已交付 `server/database/` migration runner、版本常數、完整 ORM 定義、[v10 實際結構清單](../docs/database-schema-v10.json)、`tests/fixtures/database/v1.sql` 至 `v10.sql` 真實舊結構及 `tests/database-migrations.test.ts`。

驗證：資料庫專項 27/27 通過，涵蓋所有歷史版本升級／還原、schema 漂移、適用資料保存、外鍵／完整性、唯一／CHECK／自增、失敗 rollback/restart/close、較新版本拒絕及不支援／外鍵失效備份拒絕。連同 auth/settings/platform 回歸共 39/39；typecheck/build 通過。新增版本後仍須重跑此套測試。歷史 SQLite PRIMARY KEY 的 notnull metadata 與 ORM 宣告差異、增加 migration 方式及備份回退要求見[維護指南](../docs/database-maintenance.md)。測試不聲稱可修復人工改表或已損壞的資料庫。

純內部整理不改變遊戲規格。若支援範圍或部署升級要求改變，同步 README、維護文件及 OTA 相關說明。

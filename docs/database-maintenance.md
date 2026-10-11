# 資料庫結構、升級與還原

平台維持 SQLite、單一 app 實例及 `PRAGMA user_version`。部署結構的權威是已執行 migration 後的實際 SQLite schema；Drizzle 定義供程式讀寫，不用 ORM 推導工具重新建立或修補正式資料庫。

`server/database/migrations/index.ts` 是有序清單，`server/database/version.ts` 從清單取得目前版本及支援的備份版本。v0 建庫與舊庫均走 `runMigrations` 的同一路徑。05 純抽離保持 schema v10；02 新增 schema v11 快照；07 安裝日誌升至 schema v12。

## v10 結構盤點

[完整結構清單](database-schema-v10.json) 包含 19 張表的建表 SQL、欄位、主鍵、外鍵、全部索引、唯一性、索引 COLLATE／排序及 CHECK。清單由空 v0 依序執行已發布 v1–v10 後擷取，保留為歷史基準。

| 表 | 主鍵／額外唯一性 | 外鍵 | 一般索引／CHECK |
| --- | --- | --- | --- |
| users | 自增 id；username 唯一、NOCASE | 無 | role 限 player/game_manager/analyst/admin |
| sessions | token_hash | user_id → users | sessions_expiry |
| repositories | 自增 id；full_name 唯一 | 無 | 無 |
| games | id；repository_id 唯一 | repository_id → repositories | 無 |
| versions | 自增 id；(game_id,version) 唯一 | game_id → games | 無 |
| import_jobs | id | repository_id → repositories | 無 |
| previews | token_hash | 無 | previews_expiry |
| plays | id；(session_hash,request_id) 唯一 | user_id → users；game_id → games | plays_user_game |
| runs | id；(play_id,request_id) 唯一 | play_id → plays | runs_play_finished |
| best_scores | (user_id,game_id,board_id) | user_id → users；game_id → games；run_id → runs | best_scores_ranking |
| favorites | (user_id,game_id) | user_id → users；game_id → games | favorites_user_created，created_at DESC |
| account_settings | user_id | user_id → users | career_visibility 限 public/limited/private |
| score_submission_metrics | (day,game_id,outcome) | game_id → games | outcome 限 success/rejected/server_error；count ≥ 0 |
| operational_state | key | 無 | 無 |
| visitor_events | 自增 id；(visitor_id,request_id) 唯一 | user_id → users；game_id → games | time(occurred_at DESC,id DESC)、visitor、game；kind 限 page_view/game_open |
| github_owners | login，NOCASE | 無 | 無 |
| import_batches | id | 無 | 無 |
| import_batch_items | 自增 id；(batch_id,repository_id,release_id) 唯一 | batch_id → import_batches；repository_id → repositories；job_id → import_jobs | import_batch_items_batch |
| cloud_saves | (user_id,game_id) | user_id → users；game_id → games | revision > 0 |

整理前 ORM 缺少 plays、runs、best_scores、favorites、account_settings、score_submission_metrics、operational_state、visitor_events、cloud_saves；users／github_owners 的 NOCASE、複合唯一性、索引與 CHECK 亦未完整表示。`server/database/schema.ts` 已補齊，NOCASE 欄位用 custom type 明確保留 collation。複雜報表可繼續使用 raw SQL。

歷史 SQLite 的 TEXT PRIMARY KEY 及 INTEGER PRIMARY KEY 可在 `table_info.notnull` 顯示 0；Drizzle 的 `.primaryKey()` metadata 將其視作必填。此差異明示於測試，不改寫歷史資料。previews.game_id/version、import_jobs.game_id/version 及 versions.reviewed_by 歷來不是外鍵，不補造約束。github_owners.kind/import_batch_items.outcome 歷來沒有 CHECK，ORM 型別不宣稱 SQLite 會檢查。

## 新增 migration

1. 新建下一個編號的 `server/database/migrations/NNN.ts`，export `Migration`，含 version、name 及 up(sqlite)。不要改寫 001–010 的 SQL、條件、資料效果或交易邊界。
2. up 內以同一 transaction 執行變更，最後設 `PRAGMA user_version = N`；只在交易成功後視為完成。不把檔案操作混入 migration。
3. 加入 registry 的 import 與最後一項；runner 要求從 1 起連續排序。版本常數與備份清單隨 registry 更新，無須另抄版本陣列。
4. 補 schema.ts 定義與結構說明。新增實質結構才升版；不因搬檔升版。
5. 新增 fixture／資料保存測試，重跑 fresh/舊版升級、ORM、foreign_key_check、integrity_check 及還原。不要重新生成歷史 fixture 來掩蓋漂移。

v8 保留 `foreign_keys=OFF` → transaction 內複製 users 與保留 sqlite_sequence → transaction 內 foreign_key_check → commit／rollback → finally `foreign_keys=ON`。外鍵開關不能移入已開始的 transaction。失敗保留 v7 及原表；openStore 關閉失敗連線。

## 升級、失敗與回退

部署前使用原版平台建立完整備份，另存至受控位置。啟動逐一完成每個版本的交易；失敗保留最後成功版本，重啟由該版本續行。舊平台遇較新 user_version 明確拒絕並關閉連線，不嘗試降級。

回退必須停止服務、保留現有資料並將升級前備份還原至空 DATA_DIR／新 volume，再啟動原平台。直接調低 user_version 不能回退 schema，也不能作為舊版 fixture。OTA 同樣以備份還原處理回退，維持現有單實例及資料目錄鎖。

備份／還原版本由 registry 集中驗證（本歷史基準支援 v1–v10）。還原先驗證雜湊、integrity_check、foreign_key_check 及必要資源，再複製至空目錄並走正常升級。備份清除 sessions/previews，中斷匯入變為 failed；還原不復活登入或預覽授權。帳號、角色、遊戲、生涯、收藏與適用版本的存檔保留。

02 新增 migration 011（cloud-save-snapshots）：cloud_saves 增加 nullable source_snapshot_id 以保存最近恢復請求身份（來源快照淘汰後仍能重試），及 (game_id,format_version) 索引；cloud_save_snapshots 保存原存檔資料／版本／時間／請求資訊、captured_at 與 reason。主鍵 id 自增，外鍵 user_id→users、game_id→games，(user_id,game_id,revision) 唯一，CHECK revision>0、reason∈migration/restore，索引 (user_id,game_id,id DESC)。source_snapshot_id 不設快照外鍵，以便有界淘汰。migration 011 的 DDL 與 user_version 同交易，既有存檔原值不变、無初始快照。v10 歷史清單及 fixture 保持不變。

目前支援 v1–v11 備份，v11 的完整 SQLite 快照包括私人進度及遷移／恢復快照；升級前備份可還原至新目錄再升級。快照保留最新 20 份／帳號／遊戲，容量統計與本人恢復程序見[存檔相容性](save-compatibility.md)。

## 驗證證據

`node --import tsx --test tests/database-migrations.test.ts`：27 項通過。真實 v1–v10 凍結 DDL 各自包含當時可用資料；逐級升級後與 fresh schema 的 SQL、欄位、外鍵及索引一致。每版備份還原保留資料並撤銷授權。另驗證 NOCASE、角色 CHECK、外鍵、複合唯一、自增 ID、DDL／version rollback、v8 FK 失敗與重啟、close、較新版本拒絕、ORM 覆蓋及拒絕不支援／外鍵失效備份。

連同 `tests/auth.test.ts`、`tests/settings.test.ts`、`tests/platform.test.ts` 的回歸共 39/39 通過；既有 auth v1 與 settings v4 測試亦改用凍結歷史 DDL，避免以最新版改 user_version 冒充舊庫。`npm run typecheck` 與 `npm run build` 通過。Windows sandbox 的 rename/realpath EPERM 經授權在 sandbox 外重跑驗證解決，未修改產品程式繞過限制。

測試驗證受支援結構，不能取代部署前備份，也不宣稱可以修復人工改表、磁碟損壞或不符合歷史 schema 的資料庫。


## schema v12 安裝日誌

Migration 012 新增 installations：UUID 主鍵；nullable job_id 唯一且外鍵至 import_jobs；game_id／version、staging_path、Manifest／來源／檔案雜湊清單 JSON、state／reason／時間。state CHECK 限 prepared／registered／completed／quarantining／quarantined／blocked，索引 (game_id,version)。未登記成品也需記錄意圖，因此 game_id／version 不設版本外鍵。DDL 及 user_version 同交易，既有資料不變；001–011、v10 歷史盤點及凍結 fixture 不改寫。

目前支援 v1–v12 備份；v12 快照只保留已登記版本的完成日誌，不帶 staging 或隔離區，還原不依賴兩者。操作與保留規則見[匯入恢復](import-recovery.md)。

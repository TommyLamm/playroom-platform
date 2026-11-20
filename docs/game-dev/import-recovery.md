# 匯入恢復與版本保留

schema v12 新增 installations，維持單一 app、SQLite 與 .platform.lock。恢復不自動發布、不改變 activeVersion 或人工確認，也不覆寫已登記版本。

## 安裝階段與不變條件

1. 解析 Release、下載 ZIP 並核對 digest；解壓驗證限制、路徑、Manifest 及 tag。
2. 核對來源、遊戲 ID 與榜單規則；目錄只能在 DATA_DIR/staging。
3. 保存每個檔案的相對位置、長度及 SHA-256，flush 檔案；以 SQLite synchronous=FULL 寫入 prepared 日誌。
4. 移至由 Manifest 推導的 games/id/version，flush 父目錄，再核對成品；目的地存在則拒絕覆寫。
5. 同一 transaction 登記 games／versions 並將日誌設為 registered，不發布。
6. 下一 transaction 完成日誌與關聯工作。建立持久化意圖後，失敗成品保留供恢復。

日誌含 UUID、可選工作 ID、遊戲／版本、可信 staging 相對位置、Manifest、repository／Release／asset／tag／原包雜湊、全檔案清單及時間。恢復重新核對驗證後的成品，不依賴 ZIP、不重新下載附件。Linux fsync 檔案及父目錄；Windows flush 檔案，但 Node 不提供相同的目錄 fsync。斷電保證仍取決於檔案系統及硬體，不能修復磁碟或人工改壞的資料庫。

## 啟動核對

取得平台鎖、完成 migration 後，在佇列與 HTTP listener 啟用前核對未結案日誌。

| 版本記錄 | 成品 | 處理 |
| --- | --- | --- |
| 無 | 只有完整 staging | 再驗證，移入、補登記、完成工作 |
| 無 | 只有完整正式成品 | 再驗證，補登記、完成工作 |
| 有且來源／Manifest 一致 | 正式成品完整、無衝突 staging | 只補正工作與日誌 |
| 無 | 不符、缺失或兩處同時存在 | 隔離可辨認成品，工作 failed／quarantined |
| 有 | 來源不同、正式檔案損壞／缺失、衝突 staging | blocked；保護已登記檔案，需維護或還原備份 |
| 任意 | 非法路徑、祖先符號連結或不能安全操作 | blocked，不操作資料目錄外檔案 |
| 無日誌 | 孤立正式目錄或 staging | 只列診斷，指定 ID 才隔離，不憑名稱補登記 |

無日誌的中斷下載／驗證工作維持 interrupted／failed，需重新提交。已結案日誌不在每次啟動重掃，但診斷與備份仍核對檔案。工作與日誌來源不符會拒絕恢復。

## 診斷與修復

先停止 app，保存完整資料副本或一致版本備份，以同一 DATA_DIR 執行：

```sh
npm run imports:diagnose
npm run versions:report
npm run imports:repair -- <診斷中的安裝 UUID>
npm run imports:repair -- orphan:games/example-game/1.0.0
npm run imports:repair -- orphan:staging/example-work-id
```

diagnose 是 dry-run：readonly SQLite，不執行 migration、不改工作狀態、不移動成品；輸出狀態、action／原因、孤立成品與隔離區。versions:report 同樣只讀，輸出大小、資源候選、阻擋原因與 metadata 保留理由。兩者暫時取得／釋放資料目錄鎖；app 或其他維護程序運行時拒絕執行。

repair 僅接受已識別安裝或孤立成品 ID，不接受任意外部路徑，不提供刪除或發布。已登記版本禁止 orphan 操作；有未結案日誌的成品需使用 UUID。可重複執行，隔離目的地衝突拒絕覆寫。

安裝先保存 SQLite quarantining 意圖，再移至 quarantine/UUID/final 或 staging，最後設為 quarantined。reason.json 保存原因與工作／版本關聯。中斷後沿同一意圖續行，不自動刪除。未知成品以 ID 雜湊推導固定隔離位置，在 reason.json flush 意圖後才移入；中斷後重跑同一 orphan ID 即可核對。隔離區不提供公開或預覽資源。非法識別、符號連結祖先、目的地衝突及已登記檔案損壞需保存報告並由維護者處理或還原驗證過的備份。

## 版本引用與保留

| 引用 | 資源檔案 | metadata |
| --- | --- | --- |
| activeVersion，包含已下架 | 保留 | 保留 |
| 任何曾公開版本 | 保留舊分頁載入、回退及重新上架能力 | 保留公開／審查紀錄 |
| 未到期 preview | 保留指定版本 | 保留 |
| 未結案安裝／工作 | 保留待核對成品 | 保留來源／工作關聯 |
| plays／runs／best_scores | 保守保留遊玩引用的資源 | 永遠保留身份、名稱、榜單規則與歷史 |
| 存檔及格式快照 | 保守保留 gameVersion 資源 | 保留格式判斷依據 |
| 正在備份 | 全部阻擋清理 | snapshot 引用完整登記版本 |
| 既有完整備份 | 獨立複製，不依賴現行目錄 | 保留快照當時資料 |

只有未曾公開、不是目前版本、無有效預覽／安裝／遊玩／存檔引用、無進行中備份且檔案可安全讀取的資源列為候選。目前沒有移除命令；候選報告不是刪除授權。所有版本 metadata 保留，刪資源與刪版本記錄不可混為一談。外部備份是否仍存在、可還原需另外驗證。

## 備份與還原

備份允許 app 運行時執行，由 SQLite snapshot 決定複製的 immutable 登記版本。v12 snapshot 排除未完成／隔離日誌，只保留快照已登記版本的 registered／completed 日誌並正規化為 completed；關聯工作同步完成，其餘未完成工作標為 interrupted。

複製前拒絕符號連結、hard link 與特殊檔案，新版日誌核對全檔案雜湊；複製後再對比 inventory。不帶 staging 或 quarantine，還原不依賴兩者。需保留待修復／隔離成品時，停止 app 後另存完整 DATA_DIR；一致版本備份不包含它們。備份成功需完整檔案清單與校驗均通過。

schema v1–v12 備份可還原至空 DATA_DIR 後升級。升級前以原平台備份；回退至不支援 v12 的平台需使用升級前備份，不調低 user_version。

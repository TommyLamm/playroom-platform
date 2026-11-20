# 雲端存檔格式與恢復

正式存檔依登入者＋遊戲 ID 隔離。`revision` 是伺服器的樂觀鎖，每次保存或恢復加 1；`formatVersion` 是遊戲資料格式；`gameVersion` 記錄產生該資料的遊戲版本。提高遊戲版本或更新 SDK 不代表格式變更，回退遊戲版本也不自動回退玩家資料。

## 格式契約

新接入遊戲使用 Manifest schema 2，例如：

```json
"cloudSave": { "readableFormats": [1, 2], "writeFormat": 2 }
```

可讀格式必須唯一且包含寫入格式，最多 32 種正安全整數。格式號是識別碼，沒有數字大小的自動相容推論。伺服器依提交的**已公開版本**之不可變 Manifest 檢查：讀取與寫入前須能讀取目前格式；寫入格式必須等於 writeFormat；寫入結果也必須能被目前上架版本讀取。這避免舊分頁在回退後寫回上架版本無法讀取的格式。遊戲仍負責驗證 data 結構與實際遷移，平台不解讀私人資料。

橋接在 `loadProgress` 時附上該 iframe 的遊戲版本。直接 HTTP 讀取可用 `?version=2.0.0`，省略時以目前上架版本檢查。只有成功且無資料才回傳 null；不相容回傳 HTTP 409、`code=SAVE_FORMAT_INCOMPATIBLE`，SDK 保留數字 code 並附 machineCode。遊戲停止進度寫入並提示重新開啟相容版本，不能把讀取拒絕當空存檔、提高 revision 或保存預設資料。

schema 1 或未宣告 cloudSave 的版本是「相容性未知」，保留既有讀寫行為，沒有虛構的格式支援範圍；若目前上架版本有宣告，任何寫入結果仍必須在其可讀範圍。未知版本無法提供與已宣告版本相同的保護，接入時應提高遊戲版本並加入宣告。平台 `ready().capabilities` 提供 saveFormats；舊 SDK／protocol v1 仍可使用原操作與數字錯誤碼。

## 發布與回退

「遊戲與版本」的版本詳情顯示目前存檔格式相容性、總數與不相容數。只提供格式／筆數的彙總，不提供玩家 ID、存檔內容或私人快照。未知不能顯示已驗證相容；格式相容也不證明遊戲能正確解讀 data。

所有發布入口透過相同底層檢查，在發布交易內重新計算相容性。已知無法讀取任何現有存檔時，發布或直接回退回傳 409 SAVE_FORMAT_INCOMPATIBLE；批量逐項回報失敗原因。回退仍只允許曾公開版本，首次發布仍需預覽確認。存檔與發布不能交錯產生已知不相容結果；舊分頁保存也檢查目前上架版本。應提供能讀取新舊格式的修復版本，不能讓管理員直接覆寫玩家資料。

## 快照與保留規則

schema v11 新增 cloud_save_snapshots。首次成功改變格式時，保存被取代存檔的完整 data、原 revision、formatVersion、gameVersion、updatedAt、requestId，以及 capturedAt／reason。手動恢復也先保存目前資料，即使格式相同。普通同格式保存不新增快照；新玩家第一次保存沒有舊資料可快照。

每帳號每款遊戲保留**最新 20 份**，按自增 id 淘汰最舊快照，不設時間到期。快照新增、淘汰與存檔更新在同一交易中；任一步失敗全部回滾。相同請求重試不新增快照。淘汰不刪除目前存檔，既有完整備份也不受影響；超過 20 次遷移／恢復前的資料只能由保留的備份找回。每份正常存檔 data 最多 64 KiB，20 份快照 data 最多 1.25 MiB／帳號／遊戲，另有 metadata、SQLite 頁與 WAL 用量。

完整 SQLite 備份包含目前存檔及快照；v1–v11 備份還原後升級至 v11。營運儲存統計提供全站 snapshotCount 與 snapshotDataBytes（UTF-8 data 大小），最多快取 30 秒；平台資料用量亦包含實際資料庫／WAL，兩者不能相加當成總容量。沒有自動備份清理或額外快照刪除介面。

## 本人恢復程序

恢復是本人登入後的明確 API 操作，沒有管理員代讀／代恢復權限，也不由遊戲 SDK 提供。使用平台來源、本人 session Cookie 與 CSRF；下架時停止讀寫及恢復，資料保留。

1. 登入本人帳號，`GET /api/v1/games/:id/save/snapshots` 取得 `{revision,snapshots}`。snapshots 包含 id、原 revision、格式、來源版本、時間與 reason，不含 data；只列本人的資料。即使目前正式讀取遇到格式不相容，這個列表仍可取得恢復所需的目前 revision。
2. 根據時間與來源版本選取快照，明確確認將取代目前進度；保留 requestId。`POST /api/v1/games/:id/save/restore` 傳入 `{snapshotId,revision,requestId}`，其中 revision 是步驟 1 的**目前 revision**，不能使用快照中的舊 revision。
3. 只有 `{saved:true,...ProgressSave}` 成功才確認恢復完成。回傳 revision 是目前值加 1，gameVersion 保留快照的來源版本，updatedAt 為恢復時間。恢復前資料也成為 reason=restore 快照。重新開啟遊戲後，遊戲再驗證／遷移恢復的資料。
4. SAVE_REVISION_CONFLICT 表示別的裝置已保存；停止提交，重新讀取並讓本人重新選擇，不能自動套用新 revision。SAVE_FORMAT_INCOMPATIBLE 表示目前上架版本不能讀取該快照，須先提供相容版本。404 表示不是本人的快照或已淘汰，不自動選其他快照。
5. 回應遺失後以完全相同輸入與 requestId 重試，revision 不增加第二次；即使來源快照在本次恢復被淘汰，仍能辨識最近一次成功操作。已有後續保存時，舊請求回報 revision 衝突；REQUEST_ID_REUSED 表示最近同 ID 用於不同操作，須停止重試。401／403 要求重新登入或有效 CSRF，不跳過驗證。

快照恢復沒有時間旅行到某次普通同格式保存的保障，也不涵蓋遊戲自己的 localStorage。預覽只在本次連線記憶體模擬格式檢查，不呼叫正式存檔／快照／恢復 API。

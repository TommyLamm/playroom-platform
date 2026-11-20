# Playroom 遊戲開發與發布指令

此檔供獨立遊戲 repository 作為根目錄的 `AGENTS.md`。在平台 repository 中保留為範本。

## 核心規則

- 一個 repository 對應一款遊戲。沿用既有專案的結構與工具，保留遊戲 ID、玩家進度、素材授權及使用者修改。需要移除功能、重設玩法或遷移存檔時，先說明影響並取得同意。
- 交付可直接執行的靜態成品。自有資源用相對路徑，前端路由用 hash。開始、遊玩、結束及重新開始都須能在平台子目錄的跨來源 sandbox iframe 內完成。
- 訪客、SDK 或儲存服務不可用時仍須可玩。以遊戲 ID 區隔本機存檔。帳號成績與雲端進度只經 SDK 存取，遊戲不取得平台憑證或呼叫管理 API。
- 遊戲更新保留既有 Release 與成品，以新版本交付。推送發布 tag、建立 Release 或操作平台發布前，須有對應的明確授權；平台上架須經人工預覽確認。

## 開始前讀取線上規格

只改文案、配色或純遊戲內邏輯時，直接讀相關遊戲程式即可。涉及下表項目時，按需選讀平台 `main` 規格。表中「章名」對應同一份[開發與發布標準]的 Markdown 標題。用工具按標題擷取所需段落，只將相關內容帶入上下文；工作範圍改變時再補讀。

| 本次工作 | 要讀的規格 |
| --- | --- |
| 開發新遊戲、接入舊遊戲 | 「開發契約」、「最小成品」、「執行環境」。建立或修改 `game.json` 時核對 [Manifest Schema]。 |
| 改入口、資源路徑、畫面適配、輸入或全螢幕 | 「執行環境」。變更支援裝置時一併核對 [Manifest Schema]。 |
| 接入排行榜、改計分或影響排名的難度規則 | 「帳號成績 SDK 與排行榜」。顯示玩家生涯資料時加讀 「帳號設定與生涯隱私」。 |
| 接入雲端進度、改存檔格式或處理寫入衝突 | 「帳號雲端進度存檔」。格式變更、遷移或回退時加讀 [存檔相容規格]。 |
| 首次固定或升級 SDK、打包工具 | [版本與升級指引]。SDK 與工具使用固定版本；查 SDK 實作時對照遊戲所用版本，[平台 SDK] 供查閱最新實作。 |
| 打包、建立 GitHub Release | 依 「建置與打包」 完整驗證 ZIP，依 「驗收與上架」 驗證實際遊玩。建立或更新發布流程時採用 [Release workflow 範本]。 |
| 平台匯入、預覽、上架或回退 | 「驗收與上架」。有 SDK 時核對 「管理預覽 SDK 診斷」；處理操作衝突時查 [操作與錯誤契約]，匯入中斷時查 [匯入恢復指南]。 |

所需章節無法取得時，列明缺少的規格，先做可獨立完成的工作。完成時簡述改動及實際驗證結果，標明未驗證項目。涉及交付時，附遊戲 ID、版本、成品位置及已完成的階段（ZIP 驗證、GitHub Release、平台上架）。

[開發與發布標準]: https://raw.githubusercontent.com/TommyLamm/playroom-platform/main/docs/game-dev/game-development.md
[Manifest Schema]: https://raw.githubusercontent.com/TommyLamm/playroom-platform/main/templates/game.schema.json
[平台 SDK]: https://raw.githubusercontent.com/TommyLamm/playroom-platform/main/examples/starter/playroom-sdk.js
[版本與升級指引]: https://raw.githubusercontent.com/TommyLamm/playroom-platform/main/docs/game-dev/sdk-versioning.md
[存檔相容規格]: https://raw.githubusercontent.com/TommyLamm/playroom-platform/main/docs/game-dev/save-compatibility.md
[Release workflow 範本]: https://raw.githubusercontent.com/TommyLamm/playroom-platform/main/templates/game-release.yml
[操作與錯誤契約]: https://raw.githubusercontent.com/TommyLamm/playroom-platform/main/docs/game-dev/command-contracts.md
[匯入恢復指南]: https://raw.githubusercontent.com/TommyLamm/playroom-platform/main/docs/game-dev/import-recovery.md

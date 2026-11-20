# Playroom 遊戲開發文件

在獨立遊戲 repository 開始開發時，可將 [Agent 指令範本](../../templates/game-agent-template.md) 複製為根目錄的 `AGENTS.md`。依本次工作選讀下列規格。

| 工作 | 規格與檔案 |
| --- | --- |
| 接入遊戲、設定入口與支援裝置 | [開發與發布標準](game-development.md)、[Manifest Schema](../../templates/game.schema.json) |
| 接入排行榜、固定或升級 SDK 與工具 | [版本與升級指引](sdk-versioning.md)、[範例遊戲的 SDK](../../examples/starter/playroom-sdk.js) |
| 更新雲端存檔格式、遷移或恢復進度 | [存檔相容規格](save-compatibility.md) |
| 打包、建立 GitHub Release | [開發與發布標準的建置與打包章節](game-development.md#建置與打包)、[Release workflow 範本](../../templates/game-release.yml) |
| 處理發布衝突、匯入中斷或版本恢復 | [操作與錯誤契約](command-contracts.md)、[匯入恢復指南](import-recovery.md) |

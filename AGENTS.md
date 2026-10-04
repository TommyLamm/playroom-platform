# 平台開發指令

本檔適用於 Playroom 平台 repository。

## 遊戲開發與發布文件同步

當 Playroom 遊戲開發與發布指令有變化時，必須在同一次修改中更新 `templates/game-agent-template.md`，讓獨立遊戲 repository 使用的 Agent 指令與平台要求保持一致。

這包含開發與發布標準、Manifest Schema、SDK 接入方式、遊戲執行限制、打包與驗證指令、Release workflow 及匯入／預覽／發布流程的變更。更新相關程式或文件後，檢查範本的要求、範例及驗收項目是否需要同步調整。

範本「開始前讀取線上規格」的連結必須追蹤平台 `main` 分支的最新規格，不固定 commit SHA，也不使用待替換的 commit 佔位符。

# 驗證紀錄

驗證日期：2026-10-04。環境為 Windows、Node.js 24.11.1、Chrome；手機測試使用 Chromium 的 iPhone 13 viewport 與觸控模擬。

| 項目 | 結果 |
| --- | --- |
| TypeScript 前後端型別檢查 | 通過 |
| 正式前後端 build | 通過 |
| Node 整合／安全邊界測試 | 21 項通過，含註冊、角色、舊帳號升級及 Release tag 一致性 |
| Playwright | 6 個情境通過；2 個不適用於該 viewport 的重複情境依設定跳過 |
| 桌面／手機截圖檢查 | 大廳、遊戲、註冊、玩家選單與管理後台；封面正常、無水平溢出；手機遊戲按鈕至少 44px |
| GitHub 真實 API | 成功讀取 vitejs/vite 公開資訊與 100 個 Releases |
| 遊戲成品 ZIP 打包與完整驗證 | 通過 |
| 本機 CLI 線上備份與空目錄還原 | 實際執行成功 |
| 備份損壞檢查 | 修改檔案後，還原被拒絕 |
| 本機程序重新啟動 | 遊戲、版本與管理員資料保留 |
| 本機既有資料庫升級 | 重啟後 schema v2、原 admin 帳號及兩款遊戲 v1.0.1 保留，SQLite integrity check 通過 |
| 舊版備份相容性 | 升級前建立備份，實際還原至獨立空目錄並自動升級成功 |
| npm audit | 安裝依賴修正後無已知漏洞；production audit 亦為 0 |

瀏覽器管理流程使用測試用 GitHub adapter 提供兩個 Release，經過真實 ZIP 解壓、資料庫、資源伺服器及 UI 完成匯入、預覽、發布、更新、回退和下架。尚未以實際開發者的 game.zip Release 進行外網端到端匯入，因為本次沒有指定該 repository。

帳號測試涵蓋公開註冊只能建立 `player`、拒絕註冊注入 `admin`、帳號不分大小寫、重複／並發註冊、密碼雜湊、註冊限流、玩家不能使用任何管理 API、登出及 session 過期、角色降級後立即撤銷管理權限、v1→v2 升級保留管理員及 session，以及新版備份還原保留玩家角色。瀏覽器另驗證玩家登入後無後台入口、直接進入 `/admin` 被阻擋，admin 登入後顯示管理入口。

本機未安裝 Docker，所以 Docker image build、Compose 容器啟動／重啟及 Caddy 公網憑證申請**尚未實際驗證**。已提供 GitHub Actions CI 執行 Docker build 和 named-volume 重啟測試，該 CI 尚未在遠端執行。正式上線前仍需在有 Docker 的主機上跑完部署與健康檢查。

目前沒有執行 Safari、Firefox、多人負載或跨主機測試。平台維持第一版的單主機、可信任開發者範圍。

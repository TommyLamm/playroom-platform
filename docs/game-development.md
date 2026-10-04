# 遊戲開發與發布標準 v1

本文件是所有合作開發者的接入標準。文中的「必須」是上架條件，「建議」是體驗要求。靜態遊戲可以使用任何前端框架；平台只接收完成建置的成品。

## 開發契約

| 項目 | 必須遵守的標準 |
| --- | --- |
| 身分 | 每款遊戲使用固定、唯一的 `id`；一個 repository 對應一款遊戲 |
| 版本 | 更新必須增加 `version`，tag 必須為 `v<version>`；已匯入版本不可覆寫 |
| 交付 | 公開 GitHub repository 的 Release 附加唯一 `game.zip`；ZIP 根目錄有 `game.json` |
| 建置 | ZIP 內有可直接運作的入口、腳本、樣式、圖片和音效；不要求平台安裝或編譯 |
| 路徑 | 所有自有資源使用相對路徑；路由使用 hash；入口能在版本子目錄及預覽子目錄運作 |
| 帳號 | 遊戲不能取得平台玩家或 admin 的 Cookie，不可依賴平台登入狀態；本版沒有帳號／存檔 SDK |
| 裝置 | `devices` 必須如實宣告；標示 `mobile` 的遊戲必須可用觸控完成主要玩法 |
| 大小 | ZIP ≤ 64 MiB、解壓 ≤ 256 MiB、entries ≤ 10,000；封面 ≤ 5 MiB |
| 行為 | 不跳出 iframe、不開 popup、不提交表單；音效與全螢幕由玩家操作觸發 |

欄位的機器可讀格式是 `templates/game.schema.json`，由平台的 `shared/manifest.ts` 產生，更新規格後執行 `npm run game:schema`。合作開發者可將這個 schema 複製到遊戲 repository，讓編輯器或 JSON Schema 驗證器檢查 `game.json`。不要在 `game.json` 加 `$schema` 或其他未定義欄位；可用編輯器的外部 schema mapping。JSON Schema 驗證欄位結構；檔案存在、路徑安全及 ZIP 限制以 `npm run game:validate` 為準。

## 最小成品

```text
game.zip
  game.json
  index.html
  cover.png
  assets/
    game.js
    game.css
```

不要在 ZIP 外層再包一層 `dist/` 或 repository 名稱。平台不安裝 npm 套件、不編譯程式、不執行後端腳本；請在 GitHub Actions 或開發電腦上先完成 build。

```json
{
  "schemaVersion": 1,
  "id": "my-first-game",
  "name": "我的第一款遊戲",
  "version": "1.0.0",
  "description": "一款簡短、有趣的遊戲。",
  "author": "Your team",
  "entry": "index.html",
  "cover": "cover.png",
  "tags": ["反應", "輕鬆玩"],
  "instructions": "點擊開始，使用滑鼠或觸控操作。",
  "devices": ["desktop", "mobile"]
}
```

所有欄位必填，未知欄位會被拒絕。`id` 必須以英文字母開頭，只含小寫字母、數字、連字號，長度 2–48；請選定後保持不變。`version` 支援 `1.2.3` 或 `1.2.3-beta.1`，最多 64 字元，不含 `v` 前綴。

`name` 最多 80 字元，`author` 最多 100；`description` 和 `instructions` 各最多 2,000。最多 8 個標籤，每個最多 24 字元。`devices` 支援 `desktop`、`mobile`。封面支援 PNG、JPEG、WebP 或 GIF，最多 5 MiB，建議 800 × 500。入口必須是 HTML。

路徑必須是相對路徑，使用 `/`，不可含 `..`、反斜線、冒號、控制字元、`?`、`#`、`%`、Windows 保留檔名或尾端空白／句點。檔名區分大小寫，但禁止只靠大小寫區分的重複檔案，以保持跨平台一致。

## 建置與打包

可從 `examples/starter/` 開始。它完全不需 build，包含 `config.json`、遊戲腳本及樣式。若使用 Vite，設定 `base: './'`，並確保 `game.json` 與封面有複製到 build output。

從平台 repository 執行：

```sh
npm run game:pack -- examples/starter artifacts/game.zip
npm run game:validate -- artifacts/game.zip
```

打包指令接受任何成品目錄；ZIP 輸出必須放在成品目錄之外。完整驗證指令會使用平台同一套 ZIP 與 manifest 檢查。來源 SHA-256 是整個 ZIP 的雜湊；本機內建範例的來源校驗值則是 manifest 雜湊。

將 `templates/game-release.yml` 複製到遊戲 repository 的 `.github/workflows/release.yml`。預設成品放在 `game/`；若使用框架，加入安裝及 build 步驟，並把工作流程內的 `game` 改成成品目錄。

推送 `v1.0.0` tag 後，workflow 會檢查版本號並建立帶有 `game.zip` 的 Release。平台另外執行完整驗證。workflow 不會覆寫既有 Release；修正遊戲時請提高版本、發布新 tag。

## 執行環境

- 入口會放在 `/games/<id>/<version>/...` 或帶短效授權的 `/preview/...` 下。使用 `./assets/...`，不要寫 `/assets/...`。
- 若使用前端 router，使用 hash routing。平台資源伺服器不提供遊戲內部路徑的 SPA fallback。
- iframe 允許 scripts、same-origin、pointer lock、fullscreen、autoplay 及 gamepad；瀏覽器仍可能要求玩家手勢才能播放音效或進入全螢幕。
- 不允許 top navigation、popup、表單提交；也不提供麥克風、相機及平台登入憑證。
- 遊戲需能適應 iframe 尺寸；畫面載入成功不代表自動支援手機。只有完成觸控適配才標示 `mobile`。
- `localStorage` 由遊戲自行管理，使用例如 `my-first-game:save:v1` 的 key。預覽與已發布版本共用遊戲來源，可能共享存檔；請在升級資料格式時保留相容性。
- 遊戲檔案應自包含。若自行連接外部服務，該服務的 CORS、可用性與資料處理由遊戲負責。

目前不支援需要伺服器程序的遊戲、自動多人房間或需要 cross-origin isolation / SharedArrayBuffer 的建置。請使用不要求該能力的 Web 匯出設定。

## 平台 API 摘要

所有 JSON API 位於平台來源的 `/api/v1`。錯誤格式是 `{ "error": "說明" }`；遊戲來源只提供靜態遊戲資源。

| 方法與路徑 | 功能 |
| --- | --- |
| `GET /games`、`GET /games/:id` | 已上架遊戲及完整遊玩／封面 URL |
| `GET /session` | 登入狀態；登入後回傳 `username`、`role`、CSRF token |
| `POST /register` | `{username,password}`，建立 `player` 並登入；不接受 `role` |
| `POST /login` | `{username,password}`，設定 session cookie |
| `POST /logout` | 登出並撤銷目前 session |
| `GET /admin/overview` | 遊戲、版本、repository 與最近 50 筆匯入紀錄 |
| `POST /admin/repositories` | `{fullName:"owner/repository"}` |
| `GET /admin/repositories/:id/releases` | 最近 100 個 Release 與 game.zip 資訊 |
| `POST /admin/imports` | `{repositoryId,releaseId}`，回傳 202 與 `jobId` |
| `POST /admin/games/:id/preview` | `{version}`，回傳 `url`、`expiresAt` |
| `POST /admin/games/:id/publish` | `{version}`，發布或回退 |
| `POST /admin/games/:id/unpublish` | `{}`，封鎖所有公開版本資源 |

所有 POST 必須附正確平台 Origin。`/login` 與 `/register` 不需既有 session；`/logout` 需任一登入角色及 `X-CSRF-Token`；所有 `/admin/*` 操作需 `admin` session，修改操作另外需 `X-CSRF-Token`。玩家登入不授予管理能力。遊戲不應直接呼叫平台帳號或管理 API。匯入任務狀態為 `queued`、`running`、`completed` 或 `failed`；後台每三秒更新狀態，失敗時重新提交即可。

## 上架驗收

1. 在獨立 repository 完成遊戲，依標準填寫 `game.json`；封面必須清楚呈現實際遊戲畫面。
2. 執行 `game:pack` 和 `game:validate`，驗證成品完整、不含私鑰、token 或伺服器程式。
3. 推送與 manifest 一致的 tag，由 Release workflow 產生 `game.zip`；修正後發布新版本。
4. Admin 在「管理後台 → 匯入遊戲」加入 repository、選擇 Release、匯入並等待驗證完成。
5. 先預覽，再發布。必須測試開始、主要玩法、結束及重新開始；確認沒有缺失資源或 console 錯誤。
6. 在桌面及所有宣告裝置驗證 iframe 畫面沒有遮擋／溢出；手機主要觸控目標建議至少 44 px，直向畫面必須可完成遊戲。
7. 發布更新前確認遊戲 ID 相同、新版本號不同；上架後再測一次公開遊玩，保留舊版以供回退。

建議提供暫停或可預期的背景分頁行為、靜音設定，以及清楚的開始／結束狀態。遊戲不應在載入時自動播放聲音；不得把每幀運算或大量下載留在已結束的遊戲中。這些體驗項目由管理員預覽驗收，平台的 ZIP 驗證不會代替遊戲測試。

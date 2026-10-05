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
| 帳號 | 遊戲不能取得平台 Cookie 或直接呼叫帳號／管理 API；成績透過選填的 Playroom SDK 回報，訪客也必須可玩 |
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

除 `leaderboard` 為選填外，所有欄位必填，未知欄位會被拒絕。`id` 必須以英文字母開頭，只含小寫字母、數字、連字號，長度 2–48；請選定後保持不變。`version` 支援 `1.2.3` 或 `1.2.3-beta.1`，最多 64 字元，不含 `v` 前綴。

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

將 `templates/game-release.yml` 複製到遊戲 repository 的 `.github/workflows/release.yml`。預設成品放在 `game/`；只需修改 workflow 的 `GAME_DIR` 為 repository 內的成品目錄。若使用框架，在版本檢查前加入遊戲自己的安裝及 build 步驟，例如 `npm ci` 與 `npm run build`，並將 `GAME_DIR` 設成 `dist`。

推送 `v1.0.0` tag 後，workflow 會核對 tag 與 `game.json` 版本，以 Node 24 在 runner 暫存目錄取得平台 `main` 最新工具並執行 `npm ci`，再執行 `game:pack` 與 `game:validate`。平台 checkout 及輸出 ZIP 都在成品目錄之外；完整檢查包含 Manifest Schema、入口／封面、路徑安全、檔名碰撞、符號連結及 ZIP 大小／檔案數限制。任何步驟失敗都不會建立 Release，不要加入 `continue-on-error` 或 `always()` 繞過驗證。

通過後才將唯一的 `game.zip` 發布到遊戲 repository；GitHub token 僅提供給發布步驟，checkout 不保留憑證，平台工具不取得發布 token。平台匯入時仍會再次執行完整驗證。workflow 不會覆寫既有 Release；修正遊戲時請提高版本、發布新 tag。這些檢查不代替 SDK 接入、真實遊玩及桌面／手機的瀏覽器驗收。

## 執行環境

- 入口會放在 `/games/<id>/<version>/...` 或帶短效授權的 `/preview/...` 下。使用 `./assets/...`，不要寫 `/assets/...`。
- 若使用前端 router，使用 hash routing。平台資源伺服器不提供遊戲內部路徑的 SPA fallback。
- iframe 允許 scripts、same-origin、pointer lock、fullscreen、autoplay 及 gamepad；瀏覽器仍可能要求玩家手勢才能播放音效或進入全螢幕。
- 不允許 top navigation、popup、表單提交；也不提供麥克風、相機及平台登入憑證。
- 遊戲需能適應 iframe 尺寸；畫面載入成功不代表自動支援手機。只有完成觸控適配才標示 `mobile`。
- `localStorage` 由遊戲自行管理，使用例如 `my-first-game:save:v1` 的 key。預覽與已發布版本共用遊戲來源，可能共享存檔；請在升級資料格式時保留相容性。
- 遊戲檔案應自包含。若自行連接外部服務，該服務的 CORS、可用性與資料處理由遊戲負責。

目前不支援需要伺服器程序的遊戲、自動多人房間或需要 cross-origin isolation / SharedArrayBuffer 的建置。請使用不要求該能力的 Web 匯出設定。

## 帳號成績 SDK 與排行榜

此功能為選填。未接入的遊戲仍可遊玩，平台會為登入玩家記錄開啟次數及估計活躍時間，但不知道完成局數與分數。訪客及管理預覽不寫入帳號記錄；進度存檔仍由各遊戲自行管理，SDK 不提供雲端進度存檔。

在 `game.json` 加入榜單設定，例如：

```json
"leaderboard": {
  "id": "classic",
  "order": "desc",
  "unit": "分",
  "minScore": 0,
  "maxScore": 10000
}
```

`id` 必填，以小寫英文字母開頭，只含小寫字母、數字及連字號，最多 48 字元。其他欄位預設為 `order: "desc"`、`unit: "分"`、`minScore: 0`、`maxScore: 9007199254740991`。單位最多 16 字元，分數及上下限必須為非負安全整數，且下限不可大於上限；實際 ZIP 驗證仍不可省略。`desc` 表示越高越好，`asc` 表示越低越好；計時遊戲回報整數毫秒，設定 `unit: "毫秒"`。

每個版本宣告一個榜單。相同遊戲 ID 與榜單 ID 的成績跨版本沿用；排序、單位及有效範圍必須一致，匯入不相容規則會被拒絕。改變難度或計分方式時使用新榜單 ID。玩家只佔一列，以個人最佳成績排名，同分並列（例如 1、1、3），同分顯示順序以首次達成時間再按玩家 ID 排列。過往已發布榜單保留，未上架版本不能提交成績。遊戲下架後停止提交與公開排行查詢，既有生涯摘要與本人逐局記錄保留。

將 `examples/starter/playroom-sdk.js` 複製到成品內；TypeScript 遊戲可同時複製旁邊的 `.d.ts`。以相對路徑匯入：

```js
import { Playroom } from './playroom-sdk.js';

// 可用狀態只影響帳號成績，不能阻擋訪客或獨立遊玩。
Playroom.ready().then(({ available, mode }) => {
  console.log('帳號成績可用：', available, '模式：', mode);
});

let currentRun = Promise.resolve(null);
function onRoundStart() {
  currentRun = Playroom.startRun().catch(() => null);
  // 立即開始本身的遊戲邏輯，不等待網路。
}
async function onRoundFinish(finalScore) {
  try {
    const run = await currentRun;
    if (run) await Playroom.finishRun({ runId: run.runId, score: finalScore });
  } catch {
    // 大廳工具列顯示未保存狀態，玩家可在離開本頁前重試保存。
  }
}
```

`ready()` 回傳 `{available, mode}`；`available` 表示登入且遊戲宣告榜單，可以保存帳號成績。`startRun()` 回傳 `{runId}`，訪客、獨立開啟及一般未啟用診斷的預覽回傳 `null`。`finishRun({runId,score})` 正式保存成功回傳 `{saved:true,runId,score,finishedAt}`，失敗會拒絕 Promise；同一局同分重試不會增加紀錄，不能改寫已保存的分數。開始局次失敗時仍需可遊玩，但該局沒有可提交的 ID。開始新一局時保留上一局正在提交的 Promise，避免把前一局成績綁到新一局。

### 管理預覽 SDK 診斷

管理員預覽會顯示 SDK 連線、協定版本、遊戲版本、榜單 ID／排序／單位／範圍，以及最近 80 筆開始、完成、驗證錯誤與重複提交事件。新版 SDK 的 `hello` 宣告 `diagnostics:true`，平台只在管理預覽的初始化訊息加入 `diagnostics:true`，沿用協定版本 1；既有 SDK 仍可遊玩，但會提示不支援預覽局次診斷。未收到 SDK 時顯示未連線，不能把 iframe 載入成功當作成績接入成功。

在啟用診斷的預覽中，`ready()` 仍回傳 `available:false, mode:'preview'`；`startRun()` 回傳本次連線記憶體內的模擬 `{runId}`，`finishRun()` 驗證格式、局次歸屬、分數範圍與不可覆寫規則後回傳 `null`。這些操作不呼叫帳號記錄 API，也不保存遊玩、局次或排行榜資料。沿用上述開始與完成呼叫即可驗證完整流程，不要僅因 `available:false` 而跳過 SDK 呼叫；`available` 用來決定是否顯示「保存帳號成績」。未設定榜單時開始模擬會回報錯誤，遊戲應捕捉錯誤並繼續操作。

模擬局次不能拿到正式遊玩使用；不要把 `runId` 視為已保存證明，只有正式模式 `finishRun()` 回傳的 `saved:true` 才代表保存成功。面板不顯示預覽 URL、Cookie、CSRF token 或原始訊息。清除事件只清空列表，重新開始才會重建連線及模擬局次。更新 SDK 後提高遊戲版本再匯入，不覆寫已匯入版本。診斷不能代替真實遊玩、手機與帳號保存驗收。

SDK 以版本 1 的 `playroom` postMessage 協定與當前大廳 iframe 連線，只提供局次開始與完成操作。SDK 驗證父視窗，初始化後固定父來源及連線 ID；大廳驗證遊戲來源、目前 iframe、連線 ID、訊息結構與局次歸屬，再以大廳自己的憑證提交。平台 Cookie、CSRF token 及管理功能不會交給遊戲。切換帳號、重新載入或登入失效後需重新開啟遊戲；不要把局次 ID 或待提交成績跨帳號儲存。

工具列的「重試保存」只保留目前頁面的待提交結果，離開／重新載入會清除；顯示成功前不能稱為已保存。此版榜單為休閒用途，限流及數值驗證不能證明前端分數真實，競技用途需要額外的伺服器結果驗證。既有瀏覽器最佳分數不會匯入帳號。

### 帳號設定與生涯隱私

玩家在平台的「帳號設定」管理密碼、其他登入 session 與生涯公開範圍。`public` 是預設值，公開遊戲、最佳成績及活動次數／時間；`limited` 只公開遊戲與最佳成績，活動欄位回傳 `null` 且 `activityVisible:false`；`private` 的生涯只有本人可讀，其他人查詢回傳 404。本人始終可查完整生涯、逐局成績與進步趨勢。排行榜仍公開玩家名稱、最佳成績與排名，不受生涯公開範圍影響。

顯示生涯資料時遵守 `activityVisible`，不要把隱藏的 `null` 次數／時間當成零，也不要將 404 誤稱為沒有玩過遊戲。連到私人生涯時可顯示「未公開或不存在」；不得以私人逐局資料填補公開摘要。遊戲不需要接入新的帳號設定 API，也不取得密碼、session 清單或公開範圍操作權限。修改密碼會旋轉本裝置 session 並撤銷其他 session；大廳會重建遊戲連線，不能沿用舊局次 ID。其他裝置被登出時，遊戲仍應可繼續操作，但不能顯示未保存的成績已保存。

## 平台 API 摘要

所有 JSON API 位於平台來源的 `/api/v1`。錯誤格式是 `{ "error": "說明" }`；遊戲來源只提供靜態遊戲資源。

| 方法與路徑 | 功能 |
| --- | --- |
| `GET /games`、`GET /games/:id` | 已上架遊戲及完整遊玩／封面 URL |
| `GET /session` | 登入狀態；登入後回傳 `username`、`role`、CSRF token |
| `POST /register` | `{username,password}`，建立 `player` 並登入；不接受 `role` |
| `POST /login` | `{username,password}`，設定 session cookie |
| `POST /logout` | 登出並撤銷目前 session |
| `POST /visits` | 平台頁面用：`{requestId,kind,path,gameId?,version?,referrer?}`，kind 為 page_view／game_open；需要正確 Origin，不要求登入或 CSRF，每 IP 每分鐘最多 120 次；遊戲不得直接呼叫 |
| `GET /me/settings` | 本人設定 `{careerVisibility,otherSessions}`；otherSessions 只計有效的其他 session，不接受指定其他帳號 |
| `POST /me/settings` | `{careerVisibility}`，值為 public／limited／private，回傳更新後的本人設定 |
| `POST /me/password` | `{currentPassword,newPassword}`，驗證目前密碼後更新；新密碼 12–256 字元，撤銷全部舊 session 並為本裝置建立新 session，回傳 `{ok:true,session}` |
| `POST /me/sessions/revoke` | `{currentPassword}`，驗證後撤銷其他 session，保留目前登入，回傳 `{revoked}` |
| `GET /players/:username/career` | 依公開範圍回傳摘要與 `activityVisible`；limited 活動欄位為 null、private 非本人為 404；不含逐局成績、session 或憑證 |
| `GET /me/results` | 本人逐局成績；選填 `gameId`、`page`（預設 1）、`pageSize`（預設 20，上限 100）；不接受指定其他帳號 |
| `GET /me/progress` | 本人進步；必填 `gameId`、`boardId`，回傳最近 30 局、歷來最佳、總局數及突破次數；不接受指定其他帳號 |
| `GET /games/:id/leaderboards` | 已發布榜單及 `activeBoardId` |
| `GET /games/:id/leaderboards/:boardId` | 前 100 名、已登入玩家自己的最佳成績／名次及 `nextTarget`（最近的嚴格較佳分數組之名次、分數與差距；沒有目標時為 null） |
| `POST /games/:id/plays` | 大廳用：`{version,requestId}`，回傳 `{playId}`；requestId 為 UUID，同 session 重試不重複開啟次數 |
| `POST /plays/:playId/heartbeat` | 大廳用：`{active}`；前景具有焦點時 active=true，失焦時送 false，恢復時重新啟動計時 |
| `POST /plays/:playId/runs` | 大廳用：`{requestId}`，回傳 `{runId}`；同遊玩記錄重試不重複建立局次 |
| `POST /runs/:runId/finish` | 大廳用：`{score}`，回傳保存結果 |
| `GET /admin/overview` | 遊戲、版本、repository 與最近 50 筆匯入紀錄 |
| `GET /admin/analytics` | 選填 `days=7`（預設）或 `30`；UTC 區間、活躍玩家／開啟／完成／熱門遊戲、成績提交／每日指標、磁碟用量與最近備份狀態；只供管理員 |
| `GET /admin/visitors` | 選填 `days=7`（預設）或 `30`；訪客、瀏覽、遊戲開啟總數、每日趨勢、國家分佈與前 10 款訪客熱門遊戲；只供管理員 |
| `GET /admin/visitors/records` | 選填 `days=7`／`30`、`page`、`country`（ISO 國家碼或 unknown）、`ip`、`gameId`、`kind`、`visitor`（完整雜湊）；每頁 25 筆，包含 IP／國家／帳號／頁面／遊戲／來源／User-Agent；只供管理員 |
| `POST /admin/repositories` | `{fullName:"owner/repository"}`，亦接受 GitHub repository URL；大小寫及重複來源正規化 |
| `GET /admin/github-owners` | 常用 GitHub 帳號／組織 |
| `POST /admin/github-owners` | `{login}`，檢查並保存公開帳號／組織 |
| `POST /admin/github-owners/:login/remove` | `{}`，移除常用帳號，不刪除來源 |
| `GET /admin/github-owners/:login/repositories` | 選填 `page`（預設 1），每次最多 100 個公開 repositories、`added` 及 `hasMore` |
| `GET /admin/sources` | 遊戲來源、封存狀態、保存的 Release 檢查結果及已匯入版本 |
| `POST /admin/repositories/:id/check` | `{}`，更新 Release 檢查與時間，失敗保留快取並回傳 `checkError` |
| `POST /admin/repositories/:id/state` | `{archived}`，封存／恢復；匯入中的來源不可封存 |
| `POST /admin/import-batches` | `{requestId,items:[{repositoryId,releaseId}]}`，UUID requestId，同批次冪等，最多 100 項，回傳 202 與 `batch` |
| `GET /admin/import-batches` | 最近 50 個批次的總數、完成／跳過、失敗及等待中數量 |
| `GET /admin/import-batches/:id` | 批次完整項目、任務狀態及錯誤，不受 overview 50 筆限制 |
| `GET /admin/repositories/:id/releases` | 最近 100 個 Release 與 game.zip 資訊 |
| `POST /admin/imports` | `{repositoryId,releaseId}`，回傳 202 與 `jobId` |
| `POST /admin/games/:id/preview` | `{version}`，回傳 `url`、`expiresAt` |
| `POST /admin/games/:id/publish` | `{version}`，發布或回退 |
| `POST /admin/games/:id/unpublish` | `{}`，封鎖所有公開版本資源 |

`/me/progress` 只查登入帳號的已完成局次。`points` 依完成時間從舊到新排列，最多 30 筆；完成時間相同時按局次 ID 排序。每筆含 `previousBest` 與 `personalBest`；首次成績的 previousBest 為 null、personalBest 為 false，同分不算突破。最佳成績及突破次數以整個榜單的歷史計算，早於最近 30 局的成績也會影響判斷；沿用榜單 ID 的版本合併，不同 ID 分開。生涯公開摘要不包含這些逐局趨勢，下架後本人仍可查看。

所有 POST 必須附正確平台 Origin。`/login` 與 `/register` 不需既有 session；`/logout`、帳號設定、遊玩、心跳、局次及成績寫入需任一登入角色及 `X-CSRF-Token`；所有 `/admin/*` 操作需 `admin` session，修改操作另外需 `X-CSRF-Token`。玩家登入不授予管理能力。遊戲不應直接呼叫平台 API，使用 SDK 由大廳代為提交。寫入限流以帳號計算：每分鐘最多 30 次建立遊玩記錄、20 次心跳、60 次開始局次、60 次完成提交及 30 次公開範圍更新；修改密碼與撤銷其他 session 共用每帳號 15 分鐘最多 5 次的限制，重新登入不繞過限制。匯入任務狀態為 `queued`、`running`、`completed` 或 `failed`；後台每三秒更新狀態，失敗時重新提交即可；同時只執行一款匯入，等待及處理中合計最多 100 款。

營運指標的期間從 UTC 今天往前 6／29 天的 00:00 起算，至回應產生時間，包含今天；活躍玩家是期間內有開啟、心跳或完成事件的登入帳號，訪客與預覽不納入。熱門遊戲以開啟次數排序，最多 10 款，保留已下架遊戲的歷史活動。成績提交只統計伺服器收到且屬於有效登入 session 的本人局次：2xx 為 `success`、4xx 為 `rejected`、5xx 為 `server_error`；重複提交及重試再次計數，完成局數不重複。`failureRate` 為（拒絕＋伺服器錯誤）／提交次數，沒有提交時為 null；離線或未到達伺服器的失敗不計。指標上線後開始累積，不補算過往失敗。

管理員另可在 `/api/v1/admin/visitors` 與 `/api/v1/admin/visitors/records` 查看匿名及登入玩家的訪客統計和活動明細（UTC 7／30 天）。訪客 Cookie 由平台簽發並以雜湊識別；記錄保留 90 天，國家由伺服器按 IP 的本機 GeoIP 資料推算，未知或內網不強行指定國家。平台頁面負責送出瀏覽及公開遊戲 iframe 載入事件，無 SDK 遊戲亦能記開啟；遊戲本身不得取得訪客 IP／Cookie、直接呼叫 `/api/v1/visits` 或另行提交平台訪客統計。管理員活動及預覽不納入，訪客開啟不代表完成一局或保存帳號成績，亦不改變生涯與成績 API 的權限。

營運回應的磁碟總容量／可用空間與資料／遊戲檔案用量最多快取 30 秒，讀取失敗回傳 null，介面顯示「未知」；測量不追蹤符號連結。備份狀態為 `never`、`running`、`success` 或 `failed`，只表示平台備份指令記錄的狀態，不驗證備份目的地仍可用。schema v7 備份保留公開範圍設定、營運指標、訪客記錄、常用 GitHub 帳號、來源檢查與匯入批次，支援 schema v1–v7 還原；快照中的進行中狀態會轉為 failed 並提醒還原後重新備份。源資料庫在快照、檔案與雜湊清單全部完成後才記錄 success，避免宣稱尚未完成的備份成功。舊平台版本回退需使用升級前備份。

## 上架驗收

1. 在獨立 repository 完成遊戲，依標準填寫 `game.json`；封面必須清楚呈現實際遊戲畫面。
2. 執行 `game:pack` 和 `game:validate`，驗證成品完整、不含私鑰、token 或伺服器程式。
3. 推送與 manifest 一致的 tag，由 Release workflow 產生 `game.zip`；修正後發布新版本。
4. Admin 可在「管理後台 → 遊戲來源」保存多位開發者的 GitHub 帳號／組織，探索公開 repositories 並勾選批量加入，或一次貼上多行 URL／owner/repo；來源列表可搜尋、按帳號及狀態篩選，封存不下架或刪除遊戲。從來源列表多選匯入，或由「匯入遊戲」搜尋選取來源，再確認各款 Release 並等待驗證完成。每批最多 100 款，預設最新有效正式版，預發布需手動選擇；已匯入 Release 跳過、相同等待中任務沿用。批次進度可重新開啟，失敗或重啟中斷可批量重試，匯入完成不會自動上架。
5. 先預覽，再發布。必須測試開始、主要玩法、結束及重新開始；確認沒有缺失資源或 console 錯誤。
6. 在桌面及所有宣告裝置驗證 iframe 畫面沒有遮擋／溢出；手機主要觸控目標建議至少 44 px，直向畫面必須可完成遊戲。
7. 發布更新前確認遊戲 ID 相同、新版本號不同；上架後再測一次公開遊玩，保留舊版以供回退。

建議提供暫停或可預期的背景分頁行為、靜音設定，以及清楚的開始／結束狀態。遊戲不應在載入時自動播放聲音；不得把每幀運算或大量下載留在已結束的遊戲中。這些體驗項目由管理員預覽驗收，平台的 ZIP 驗證不會代替遊戲測試。

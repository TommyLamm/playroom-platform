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

欄位結構以 [Manifest Schema](../templates/game.schema.json) 為準；它由 `shared/manifest.ts` 的輸入格式產生，平台修改欄位後執行 `npm run game:schema`。可使用編輯器的外部 schema mapping，不在 `game.json` 加 `$schema` 或未知欄位。Schema 的 `default` 是說明，預設值由平台驗證器套用；分數上下限關係、檔案存在、路徑安全及 ZIP 限制仍須執行 `npm run game:validate`。

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

除 `leaderboard` 為選填外，所有頂層欄位必填，未知欄位會被拒絕。`id` 必須以英文字母開頭，只含小寫字母、數字、連字號，長度 2–48；請選定後保持不變。`version` 支援 `1.2.3` 或 `1.2.3-beta.1`，最多 64 字元，不含 `v` 前綴。

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

通過後才將唯一的 `game.zip` 發布到遊戲 repository；GitHub token 僅提供給發布步驟，checkout 不保留憑證，平台工具不取得發布 token。含預發布後綴的版本（例如 `1.2.3-beta.1`）會透過 [GitHub CLI 的 --prerelease 選項](https://cli.github.com/manual/gh_release_create) 標記為預發布，平台須手動選擇匯入。平台匯入時仍會再次執行完整驗證。workflow 不會覆寫既有 Release；修正遊戲時請提高版本、發布新 tag。這些檢查不代替 SDK 接入、真實遊玩及桌面／手機的瀏覽器驗收。

## 執行環境

- 入口會放在 `/games/<id>/<version>/...` 或帶短效授權的 `/preview/...` 下。使用 `./assets/...`，不要寫 `/assets/...`。
- 若使用前端 router，使用 hash routing。平台資源伺服器不提供遊戲內部路徑的 SPA fallback。
- iframe 允許 scripts、same-origin、pointer lock、fullscreen、autoplay 及 gamepad；瀏覽器仍可能要求玩家手勢才能播放音效或進入全螢幕。
- 不允許 top navigation、popup、表單提交；也不提供麥克風、相機及平台登入憑證。
- 遊戲需能適應 iframe 尺寸；畫面載入成功不代表自動支援手機。只有完成觸控適配才標示 `mobile`。
- `localStorage` 由遊戲自行管理，使用例如 `my-first-game:save:v1` 的 key。預覽與已發布版本共用遊戲來源，可能共享存檔；請在升級資料格式時保留相容性，儲存不可用時仍能遊玩。
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
  const finishingRun = currentRun; // 固定本局，不受下一局開始影響。
  try {
    const run = await finishingRun;
    if (!run) return;
    const result = await Playroom.finishRun({ runId: run.runId, score: finalScore });
    if (result?.saved === true) {
      // 此時才可在遊戲內顯示「已保存」；預覽回傳 null。
    }
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

## 平台功能邊界

- 帳號、權限、生涯頁及訪客統計由平台處理；遊戲不索取管理角色、密碼、session、Cookie、CSRF token 或訪客 IP，也不直接呼叫帳號、訪客及管理 API。
- 訪客開啟統計不需要 SDK，統計失敗不能阻擋遊玩。開啟次數不等於完成局次或已保存成績。
- 只有平台管理員（admin）或遊戲管理者（game_manager）可匯入、預覽、確認、發布及下架；玩家及分析員不能操作。遊戲 Release 與平台 OTA 更新各自獨立。
- 平台 API、角色權限、統計、備份及後台操作細節見 [平台參考](platform-api.md)，不屬於遊戲 SDK 接入工作。

## 驗收與上架

1. 完成實際可玩的開始、主要玩法、結束及重新開始流程，填寫 Manifest，封面呈現實際遊戲畫面。
2. 執行專案既有的 build、型別檢查及相關測試，再以最新平台 `main` 工具執行 `game:pack` 與 `game:validate`。另行檢查成品不含帳密、token、私鑰、`.env` 或無關建置檔案；ZIP 驗證不代替機密檢查。
3. 使用真實瀏覽器測試版本／預覽子目錄及跨來源 iframe，設定 `sandbox="allow-scripts allow-same-origin allow-pointer-lock"`、`allow="fullscreen; autoplay; gamepad"`。單獨開啟 `index.html` 或只成功 build 不算完成驗收。
4. 測試所有宣告裝置的完整流程、畫面、資源、console、音效及全螢幕；`mobile` 須能以手機直向觸控完成玩法，主要觸控目標建議至少 44 px。更新需檢查本機存檔相容性。
5. 有 SDK 時測試登入保存、訪客、獨立開啟、管理預覽診斷、重新開始、失敗重試及 session 失效；只有正式 `finishRun()` 回傳 `saved:true` 才顯示已保存。榜單、生涯摘要及本人逐局記錄應正確更新。
6. 獲得發布授權後，推送與 Manifest 一致的 `v<version>` tag，由 workflow 建立附有唯一 `game.zip` 的公開 Release；已發布版本不覆寫。
7. 平台管理員或遊戲管理者在「管理後台 → 遊戲更新 → 加入來源」加入公開 repository，確認 Release 後匯入。支援多位開發者及批量操作，每批最多 100 款；預設最新有效正式版，預發布需手動選擇，匯入完成不會自動上架。
8. 逐款實際預覽後按「確認通過」，再發布。確認按版本保存確認者及時間、管理者共用且可撤銷；新版本需重新確認。首次發布的單款及批量 API 均要求確認，已公開歷史版本可回退。自動驗證、載入成功或 SDK 連線不能代替人工確認，不擅自確認或上架。
9. 批量發布逐款回報，略過已是目標版本的項目；目前版本或上架狀態被其他管理者變更時，刷新並重新確認。上架後再測公開遊玩，保留舊版供回退。

日常流程為「檢查新版 → 勾選並確認 Release → 匯入 → 連續預覽確認 → 發布」。更新候選及待發布版本須高於目前版本；較新的預發布版需手動選擇，未發布舊版不列為待更新，批量發布不能降版。已有目前版本時，未曾發布的舊版亦不能透過單款 API 發布；已公開歷史版本可在「遊戲與版本」回退。背景只檢查，不自動匯入或上架；進入後台沿用五分鐘內成功的檢查結果，GitHub 限流後保留快取並到期自動重試被限流的來源。封存來源不刪除或下架遊戲，完整後台細節見 [平台參考](platform-api.md)。

建議提供暫停或可預期的背景分頁行為、靜音設定，以及清楚的開始／結束狀態。遊戲不應在載入時自動播放聲音；結束後停止不必要的每幀運算與大量下載。無法執行的驗收列為未驗證，不以推測或 mock 宣稱已通過。

# 自行部署 Nginx 與網域

平台 Compose 僅部署 app；啟用 OTA 時另部署 updater。不包含反向代理、DNS 或憑證管理。

## 連接埠與安全邊界

| 用途 | 主機 upstream | 對外 origin 範例 |
| --- | --- | --- |
| 平台與 API | `http://127.0.0.1:3000` | `https://play.example.com` |
| 遊戲與預覽資源 | `http://127.0.0.1:3001` | `https://games.example.com` |

3000/3001 只綁定主機 loopback，不對公網開放。Nginx 在主機上監聽 80/443，TLS 在 Nginx 終止，upstream 使用 HTTP。不要將遊戲域名代理至 3000，也不要在遊戲域名提供管理 API。

兩個 origin 必須使用不同 hostname；只有連接埠不同不能隔離 Cookie。平台仍以 production 模式要求 HTTPS，使用 host-only Secure Cookie，並驗證 Host、Origin 與 CSRF。不要為了讓 HTTP 登入成功而切成 development 模式。

## 設定自己的域名

1. 設定自己的兩個 DNS 記錄及 HTTPS 憑證。
2. 在部署目錄的 `.env` 設定完整 origin，不能帶路徑或結尾 `/`：

```dotenv
PLATFORM_ORIGIN=https://play.example.com
GAMES_ORIGIN=https://games.example.com
```

3. 按 `templates/nginx.conf` 範本設定主機上的 Nginx，替換域名與憑證路徑。範本不能在尚未取得憑證時直接啟用；憑證申請／續期與 default server 由你自己的 Nginx 部署處理。需保留外部的 Host，覆寫 X-Forwarded-For，避免接受客戶端偽造的代理 IP。
4. 重建 app 的容器設定，而不是只 restart。啟用 OTA 的既有部署使用：

```sh
cd /opt/playroom-platform
docker compose -f compose.yaml -f compose.ota.yaml -f ota-state/active.json up -d --no-build --force-recreate --wait app updater
nginx -t
systemctl reload nginx
```

未啟用 OTA 時使用 `docker compose up -d --no-build --force-recreate --wait app`。不要覆寫 `ota-state/active.json`，也不要執行 `down -v`。

5. 從外網驗證兩個 HTTPS 域名、登入／註冊、遊玩 iframe、後台預覽與 OTA 狀態；域名改變後需重新登入。遊戲來源變更也會改變瀏覽器儲存來源，舊域名的 localStorage 存檔不會自動轉移；若遊戲支援存檔匯出／匯入，需另行遷移，這不影響主機保存的遊戲檔案與平台帳號。

## Cloudflare Proxy 與訪客真實 IP

以下適用於「訪客 → Cloudflare Proxy（橙雲）→ 主機 Nginx → app」。開啟 Proxy 後，Nginx 的連線來源是 Cloudflare 節點；若仍直接轉送 `$remote_addr`，訪客統計和 IP 限流會使用節點 IP。

Cloudflare 使用 `CF-Connecting-IP` 傳遞訪客 IP。讓 Nginx 的 realip 模組只接受 Cloudflare 官方網段傳來的這個 header，還原 `$remote_addr`，再按原本設定覆寫 `X-Forwarded-For`。平台沿用 Fastify 的 `request.ip`，不需要修改程式、Compose、updater 或重新 build。不要直接用 `$http_cf_connecting_ip` 覆寫 `X-Forwarded-For`，也不要加入 `set_real_ip_from 0.0.0.0/0` 或 `::/0`，否則直連來源站的請求可以偽造 IP。

1. 核對 [Cloudflare IPv4](https://www.cloudflare.com/ips-v4) 和 [IPv6](https://www.cloudflare.com/ips-v6) 清單；`templates/cloudflare-realip.conf` 保存兩份清單於 2026-10-05 的網段，之後應定期核對。將範本複製到主機的 snippets 目錄：

```sh
cd /opt/playroom-platform
sudo install -d /etc/nginx/snippets
sudo install -m 0644 templates/cloudflare-realip.conf /etc/nginx/snippets/playroom-cloudflare-realip.conf
```

2. 在主機**實際啟用的**平台與遊戲 HTTPS `server` 區塊加入下列 include（`templates/nginx.conf` 已預留註解範例），保留原本的域名、憑證及 upstream：

```nginx
# server 區塊內，location 外
include /etc/nginx/snippets/playroom-cloudflare-realip.conf;

# 原本 location / 內的這一行繼續保留
proxy_set_header X-Forwarded-For $remote_addr;
```

3. Cloudflare SSL/TLS 使用 **Full (strict)** 並保留來源站有效憑證；停用會移除訪客 IP headers 的 Managed Transform。如啟用了 Pseudo IPv4，使用 **Off** 或 **Add Header**；`Overwrite Headers` 會把 IPv6 訪客地址替換為合成 IPv4。
4. 驗證後重新載入主機 Nginx：

```sh
sudo nginx -t && sudo systemctl reload nginx
```

若出現 unknown directive，先確認 `nginx -V` 包含 `--with-http_realip_module`，使用支援此模組的 Nginx 套件。此處不需要重啟 app。

5. 以未登入管理員的瀏覽器經 Cloudflare 網域開啟平台及遊玩遊戲，再到後台查看**新產生**的訪客紀錄，應顯示訪客的公網 IPv4／IPv6，而非 Cloudflare IP；VPN／NAT 使用其對外出口地址。管理員瀏覽本來不會寫入訪客活動。若來源站允許直連，可另外在 Nginx access log 驗證：從非 Cloudflare 網段直連，即使自帶 `CF-Connecting-IP`，也不能取代其連線 IP。遊戲／預覽域名按範本停用 access log，避免記錄預覽憑證。

這是**主機 Nginx 設定變更，OTA 不會套用**。可以在伺服器 pull 取得範本，或直接複製檔案內容；之後仍須修改已啟用設定並 reload，單純 pull 沒有效果。已有的錯誤紀錄不能由 Cloudflare IP 推回原訪客 IP，若另有保留原始 IP 的可信日誌才可另行核對。修正後國家統計會依新紀錄的真實 IP 判定。

此網段範本不適用於 Cloudflare Tunnel，或 Cloudflare 與 Nginx 之間另有負載平衡器／代理的拓撲；它們的直接連線來源不同，需依實際代理鏈設定信任來源。

### Nginx Proxy Manager

NPM 2.16.0 預設信任 CDN 網段，但 realip 使用 `X-Real-IP`；Cloudflare 的訪客 IP 位於 `CF-Connecting-IP`，因此僅有信任網段仍不足以還原地址。不要手動修改 `/data/nginx/proxy_host/*.conf`，NPM 會重新產生這些檔案。

若所有 Proxy Hosts 都適用於「Cloudflare 直接連接 NPM」，可將 `templates/cloudflare-realip.conf` 的內容放入 NPM 的持久化 `/data/nginx/custom/server_proxy.conf`。既有檔案應先備份並合併，避免覆寫其他設定。NPM 會在每個 Proxy Host 的 `server` 區塊載入此檔；範本明確列出的 Cloudflare 網段會取代 http 層繼承的信任網段。若還有其他 CDN／代理的 Proxy Hosts，應按 host 個別配置，不能共用此設定。

目前伺服器 `103.199.19.41` 的 NPM 容器為 `nginx-app-1`，`/root/nginx/data` 掛載至 `/data`，所以已將範本放在 `/root/nginx/data/nginx/custom/server_proxy.conf`，套用至 `playroom.party` 與 `games.playroom.party`。使用：

```sh
docker exec nginx-app-1 nginx -t && docker exec nginx-app-1 nginx -s reload
```

NPM 現有 `proxy.conf` 使用 `$proxy_add_x_forwarded_for`，還原後的 `$remote_addr` 位於代理鏈最右側；平台 Fastify 會以此公網地址為訪客 IP，不採用更左側的客戶端偽造值。2026-10-05 已經 Cloudflare 的 IPv4／IPv6 請求、偽造 X-Forwarded-For，以及從非 Cloudflare 網段直連偽造 headers 驗證，並核對 SQLite 保存的訪客 IP。來源站設定備份於 `/root/nginx/maintenance-cloudflare-backup-20261005/`；app 和 updater 無須重建或重啟。

參考：[Cloudflare 原始訪客 IP](https://developers.cloudflare.com/support/troubleshooting/restoring-visitor-ips/restoring-original-visitor-ips/)、[Cloudflare headers](https://developers.cloudflare.com/fundamentals/reference/http-headers/)、[Nginx realip 模組](https://nginx.org/en/docs/http/ngx_http_realip_module.html)。

## 等待新域名期間

目前移除測試域名的主機配置使用 `https://play.example.invalid` 及 `https://games.example.invalid` 作為佔位 origin。它們不是可遊玩的網站網址；正式服務前必須替換。

主機健康檢查不要求特定 Host：

```sh
curl --fail http://127.0.0.1:3000/api/v1/health
```

其他路由若直接使用 `127.0.0.1:3000` 會回覆 421，這是正常的 Host 防護。僅供主機診斷可附已配置的 Host：

```sh
curl --fail -H 'Host: play.example.invalid' http://127.0.0.1:3000/api/v1/games
```

不要將 `.invalid` 網址當成正式設定；不要將舊測試域名加回 Nginx 的 server_name。第三方 IP-embedded DNS 的解析不受平台控制，移除本站的域名設定不會刪除第三方 DNS 記錄。

## 容器化 Nginx

範本假設 Nginx 在主機上執行。若 Nginx 也在容器內，其 `127.0.0.1` 指向 Nginx 自身，不是 Docker 主機；需將它加入平台的 Compose 網路，以 `http://app:3000` 與 `http://app:3001` 作 upstream。updater 不需公開連接埠。

舊 Caddy 的憑證 volumes 不屬於遊戲資料，移除服務後可留存供人工核對；不應因移除反向代理而清除平台資料 volume。

參考：[Docker loopback port publishing](https://docs.docker.com/engine/network/port-publishing/)、[Nginx proxy_set_header](https://nginx.org/en/docs/http/ngx_http_proxy_module.html#proxy_set_header)。

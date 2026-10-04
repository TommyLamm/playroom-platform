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

5. 從外網驗證兩個 HTTPS 域名、登入／註冊、遊玩 iframe、後台預覽與 OTA 狀態；域名改變後需重新登入。

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

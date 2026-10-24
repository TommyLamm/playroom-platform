# Nginx Proxy Manager security overlay

Temporary security overlay for upstream 2.16.0 while its latest image still contains the affected runtimes and dependencies.

Build from the repository root:

    docker build --pull -f deployment/nginx-proxy-manager/Dockerfile -t playroom-nginx:security-20261023 .

This keeps the upstream application and native SQLite modules, replaces Node 22 with 22.23.4, and replaces every installed copy of the six audited affected versions (other versions are preserved) using a separate locked npm tree with nested dependencies. No installation scripts run. basic-ftp moves from major 5 to 6; verify any FTP proxy usage separately. It is not used by the Playroom HTTPS proxy routes.

The overlay does not patch the OpenResty/Nginx core. Keep HTTP/3, AIO, SSI and alias/rewrite combinations disabled, and set ssl_session_tickets off in the existing persistent /data/nginx/custom/http_top.conf until the upstream core includes the relevant fixes. Review any future custom configuration against the original advisories.

Before replacing the proxy, back up its existing data, certificates, Compose file and image ID. Preserve its existing mounts, networks and the localhost-only management port. Run nginx -t on the new container and verify the platform, game origin and management page. Roll back to the saved image/configuration if these checks fail. Do not delete data volumes.

Revisit this overlay when upstream ships a patched image. Re-audit its actual dependencies rather than carrying replacements forward without review.

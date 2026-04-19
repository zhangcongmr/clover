# Nginx 容器化改造方案

## 背景

pty-server 容器运行在 `--internal` 模式（`pty-network` 网络），该模式下容器端口不对宿主机暴露，仅支持同网络内容器间通过容器名 DNS 通信。

当前 Nginx 直接运行在宿主机上，无法访问 `pty-network` 网络内的 `pty-server-app:3000`，导致 `/terminals` 路由返回 404。

## 网络拓扑

```javascript
改造前（不可通）:
  宿主机 Nginx ──❌──> pty-network (10.89.0.0/24)
                         └── pty-server-app:3000 (internal, 无法从宿主机到达)

改造后（可通）:
  nginx-proxy 容器 ──✅──> pty-network
  (--network pty-network)    └── pty-server-app:3000 (容器间 DNS 可达)
```

## 改造步骤

### 步骤 1：停止宿主机 Nginx

```bash
sudo systemctl stop nginx
sudo systemctl disable nginx
```

### 步骤 2：修改 shared-locations.conf

pty-server 内部使用 HTTPS（自签名证书），Nginx 反向代理时需要跳过 SSL 证书验证。

编辑 `/etc/nginx/shared-locations.conf`，在 `/terminals` location 中添加 `proxy_ssl_verify off;`：

```javascript
location /terminals {
    if ($target_container = "") {
        return 400 "Missing 'name' parameter";
    }
    set $backend "pty-server-app:3000";
    proxy_pass https://$backend;

    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;

    proxy_ssl_verify off;          # 跳过自签名证书验证
    proxy_buffering off;
    proxy_read_timeout 86400;
    proxy_send_timeout 86400;
}
```

### 步骤 3：启动 Nginx 容器

```bash
podman run -d \
  --name nginx-proxy \
  --network pty-network \
  -p 80:80 \
  -p 443:443 \
  -v /etc/nginx/nginx.conf:/etc/nginx/nginx.conf:ro \
  -v /etc/nginx/shared-locations.conf:/etc/nginx/shared-locations.conf:ro \
  -v /etc/nginx/cert.pem:/etc/nginx/cert.pem:ro \
  -v /etc/nginx/cert.key:/etc/nginx/cert.key:ro \
  -v /var/www/html:/etc/nginx/html:ro \
  --restart unless-stopped \
  docker.io/library/nginx:latest
```

# 允许 rootless 绑定低端口（推荐，一劳永逸）
echo 'net.ipv4.ip_unprivileged_port_start=80' | sudo tee -a /etc/sysctl.conf 
sudo sysctl -p  


**参数说明：**

| 参数                                    | 说明                              |
| ------------------------------------- | ------------------------------- |
| `--network pty-network`               | 加入 pty-server 所在网络，启用容器名 DNS 解析 |
| `-p 80:80 -p 443:443`                 | 对外暴露 HTTP/HTTPS 端口              |
| `-v /etc/nginx/nginx.conf`            | 主配置文件（只读）                       |
| `-v /etc/nginx/shared-locations.conf` | location 配置文件（只读）               |
| `-v /etc/nginx/cert.pem`              | HTTPS 证书（只读）                    |
| `-v /etc/nginx/cert.key`              | HTTPS 私钥（只读）                    |
| `-v /var/www/html`                    | 前端静态文件（只读）                      |

### 步骤 4：验证

```bash
# 检查容器状态
podman ps

# 检查 nginx-proxy 日志
podman logs nginx-proxy

# 测试终端连接
curl -k "https://localhost/terminals?cols=80&rows=24&name=cnr-Anonymous&pixelWidth=560&pixelHeight=346&cwd=%2Ftmp"

# 检查 Nginx 容器能否解析 pty-server-app
podman exec nginx-proxy getent hosts pty-server-app
```

## 回滚方案

如果改造后出现问题，可以恢复到宿主机 Nginx（但需要 pty-server 退出 internal 模式）：

```bash
# 停止 Nginx 容器
podman stop nginx-proxy
podman rm nginx-proxy

# 恢复宿主机 Nginx
sudo systemctl enable nginx
sudo systemctl start nginx

# 重启 pty-server（非 internal 模式，暴露端口到宿主机）
cd /home/ta/pty-server
./container-run.sh stop
./container-run.sh run -d --cert-dir ./certs
```

同时需要将 `shared-locations.conf` 中的 `set $backend "pty-server-app:3000"` 改为 `set $backend "localhost:3000"`。

## 日常管理命令

```bash
# 查看 Nginx 容器状态
podman ps --filter name=nginx-proxy

# 查看 Nginx 日志
podman logs -f nginx-proxy

# 重载 Nginx 配置（修改配置后）
podman exec nginx-proxy nginx -s reload

# 测试 Nginx 配置
podman exec nginx-proxy nginx -t

# 停止/启动 Nginx 容器
podman stop nginx-proxy
podman start nginx-proxy
```

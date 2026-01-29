#### 同一 Nginx 下不同路径共享


如果不想用独立域名，也可以在同一主站下设共享路径：

nginx

```
server {
    listen 80;
    server_name example.com;    # 主项目 A
    location /appA/ {
        alias /var/www/appA/;
    }    # 主项目 B
    location /appB/ {
        alias /var/www/appB/;
    }    # 共享静态资源
    location /shared-static/ {
        alias /var/www/shared-static/;
        expires 1y;
        add_header Cache-Control "public, immutable";
    }
}
```

HTML 中引用：

 `<link rel="stylesheet" href="/shared-static/common/css/reset.css">`

⚠️ 注意：这种方式要求所有项目在同一域名下，否则会受同源策略或 CORS 限制（但静态资源一般不需要 CORS，除非用 JS fetch 加载）。
🔐 安全与缓存注意事项

#### 缓存策略要合理

使用 immutable + 长期缓存（如 1 年），但文件名需带 hash（如 utils.a1b2c3.js），避免更新后用户仍用旧缓存。
若无法改文件名，可用查询参数（不推荐，部分代理会忽略）或短缓存。
不要暴露敏感信息
共享目录只放公开资源，不要包含配置、密钥等。
考虑 HTTPS
现代浏览器要求混合内容（HTTP 资源在 HTTPS 页面）被阻止，所以静态资源也应通过 HTTPS 提供。
CORS（仅当跨域加载 JS/CSS 且涉及字体或 canvas 时）
字体文件（.woff, .ttf）通常需要 CORS 头：

nginx

```
https://static.example.com/
```

#### 🧩 进阶建议

使用 CDN 加速 static.example.com，进一步提升全球访问速度。
结合 构建工具（如 Webpack、Vite）将公共依赖提取为 vendor 包，并发布到共享目录。
使用 对象存储（如 AWS S3 + CloudFront、阿里云 OSS）替代本地文件，实现高可用。

## 来源于知乎：[nginx开启ssl并把http重定向到https的两种方式](https://zhuanlan.zhihu.com/p/536322615)

## 1 简介

[Nginx](https://zhida.zhihu.com/search?content_id=207316392&content_type=Article&match_order=1&q=Nginx&zhida_source=entity)是一个非常强大和流行的高性能Web服务器。本文讲解Nginx如何整合https并将http重定向到https。

https相关文章如下：

（1）[Springboot](https://zhida.zhihu.com/search?content_id=207316392&content_type=Article&match_order=1&q=Springboot&zhida_source=entity)整合https原来这么简单

（2）HTTPS之密钥知识与密钥工具[Keytool](https://zhida.zhihu.com/search?content_id=207316392&content_type=Article&match_order=1&q=Keytool&zhida_source=entity)和[Keystore-Explorer](https://zhida.zhihu.com/search?content_id=207316392&content_type=Article&match_order=1&q=Keystore-Explorer&zhida_source=entity)

（3）Springboot以[Tomcat](https://zhida.zhihu.com/search?content_id=207316392&content_type=Article&match_order=1&q=Tomcat&zhida_source=entity)为容器实现http重定向到https的两种方式

（4）Springboot以[Jetty](https://zhida.zhihu.com/search?content_id=207316392&content_type=Article&match_order=1&q=Jetty&zhida_source=entity)为容器实现http重定向到https

![](https://pic2.zhimg.com/v2-9ba859a8e2d770497fca6b575b30ccbb_1440w.jpg)

Nginx的特点：

（1）热启动：例如当修改配置文件后，不需要停止与启动就可以让配置生效，命令如下：

```text
nginx -s reload
```

（2）高并发连接：顶住10万以上连接是没有问题的。

（3）低内存消耗：在高性能的同时，保持很低的内存消耗；

（4）响应请求快；

（5）高可靠性。

Nginx可以做哪些事呢？最常用的功能为下面三个：

（1）静态HTTP服务器，实现动静态分离

（2）反向代理

（3）负载均衡

## 2 安装与使用

CentOS使用下面命令进行安装与使用：

```text
# 添加 Nginx 源
rpm -Uvh http://nginx.org/packages/centos/7/noarch/RPMS/nginx-release-centos-7-0.el7.ngx.noarch.rpm

# 安装 Nginx
yum install -y nginx
# 启动 Nginx
systemctl start nginx.service
# 停止 Nginx
systemctl stop nginx.service
# 设置开机自启 Nginx
systemctl enable nginx.service
# 重新加载
nginx -s reload
```

Mac使用下面命令进行安装和使用：

```text
# 查看是否有安装
brew info nginx
# 安装
brew install nginx
# 启动，默认端口为8080
nginx
# 停止
nginx -s stop
# 重新加载
nginx -s reload
```

安装完后会有提供说明：
Docroot is: /usr/local/var/www

nginx will load all files in /usr/local/etc/nginx/servers/

就知道该在哪放网站资源和配置文件了。

## 3 整合https

## 3.1 生成密钥文件

先通过keytool生成[PKCS12](https://zhida.zhihu.com/search?content_id=207316392&content_type=Article&match_order=1&q=PKCS12&zhida_source=entity)格式的密钥，然后通过[openssl](https://zhida.zhihu.com/search?content_id=207316392&content_type=Article&match_order=1&q=openssl&zhida_source=entity)取出cert和key，具体命令如下：

```text
# 生成PKCS12格式的密钥文件
keytool -genkey -alias localhost -keyalg RSA -keysize 2048 -sigalg SHA256withRSA -storetype PKCS12 -keystore localhost.p12 -dname CN=localhost,OU=Test,O=pkslow,L=Guangzhou,C=CN -validity 731 -storepass changeit -keypass changeit

# 导出pem(certificate)
openssl pkcs12 -nokeys -in ./localhost.p12 -out localhost.pem

# 导出key
openssl pkcs12 -nocerts -nodes -in ./localhost.p12 -out localhost.key
```

## 3.2 配置[nginx.conf](https://zhida.zhihu.com/search?content_id=207316392&content_type=Article&match_order=1&q=nginx.conf&zhida_source=entity)

新建一个nginx.conf文件，把它放在配置加载目录上。要把密钥文件路径配置上去，具体配置如下：

```text
server {
    listen 443 ssl;
    server_name localhost;
  
    ssl_certificate /key-path/localhost.pem;
    ssl_certificate_key /key-path/localhost.key;
    ssl_session_timeout 5m;
    ssl_ciphers ECDHE-RSA-AES128-GCM-SHA256:ECDHE:ECDH:AES:HIGH:!NULL:!aNULL:!MD5:!ADH:!RC4;  
    ssl_protocols TLSv1 TLSv1.1 TLSv1.2;
    ssl_prefer_server_ciphers on; 

    location / {
        proxy_set_header HOST $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;

        proxy_pass http://127.0.0.1:8000/;
    }
}
```

记得要替换key-path为具体的密钥文件的路径。

ssl_certificate：这个配置的是cert文件。

ssl_certificate_key：这个配置的是private key文件。

proxy_pass [http://**127.0.0.1:8000/**](https://link.zhihu.com/?target=http%3A//127.0.0.1%3A8000/)：这个作用是把请求反向代理到这个地址上。

## 4 开启http并重定向到https

## 4.1 开启http

开启http很简单，直接把listen 80;加到listen 443 ssl;上去就可以了。或者新加一个server配置，如下：

```text
server {
    listen 443 ssl;
    server_name localhost;
  
    ssl_certificate /key-path/localhost.pem;
    ssl_certificate_key /key-path/localhost.key;
    ssl_session_timeout 5m;
    ssl_ciphers ECDHE-RSA-AES128-GCM-SHA256:ECDHE:ECDH:AES:HIGH:!NULL:!aNULL:!MD5:!ADH:!RC4;  
    ssl_protocols TLSv1 TLSv1.1 TLSv1.2;
    ssl_prefer_server_ciphers on; 

    location / {
        proxy_set_header HOST $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;

        proxy_pass http://127.0.0.1:8000/;
    }
}

server {
    listen 80;
    server_name localhost;

    location / {
        proxy_set_header HOST $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;

        proxy_pass http://127.0.0.1:8000/;
    }
}
```

## 4.2 重定向到https的两种方式

要把http重定向到https也很简单，具体可以使用两种配置来实现。

第一种方式使用[return 301](https://zhida.zhihu.com/search?content_id=207316392&content_type=Article&match_order=1&q=return+301&zhida_source=entity)如下：

```text
server {
    listen 80;
    server_name localhost;
    return 301 https://127.0.0.1$request_uri;
}
```

第二种方式使用[rewrite](https://zhida.zhihu.com/search?content_id=207316392&content_type=Article&match_order=1&q=rewrite&zhida_source=entity)如下：

```text
server {
    listen 80;
    server_name localhost;
    rewrite ^(.*)$ https://$host$1 permanent;
}
```

对于return和rewrite的区别，可以阅读这篇文章：Creating NGINX Rewrite Rules

## 5 总结

最后，介绍一个工具，可以快速方便获得nginx的配置：Nginx Config。

# @julyware/clover-desktop

Tauri v2 桌面外壳（Rust crate `Clover64`）。这是一个 **私有包**，不发布到 npm；
安装包通过 GitHub Releases 分发。

## 结构

```
packages/desktop/
├── package.json          # 私有包，提供 dev/build/tauri 脚本
└── src-tauri/
    ├── tauri.conf.json   # frontendDist 指向 ../../assistant/dist/clover/browser
    ├── Cargo.toml        # 版本继承 workspace（changesets 统一升级）
    ├── capabilities/
    ├── icons/
    └── src/              # 启动内嵌的 clover-server、server_info 命令
```

前端源码仍然只属于 `packages/assistant`；桌面端只消费它的构建产物。

## 开发与本地构建

```bash
pnpm install

# 开发模式：启动 ng serve（4200），窗口加载 devUrl
pnpm --filter @julyware/clover-desktop dev

# 生产构建：编译前端 + Rust，并打安装包
pnpm --filter @julyware/clover-desktop build
```

`beforeBuildCommand` 执行：

```bash
pnpm --filter @julyware/clover-ui run build:web
```

它会先构建 workspace 依赖（`@julyware/common`、`@julyware/clover-server`、
`@julyware/community-widget`），再用 production 配置构建 Angular（无 source map、
开启 optimization），产物写入 `packages/assistant/dist/clover/browser`，由 Tauri
在编译期嵌入二进制。

## 发布

版本由 changesets 管理，与其它 `@julyware/*` 包一致。发版流程：

```bash
# 1. 在 main 上完成版本 bump 并提交、推送
pnpm release
git add ...
git commit -m "chore: release X.Y.Z"
git push origin main

# 2. 打桌面端 tag（tag 必须与 packages/desktop/package.json 一致）
git tag clover-desktop-vX.Y.Z
git push origin clover-desktop-vX.Y.Z
```

`.github/workflows/release-desktop.yml` 会：

1. 校验 tag 与 `packages/desktop/package.json`、`Cargo.toml` 版本一致；
2. 在 4 个平台构建：
   - Windows x64：`.msi` + NSIS `-setup.exe`
   - macOS Apple Silicon：`.dmg`
   - macOS Intel：`.dmg`
   - Linux x64：`.AppImage` + `.deb` + `.rpm`
3. 创建 **draft** GitHub Release 并上传安装包；检查无误后在网页上手动 Publish。

### 重新构建某个平台

某个平台失败时不用重打 tag。在包含修复的分支上手动触发即可，产物会继续上传到
已存在的 draft Release：

```bash
gh workflow run release-desktop.yml --ref main
gh run list -L 1
gh run watch
```

手动触发会用当前引用的代码构建，但 Release 仍使用 `packages/desktop/package.json`
对应版本拼出的 `clover-desktop-vX.Y.Z` tag。

桌面端和 CLI 的 tag 相互独立：

```
clover-cli-vX.Y.Z        # npm 二进制（5 平台）
clover-desktop-vX.Y.Z    # GitHub Release 安装包（4 平台）
```

两个 tag 都可以指向同一个版本提交。

## 签名与自动更新

当前 workflow 已接好 macOS 签名/公证的 env 变量，但需要你配置仓库 secrets 才会生效：

| secret | 用途 |
|---|---|
| `APPLE_CERTIFICATE` | Developer ID `.p12` 的 base64 |
| `APPLE_CERTIFICATE_PASSWORD` | `.p12` 密码 |
| `APPLE_SIGNING_IDENTITY` | 例如 `Developer ID Application: ...` |
| `APPLE_ID` / `APPLE_PASSWORD` / `APPLE_TEAM_ID` | 公证账号（app-specific password） |

未配置时 workflow 会自动跳过签名步骤并产出未签名包（构建不会失败）：macOS 会被
Gatekeeper 拦截，Windows 未做 Authenticode 签名，会出现 SmartScreen 提示。

> 注意：不要把 `${{ secrets.APPLE_CERTIFICATE }}` 直接塞进 env。未配置的 secret 会
> 变成空字符串，而 tauri-bundler 看到该变量存在就会尝试导入证书，报
> `SecKeychainItemImport: Unable to decode the provided data`。
> workflow 现在只在 secret 非空时才导出这些变量。

自动更新尚未启用。要开启需要：

1. 引入 `tauri-plugin-updater`；
2. `bundle.createUpdaterArtifacts: true`；
3. 配置 `plugins.updater.endpoints` 与公钥；
4. 把 workflow 的 `includeUpdaterJson` 改为 `true`，并配置
   `TAURI_SIGNING_PRIVATE_KEY` / `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`。

在此之前 `TAURI_SIGNING_PRIVATE_KEY` 不会产生任何效果。
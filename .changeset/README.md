# Changesets 使用说明

本仓库使用 [Changesets](https://github.com/changesets/changesets) 管理发版与版本号升级。当前固定分组同步发版：`@julyware/clover-agent`、`@julyware/clover-ui`、`@julyware/clover` 三个包始终使用同一版本号，一次提交统一升级。

## 相关命令

```bash
pnpm changeset          # 交互式添加变更说明（选择 patch / minor / major）
pnpm version-packages   # 执行 changeset version：统一 bump 版本 + 更新 CHANGELOG + 同步内部依赖
pnpm release            # 先 version-packages，再发布三个包（会触发各包 prepublishOnly 构建）
```

## 日常流程

### 1. 代码改动时（每个需要发版的改动）

```bash
pnpm changeset
```

按提示选择：
- `patch`（0.1.0 → 0.1.1）：bug 修复、小改动
- `minor`（0.1.0 → 0.2.0）：新功能（向后兼容）
- `major`（0.1.0 → 1.0.0）：破坏性变更

会在 `.changeset/` 下生成一个 `*.md` 变更说明文件，与代码一起提交（普通 commit）。

### 2. 发版时

```bash
pnpm version-packages
```

- 三个包统一升级版本号
- 生成/更新各包的 `CHANGELOG.md`
- 同步包间 `workspace:*` 内部依赖版本

然后手动提交（一次 git commit）：

```bash
git add -A
git commit -m "chore: release vX.Y.Z"
git push
```

> 注意：`pnpm-workspace.yaml`、`pnpm-lock.yaml` 按仓库规则不纳入提交，提交前请排除：
> ```bash
> git restore --staged pnpm-workspace.yaml pnpm-lock.yaml
> ```

### 3. 发布

```bash
pnpm release
```

等价于先执行 `pnpm version-packages`，再对三个发布包执行 publish（publish 时会先跑各包的 `prepublishOnly` 构建）。

## 配置说明（.changeset/config.json）

| 配置项 | 值 | 说明 |
| --- | --- | --- |
| `commit` | `false` | 不自动 commit/tag，由开发者手动提交，便于遵守仓库 commit 规则 |
| `fixed` | 三个包 | 固定分组，统一版本号同步发版 |
| `ignore` | `common`、`community-widget` | 排除在 Changesets 管理之外 |
| `access` | `public` | 按公开包发布（npm 需要登录且有权限） |
| `baseBranch` | `main` | 版本比较基准分支 |

## 其他说明

- private 包（home、signin 等）由 Changesets 自动跳过。
- 发版后如需 tag 可手动执行：`git tag vX.Y.Z && git push --tags`。
- 若某个改动不需要发版，可运行 `pnpm changeset add --empty` 生成空 changeset 跳过该包。

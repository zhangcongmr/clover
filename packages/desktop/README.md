# @julyware/clover-desktop

Tauri v2 desktop shell (Rust crate `Clover64`). This is a **private package**, not published to npm;
installers are distributed through GitHub Releases.

## Structure

```
packages/desktop/
├── package.json          # private package, provides dev/build/tauri scripts
└── src-tauri/
    ├── tauri.conf.json   # frontendDist points to ../../assistant/dist/clover/browser
    ├── Cargo.toml        # version inherited from the workspace (bumped together by changesets)
    ├── capabilities/
    ├── icons/
    └── src/              # starts the embedded clover-server, server_info command
```

The frontend source still belongs only to `packages/assistant`; the desktop app just consumes its build output.

## Window visibility at startup

The main window in `tauri.conf.json` is declared with `"visible": false` and `"create": false`, and is
created explicitly by `create_main_window` in `src/lib.rs` during `setup`:

- The window is created hidden first, and the WebView and API server start in parallel;
- It is shown with `show()` only after `PageLoadEvent::Finished` fires (document and CSS ready, first frame painted);
- Fallback: if `Finished` never arrives within 5 seconds (dev server down, broken build output, etc.) the window is still shown,
  so the app never "starts but stays invisible".

The reason: if a Tauri window is shown before the WebView has content, it flashes an empty frame — on
Windows that means the window's default background (black) around a WebView child window that has not
filled it yet, which looks like "a black frame flashing by during startup". `backgroundColor` is set to the
UI's default background (`#ffffff`, matching the default of `--vscode-background` in `styles.css`) as a second layer of insurance.

## Window size and position

- **Default size**: `width` / `height` in `tauri.conf.json` (`1280 × 800`, logical pixels) are also the
  size the window returns to when the user unmaximizes it. `preventOverflow` shrinks that default on
  displays whose work area is smaller, so the window never opens larger than the screen.
- **Remembered geometry**: after the first session the size, position and maximized state come from
  `~/.clover/desktop-window.json` (physical pixels) instead of the config defaults. The file is written
  when the main window closes and, as a fallback, on `RunEvent::Exit`.
- Only the geometry seen in the *normal* state is stored: a maximized window reports the screen size and
  a minimized one `0×0`, neither of which is the size the user gets back on unmaximize. The maximized flag
  is stored separately and re-applied after the size.
- A remembered rectangle that no longer overlaps a monitor (undocked laptop, removed display, changed
  resolution) is ignored in favor of the config defaults, and one that is larger than the current work area
  is shrunk to fit.

`WindowMemory` in `src/lib.rs` keeps the value in memory during the session, so dragging and resizing do
not touch the disk; only closing the window does.

## Development and local builds

```bash
pnpm install

# Dev mode: starts ng serve (4200), the window loads devUrl
pnpm --filter @julyware/clover-desktop dev

# Production build: compiles the frontend + Rust and packages installers
pnpm --filter @julyware/clover-desktop build
```

`beforeBuildCommand` runs:

```bash
pnpm --filter @julyware/clover-ui run build:web
```

It first builds the workspace dependencies (`@julyware/common`, `@julyware/clover-server`,
`@julyware/community-widget`), then builds Angular with the production configuration (no source maps,
optimization enabled). The output goes to `packages/assistant/dist/clover/browser`, and Tauri embeds it
into the binary at compile time.

## Release

Versions are managed by changesets, like the other `@julyware/*` packages. Release flow:

```bash
# 1. Bump versions on main, commit and push
pnpm release
git add ...
git commit -m "chore: release X.Y.Z"
git push origin main

# 2. Tag the desktop app (the tag must match packages/desktop/package.json)
git tag clover-desktop-vX.Y.Z
git push origin clover-desktop-vX.Y.Z
```

`.github/workflows/release-desktop.yml` will:

1. Verify that the tag matches the versions in `packages/desktop/package.json` and `Cargo.toml`;
2. Build on 4 platforms:
   - Windows x64: `.msi` + NSIS `-setup.exe`
   - macOS Apple Silicon: `.dmg`
   - macOS Intel: `.dmg`
   - Linux x64: `.AppImage` + `.deb` + `.rpm`
3. Create a **draft** GitHub Release and upload the installers; publish it manually on the web once verified.

### Rebuilding a single platform

When one platform fails, there is no need to re-tag. Trigger the workflow manually on a branch that
contains the fix, and the artifacts will continue uploading to the existing draft Release:

```bash
gh workflow run release-desktop.yml --ref main
gh run list -L 1
gh run watch
```

A manual trigger builds the code at the current ref, but the Release still uses the
`clover-desktop-vX.Y.Z` tag derived from the version in `packages/desktop/package.json`.

The desktop and CLI tags are independent of each other:

```
clover-cli-vX.Y.Z        # npm binaries (5 platforms)
clover-desktop-vX.Y.Z    # GitHub Release installers (4 platforms)
```

Both tags may point to the same version commit.

## Signing and auto-update

The workflow already wires up the env variables for macOS signing/notarization, but they only take
effect once you configure the repository secrets:

| Secret | Purpose |
|---|---|
| `APPLE_CERTIFICATE` | base64 of the Developer ID `.p12` |
| `APPLE_CERTIFICATE_PASSWORD` | `.p12` password |
| `APPLE_SIGNING_IDENTITY` | e.g. `Developer ID Application: ...` |
| `APPLE_ID` / `APPLE_PASSWORD` / `APPLE_TEAM_ID` | Notarization account (app-specific password) |

When they are not configured, the workflow skips the signing step and produces unsigned packages (the
build does not fail): macOS will be blocked by Gatekeeper, and Windows has no Authenticode signature, so SmartScreen will warn.

> Note: do not put `${{ secrets.APPLE_CERTIFICATE }}` directly into env. An unset secret becomes an
> empty string, and when tauri-bundler sees the variable present it tries to import the certificate and
> fails with `SecKeychainItemImport: Unable to decode the provided data`.
> The workflow now exports these variables only when the secret is non-empty.

Auto-update is not enabled yet. To enable it you need to:

1. Add `tauri-plugin-updater`;
2. Set `bundle.createUpdaterArtifacts: true`;
3. Configure `plugins.updater.endpoints` and the public key;
4. Change `includeUpdaterJson` in the workflow to `true`, and configure
   `TAURI_SIGNING_PRIVATE_KEY` / `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`.

Until then, `TAURI_SIGNING_PRIVATE_KEY` has no effect.
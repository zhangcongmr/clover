# @julyware/clover-ui

## 0.1.3

### Patch Changes

- Release v0.1.3: accumulated changes since 0.1.2.
  
  - ACP agents: install/uninstall from the registry, persisted `~/.clover/acp.json`, status pushed over a global SSE stream, and typed request/response interfaces for all agent endpoints.
  - Multi-agent collaboration: session-primary collaboration space with four modes, role presets, and per-agent mode/model settings.
  - Assistant UI: content-first dock layout, unified chat input, tool-call rendering (shell/edit/search), and virtual-scroll chat history.
  - Knowledge base: RAG MCP server with manager dialog and result cards, plus KaTeX math rendering and the A2UI JSON renderer.
  - Skills and MCP management: local skills store, HTTP catalogs, aggregated official MCP registry.
  - Themes: theme library with SVG previews, built-in presets, and IndexedDB persistence.
  - Fixes: agent status column alignment, ACP agent warmup deferred until first request, and a CJS build warning in the pty module.

## 0.1.2

## 0.1.1

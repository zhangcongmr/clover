# Plan: App Header Navigation Menu

## Status: COMPLETED ✅

All tasks have been implemented and the build passes successfully.

---

## Summary

Implemented a grouped navigation menu for the hamburger button with hover-triggered submenus. The menu uses a new `ast-submenu` component as a prerequisite for submenu support.

### Final Menu Structure

```
File        ▶ → New File, Open File, Import API
View        ▶ → Search, Terminal
Theme Prompt      (single item, no submenu)
Settings    ▶ → Settings, User Center
---
Sign In / Sign Out
```

- Arrow icons are SVG chevrons (`polyline points="9 18 15 12 9 6"`)
- Arrows are right-aligned in each menu row via `margin-left: auto`

---

## Implemented Features

### Part 1: `ast-submenu` Component

**New Files:**
- `packages/assistant/src/app/shared/ast-menu/ast-submenu.component.ts`
- `packages/assistant/src/app/shared/ast-menu/ast-submenu.component.html`
- `packages/assistant/src/app/shared/ast-menu/ast-submenu.component.css`

**Features:**
- Hover-triggered submenu with 200ms open delay / 300ms close grace period
- Fixed positioning with viewport boundary detection
- Parent element binding via `@Input() parentItem`

### Part 2: `ast-menu` Close Logic

**Modified:** `packages/assistant/src/app/shared/ast-menu/ast-menu.component.ts`

- `documentClickHandler` now checks child `[ast-submenu]` elements before closing
- `windowBlurHandler` now checks child `[ast-submenu]` elements before closing

### Part 3: Submenu CSS

**Modified:** `packages/assistant/src/app/shared/ast-menu/ast-menu.component.css`

```css
:host(.codigma-right-menu) .has-submenu {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
}

:host(.codigma-right-menu) .submenu-arrow {
  margin-left: auto;
  width: 16px;
  height: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0.6;
  flex-shrink: 0;
}

:host(.codigma-right-menu) .submenu-container {
  background: var(--vscode-editorWidget-background);
  border: 1px solid var(--vscode-editorGroup-border);
  box-shadow: var(--vscode-shadow-md, 0 4px 12px rgba(0, 0, 0, 0.15));
  border-radius: var(--vscode-radius-sm, 4px);
  min-width: 160px;
  font-size: var(--vscode-menu-font-size, 13px);
  color: var(--vscode-foreground);
  z-index: 1001;
}
```

### Part 4: Hamburger Menu HTML

**Modified:** `packages/assistant/src/app/app.component.html`

Grouped menu items with `has-submenu` class and `ast-submenu` components:
- File group: New File, Open File, Import API
- View group: Search, Terminal
- Theme Prompt (single item)
- Settings group: Settings, User Center
- Auth: Sign In / Sign Out

### Part 5: Component State

**Modified:** `packages/assistant/src/app/app.component.ts`

```typescript
import { AstSubmenuComponent } from './shared/ast-menu/ast-submenu.component';

@ViewChild('fileSubmenu') fileSubmenuRef!: AstSubmenuComponent;
@ViewChild('viewSubmenu') viewSubmenuRef!: AstSubmenuComponent;
@ViewChild('settingsSubmenu') settingsSubmenuRef!: AstSubmenuComponent;

get fileSubmenuEl(): HTMLElement | undefined {
  return this.fileSubmenuRef?.nativeElement?.parentElement ?? undefined;
}
get viewSubmenuEl(): HTMLElement | undefined {
  return this.viewSubmenuRef?.nativeElement?.parentElement ?? undefined;
}
get settingsSubmenuEl(): HTMLElement | undefined {
  return this.settingsSubmenuRef?.nativeElement?.parentElement ?? undefined;
}
```

### Part 6: Menu Item Styles

**Modified:** `packages/assistant/src/app/app.component.css`

```css
.app-menu-dropdown .app-menu-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  cursor: pointer;
  color: var(--vscode-foreground);
  font-size: var(--vscode-menu-font-size, 13px);
  background: var(--vscode-editorWidget-background);
  width: 100%;
  box-sizing: border-box;
}
```

---

## Files Summary

| File | Action | Purpose |
|------|--------|---------|
| `shared/ast-menu/ast-submenu.component.ts` | CREATE | Submenu component with hover trigger, positioning |
| `shared/ast-menu/ast-submenu.component.html` | CREATE | Submenu template |
| `shared/ast-menu/ast-submenu.component.css` | CREATE | Submenu positioning, z-index |
| `shared/ast-menu/ast-menu.component.ts` | MODIFY | Submenu-aware close logic |
| `shared/ast-menu/ast-menu.component.css` | MODIFY | `.has-submenu`, `.submenu-arrow`, `.submenu-container` styles |
| `app.component.ts` | MODIFY | Add `AstSubmenuComponent` import + ViewChild refs |
| `app.component.html` | MODIFY | Grouped hamburger menu HTML |
| `app.component.css` | MODIFY | Menu item width/box-sizing |

---

## Verification

```bash
pnpm --filter ./packages/assistant build
```

Build passes with pre-existing SSR warnings (not related to our changes).

### Test Checklist

1. ✅ Click hamburger → menu opens with grouped items
2. ✅ Hover "File" → submenu opens with New File, Open File, Import API
3. ✅ Hover "View" → submenu opens with Search, Terminal
4. ✅ Hover "Settings" → submenu opens with Settings, User Center
5. ✅ Click "Theme Prompt" → directly executes action
6. ✅ Click any submenu item → action executes, all menus close
7. ✅ Mouse moves from parent to submenu → submenu stays open
8. ✅ Mouse leaves submenu area → submenu closes after 300ms delay
9. ✅ Click outside → everything closes immediately
10. ✅ Arrow icons are SVG chevrons, right-aligned in each row

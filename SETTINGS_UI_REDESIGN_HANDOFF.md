# Settings UI Redesign — Handoff Document

## Current State (v1.1.0-plugin)

### Entry Points
| Feature | Current Location | Issues |
|---------|------------------|--------|
| **Settings** | File menu → "Settings" | Buried in menu, no keyboard shortcut visible |
| **Manage Plugins** | Toolbar puzzle icon → Modal | Separate from settings, duplicate UI patterns |
| **Themes** | Not exposed | Only CSS variable toggle in editor |

### Plugin Manager Modal (`src/ui/plugins-panel.js`)
- **2358 lines**, single class `PluginManagerPanel`
- Does too much: list, detail, settings, permissions, registry, install, uninstall
- `togglePlugin` overhaul done but still fragile
- `_renderDetailView` = 1000+ lines, 7 tabs rendered inline
- State management scattered: `selectedPluginId`, `detailTab`, `inFlightActions`, `settingsMap`
- No separation between data layer and UI layer

### Side Nav (`src/ui/utilityPane.js`)
- Top section: File, Edit, View, Insert, Workspace
- Bottom: Only "Keyboard Shortcuts"
- No Settings entry

---

## Target Design

### 1. Side Nav Bar — Add Settings at Bottom
```
┌─────────────────────┐
│ File                │
│ Edit                │
│ View                │
│ Insert              │
│ Workspace           │
│ ──────────────────  │
│ ⚙ Settings        ← NEW, bottom, always visible
└─────────────────────┘
```
- Settings entry at bottom, separated by divider
- Icon: `Settings` (lucide)
- Click → opens Settings Dialog

### 2. Settings Dialog — Professional Vertical Tab Layout
```
┌─────────────────────────────────────────────┐
│ Settings                                    │
├──────────┬──────────────────────────────────┤
│ 📁 General │                                │
│ 🎨 Appearance│  Content pane (vertical tabs)│
│ 🔌 Plugins │                                │
│ ⌨ Shortcuts│                                │
│ 🔒 Privacy  │                                │
│ ──────────┤                                │
│ ℹ About     │                                │
└──────────┴──────────────────────────────────┘
```
- **Left sidebar**: Vertical tab list (fixed width ~200px)
- **Right pane**: Scrollable content for selected tab
- **Bottom**: "Done" button (closes dialog)
- **Keyboard**: `Escape` to close, `Tab`/`Shift+Tab` navigation

#### Tabs & Content

| Tab | Key | Content |
|-----|-----|---------|
| **General** | `general` | Startup behavior, auto-save interval, default folder, language |
| **Appearance** | `appearance` | **Theme selector** (Light/Dark/System + custom), font size, line height, editor width |
| **Plugins** | `plugins` | **Embedded Manage Plugins UI** (list + detail, same as current modal but embedded) |
| **Shortcuts** | `shortcuts` | Searchable list of all commands with editable keybindings |
| **Privacy** | `privacy` | Telemetry opt-out, crash reporting, update channel |
| **About** | `about` | Version, build info, license, check for updates |

### 3. Manage Plugins — Embedded in Settings Dialog
- **Same functionality** as current modal but:
  - No modal overlay — embedded in right pane
  - List view on left (or top), detail on right (or bottom)
  - Same tabs: Overview, Settings, Contributions, Permissions, Location, Manage, Registry
  - Same actions: enable/disable, uninstall, install from folder/GitHub, hot reload
- **Responsive**: Side-by-side on wide dialog, stacked on narrow

### 4. Theme System (Appearance Tab)
- **Presets**: Light, Dark, System (follows OS)
- **Custom**: Color picker for `--fm-bg`, `--fm-text`, `--fm-accent`, `--fm-border`
- **Live preview**: Apply immediately without restart
- **Persist**: Save to `settings.json` + apply CSS variables on startup

---

## Implementation Plan

### Phase 1: Side Nav + Settings Dialog Shell (Day 1-2)
1. **Add Settings to side nav** (`src/ui/utilityPane.js`)
   - Add `Settings` item at bottom with divider
   - Click handler → `window.settingsAPI.open()`

2. **Create Settings Dialog component** (`src/ui/settingsDialog.js` — NEW)
   - Vertical tab list + content pane
   - Tab registry: `tabs = [{ id, label, icon, component }]`
   - `open()` / `close()` methods, `Escape` handling
   - Focus management (trap focus, restore on close)

3. **Wire up** in `src/editor.js` → instantiate dialog, expose `window.settingsAPI.open()`

### Phase 2: Tabs — General, Appearance, About (Day 2-3)
1. **General tab** — Form with inputs bound to `settingsAPI`
2. **Appearance tab** — 
   - Theme selector (radio group: Light/Dark/System/Custom)
   - Custom theme → color pickers for CSS variables
   - Live preview via `document.documentElement.style.setProperty()`
3. **About tab** — Static content + "Check for updates" button

### Phase 3: Plugins Tab — Embed Plugin Manager (Day 3-4)
1. **Extract PluginManagerPanel** into reusable component
   - Split `PluginManagerPanel` into:
     - `PluginListView` — list + filters + actions
     - `PluginDetailView` — tabs + content
     - `PluginManager` — orchestrator (state + data)
   - Make `PluginManager` accept `container` + `mode: 'modal' | 'embedded'`

2. **Plugins tab** — Instantiate `PluginManager` in embedded mode
   - Pass settings dialog's right pane as container
   - Same data source (`pluginManager` API)

3. **Remove old modal** — Delete `PluginManagerPanel` modal code, keep only embedded

### Phase 4: Shortcuts + Privacy + Polish (Day 4-5)
1. **Shortcuts tab** — 
   - Fetch all commands from `commandRegistry`
   - Group by category, editable keybinding inputs
   - Conflict detection
2. **Privacy tab** — Toggles for telemetry, crash reports, auto-update
3. **Polish** — Animations, focus traps, responsive layout, keyboard nav

---

## File Map (Target)

```
src/
├── ui/
│   ├── utilityPane.js          ← Add Settings at bottom
│   ├── settingsDialog.js       ← NEW: Vertical tab dialog
│   ├── settingsTabs/
│   │   ├── index.js            ← Tab registry + base class
│   │   ├── generalTab.js       ← General settings form
│   │   ├── appearanceTab.js    ← Theme selector + custom colors
│   │   ├── pluginsTab.js       ← Embedded PluginManager
│   │   ├── shortcutsTab.js     ← Keybinding editor
│   │   ├── privacyTab.js       ← Telemetry toggles
│   │   └── aboutTab.js         ← Version + update check
│   ├── pluginManager/
│   │   ├── index.js            ← Orchestrator (NEW)
│   │   ├── pluginListView.js   ← List + filters (extracted)
│   │   ├── pluginDetailView.js ← Detail tabs (extracted)
│   │   └── pluginRegistryView.js ← Registry tab
│   └── ...
├── editor.js                   ← Instantiate SettingsDialog
└── preload.js                  ← Expose settingsAPI, themeAPI
```

---

## API Contracts

### `window.settingsAPI` (preload → renderer)
```typescript
interface SettingsAPI {
  // Core
  get(key: string): Promise<any>;
  set(key: string, value: any): Promise<void>;
  getAll(): Promise<Record<string, any>>;
  register(key: string, defaultValue: any, meta?: SettingMeta): Promise<void>;
  onChange(cb: (key: string, value: any) => void): () => void;

  // Dialog
  open(): void;
  close(): void;
  onOpen(cb: () => void): () => void;
  onClose(cb: () => void): () => void;
}
```

### `window.themeAPI` (NEW)
```typescript
interface ThemeAPI {
  getTheme(): 'light' | 'dark' | 'system' | 'custom';
  setTheme(theme: 'light' | 'dark' | 'system' | 'custom'): void;
  getCustomColors(): Record<string, string>;
  setCustomColor(key: string, value: string): void;
  applyTheme(): void; // applies to document.documentElement
}
```

---

## Migration Notes

### Remove / Deprecate
| File | Action |
|------|--------|
| `src/ui/plugins-panel.js` | **Delete** — replace with `pluginManager/` components |
| `src/ui/utilityPane.js` | Modify — add Settings entry |
| `src/editor.js` | Add SettingsDialog instantiation |
| File menu "Settings" | Remove |

### Preserve Logic
- All `pluginManager` IPC calls (`enable`, `disable`, `install`, `uninstall`, `getSettings`, `setSetting`, `reload`, `devReload`)
- Plugin detail tabs: Overview, Settings, Contributions, Permissions, Location, Manage, Registry
- Registry fetch via `pluginRegistryAPI.getRegistry()`
- Hot reload (`devReload`) in dev mode
- In-flight action guards (`inFlightActions`)

---

## Acceptance Criteria

| Criterion | Test |
|-----------|------|
| Settings at bottom of side nav | Click → opens dialog |
| Dialog has vertical tabs | 7 tabs visible, click switches pane |
| Appearance tab changes theme live | Select "Dark" → editor darkens immediately |
| Custom theme colors persist | Restart app → colors restored |
| Plugins tab shows full manager | Enable/disable/uninstall works |
| Shortcuts tab edits keybindings | Change shortcut → works immediately |
| Dialog closes on Escape | Press Escape → dialog closes |
| Focus trapped in dialog | Tab cycles within dialog only |
| Responsive: narrow dialog stacks tabs | Resize dialog < 800px → tabs stack vertically |

---

## Estimated Effort

| Phase | Days |
|-------|------|
| 1. Side nav + Dialog shell | 2 |
| 2. General/Appearance/About tabs | 2 |
| 3. Plugins tab (extract + embed) | 2 |
| 4. Shortcuts/Privacy + Polish | 2 |
| **Total** | **~8 days** |

---

## Quick Start for Next Agent

```bash
# 1. Branch
git checkout -b settings-redesign

# 2. Create dialog shell
touch src/ui/settingsDialog.js
touch src/ui/settingsTabs/{index,general,appearance,plugins,shortcuts,privacy,about}Tab.js

# 3. Add to utilityPane.js (see handoff)
# 4. Wire in editor.js
# 5. Extract pluginManager components
# 6. Delete plugins-panel.js when done
```

---

## Notes

- **CSS Variables**: All theming via `--fm-*` on `:root` — no inline styles
- **No new deps** — Use existing `lucide` icons, native `<dialog>` or custom overlay
- **Accessibility**: ARIA roles on tabs (`tablist`, `tab`, `tabpanel`), focus management
- **Performance**: Lazy-load tab components on first click
- **Backward compat**: `window.settingsAPI.open()` keeps working for any existing callers

---

*Generated from current codebase analysis. Update as implementation progresses.*
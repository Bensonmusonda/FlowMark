# Plugin Enhancements — Compressed Execution Plan

**Target: 10 working days (2 weeks max)** — vibe-coded, AI-optimized, no ceremonies.

---

## Principles for Maximum Velocity

| Rule | Why |
|------|-----|
| **One file per task** | Parallelizable, reviewable, revertible |
| **Types first, impl second** | Catches design errors before code; AI writes better impl against fixed interfaces |
| **Test in app, not unit tests** | Electron + CM6 = integration reality; headless probes only for pure logic |
| **Copy-paste existing patterns** | `plugin-host.js`, `plugin-preload.js`, `preload.js` are your templates |
| **No new dependencies** | Use what's in `package.json` (Electron, CM6, Zod for validation if present) |

---

## Phase 0: TypeScript Definitions (Day 1, 2h)

**File:** `src/plugins/plugin-api.d.ts` — single source of truth for plugin authors + AI completion.

```typescript
// Core API surface — extend only with deliberate decision
export interface FlowmarkPluginAPI {
  // Metadata
  readonly id: string;
  readonly permissions: readonly string[];
  hasPermission(perm: string): boolean;

  // Editor
  editor: {
    getContent(): Promise<string>;
    setContent(content: string): Promise<void>;
    getSelection(): Promise<{ from: number; to: number; empty: boolean; text: string }>;
    setSelection(sel: { anchor: number; head: number }): Promise<void>;
    replaceSelection(text: string, from?: number): Promise<void>;  // from = triggerPos for slash
    executeCommand(commandId: string): Promise<void>;
    onContentChange(cb: (doc: string) => void): () => void;
    onSelectionChange(cb: (sel: { from: number; to: number; empty: boolean }) => void): () => void;
    registerSlashCommand(cmd: SlashCommandMeta): Promise<void>;
    removeSlashCommand(commandId: string): Promise<void>;
  };

  // Files
  file: {
    read(path?: string): Promise<string | null>;
    write(path: string, content: string): Promise<void>;
    save(content: string, defaultPath?: string): Promise<{ filePath?: string; canceled?: boolean }>;
    export(format: 'html', content: string): Promise<{ html?: string; error?: string }>;
    pickFile(options?: { title?: string; filters?: Array<{ name: string; extensions: string[] }> }): Promise<string | null>;
    pickFolder(): Promise<string | null>;
  };

  // Settings
  settings: {
    get(key: string): Promise<any>;
    set(key: string, value: any): Promise<void>;
    register(key: string, defaultValue: any, meta?: SettingMeta): Promise<void>;
    getAll(): Promise<Record<string, any>>;
    onChange(cb: (key: string, value: any) => void): () => void;
  };

  // UI
  ui: {
    addMenuItem(section: MenuSection, item: MenuItem): Promise<void>;
    removeMenuItem(itemId: string): Promise<void>;
    setStatusBar(text: string, opts?: { side?: 'left' | 'right'; timeout?: number }): Promise<void>;
    showNotification(title: string, body: string, opts?: { timeout?: number }): Promise<void>;
    registerCommand(cmd: CommandMeta): Promise<void>;
    registerSidebarPanel(panel: SidebarPanelMeta): Promise<void>;
    removeSidebarPanel(panelId: string): Promise<void>;
    registerCustomView(view: CustomViewMeta): Promise<void>;
    openCustomView(viewId: string, opts?: { name?: string; state?: any }): Promise<void>;
    removeCustomView(viewId: string): Promise<void>;
  };

  // Custom views
  views: {
    registerCustomView(view: CustomViewMeta): Promise<void>;
    open(viewId: string, opts?: { name?: string; state?: any }): Promise<void>;
    removeCustomView(viewId: string): Promise<void>;
  };

  // Clipboard
  clipboard: {
    readText(): Promise<string>;
    writeText(text: string): Promise<void>;
    readHTML(): Promise<string>;
    writeHTML(html: string): Promise<void>;
    registerSmartPaste(handler: SmartPasteHandler): Promise<{ success: boolean }>;
  };

  // Network
  network: {
    fetch(url: string, opts?: RequestInit): Promise<{ status: number; data: any; headers: Record<string, string> }>;
  };

  // Events
  on(event: string, cb: (data: any) => void): () => void;
  emit(event: 'log', data: { level: 'info' | 'warn' | 'error'; args: any[] }): void;

  // Logging
  log(...args: any[]): void;
  warn(...args: any[]): void;
  error(...args: any[]): void;
}

// Supporting types (minimal, no fluff)
export type MenuSection = 'file' | 'edit' | 'insert' | 'view' | 'plugins';
export interface MenuItem { id: string; label: string; shortcut?: string; icon?: string; run?: () => void; }
export interface CommandMeta { id: string; label: string; shortcut?: string; icon?: string; run: () => void; }
export interface SlashCommandMeta { id: string; label: string; run: (triggerPos: number) => Promise<void>; }
export interface SettingMeta { type?: 'string' | 'number' | 'boolean' | 'select' | 'color' | 'path'; label?: string; description?: string; options?: string[]; }
export interface SidebarPanelMeta { id: string; title: string; icon?: string; location?: 'left' | 'right'; entry: string; }
export interface CustomViewMeta { id: string; name: string; extensions: string[]; entry: string; }
export type SmartPasteHandler = (data: { text: string; html: string }) => Promise<{ text: string; html: string } | string>;
```

**Deliverable:** This file. Run `tsc --noEmit` to verify. Commit.

---

## Phase 1: Settings UI + Manifest Validation (Day 1-2)

### 1.1 Manifest Schema + Validation (2h)

**File:** `src/plugins/manifest-schema.ts` (new)

```typescript
import { z } from 'zod'; // add if missing: npm i zod

export const ManifestSchema = z.object({
  name: z.string().min(1).regex(/^[a-z0-9-]+$/),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  manifest_version: z.literal(1),
  description: z.string().optional(),
  entry_point: z.string().min(1),
  permissions: z.array(z.string()).default([]),
  commands: z.array(z.object({
    id: z.string().regex(/^[a-z0-9-:]+$/),
    label: z.string().min(1).max(200),
    shortcut: z.string().optional(),
    icon: z.string().optional(),
  })).default([]),
  menu_items: z.array(z.object({
    id: z.string().regex(/^[a-z0-9-:]+$/),
    label: z.string().min(1).max(200),
    section: z.enum(['file', 'edit', 'insert', 'view', 'plugins']),
    shortcut: z.string().optional(),
    icon: z.string().optional(),
  })).default([]),
  stylesheet: z.string().optional(),
  settings: z.record(z.object({
    type: z.enum(['string', 'number', 'boolean', 'select', 'color', 'path']).default('string'),
    label: z.string().optional(),
    description: z.string().optional(),
    default: z.any(),
    options: z.array(z.string()).optional(),
  })).default({}),
});

export type Manifest = z.infer<typeof ManifestSchema>;

export function validateManifest(obj: unknown): { ok: true; data: Manifest } | { ok: false; errors: string[] } {
  const result = ManifestSchema.safeParse(obj);
  if (result.success) return { ok: true, data: result.data };
  return { ok: false, errors: result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`) };
}
```

### 1.2 Settings Panel in Plugin Manager (4h)

**Files to modify:**
- `src/ui/plugins-panel.js` — add Settings tab per plugin
- `src/plugins/sandbox/plugin-settings-store.js` — already exists, use it
- `src/preload.js` — add `settings:getAll`, `settings:register` (already there)

**UI pattern:** Copy the existing plugin list rendering, add a modal/drawer for settings with dynamic form from `manifest.settings` schema.

```javascript
// In plugins-panel.js, add to renderSettings(plugin) {
const meta = plugin.manifest.settings || {};
for (const [key, m] of Object.entries(meta)) {
  const current = await this.pluginManager.getSetting(`${plugin.name}.${key}`);
  // Render input based on m.type: string/number/boolean/select/color/path
  // On change: await this.pluginManager.setSetting(plugin.name, key, value);
}
```

### 1.3 Validation at Install Time (1h)

**File:** `src/plugins/sandbox/plugin-host.js` — `loadManifest()`

```javascript
const { validateManifest } = require('./manifest-schema');
const { ok, data, errors } = validateManifest(manifest);
if (!ok) throw new Error('Invalid manifest:\n' + errors.join('\n'));
return data;
```

**Test:** Try installing a plugin with bad manifest → see friendly error in toast.

---

## Phase 2: Error Boundaries + Plugin Health (Day 3)

### 2.1 Plugin Error State in UI (2h)

**File:** `src/ui/plugins-panel.js`

```javascript
// Add to plugin list item:
if (plugin.error) {
  const errBtn = document.createElement('button');
  errBtn.textContent = '⚠ Error';
  errBtn.className = 'plugin-error-btn';
  errBtn.onclick = () => showErrorModal(plugin.name, plugin.error);
  // Show last 500 chars of error, with "Copy" button
}
```

### 2.2 Crash Recovery in Plugin Host (3h)

**File:** `src/plugins/sandbox/plugin-host.js`

```javascript
// In createPluginWindow(), enhance render-process-gone:
pluginWindow.webContents.on('render-process-gone', (_event, details) => {
  plugin.state = 'error';
  plugin.error = `Renderer crashed: ${details?.reason || 'unknown'}`;
  plugin.crashCount = (plugin.crashCount || 0) + 1;
  plugin.lastCrash = Date.now();

  // Auto-recover up to 3 times with 5s delay
  if (plugin.crashCount <= 3) {
    setTimeout(() => {
      if (plugin.state === 'error') this.createPluginWindow(plugin);
    }, 5000);
  }

  this._notifyPluginsChanged();
});
```

### 2.3 Permission Grant/Revoke UI (2h)

**File:** `src/ui/plugins-panel.js` — add Permissions section in plugin detail

```javascript
const perms = plugin.manifest.permissions || [];
const granted = plugin.permissions || new Set();
for (const perm of ALL_PERMISSIONS) {
  const checkbox = createCheckbox(perm, granted.has(perm));
  checkbox.onchange = async () => {
    if (checkbox.checked) await pluginHost.grantPermission(plugin.name, perm);
    else await pluginHost.revokePermission(plugin.name, perm);
  };
}
```

**File:** `src/plugins/sandbox/plugin-host.js` — add methods:

```javascript
grantPermission(pluginId, perm) {
  const p = this.plugins.get(pluginId);
  if (p) { p.permissions.add(perm); p.window?.webContents.send('permissions:changed', [...p.permissions]); }
}
revokePermission(pluginId, perm) { /* similar */ }
```

---

## Phase 3: DevEx — Hot Reload + Template (Day 4)

### 3.1 Hot Reload in Dev Mode (3h)

**File:** `src/main.js` — add IPC handler:

```javascript
ipcMain.handle('plugins:devReload', async (_, pluginId) => {
  if (!process.env.FLOWMARK_DEV) return { success: false, error: 'Not in dev mode' };
  const plugin = pluginHost.plugins.get(pluginId);
  if (!plugin) return { success: false, error: 'Not found' };
  await pluginHost.setPluginEnabled(pluginId, false);
  await pluginHost.setPluginEnabled(pluginId, true);
  return { success: true };
});
```

**File:** `src/preload.js` — expose:

```javascript
devReload: (pluginId) => ipcRenderer.invoke('plugins:devReload', pluginId),
```

**File:** `package.json` — add script:

```json
"plugin:dev": "FLOWMARK_DEV=1 electron ."
```

**Workflow:** `npm run plugin:dev` → edit plugin → click "Reload" in plugin panel → instant.

### 3.2 Plugin Template Generator (2h)

**File:** `scripts/create-plugin.js` (new, run with `node scripts/create-plugin.js my-plugin`)

```javascript
#!/usr/bin/env node
const fs = require('fs');
const path = require('root');
const name = process.argv[2];
if (!name) { console.error('Usage: node scripts/create-plugin.js <plugin-name>'); process.exit(1); }

const dir = path.join(process.cwd(), 'plugins', name);
fs.mkdirSync(dir, { recursive: true });

const files = {
  'plugin.json': `{
  "name": "${name}",
  "version": "0.1.0",
  "manifest_version": 1,
  "description": "",
  "entry_point": "index.js",
  "permissions": ["editor.read", "editor.write"],
  "commands": [],
  "menu_items": []
}`,
  'index.js': `const PLUGIN_ID = '${name}';

flowmarkPlugin.editor.registerSlashCommand({
  id: '${name}:hello',
  label: 'Say Hello',
  run: async () => {
    await flowmarkPlugin.editor.replaceSelection('Hello from ${name}!');
  }
});`,
  'README.md': `# ${name}\n\nFlowMark plugin.\n`
};

for (const [file, content] of Object.entries(files)) {
  fs.writeFileSync(path.join(dir, file), content);
}
console.log(`Created ${dir}/ — edit plugin.json, then install from plugin panel.`);
```

---

## Phase 4: Advanced APIs (Day 5-6)

### 4.1 Plugin Event Bus (2h)

**File:** `src/plugins/sandbox/plugin-host.js`

```javascript
// Add to class:
broadcastToPlugins(channel, data, excludePluginId = null) {
  for (const [id, p] of this.plugins) {
    if (id === excludePluginId || p.state !== 'ready' || !p.window) continue;
    p.window.webContents.send(`plugin:broadcast:${channel}`, data);
  }
}

// Register handler in plugin-preload.js:
ipcRenderer.on('plugin:broadcast:*', (_, { channel, data }) => {
  // Emit on flowmarkPlugin.events or similar
});
```

**Manifest permission:** `plugins.communicate`

### 4.2 Async Markdown Transforms (2h)

**File:** `src/plugins/pluginManager.js` — `applyMarkdownTransforms`

```javascript
async applyMarkdownTransforms(markdown, context = {}) {
  let result = markdown;
  for (const { fn } of this.markdownTransforms) {
    try {
      const transformed = await fn(result, context);
      if (typeof transformed === 'string') result = transformed;
    } catch (err) { console.error('Markdown transform error:', err); }
  }
  return result;
}
```

**File:** `src/plugins/sandbox/plugin-preload.js` — add to editor API:

```javascript
registerMarkdownTransform: (fn) => {
  if (!hasPermission('markdown.transform')) return Promise.reject(...);
  return sendRequest('editor:registerMarkdownTransform', { fn: fn.toString() });
},
```

### 4.3 Workspace Events (2h)

**File:** `src/plugins/sandbox/plugin-host.js` — register handlers:

```javascript
this.registerHandler('workspace:onFileOpen', async ({ pattern }, _evt, plugin) => {
  // pattern: glob, e.g. "*.md"
  plugin.fileWatchPatterns = plugin.fileWatchPatterns || [];
  plugin.fileWatchPatterns.push(pattern);
}, 'file.read');

this.registerHandler('workspace:onFileSave', async ({ pattern }, _evt, plugin) => { /* similar */ }, 'file.write');
```

**Main process broadcasts:**

```javascript
// In main.js, on tab change:
win.webContents.send('plugin:workspace:fileOpen', { path: doc.path });
// On save:
win.webContents.send('plugin:workspace:fileSave', { path: doc.path });
```

---

## Phase 5: Local Registry + Install from GitHub (Day 7)

### 5.1 Install from Zip/Folder (2h)

**File:** `src/ui/plugins-panel.js` — add "Install from GitHub" button

```javascript
async installFromGitHub() {
  const url = await prompt('GitHub repo URL (e.g. user/repo or https://github.com/user/repo)');
  const zipUrl = url.includes('/') ? `https://github.com/${url}/archive/refs/heads/main.zip` : url;
  const resp = await fetch(zipUrl);
  const blob = await resp.blob();
  const tmpDir = await extractZip(blob); // use JSZip or similar
  await this.pluginManager.install(tmpDir);
}
```

### 5.2 Local Registry Index (3h)

**File:** `src/plugins/registry-index.json` (generated)

```json
{
  "snippet-pack": { "name": "snippet-pack", "version": "1.0.0", "description": "Slash-menu snippets", "repo": "https://github.com/flowmark/snippet-pack" },
  "word-count": { "name": "word-count", "version": "1.0.0", "description": "Word count in status bar", "repo": "https://github.com/flowmark/word-count" }
}
```

**File:** `src/ui/plugins-panel.js` — "Browse Registry" tab showing cards with "Install" button.

---

## Phase 6: Polish + Ship (Day 8-9)

| Task | Time | File |
|------|------|------|
| Update `docs/phase-5-plugin-enhancements.md` with final API | 1h | docs/ |
| Add plugin API versioning (`api_version` in manifest) | 1h | manifest-schema.ts |
| Migration guide for existing plugins | 1h | docs/plugin-migration.md |
| Test all built-in plugins still work | 2h | — |
| Build & smoke test portable | 1h | `npm run build` |
| Commit, tag, push | 30m | — |

---

## Day 10: Buffer

- Unexpected integration issues
- Edge cases (permission denied UX, manifest migration)
- Documentation screenshots

---

## File Map for Quick Navigation

```
src/
├── plugins/
│   ├── plugin-api.d.ts          ← Phase 0 (types)
│   ├── manifest-schema.ts       ← Phase 1.1 (Zod schema)
│   ├── pluginManager.js         ← Core API, markdown transforms
│   ├── sandbox/
│   │   ├── plugin-host.js       ← Crash recovery, permissions, broadcast
│   │   ├── plugin-preload.js    ← IPC bridge, event bus
│   │   ├── plugin-settings-store.js
│   │   ├── manifest-validator.js  (replace with Zod)
│   │   └── request-authorizer.js
│   └── registry-index.json      ← Phase 5.2
├── ui/
│   ├── plugins-panel.js         ← Settings UI, error display, install from GitHub
│   └── ...
├── preload.js                   ← IPC surface
├── main.js                      ← Dev reload, workspace events
└── scripts/
    └── create-plugin.js         ← Phase 3.2

docs/
├── phase-5-plugin-enhancements.md
└── plugin-migration.md
```

---

## Execution Checklist (copy to terminal)

```bash
# Day 0: Baseline
git status && npm run build 2>&1 | tail -20

# Day 1: Types + Schema
# → create src/plugins/plugin-api.d.ts
# → create src/plugins/manifest-schema.ts (npm i zod if needed)
# → tsc --noEmit

# Day 2: Settings UI + Validation
# → edit src/ui/plugins-panel.js (settings tab)
# → edit src/plugins/sandbox/plugin-host.js (loadManifest validation)
# → test: install bad manifest

# Day 3: Error Boundaries + Permissions
# → edit src/ui/plugins-panel.js (error btn, permissions section)
# → edit src/plugins/sandbox/plugin-host.js (crash recovery, grant/revoke)

# Day 4: DevEx
# → edit src/main.js + preload.js (devReload)
# → add "plugin:dev" script to package.json
# → create scripts/create-plugin.js && chmod +x

# Day 5-6: Advanced APIs
# → plugin-host.js (broadcastToPlugins, workspace handlers)
# → plugin-preload.js (event bus listener)
# → pluginManager.js (async markdown transforms)
# → main.js (workspace event broadcasts)

# Day 7: Registry
# → plugins-panel.js (install from GitHub, browse registry)
# → create plugins/registry-index.json

# Day 8-9: Polish
# → docs/phase-5-plugin-enhancements.md
# → docs/plugin-migration.md
# → npm run build && test all built-in plugins

# Day 10: Buffer
git add -A && git commit -m "Plugin enhancements: settings UI, error boundaries, hot reload, event bus, registry" && git tag v1.1.0-plugin
```

---

## Anti-Patterns to Avoid

| ❌ Don't | ✅ Do |
|----------|-------|
| Write unit tests for IPC | Test in app: `console.log` in preload → DevTools |
| Create new UI components | Copy `fm-slash-menu`, `cm-context-menu` patterns |
| Add dependencies | Use `zod` (already in devDeps?) or plain objects |
| Abstract early | Copy-paste working code, refactor only when 3+ copies exist |
| Design in isolation | Open `plugin-host.js` and `plugin-preload.js` side-by-side; they're mirrors |

---

## Success Criteria

- [ ] `npm run build` green
- [ ] Install plugin with bad manifest → friendly toast error
- [ ] Plugin crashes → auto-recovers 3x, then shows error in panel
- [ ] Settings panel shows dynamic form from manifest
- [ ] `npm run plugin:dev` → edit plugin → click Reload → instant update
- [ ] `node scripts/create-plugin.js foo` → installable plugin folder
- [ ] Two plugins communicate via `broadcastToPlugins`
- [ ] Markdown transform runs async without blocking editor
- [ ] "Install from GitHub" works on a test repo
- [ ] All 3 built-in plugins (custom-transform, insert-date, word-count) still work
Two things I couldn't see earlier turned out to matter. I still haven't seen the three `index.js` files, so the last step depends on them.

## What's actually broken (4 things beyond what I said before)

1. **Your plugins' code never runs.** `entry_point` is `index.js`, and the host does `loadURL('file:///.../index.js')`. That makes a browser window *open a JS file as a document* instead of running it as a script, so the window loads and nothing executes. It needs a small HTML runner page that loads the script. This alone would explain why nothing appears.
2. **The manifest `commands` and `menu_items` are never read by anything.** The host only returns `commands` in the list and never forwards them to the renderer.
3. **The permission/handshake bug from before** (init message consumed by `about:blank`).
4. **Content-change events never reach plugins.** The renderer sends `editor:contentChanged`, but main.js listens on `plugin:editor:contentChanged`. Word-count would never update.

I'm fixing 1 to 3 by having the host announce each plugin's manifest items itself, so they show up whether or not `index.js` registers them.

---

## File 1: `src/plugins/sandbox/plugin-runner.html` (new file)

```html
<!doctype html>
<html><head><meta charset="utf-8"></head><body>
<script>
  if (typeof globalThis.global === 'undefined') globalThis.global = globalThis;
  if (typeof globalThis.process === 'undefined') globalThis.process = { env: {}, platform: 'browser', version: '' };
  if (typeof globalThis.Buffer === 'undefined') {
    globalThis.Buffer = class Buffer {
      static from(d) { return new TextEncoder().encode(d); }
      static alloc(n) { return new Uint8Array(n); }
    };
  }
  const entry = new URLSearchParams(location.search).get('entry');
  const s = document.createElement('script');
  s.src = entry;
  s.onerror = () => console.error('[plugin-runner] failed to load', entry);
  document.body.appendChild(s);
</script>
</body></html>
```

## File 2: `src/plugins/sandbox/plugin-preload.js`

**(a)** Replace this block near the top (from `// Unique ID` through the `plugin:init` listener):

```diff
-// Unique ID for this plugin instance (assigned by host)
-let PLUGIN_ID = null;
-let PLUGIN_PERMISSIONS = new Set();
-
-// Initialize plugin identity from host, then signal ready
-ipcRenderer.on('plugin:init', (_, { pluginId, permissions }) => {
-  ...
-});
+const arg = (name) => {
+  const prefix = `--${name}=`;
+  const found = process.argv.find((a) => a.startsWith(prefix));
+  return found ? found.slice(prefix.length) : '';
+};
+const PLUGIN_ID = arg('plugin-id');
+const PLUGIN_PERMISSIONS = new Set(arg('plugin-permissions').split(',').filter(Boolean));
+const commandHandlers = new Map();
+
+// Host tells us a command was clicked in the main window
+ipcRenderer.on('plugin:command', (_, { id }) => {
+  const fn = commandHandlers.get(id);
+  if (fn) { try { fn(); } catch (e) { console.error(e); } }
+});
+
+window.addEventListener('DOMContentLoaded', () => {
+  ipcRenderer.send('plugin:ready', { pluginId: PLUGIN_ID });
+});
```

**(b)** `contextBridge` copies getters once, freezing them as `null`/`[]`:

```diff
-  get id() { return PLUGIN_ID; },
-  get permissions() { return [...PLUGIN_PERMISSIONS]; },
+  id: PLUGIN_ID,
+  permissions: [...PLUGIN_PERMISSIONS],
```

**(c)** Functions can't cross IPC, so keep the handler locally and send only metadata:

```diff
     registerCommand: (command) => {
+      const { run, ...meta } = command || {};
+      if (typeof run === 'function') commandHandlers.set(meta.id, run);
       if (!hasPermission('editor.commands')) return Promise.reject(new Error('Permission denied: editor.commands'));
-      return sendRequest('ui:registerCommand', { command });
+      return sendRequest('ui:registerCommand', { command: meta });
     }
```

## File 3: `src/plugins/sandbox/plugin-host.js`

**(a)** Add at the top with the other requires:

```js
const { pathToFileURL } = require('url');
```

**(b)** In `_setupIPC`, replace the `plugin:ready` handler:

```js
    ipcMain.on('plugin:ready', (event) => {
      for (const plugin of this.plugins.values()) {
        if (plugin.window && !plugin.window.isDestroyed() &&
            plugin.window.webContents === event.sender) {
          plugin.state = 'ready';
          this._announce(plugin);
          this.mainWindow.webContents.send('plugins:changed', this.getPluginsList());
          return;
        }
      }
    });
```

**(c)** Add these methods to the class (anywhere, e.g. above `registerHandler`):

```js
  _announce(plugin) {
    if (this.mainWindow.isDestroyed()) return;
    const { manifest } = plugin;
    for (const command of manifest.commands || []) {
      this.mainWindow.webContents.send('plugin:registerCommand', { pluginId: manifest.name, command });
    }
    for (const item of manifest.menu_items || []) {
      this.mainWindow.webContents.send('ui:addMenuItem', { section: item.section, item });
    }
  }

  announceAll() {
    for (const p of this.plugins.values()) if (p.state === 'ready') this._announce(p);
  }

  invokeCommand(pluginId, commandId) {
    const p = this.plugins.get(pluginId);
    if (!p || !p.window || p.window.isDestroyed()) return false;
    p.window.webContents.send('plugin:command', { id: commandId });
    return true;
  }

  broadcast(channel, data, permission) {
    for (const p of this.plugins.values()) {
      if (p.state !== 'ready' || !p.window || p.window.isDestroyed()) continue;
      if (permission && !p.permissions.has(permission)) continue;
      p.window.webContents.send(channel, data);
    }
  }
```

**(d)** Replace the whole `createPluginWindow` method:

```js
  async createPluginWindow(plugin) {
    const { manifest, path: pluginPath } = plugin;
    const pluginId = manifest.name;
    const permissions = [...(manifest.permissions || [])];
    const entryPath = path.join(pluginPath, manifest.entry_point);
    if (!fs.existsSync(entryPath)) throw new Error(`Entry point not found: ${manifest.entry_point}`);

    const pluginWindow = new BrowserWindow({
      show: false,
      webPreferences: {
        preload: path.join(__dirname, 'plugin-preload.js'),
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        webSecurity: true,
        additionalArguments: [
          `--plugin-id=${pluginId}`,
          `--plugin-permissions=${permissions.join(',')}`,
        ],
      },
    });
    plugin.window = pluginWindow;

    pluginWindow.webContents.on('did-fail-load', (_e, code, desc) => {
      console.error(`[PluginHost] ${pluginId} failed to load:`, code, desc);
    });
    // TEMP for debugging, shows each plugin's console:
    // pluginWindow.webContents.openDevTools({ mode: 'detach' });

    if (entryPath.endsWith('.html')) {
      await pluginWindow.loadFile(entryPath);
    } else {
      await pluginWindow.loadFile(path.join(__dirname, 'plugin-runner.html'), {
        query: { entry: pathToFileURL(entryPath).href },
      });
    }
    return pluginWindow;
  }
```

**(e)** Replace `installPlugin`:

```js
  async installPlugin(sourcePath) {
    const manifest = await this.loadManifest(sourcePath);
    const pluginId = manifest.name;
    if (this.plugins.has(pluginId)) throw new Error(`Plugin already installed: ${pluginId}`);

    const pluginsDir = path.join(app.getPath('userData'), 'plugins');
    fs.mkdirSync(pluginsDir, { recursive: true });
    const destPath = path.join(pluginsDir, pluginId);
    if (path.resolve(sourcePath) !== path.resolve(destPath)) this._copyDir(sourcePath, destPath);

    const plugin = {
      manifest, window: null, path: destPath,
      permissions: new Set(manifest.permissions || []),
      state: 'loading',
    };
    this.plugins.set(pluginId, plugin);   // must exist BEFORE the window loads
    try {
      await this.createPluginWindow(plugin);
    } catch (err) {
      plugin.state = 'error';
      plugin.error = err.message;
      throw err;
    }
    return pluginId;
  }
```

**(f)** In `setPluginEnabled`:

```diff
-        await this.createPluginWindow(pluginId, plugin.manifest, plugin.path);
+        plugin.state = 'loading';
+        await this.createPluginWindow(plugin);
```

**(g)** Fix the script-injection holes in `_registerCoreHandlers` (a backtick-escape isn't enough):

```diff
-        `window.setEditorContent?.(\`${content.replace(/`/g, '\\`')}\`); null`);
+        `window.setEditorContent?.(${JSON.stringify(content)}); null`);

-        `window.replaceEditorSelection?.(\`${text.replace(/`/g, '\\`')}\`); null`);
+        `window.replaceEditorSelection?.(${JSON.stringify(text)}); null`);

-        `window.CommandRegistry?.execute?.('${commandId}', window.view, window.view?.state); null`);
+        `window.CommandRegistry?.execute?.(${JSON.stringify(commandId)}, window.view, window.view?.state); null`);

-        `navigator.clipboard.writeText(\`${text.replace(/`/g, '\\`')}\`)`
+        `navigator.clipboard.writeText(${JSON.stringify(text)})`
```

## File 4: `src/main.js`

**(a)** Don't create a second host on reload:

```diff
 async function initializePluginHost() {
   try {
+    if (pluginHost) {
+      pluginHost.announceAll();
+      win.webContents.send('plugins:ready', pluginHost.getPluginsList());
+      return;
+    }
     pluginHost = new PluginSandboxHost(win);
```

**(b)** Add next to the other `plugins:*` handlers:

```js
ipcMain.handle('plugins:invokeCommand', (_, { pluginId, commandId }) =>
  pluginHost ? pluginHost.invokeCommand(pluginId, commandId) : false);

// Renderer -> plugin windows (these channels were previously going nowhere)
ipcMain.on('editor:contentChanged', (_, data) =>
  pluginHost?.broadcast('editor:contentChanged', data, 'editor.read'));
ipcMain.on('editor:selectionChanged', (_, data) =>
  pluginHost?.broadcast('editor:selectionChanged', data, 'editor.selection'));
```

## File 5: `src/preload.js` (the main window's)

```diff
 contextBridge.exposeInMainWorld('pluginManager', {
   getPlugins: () => ipcRenderer.invoke('plugins:get'),
+  invokeCommand: (pluginId, commandId) => ipcRenderer.invoke('plugins:invokeCommand', { pluginId, commandId }),
```

## File 6: `src/editor.js`

**(a)** Right after the `const view = new EditorView({...});` block, add the hooks the host calls (they didn't exist):

```js
// Hooks used by PluginSandboxHost via executeJavaScript
window.CommandRegistry = CommandRegistry;
window.getEditorContent = () => view.state.doc.toString();
window.setEditorContent = (text) => view.dispatch({
  changes: { from: 0, to: view.state.doc.length, insert: text },
});
window.getEditorSelection = () => {
  const { from, to, empty } = view.state.selection.main;
  return { from, to, empty, text: view.state.sliceDoc(from, to) };
};
window.setEditorSelection = (sel) => view.dispatch({
  selection: { anchor: sel.anchor ?? sel.from, head: sel.head ?? sel.to },
});
window.replaceEditorSelection = (text) => {
  const { from, to } = view.state.selection.main;
  view.dispatch({ changes: { from, to, insert: text }, selection: { anchor: from + text.length } });
  view.focus();
};
```

**(b)** In `initPlugins`, replace the `onAddMenuItem` block (new signature, no double click handler, no duplicates):

```js
  window.uiAPI?.onAddMenuItem((section, item) => {
    const menu = document.querySelector(`[data-menu-section="${section}"]`)
      || document.getElementById(`${section}-dropdown`);
    if (!menu || !item) return;
    if (menu.querySelector(`[data-action="${item.id}"]`)) return;   // already added
    const btn = document.createElement('button');
    btn.textContent = item.label;
    btn.dataset.action = item.id;   // the dropdown's own click handler runs it
    menu.appendChild(btn);
  });
```

**(c)** In `onRegisterCommand`, replace the `run:` function:

```diff
-        run: () => {
-          if (typeof command.run === 'function') { ... } else { ... }
-        },
+        run: () => window.pluginManager.invokeCommand(pluginId, command.id),
```

**(d)** Two latent bugs in the same function that would hit you next:

```diff
-  function applyPluginStyles() {
+  async function applyPluginStyles() {
     if (!window.pluginManager) return;
-    const css = window.pluginManager.getStylesheets();
+    const css = await window.pluginManager.getStylesheets();   // was a Promise
```
```diff
-    if (window.pluginManager && content) {
+    if (window.pluginManager && typeof window.pluginManager.applyMarkdownTransforms === 'function' && content) {
```
The second one matters because `applyMarkdownTransforms` doesn't exist in your preload, so it would throw on every save.

## Then

1. Rebuild the bundle (whatever script produces `editor.new.bundle.js`), then restart the app.
2. Expect **Insert → Date**, **Edit → Apply Transforms**, and three entries under **Plugins**.
3. If something is still missing, uncomment the `openDevTools` line in `createPluginWindow`. Each plugin's console will show its errors.

## What I couldn't check

I haven't seen the three `index.js` files. Clicking a menu item sends `plugin:command` to the plugin, and it only does something if `index.js` listens for it. That means one of these:
- `flowmarkPlugin.ui.registerCommand({ id: 'insert-date:insert', run() {...} })`, which needs `editor.commands` added to its manifest permissions. If the gate rejects it, the handler is still saved locally.
- `flowmarkPlugin.on('command', ({ id }) => ...)`.

Also, `editor.getSelection` returns a JSON string, so a plugin must `JSON.parse` it. And if an `index.js` uses `import`, the runner needs `s.type = 'module'`.

Paste the three `index.js` files and I'll check them against this contract.
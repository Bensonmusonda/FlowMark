const { app, BrowserWindow, ipcMain, dialog, Menu, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { PluginSandboxHost } = require('./plugins/sandbox/plugin-host.js');
const { WorkspaceService } = require('./workspace/workspace-service.js');

let win;
let pluginHost = null;
let currentFilePath = null;
const recentFiles = [];
const MAX_RECENTS = 10;
const workspaceService = new WorkspaceService((change) => {
  if (win && !win.isDestroyed()) {
    win.webContents.send('workspace:changed', change);
  }
});

function addRecent(filePath) {
  const i = recentFiles.indexOf(filePath);
  if (i !== -1) recentFiles.splice(i, 1);
  recentFiles.unshift(filePath);
  if (recentFiles.length > MAX_RECENTS) recentFiles.pop();
}

function createWindow() {
  win = new BrowserWindow({
    width: 900,
    height: 700,
    minWidth: 500,
    minHeight: 400,
    frame: false,
    titleBarStyle: 'hidden',
    backgroundColor: '#1a1a1a',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      devTools: true,
    },
  });

  win.loadFile(path.join(__dirname, 'index.html'));

  win.webContents.on('did-finish-load', () => {
    win.focus();
    win.webContents.focus();

    // Only open DevTools in dev mode (--dev flag)
    if (process.argv.includes('--dev')) {
      win.webContents.openDevTools({ mode: 'detach' });
    }

    // Initialize sandbox plugin host after window loads
    initializePluginHost();
  });

  win.webContents.on('before-input-event', (event, input) => {
    if (input.key === 'F12' || (input.control && input.shift && input.key.toLowerCase() === 'i')) {
      win.webContents.toggleDevTools();
      event.preventDefault();
    }
  });

  win.on('maximize', () => {
    if (!win.isDestroyed()) win.webContents.send('window:maximized-change', true);
  });
  win.on('unmaximize', () => {
    if (!win.isDestroyed()) win.webContents.send('window:maximized-change', false);
  });

  Menu.setApplicationMenu(null);
}

async function initializePluginHost() {
  try {
    if (pluginHost) {
      pluginHost.announceAll();
      win.webContents.send('plugins:ready', pluginHost.getPluginsList());
      return;
    }
    pluginHost = new PluginSandboxHost(win);

    // Auto-install bundled plugins on first run
    await autoInstallBundledPlugins();

    // Send initial plugin list to renderer
    win.webContents.send('plugins:ready', pluginHost.getPluginsList());

    console.log('[main] Plugin Sandbox Host initialized');
  } catch (err) {
    console.error('[main] Failed to initialize Plugin Host:', err);
  }
}

async function autoInstallBundledPlugins() {
  const bundledPluginsDir = path.join(__dirname, 'plugins');
  const userDataPluginsDir = path.join(app.getPath('userData'), 'plugins');

  if (!fs.existsSync(userDataPluginsDir)) {
    fs.mkdirSync(userDataPluginsDir, { recursive: true });
  }

  // Clean up sandbox infrastructure folder if it was accidentally copied to userData
  const sandboxInUserData = path.join(userDataPluginsDir, 'sandbox');
  if (fs.existsSync(sandboxInUserData)) {
    fs.rmSync(sandboxInUserData, { recursive: true, force: true });
  }

  try {
    if (!fs.existsSync(bundledPluginsDir)) return;

    const entries = fs.readdirSync(bundledPluginsDir, { withFileTypes: true });
    const bundledPlugins = entries
      .filter(e => e.isDirectory() && e.name !== 'sandbox')
      .map(e => e.name);

    // Always copy/sync fresh source files from src/plugins to userData/plugins on startup
    for (const name of bundledPlugins) {
      const sourcePath = path.join(bundledPluginsDir, name);
      const destPath = path.join(userDataPluginsDir, name);

      // Overwrite with latest source changes
      copyDir(sourcePath, destPath);
    }

    // Load each plugin into the sandbox host
    for (const name of bundledPlugins) {
      const destPath = path.join(userDataPluginsDir, name);
      try {
        // If already loaded in host, remove first to reload fresh
        if (pluginHost.plugins.has(name)) {
          await pluginHost.uninstallPlugin(name);
        }
        await pluginHost.installPlugin(destPath);
        console.log(`[main] Synced & loaded plugin: ${name}`);
      } catch (err) {
        console.warn(`[main] Failed to load plugin ${name}:`, err.message);
      }
    }
  } catch (err) {
    console.warn('[main] Failed to sync bundled plugins:', err);
  }
}

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

// ── IPC Handlers ─────────────────────────────────────────────────────────────

ipcMain.handle('dialog:save', async (_, arg) => {
  let content = typeof arg === 'string' ? arg : (arg && arg.content !== undefined ? arg.content : '');
  const defaultPath = (typeof arg === 'object' && arg && arg.defaultPath) || currentFilePath || 'untitled.md';
  const { filePath, canceled } = await dialog.showSaveDialog(win, {
    title: 'Save As',
    defaultPath,
    filters: [{ name: 'Markdown', extensions: ['md'] }],
  });
  if (canceled || !filePath) return { canceled: true };

  // Apply plugin markdown transforms before saving
  if (pluginHost) {
    try {
      content = await pluginHost.applyBeforeSaveTransforms(content);
    } catch (err) {
      console.warn('[main] Plugin transform error on save:', err);
    }
  }

  fs.writeFileSync(filePath, content, 'utf8');
  currentFilePath = filePath;
  addRecent(filePath);
  return { canceled: false, filePath };
});

ipcMain.handle('file:save', async (_, arg) => {
  let targetPath = currentFilePath;
  let content = '';

  if (typeof arg === 'string') {
    content = arg;
  } else if (typeof arg === 'object' && arg !== null) {
    if (arg.filePath) targetPath = arg.filePath;
    if (arg.content !== undefined) content = arg.content;
  }

  if (!targetPath) return { noPath: true };

  // Apply plugin markdown transforms before saving
  if (pluginHost) {
    try {
      content = await pluginHost.applyBeforeSaveTransforms(content);
    } catch (err) {
      console.warn('[main] Plugin transform error on save:', err);
    }
  }

  fs.writeFileSync(targetPath, content, 'utf8');
  currentFilePath = targetPath;
  addRecent(targetPath);
  return { filePath: targetPath };
});

ipcMain.handle('file:open', async () => {
  const { filePaths, canceled } = await dialog.showOpenDialog(win, {
    title: 'Open File',
    filters: [{ name: 'Markdown', extensions: ['md'] }],
    properties: ['openFile'],
  });
  if (canceled || !filePaths.length) return { canceled: true };
  const filePath = filePaths[0];
  const content = fs.readFileSync(filePath, 'utf8');
  currentFilePath = filePath;
  addRecent(filePath);
  return { canceled: false, filePath, content };
});

ipcMain.handle('file:openPath', async (_, filePath) => {
  try {
    const resolved = path.isAbsolute(filePath)
      ? filePath
      : path.join(currentFilePath ? path.dirname(currentFilePath) : app.getPath('documents'), filePath);
    const content = fs.readFileSync(resolved, 'utf8');
    currentFilePath = resolved;
    addRecent(resolved);
    return { canceled: false, filePath: resolved, content };
  } catch (e) {
    return { canceled: true, error: 'File not found' };
  }
});

ipcMain.handle('file:createAndOpen', async (_, filePath) => {
  try {
    const resolved = path.isAbsolute(filePath)
      ? filePath
      : path.join(currentFilePath ? path.dirname(currentFilePath) : app.getPath('documents'), filePath);
    fs.writeFileSync(resolved, '', 'utf8');
    currentFilePath = resolved;
    addRecent(resolved);
    return { canceled: false, filePath: resolved, content: '' };
  } catch (e) {
    return { canceled: true, error: e.message };
  }
});

ipcMain.handle('file:clearPath', () => { currentFilePath = null; });
ipcMain.handle('file:rename', async (_, { oldPath, newName }) => {
  try {
    if (!oldPath || !fs.existsSync(oldPath)) {
      return { error: 'Original file not found' };
    }
    const dir = path.dirname(oldPath);
    const ext = path.extname(oldPath) || '.md';
    let cleanName = (newName || '').trim();
    if (!path.extname(cleanName)) {
      cleanName += ext;
    }
    cleanName = cleanName.replace(/[<>:"/\\|?*]/g, '');
    if (!cleanName) return { error: 'Invalid file name' };

    const newPath = path.join(dir, cleanName);
    if (oldPath.toLowerCase() !== newPath.toLowerCase() && fs.existsSync(newPath)) {
      return { error: 'A file with that name already exists' };
    }
    if (oldPath !== newPath) {
      fs.renameSync(oldPath, newPath);
      if (currentFilePath === oldPath) {
        currentFilePath = newPath;
      }
      const idx = recentFiles.indexOf(oldPath);
      if (idx !== -1) {
        recentFiles.splice(idx, 1);
      }
      addRecent(newPath);
    }
    return { success: true, newPath, newName: cleanName };
  } catch (err) {
    return { error: err.message };
  }
});
ipcMain.handle('recents:get', () => recentFiles.filter(f => fs.existsSync(f)));

// ── Session persistence ──────────────────────────────────────────────────────
ipcMain.handle('session:save', async (_, sessionData) => {
  try {
    const sessionPath = path.join(app.getPath('userData'), 'session.json');
    fs.writeFileSync(sessionPath, JSON.stringify(sessionData, null, 2), 'utf8');
    return { success: true };
  } catch (err) {
    console.error('Failed to save session:', err);
    return { success: false, error: err.message };
  }
});

ipcMain.handle('session:load', async () => {
  try {
    const sessionPath = path.join(app.getPath('userData'), 'session.json');
    if (!fs.existsSync(sessionPath)) return null;
    const raw = fs.readFileSync(sessionPath, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    console.error('Failed to load session:', err);
    return null;
  }
});

ipcMain.handle('workspace:openDialog', async () => {
  const { filePaths, canceled } = await dialog.showOpenDialog(win, {
    title: 'Open Folder',
    properties: ['openDirectory'],
  });
  if (canceled || !filePaths.length) return { canceled: true };
  return { canceled: false, ...workspaceService.setRoot(filePaths[0]) };
});

ipcMain.handle('workspace:openPath', (_, rootPath) => {
  if (typeof rootPath !== 'string' || !rootPath.trim()) {
    throw new Error('A workspace folder path is required');
  }
  return workspaceService.setRoot(rootPath);
});

ipcMain.handle('workspace:getTree', () => ({
  rootPath: workspaceService.rootPath,
  tree: workspaceService.getTree(),
}));

ipcMain.handle('workspace:openFile', (_, relativePath) => {
  const result = workspaceService.openFile(relativePath);
  currentFilePath = result.filePath;
  addRecent(result.filePath);
  return result;
});

ipcMain.handle('workspace:create', (_, relativePath, type) => {
  const result = workspaceService.create(relativePath, type);
  if (type === 'file') {
    currentFilePath = result.path;
    addRecent(result.path);
  }
  return result;
});

ipcMain.handle('workspace:rename', (_, relativePath, newName) => {
  const result = workspaceService.rename(relativePath, newName);
  const currentRelative = currentFilePath && path.relative(result.oldPath, currentFilePath);
  if (currentRelative === '' ||
      (currentRelative && currentRelative !== '..' &&
       !currentRelative.startsWith(`..${path.sep}`) && !path.isAbsolute(currentRelative))) {
    currentFilePath = path.join(result.newPath, currentRelative);
  }
  if (currentFilePath) addRecent(currentFilePath);
  return result;
});

ipcMain.handle('workspace:delete', (_, relativePath) => {
  const result = workspaceService.delete(relativePath);
  const currentRelative = currentFilePath && path.relative(result.path, currentFilePath);
  if (currentRelative === '' ||
      (currentRelative && currentRelative !== '..' &&
       !currentRelative.startsWith(`..${path.sep}`) && !path.isAbsolute(currentRelative))) {
    currentFilePath = null;
  }
  return result;
});
ipcMain.handle('workspace:close', () => {
  workspaceService.close();
  return { success: true };
});

ipcMain.on('window:refocus', () => { win.focus(); win.webContents.focus(); });
ipcMain.on('window:minimize', () => win.minimize());
ipcMain.on('window:maximize', () => win.isMaximized() ? win.unmaximize() : win.maximize());
ipcMain.on('window:close',    () => win.close());
ipcMain.on('window:setBackground', (_, color) => {
  if (win && typeof color === 'string' && /^#[0-9a-fA-F]{6}$/.test(color)) {
    win.setBackgroundColor(color);
  }
});

ipcMain.handle('shell:openExternal', async (_, url) => {
  if (typeof url === 'string') {
    const trimmed = url.trim();
    if (/^(https?|mailto):/i.test(trimmed)) {
      await shell.openExternal(trimmed);
      return true;
    }
  }
  return false;
});

ipcMain.handle('shell:openPath', async (_, targetPath) => {
  if (!targetPath || typeof targetPath !== 'string') return '';
  return shell.openPath(targetPath);
});

// ── Plugin Sandbox IPC ──────────────────────────────────────────────────────

ipcMain.handle('plugins:get', () => {
  if (!pluginHost) return [];
  return pluginHost.getPluginsList();
});

ipcMain.handle('plugins:enable', async (_, name) => {
  if (!pluginHost) return { success: false, error: 'Plugin host not initialized' };
  try {
    await pluginHost.setPluginEnabled(name, true);
    win.webContents.send('plugins:changed', pluginHost.getPluginsList());
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('plugins:disable', async (_, name) => {
  if (!pluginHost) return { success: false, error: 'Plugin host not initialized' };
  try {
    await pluginHost.setPluginEnabled(name, false);
    win.webContents.send('plugins:changed', pluginHost.getPluginsList());
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('plugins:installFromFolder', async () => {
  if (!pluginHost) return { success: false, error: 'Plugin host not initialized' };
  try {
    const { filePaths, canceled } = await dialog.showOpenDialog(win, {
      title: 'Select a plugin folder containing plugin.json',
      properties: ['openDirectory'],
    });
    if (canceled || !filePaths[0]) return { success: false, canceled: true };

    const pluginId = await pluginHost.installPlugin(filePaths[0]);
    win.webContents.send('plugins:changed', pluginHost.getPluginsList());
    return { success: true, pluginId };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
});

ipcMain.handle('plugins:install', async (_, sourcePath) => {
  if (!pluginHost) return { success: false, error: 'Plugin host not initialized' };
  try {
    await pluginHost.installPlugin(sourcePath);
    win.webContents.send('plugins:changed', pluginHost.getPluginsList());
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('plugins:uninstall', async (_, name) => {
  if (!pluginHost) return { success: false, error: 'Plugin host not initialized' };
  try {
    await pluginHost.uninstallPlugin(name);
    win.webContents.send('plugins:changed', pluginHost.getPluginsList());
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('plugins:settings:get', (_, pluginId) => {
  if (!pluginHost) return {};
  return pluginHost.getPluginSettings(pluginId);
});

ipcMain.handle('plugins:settings:set', async (_, payload) => {
  if (!pluginHost) return { success: false, error: 'Plugin host not initialized' };
  try {
    let { pluginId, key, value } = payload || {};
    if (!pluginId && typeof key === 'string' && key.includes('.')) {
      pluginId = key.slice(0, key.indexOf('.'));
    }
    if (!pluginId || !key) {
      throw new Error('pluginId and key are required');
    }
    pluginHost.settingsStore.set(pluginId, key, value);
    const change = { key, value, pluginId };
    if (win && !win.isDestroyed()) {
      win.webContents.send('settings:changed', change);
    }
    const plugin = pluginHost.plugins.get(pluginId);
    if (plugin && plugin.window && !plugin.window.isDestroyed()) {
      plugin.window.webContents.send('settings:changed', { key, value });
    }
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
});

ipcMain.handle('plugins:reload', async () => {
  if (!pluginHost) return { success: false, error: 'Plugin host not initialized' };
  try {
    await pluginHost.reloadAll();
    if (win && !win.isDestroyed()) {
      win.webContents.send('plugins:changed', pluginHost.getPluginsList());
    }
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
});

ipcMain.handle('plugins:openPluginsFolder', async () => {
  const pluginsDir = path.join(app.getPath('userData'), 'plugins');
  fs.mkdirSync(pluginsDir, { recursive: true });
  await shell.openPath(pluginsDir);
  return { success: true };
});

ipcMain.handle('plugins:getStylesheets', () => {
  if (!pluginHost) return '';
  try {
    return pluginHost.getPluginsList().reduce((css, plugin) => {
      if (plugin.active && plugin.stylesheet) {
        return css + plugin.stylesheet + '\n';
      }
      return css;
    }, '');
  } catch (err) {
    console.warn('[main] Failed to get stylesheets:', err);
    return '';
  }
});

ipcMain.handle('plugins:invokeCommand', (_, { pluginId, commandId }) =>
  pluginHost ? pluginHost.invokeCommand(pluginId, commandId) : false);

ipcMain.handle('plugins:invokeSlashCommand', (_, { pluginId, commandId, triggerPos }) =>
  pluginHost ? pluginHost.invokeSlashCommand(pluginId, commandId, triggerPos) : false);

ipcMain.handle('plugins:smartPaste', async (_, data) =>
  pluginHost ? pluginHost.applySmartPaste(data) : data);

// Renderer -> plugin windows (these channels were previously going nowhere)
ipcMain.on('editor:contentChanged', (_, data) =>
  pluginHost?.broadcast('editor:contentChanged', data, 'editor.read'));
ipcMain.on('editor:selectionChanged', (_, data) =>
  pluginHost?.broadcast('editor:selectionChanged', data, 'editor.selection'));

// Plugin event handlers (forwarded from sandbox host via plugin:event)
ipcMain.on('plugin:ui:addMenuItem', (_, { pluginId, section, item }) => {
  console.log(`[main] Plugin ${pluginId} adding menu item to ${section}:`, item);
  win.webContents.send('ui:addMenuItem', { section, item });
});

ipcMain.on('plugin:ui:registerCommand', (_, { pluginId, command }) => {
  console.log(`[main] Plugin ${pluginId} registering command:`, command);
  // Commands registered by plugins need to be available in renderer
  win.webContents.send('plugin:registerCommand', { pluginId, command });
});

ipcMain.on('plugin:ui:setStatusBar', (_, { pluginId, text, ...options }) => {
  win.webContents.send('ui:setStatusBar', { text, ...options, pluginId });
});

ipcMain.on('plugin:ui:showNotification', (_, { pluginId, title, body, ...options }) => {
  win.webContents.send('ui:showNotification', { title, body, ...options, pluginId });
});

ipcMain.on('plugin:editor:contentChanged', (_, { pluginId, ...data }) => {
  win.webContents.send('editor:contentChanged', data);
});

ipcMain.on('plugin:editor:selectionChanged', (_, { pluginId, ...data }) => {
  win.webContents.send('editor:selectionChanged', data);
});

ipcMain.on('plugin:settings:changed', (_, { pluginId, key, value }) => {
  win.webContents.send('settings:changed', { key, value, pluginId });
});

// Plugin log events
ipcMain.on('plugin:log', (_, { pluginId, level, args }) => {
  const prefix = `[plugin:${pluginId}]`;
  if (level === 'warn') console.warn(prefix, ...args);
  else if (level === 'error') console.error(prefix, ...args);
  else console.log(prefix, ...args);
});

// ── Export (PDF / HTML) ───────────────────────────────────────────────────────
const { buildExportDocument } = require('./export-html');

ipcMain.handle('export:html', async (_, markdown, theme) => {
  try {
    const { filePath, canceled } = await dialog.showSaveDialog(win, {
      title: 'Export HTML',
      defaultPath: currentFilePath
        ? currentFilePath.replace(/\.[^.\\/]+$/, '') + '.html'
        : 'document.html',
      filters: [{ name: 'HTML', extensions: ['html'] }],
    });
    if (canceled || !filePath) return { canceled: true };
    fs.writeFileSync(filePath, buildExportDocument(markdown, theme), 'utf8');
    return { canceled: false, filePath };
  } catch (error) {
    return { canceled: true, error: error.message };
  }
});

ipcMain.handle('export:pdf', async (_, markdown, theme) => {
  let exportWin = null;
  const tempPath = path.join(app.getPath('temp'), `flowmark-export-${Date.now()}.html`);
  try {
    fs.writeFileSync(tempPath, buildExportDocument(markdown, theme), 'utf8');

    exportWin = new BrowserWindow({
      show: false,
      width: 900,
      height: 1200,
      webPreferences: { nodeIntegration: false, contextIsolation: true },
    });
    await exportWin.loadFile(tempPath);
    await new Promise(resolve => setTimeout(resolve, 700));

    const pdf = await exportWin.webContents.printToPDF({
      printBackground: true,
      pageSize: 'A4',
      marginsType: 0,
    });

    const { filePath, canceled } = await dialog.showSaveDialog(win, {
      title: 'Export PDF',
      defaultPath: currentFilePath
        ? currentFilePath.replace(/\.[^.\\/]+$/, '') + '.pdf'
        : 'document.pdf',
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    });
    if (canceled || !filePath) return { canceled: true };
    fs.writeFileSync(filePath, pdf);
    return { canceled: false, filePath };
  } catch (error) {
    return { canceled: true, error: error.message };
  } finally {
    if (exportWin) exportWin.destroy();
    try { fs.unlinkSync(tempPath); } catch (_) { /* already gone */ }
  }
});

app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

// Cleanup on quit
app.on('before-quit', () => {
  workspaceService.close();
  if (pluginHost) {
    pluginHost.destroy();
  }
});
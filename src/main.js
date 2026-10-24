const { app, BrowserWindow, ipcMain, dialog, Menu } = require('electron');
const path = require('path');
const fs = require('fs');

let win;
let currentFilePath = null;
const recentFiles = [];
const MAX_RECENTS = 10;

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
      devTools: Boolean(process.env.FLOWMARK_DEBUG),
    },
  });

  win.loadFile(path.join(__dirname, 'index.html'));

  win.webContents.on('did-finish-load', () => {
    win.focus();
    win.webContents.focus();
  });

  Menu.setApplicationMenu(null);
}

// ── IPC Handlers ─────────────────────────────────────────────────────────────

ipcMain.handle('dialog:save', async (_, content) => {
  const { filePath, canceled } = await dialog.showSaveDialog(win, {
    title: 'Save As',
    defaultPath: currentFilePath || 'untitled.md',
    filters: [{ name: 'Markdown', extensions: ['md'] }],
  });
  if (canceled || !filePath) return { canceled: true };
  fs.writeFileSync(filePath, content, 'utf8');
  currentFilePath = filePath;
  addRecent(filePath);
  return { canceled: false, filePath };
});

ipcMain.handle('file:save', async (_, content) => {
  if (!currentFilePath) return { noPath: true };
  fs.writeFileSync(currentFilePath, content, 'utf8');
  return { filePath: currentFilePath };
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
ipcMain.handle('recents:get', () => recentFiles.filter(f => fs.existsSync(f)));

ipcMain.on('window:refocus', () => { win.focus(); win.webContents.focus(); });
ipcMain.on('window:minimize', () => win.minimize());
ipcMain.on('window:maximize', () => win.isMaximized() ? win.unmaximize() : win.maximize());
ipcMain.on('window:close',    () => win.close());
// Newly exposed window area during a live resize is painted with this colour
// before the renderer repaints; keep it in sync with the active theme so the
// right/bottom edge never flashes black.
ipcMain.on('window:setBackground', (_, color) => {
  if (win && typeof color === 'string' && /^#[0-9a-fA-F]{6}$/.test(color)) {
    win.setBackgroundColor(color);
  }
});

app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

// ── Export (PDF / HTML) ───────────────────────────────────────────────────────
// The document builder lives in export-html.js (no Electron imports, so it can
// be tested from Node). PDF is produced by printing that document in a hidden
// window; HTML writes the same bytes to disk.
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
    // Let fonts and layout settle before printing.
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
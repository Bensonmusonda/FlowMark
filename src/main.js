const { app, BrowserWindow, ipcMain, dialog, Menu } = require('electron');
const path = require('path');
const fs = require('fs');

let win;
let currentFilePath = null;

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
  return { canceled: false, filePath };
});

ipcMain.handle('file:save', async (_, content) => {
  if (!currentFilePath) {
    // No path yet — fall through to Save As
    return { noPath: true };
  }
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
  return { canceled: false, filePath, content };
});

ipcMain.handle('file:clearPath', () => { currentFilePath = null; });

ipcMain.on('window:refocus', () => {
  win.focus();
  win.webContents.focus();
});

ipcMain.on('window:minimize', () => win.minimize());
ipcMain.on('window:maximize', () => win.isMaximized() ? win.unmaximize() : win.maximize());
ipcMain.on('window:close',    () => win.close());

app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
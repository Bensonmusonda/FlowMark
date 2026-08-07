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
    },
  });

  win.loadFile(path.join(__dirname, 'index.html'));
  win.webContents.openDevTools();

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

app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

// ── Export handlers ──────────────────────────────────────────────

ipcMain.handle('export:pdf', async (event, markdown) => {
  const { marked } = require('marked');
  const html = marked(markdown);

  // Build the full HTML with print‑specific styles
  const style = fs.readFileSync(path.join(__dirname, 'style.css'), 'utf8');
  const fullHtml = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>${style}</style>
  <style>
    /* Reset for print */
    * { box-sizing: border-box; }
    html, body {
      margin: 0;
      padding: 0;
      background: var(--bg);
      color: var(--text);
      font-family: var(--font-prose);
      line-height: 1.9;
    }
    .export-content {
      max-width: 720px;
      margin: 0 auto;
      padding: 60px 40px;
    }
    /* Hide UI elements */
    #titlebar, #statusbar, #editor-wrap, .cm-editor { display: none; }

    /* Page margins via @page */
    @page {
      size: A4;
      margin: 15mm; /* adjust as needed */
    }
    /* Ensure content flows across pages */
    body {
      overflow: visible;
      height: auto;
      min-height: 100vh;
    }
  </style>
</head>
<body>
  <div class="export-content">${html}</div>
</body>
</html>
  `;

  const tempPath = path.join(app.getPath('temp'), 'flowmark-export.html');
  fs.writeFileSync(tempPath, fullHtml, 'utf8');

  const exportWin = new BrowserWindow({
    show: false,
    width: 800,
    height: 600, // doesn't matter much now
    webPreferences: { nodeIntegration: false, contextIsolation: true },
  });

  try {
    await exportWin.loadFile(tempPath);
    await new Promise(resolve => setTimeout(resolve, 600)); // let fonts/layout settle

    const pdfData = await exportWin.webContents.printToPDF({
      printBackground: true,
      pageSize: 'A4',        // or { width: 210000, height: 297000 } in µm
      marginsType: 0,        // use @page margins instead
      // Do NOT set 'margins' here – let CSS handle it
    });

    exportWin.destroy();
    fs.unlinkSync(tempPath);

    const { filePath, canceled } = await dialog.showSaveDialog(win, {
      title: 'Export PDF',
      defaultPath: 'document.pdf',
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    });
    if (canceled || !filePath) return { canceled: true };
    fs.writeFileSync(filePath, pdfData);
    return { canceled: false, filePath };
  } catch (error) {
    exportWin.destroy();
    try { fs.unlinkSync(tempPath); } catch (_) {}
    console.error('PDF export error:', error);
    return { canceled: true, error: error.message };
  }
});

ipcMain.handle('export:html', async (event, markdown) => {
  const { marked } = require('marked');
  const html = marked(markdown);

  const style = fs.readFileSync(path.join(__dirname, 'style.css'), 'utf8');
  const fullHtml = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="UTF-8">
        <style>${style}</style>
        <style>
          /* Override hidden overflow from the main style */
          html, body {
            overflow: visible !important;
            height: auto !important;
            min-height: 100vh;
          }
          body {
            background: var(--bg);
            padding: 60px 40px;
            margin: 0;
            overflow-y: auto !important;
          }
          .export-content {
            max-width: 720px;
            margin: 0 auto;
            font-family: var(--font-prose);
            color: var(--text);
            line-height: 1.9;
          }
          /* hide UI elements */
          #titlebar, #statusbar, #editor-wrap, .cm-editor { display: none; }
        </style>
      </head>
      <body>
        <div class="export-content">${html}</div>
      </body>
    </html>
  `;

  const { filePath, canceled } = await dialog.showSaveDialog(win, {
    title: 'Export HTML',
    defaultPath: 'document.html',
    filters: [{ name: 'HTML', extensions: ['html'] }],
  });
  if (canceled || !filePath) return { canceled: true };
  fs.writeFileSync(filePath, fullHtml, 'utf8');
  return { canceled: false, filePath };
});
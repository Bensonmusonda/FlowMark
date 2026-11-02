const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('fileAPI', {
  save:      (contentOrOpts, maybeContent) => {
    const payload = typeof contentOrOpts === 'object' && contentOrOpts !== null
      ? contentOrOpts
      : (maybeContent !== undefined ? { filePath: contentOrOpts, content: maybeContent } : { content: contentOrOpts });
    return ipcRenderer.invoke('file:save', payload);
  },
  saveAs:    (contentOrOpts, maybeContent) => {
    const payload = typeof contentOrOpts === 'object' && contentOrOpts !== null
      ? contentOrOpts
      : (maybeContent !== undefined ? { defaultPath: contentOrOpts, content: maybeContent } : { content: contentOrOpts });
    return ipcRenderer.invoke('dialog:save', payload);
  },
  open:      ()         => ipcRenderer.invoke('file:open'),
  openPath:  (filePath) => ipcRenderer.invoke('file:openPath', filePath),
  createAndOpen: (filePath) => ipcRenderer.invoke('file:createAndOpen', filePath),
  clearPath: ()         => ipcRenderer.invoke('file:clearPath'),
  exportPDF:  (content, theme) => ipcRenderer.invoke('export:pdf', content, theme),
  exportHTML: (content, theme) => ipcRenderer.invoke('export:html', content, theme),
  getRecents: ()        => ipcRenderer.invoke('recents:get'),
  loadSession: ()       => ipcRenderer.invoke('session:load'),
  saveSession: (data)   => ipcRenderer.invoke('session:save', data),
});

contextBridge.exposeInMainWorld('windowAPI', {
  minimize: () => ipcRenderer.send('window:minimize'),
  maximize: () => ipcRenderer.send('window:maximize'),
  close:    () => ipcRenderer.send('window:close'),
  refocus:  () => ipcRenderer.send('window:refocus'),
  setBackgroundColor: (color) => ipcRenderer.send('window:setBackground', color),
});

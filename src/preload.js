const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('fileAPI', {
  save:      (content) => ipcRenderer.invoke('file:save', content),
  saveAs:    (content) => ipcRenderer.invoke('dialog:save', content),
  open:      ()        => ipcRenderer.invoke('file:open'),
  clearPath: ()        => ipcRenderer.invoke('file:clearPath'),
});

contextBridge.exposeInMainWorld('windowAPI', {
  minimize: () => ipcRenderer.send('window:minimize'),
  maximize: () => ipcRenderer.send('window:maximize'),
  close:    () => ipcRenderer.send('window:close'),
});
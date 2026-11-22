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
  rename:    (oldPath, newName) => ipcRenderer.invoke('file:rename', { oldPath, newName }),
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
  onMaximizedChange: (callback) => {
    ipcRenderer.on('window:maximized-change', (_, isMax) => callback(isMax));
  },
});

contextBridge.exposeInMainWorld('pluginManager', {
  getPlugins: () => ipcRenderer.invoke('plugins:get'),
  enable: (name) => ipcRenderer.invoke('plugins:enable', name),
  disable: (name) => ipcRenderer.invoke('plugins:disable', name),
  install: (sourcePath) => ipcRenderer.invoke('plugins:install', sourcePath),
  uninstall: (name) => ipcRenderer.invoke('plugins:uninstall', name),
  getSettings: () => ipcRenderer.invoke('plugins:settings:get'),
  setSetting: (key, value) => ipcRenderer.invoke('plugins:settings:set', { key, value }),
  getStylesheets: () => ipcRenderer.invoke('plugins:getStylesheets'),
  invokeCommand: (pluginId, commandId) => ipcRenderer.invoke('plugins:invokeCommand', { pluginId, commandId }),
  onPluginsReady: (callback) => {
    ipcRenderer.on('plugins:ready', (_, plugins) => callback(plugins));
  },
  onPluginsChanged: (callback) => {
    ipcRenderer.on('plugins:changed', (_, plugins) => callback(plugins));
  },
});

contextBridge.exposeInMainWorld('editorAPI', {
  getContent: () => ipcRenderer.invoke('editor:getContent'),
  setContent: (content) => ipcRenderer.invoke('editor:setContent', { content }),
  getSelection: () => ipcRenderer.invoke('editor:getSelection'),
  setSelection: (selection) => ipcRenderer.invoke('editor:setSelection', { selection }),
  replaceSelection: (text) => ipcRenderer.invoke('editor:replaceSelection', { text }),
  executeCommand: (commandId) => ipcRenderer.invoke('editor:executeCommand', { commandId }),
  onContentChange: (callback) => {
    const handler = (_, data) => callback(data);
    ipcRenderer.on('editor:contentChanged', handler);
    return () => ipcRenderer.removeListener('editor:contentChanged', handler);
  },
  onSelectionChange: (callback) => {
    const handler = (_, data) => callback(data);
    ipcRenderer.on('editor:selectionChanged', handler);
    return () => ipcRenderer.removeListener('editor:selectionChanged', handler);
  },
  notifyContentChange: (data) => {
    ipcRenderer.send('editor:contentChanged', data);
  },
  notifySelectionChange: (data) => {
    ipcRenderer.send('editor:selectionChanged', data);
  },
});

contextBridge.exposeInMainWorld('uiAPI', {
  onAddMenuItem: (callback) => {
    const handler = (_, { section, item, pluginId }) => callback(section, item, pluginId);
    ipcRenderer.on('ui:addMenuItem', handler);
    return () => ipcRenderer.removeListener('ui:addMenuItem', handler);
  },
  onRemoveMenuItem: (callback) => {
    const handler = (_, data) => callback(data);
    ipcRenderer.on('ui:removeMenuItem', handler);
    return () => ipcRenderer.removeListener('ui:removeMenuItem', handler);
  },
  onRegisterCommand: (callback) => {
    const handler = (_, { pluginId, command }) => callback(pluginId, command);
    ipcRenderer.on('plugin:registerCommand', handler);
    return () => ipcRenderer.removeListener('plugin:registerCommand', handler);
  },
  onSetStatusBar: (callback) => {
    const handler = (_, { text, side, pluginId }) => callback(text, { side, pluginId });
    ipcRenderer.on('ui:setStatusBar', handler);
    return () => ipcRenderer.removeListener('ui:setStatusBar', handler);
  },
  onShowNotification: (callback) => {
    const handler = (_, { title, body, pluginId }) => callback(title, body, { pluginId });
    ipcRenderer.on('ui:showNotification', handler);
    return () => ipcRenderer.removeListener('ui:showNotification', handler);
  },
  onPluginDisabled: (callback) => {
    const handler = (_, data) => callback(data);
    ipcRenderer.on('plugin:disabled', handler);
    return () => ipcRenderer.removeListener('plugin:disabled', handler);
  },
});

contextBridge.exposeInMainWorld('shellAPI', {
  openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),
});

contextBridge.exposeInMainWorld('settingsAPI', {
  onChange: (callback) => {
    const handler = (_, { key, value, pluginId }) => callback(key, value, { pluginId });
    ipcRenderer.on('settings:changed', handler);
    return () => ipcRenderer.removeListener('settings:changed', handler);
  },
});
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
  openWorkspace: ()    => ipcRenderer.invoke('workspace:openDialog'),
  openWorkspacePath: (rootPath) => ipcRenderer.invoke('workspace:openPath', rootPath),
  getWorkspaceTree: () => ipcRenderer.invoke('workspace:getTree'),
  openWorkspaceFile: (relativePath) => ipcRenderer.invoke('workspace:openFile', relativePath),
  createWorkspaceItem: (relativePath, type) => ipcRenderer.invoke('workspace:create', relativePath, type),
  renameWorkspaceItem: (relativePath, newName) => ipcRenderer.invoke('workspace:rename', relativePath, newName),
  deleteWorkspaceItem: (relativePath) => ipcRenderer.invoke('workspace:delete', relativePath),
  closeWorkspace: () => ipcRenderer.invoke('workspace:close'),
  onWorkspaceChange: (callback) => {
    const handler = (_, change) => callback(change);
    ipcRenderer.on('workspace:changed', handler);
    return () => ipcRenderer.removeListener('workspace:changed', handler);
  },
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
  installFromFolder: () => ipcRenderer.invoke('plugins:installFromFolder'),
  install: (sourcePath) => ipcRenderer.invoke('plugins:install', sourcePath),
  installFromGitHubZip: (zipBase64) => ipcRenderer.invoke('plugins:installFromGitHubZip', zipBase64),
  uninstall: (name) => ipcRenderer.invoke('plugins:uninstall', name),
  getSettings: (pluginId) => ipcRenderer.invoke('plugins:settings:get', pluginId),
  setSetting: (pluginIdOrKey, keyOrValue, maybeValue) => {
    let payload;
    if (maybeValue !== undefined) {
      payload = { pluginId: pluginIdOrKey, key: keyOrValue, value: maybeValue };
    } else if (typeof pluginIdOrKey === 'object' && pluginIdOrKey !== null) {
      payload = pluginIdOrKey;
    } else {
      payload = { key: pluginIdOrKey, value: keyOrValue };
    }
    return ipcRenderer.invoke('plugins:settings:set', payload);
  },
  reload: () => ipcRenderer.invoke('plugins:reload'),
  devReload: (pluginId) => ipcRenderer.invoke('plugins:devReload', pluginId),
  openPluginsFolder: () => ipcRenderer.invoke('plugins:openPluginsFolder'),
  getStylesheets: () => ipcRenderer.invoke('plugins:getStylesheets'),
  invokeCommand: (pluginId, commandId) => ipcRenderer.invoke('plugins:invokeCommand', { pluginId, commandId }),
  invokeSlashCommand: (pluginId, commandId, triggerPos) => ipcRenderer.invoke('plugins:invokeSlashCommand', { pluginId, commandId, triggerPos }),
  applySmartPaste: (data) => ipcRenderer.invoke('plugins:smartPaste', data),
  grantPermission: (pluginId, permission) => ipcRenderer.invoke('plugins:grantPermission', { pluginId, permission }),
  revokePermission: (pluginId, permission) => ipcRenderer.invoke('plugins:revokePermission', { pluginId, permission }),
  onPluginsReady: (callback) => {
    const handler = (_, plugins) => callback(plugins);
    ipcRenderer.on('plugins:ready', handler);
    return () => ipcRenderer.removeListener('plugins:ready', handler);
  },
  onPluginsChanged: (callback) => {
    const handler = (_, plugins) => callback(plugins);
    ipcRenderer.on('plugins:changed', handler);
    return () => ipcRenderer.removeListener('plugins:changed', handler);
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
  onRegisterSidebarPanel: (callback) => {
    const handler = (_, panel) => callback(panel);
    ipcRenderer.on('ui:registerSidebarPanel', handler);
    return () => ipcRenderer.removeListener('ui:registerSidebarPanel', handler);
  },
  onRemoveSidebarPanel: (callback) => {
    const handler = (_, data) => callback(data);
    ipcRenderer.on('ui:removeSidebarPanel', handler);
    return () => ipcRenderer.removeListener('ui:removeSidebarPanel', handler);
  },
  onRegisterCustomView: (callback) => {
    const handler = (_, view) => callback(view);
    ipcRenderer.on('ui:registerCustomView', handler);
    return () => ipcRenderer.removeListener('ui:registerCustomView', handler);
  },
  onRemoveCustomView: (callback) => {
    const handler = (_, data) => callback(data);
    ipcRenderer.on('ui:removeCustomView', handler);
    return () => ipcRenderer.removeListener('ui:removeCustomView', handler);
  },
  onOpenCustomView: (callback) => {
    const handler = (_, data) => callback(data);
    ipcRenderer.on('ui:openCustomView', handler);
    return () => ipcRenderer.removeListener('ui:openCustomView', handler);
  },
  onRegisterSlashCommand: (callback) => {
    const handler = (_, data) => callback(data.pluginId, data.command);
    ipcRenderer.on('plugin:registerSlashCommand', handler);
    return () => ipcRenderer.removeListener('plugin:registerSlashCommand', handler);
  },
  onRemoveSlashCommand: (callback) => {
    const handler = (_, data) => callback(data.pluginId, data.commandId);
    ipcRenderer.on('plugin:removeSlashCommand', handler);
    return () => ipcRenderer.removeListener('plugin:removeSlashCommand', handler);
  },
});

contextBridge.exposeInMainWorld('shellAPI', {
  openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),
  openPath: (targetPath) => ipcRenderer.invoke('shell:openPath', targetPath),
  showItemInFolder: (targetPath) => ipcRenderer.invoke('shell:showItemInFolder', targetPath),
});

contextBridge.exposeInMainWorld('settingsAPI', {
  // Core settings
  get: (key) => ipcRenderer.invoke('settings:get', key),
  set: (key, value) => ipcRenderer.invoke('settings:set', { key, value }),
  getAll: () => ipcRenderer.invoke('settings:getAll'),
  register: (key, defaultValue, meta) => ipcRenderer.invoke('settings:register', { key, defaultValue, meta }),
  onChange: (callback) => {
    const handler = (_, { key, value, pluginId }) => callback(key, value, { pluginId });
    ipcRenderer.on('settings:changed', handler);
    return () => ipcRenderer.removeListener('settings:changed', handler);
  },

  // Dialog control
  open: () => ipcRenderer.send('settings:open'),
  close: () => ipcRenderer.send('settings:close'),
  onOpen: (callback) => {
    const handler = () => callback();
    ipcRenderer.on('settings:opened', handler);
    return () => ipcRenderer.removeListener('settings:opened', handler);
  },
  onClose: (callback) => {
    const handler = () => callback();
    ipcRenderer.on('settings:closed', handler);
    return () => ipcRenderer.removeListener('settings:closed', handler);
  },
});

contextBridge.exposeInMainWorld('themeAPI', {
  getTheme: () => ipcRenderer.invoke('theme:get'),
  setTheme: (theme) => ipcRenderer.invoke('theme:set', theme),
  getCustomColors: () => ipcRenderer.invoke('theme:getCustomColors'),
  setCustomColor: (key, value) => ipcRenderer.invoke('theme:setCustomColor', { key, value }),
  applyTheme: () => ipcRenderer.invoke('theme:apply'),
});

contextBridge.exposeInMainWorld('appAPI', {
  isDevMode: () => ipcRenderer.invoke('app:isDevMode'),
  getVersions: () => ipcRenderer.invoke('app:getVersions'),
});

contextBridge.exposeInMainWorld('pluginRegistryAPI', {
  getRegistry: () => ipcRenderer.invoke('plugins:getRegistry'),
});
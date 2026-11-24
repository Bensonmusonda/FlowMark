/**
 * Plugin Sandbox Host (Main Process)
 *
 * Manages plugin lifecycle, sandbox creation, permission enforcement,
 * and communication between plugins and the application.
 */

const { BrowserWindow, ipcMain, dialog, app } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const { validateManifest } = require('./manifest-validator');
const { PluginSettingsStore } = require('./plugin-settings-store');
const {
  authorizePluginEvent,
  authorizePluginRequest,
  findPluginForSender,
} = require('./request-authorizer');

class PluginSandboxHost {
  constructor(mainWindow) {
    this.mainWindow = mainWindow;
    this.plugins = new Map(); // pluginId -> { manifest, window, permissions, state }
    this.requestHandlers = new Map();
    this.nextRequestId = 0;
    this.settingsStore = new PluginSettingsStore(
      path.join(app.getPath('userData'), 'plugin-settings.json')
    );
    this.stateFile = path.join(app.getPath('userData'), 'plugin-state.json');

    this._loadPluginState();
    this._setupIPC();
    this._registerCoreHandlers();
  }

  _loadPluginState() {
    try {
      if (fs.existsSync(this.stateFile)) {
        const raw = fs.readFileSync(this.stateFile, 'utf8');
        const state = JSON.parse(raw);
        this.savedPluginState = state.enabled || {};
      } else {
        this.savedPluginState = {};
      }
    } catch (err) {
      console.error('Failed to load plugin state:', err);
      this.savedPluginState = {};
    }
  }

  _savePluginState() {
    try {
      fs.writeFileSync(this.stateFile, JSON.stringify({ enabled: this.savedPluginState }, null, 2), 'utf8');
    } catch (err) {
      console.error('Failed to save plugin state:', err);
    }
  }

  _setupIPC() {
    // Plugin lifecycle — plugin:init is no longer needed (identity passed via args)

    ipcMain.on('plugin:ready', (event) => {
      const plugin = findPluginForSender(this.plugins, event.sender);
      if (!plugin) return;
      plugin.state = 'ready';
      plugin.error = null;
      this._announce(plugin);
      this._notifyPluginsChanged();
    });

    // Request/Response pattern
    ipcMain.on('plugin:request', (event, request) => {
      const requestId = request?.requestId;
      if (typeof requestId !== 'string' || requestId.length === 0 || requestId.length > 256) return;

      const respond = (response) => {
        if (!event.sender.isDestroyed()) {
          event.sender.send('plugin:response', { requestId, ...response });
        }
      };
      const { channel, payload } = request;
      const authorization = authorizePluginRequest(this.plugins, event.sender, channel);
      if (!authorization.allowed) {
        console.warn(`[PluginHost] Rejected ${String(channel)}: ${authorization.error}`);
        respond({ error: authorization.error });
        return;
      }

      const handler = this.requestHandlers.get(channel);
      if (!handler) {
        respond({ error: `No handler for channel: ${channel}` });
        return;
      }

      Promise.resolve()
        .then(() => handler(payload, event, authorization.plugin))
        .then(data => respond({ data }))
        .catch(err => {
          const message = err instanceof Error ? err.message : String(err);
          console.error(`[PluginHost] ${channel} request failed:`, err);
          respond({ error: message });
        });
    });

    // Events from plugins
    ipcMain.on('plugin:event', (event, message) => {
      const { channel, payload } = message || {};
      const authorization = authorizePluginEvent(this.plugins, event.sender, channel);
      if (!authorization.allowed) {
        console.warn(`[PluginHost] Rejected plugin event ${String(channel)}: ${authorization.error}`);
        return;
      }

      const pluginId = authorization.plugin.manifest.name;
      const eventPayload = payload && typeof payload === 'object' && !Array.isArray(payload)
        ? payload
        : { value: payload };
      if (channel === 'log') {
        const level = ['info', 'warn', 'error'].includes(eventPayload.level)
          ? eventPayload.level
          : 'info';
        const args = Array.isArray(eventPayload.args) ? eventPayload.args : [eventPayload];
        console[level](`[plugin:${pluginId}]`, ...args);
      }
    });
  }

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

  _notifyPluginsChanged() {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send('plugins:changed', this.getPluginsList());
    }
  }

  _cleanupPluginUI(pluginId, plugin) {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) return;
    this.mainWindow.webContents.send('plugin:disabled', {
      pluginId,
      commands: [...plugin.uiCommands],
      menuItems: [...plugin.uiMenuItems],
      sidebarPanels: [...(plugin.uiSidebarPanels || [])],
      floatingWidgets: [...(plugin.uiFloatingWidgets || [])],
      customViews: [...(plugin.uiCustomViews || [])],
      slashCommands: [...(plugin.uiSlashCommands || [])],
    });
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

  invokeSlashCommand(pluginId, commandId, triggerPos) {
    const plugin = this.plugins.get(pluginId);
    if (!plugin || !plugin.window || plugin.window.isDestroyed()) return false;
    plugin.window.webContents.send('plugin:slashCommand', { id: commandId, triggerPos });
    return true;
  }

  /**
   * Grant a permission to a plugin at runtime
   */
  grantPermission(pluginId, perm) {
    const plugin = this.plugins.get(pluginId);
    if (!plugin) return false;
    plugin.permissions.add(perm);
    if (plugin.window && !plugin.window.isDestroyed()) {
      plugin.window.webContents.send('permissions:changed', [...plugin.permissions]);
    }
    this._notifyPluginsChanged();
    return true;
  }

  /**
   * Revoke a permission from a plugin at runtime
   */
  revokePermission(pluginId, perm) {
    const plugin = this.plugins.get(pluginId);
    if (!plugin) return false;
    plugin.permissions.delete(perm);
    if (plugin.window && !plugin.window.isDestroyed()) {
      plugin.window.webContents.send('permissions:changed', [...plugin.permissions]);
    }
    this._notifyPluginsChanged();
    return true;
  }

  broadcast(channel, data, permission) {
    for (const p of this.plugins.values()) {
      if (p.state !== 'ready' || !p.window || p.window.isDestroyed()) continue;
      if (permission && !p.permissions.has(permission)) continue;
      p.window.webContents.send(channel, data);
    }
  }

  /**
   * Broadcast an event to all plugins (or all except one) for inter-plugin communication.
   * Requires 'plugins.communicate' permission.
   */
  broadcastToPlugins(channel, data, excludePluginId = null) {
    for (const [id, p] of this.plugins) {
      if (id === excludePluginId || p.state !== 'ready' || !p.window || p.window.isDestroyed()) continue;
      if (!p.permissions.has('plugins.communicate')) continue;
      p.window.webContents.send(`plugin:broadcast:${channel}`, data);
    }
  }

  /**
   * Register a handler for plugin-to-plugin broadcast messages.
   */
  registerBroadcastHandler(pluginId, channel, handler) {
    const plugin = this.plugins.get(pluginId);
    if (!plugin) return false;
    if (!plugin.broadcastHandlers) plugin.broadcastHandlers = new Map();
    if (!plugin.broadcastHandlers.has(channel)) {
      plugin.broadcastHandlers.set(channel, []);
    }
    plugin.broadcastHandlers.get(channel).push(handler);
    return true;
  }

  async applyBeforeSaveTransforms(initialContent) {
    let currentContent = initialContent;
    for (const plugin of this.plugins.values()) {
      if (plugin.state !== 'ready' || !plugin.window || plugin.window.isDestroyed()) continue;
      if (!plugin.permissions.has('file.save')) continue;

      try {
        const transformed = await new Promise((resolve) => {
          const requestId = `save-${Date.now()}-${Math.random().toString(36).slice(2)}`;
          const timeout = setTimeout(() => {
            ipcMain.removeListener('file:beforeSaveResult', handler);
            resolve(currentContent);
          }, 1500);

          const handler = (_, response) => {
            if (response && response.requestId === requestId) {
              clearTimeout(timeout);
              ipcMain.removeListener('file:beforeSaveResult', handler);
              resolve(typeof response.content === 'string' ? response.content : currentContent);
            }
          };

          ipcMain.on('file:beforeSaveResult', handler);
          plugin.window.webContents.send('file:beforeSave', { requestId, content: currentContent });
        });
        currentContent = transformed;
      } catch (err) {
        console.warn(`[PluginHost] Failed to apply beforeSave transform for ${plugin.manifest.name}:`, err);
      }
    }
    return currentContent;
  }

  async applySmartPaste(initialData) {
    let current = initialData && typeof initialData === 'object'
      ? { text: String(initialData.text || ''), html: String(initialData.html || '') }
      : { text: String(initialData || ''), html: '' };
    for (const plugin of this.plugins.values()) {
      if (plugin.state !== 'ready' || !plugin.window || plugin.window.isDestroyed()) continue;
      if (!plugin.permissions.has('clipboard.smartPaste')) continue;
      current = await new Promise((resolve) => {
        const requestId = `paste-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const timeout = setTimeout(() => {
          ipcMain.removeListener('clipboard:smartPasteResult', handler);
          resolve(current);
        }, 1500);
        const handler = (_, response) => {
          if (response?.requestId === requestId) {
            clearTimeout(timeout);
            ipcMain.removeListener('clipboard:smartPasteResult', handler);
            resolve(response.result && typeof response.result === 'object' ? response.result : current);
          }
        };
        ipcMain.on('clipboard:smartPasteResult', handler);
        plugin.window.webContents.send('clipboard:smartPaste', {
          requestId,
          text: current.text,
          html: current.html,
        });
      });
    }
    return current;
    }

  /**
   * Apply all registered markdown transforms in sequence.
   * Used for preview/export pipeline.
   */
  async applyMarkdownTransforms(markdown, context = {}) {
    let result = markdown;
    for (const item of this.markdownTransforms || []) {
      try {
        const transformed = typeof item.transform === 'function'
          ? await item.transform(result, context)
          : (typeof item.fn === 'function' ? await item.fn(result, context) : result);
        if (typeof transformed === 'string') result = transformed;
      } catch (err) {
        console.error('Markdown transform error:', err);
      }
    }
    return result;
  }

  _registerCoreHandlers() {
    // Editor handlers - ensure serializable returns
    this.registerHandler('editor:getContent', async () => {
      const result = await this.mainWindow.webContents.executeJavaScript('window.getEditorContent?.()');
      return typeof result === 'string' ? result : String(result);
    });

    this.registerHandler('editor:setContent', async ({ content }) => {
      await this.mainWindow.webContents.executeJavaScript(
        `window.setEditorContent?.(${JSON.stringify(content)}); null`);
      return { success: true };
    });

    this.registerHandler('editor:getSelection', async () => {
      const result = await this.mainWindow.webContents.executeJavaScript('window.getEditorSelection?.()');
      return typeof result === 'object' ? JSON.stringify(result) : String(result);
    });

    this.registerHandler('editor:setSelection', async ({ selection }) => {
      await this.mainWindow.webContents.executeJavaScript(
        `window.setEditorSelection?.(${JSON.stringify(selection)}); null`
      );
      return { success: true };
    });

    this.registerHandler('editor:replaceSelection', async ({ text, from }) => {
      await this.mainWindow.webContents.executeJavaScript(
        `window.replaceEditorSelection?.(${JSON.stringify(text)}, ${JSON.stringify(from ?? null)}); null`);
      return { success: true };
    });

    this.registerHandler('editor:executeCommand', async ({ commandId }) => {
      await this.mainWindow.webContents.executeJavaScript(
        `window.executePluginEditorCommand?.(${JSON.stringify(commandId)}); null`);
      return { success: true };
    });

    // File handlers
    this.registerHandler('file:read', async ({ path: filePath }) => {
      const { filePaths } = await dialog.showOpenDialog(this.mainWindow, {
        properties: ['openFile'],
        defaultPath: filePath
      });
      if (!filePaths?.length) return null;
      return fs.readFileSync(filePaths[0], 'utf8');
    });

    this.registerHandler('file:write', async ({ path: filePath, content }) => {
      fs.writeFileSync(filePath, content, 'utf8');
      return { success: true };
    });

    this.registerHandler('file:save', async ({ content, defaultPath }) => {
      const { filePath, canceled } = await dialog.showSaveDialog(this.mainWindow, {
        defaultPath: defaultPath || 'untitled.md',
        filters: [{ name: 'Markdown', extensions: ['md'] }]
      });
      if (canceled || !filePath) return { canceled: true };
      fs.writeFileSync(filePath, content, 'utf8');
      return { filePath };
    });

    this.registerHandler('file:export', async ({ format, content }) => {
      const { buildExportDocument } = require('../export-html');
      if (format === 'html') {
        return { html: buildExportDocument(content, 'dark') };
      }
      // PDF would need hidden window
      return { error: 'PDF export not implemented in sandbox host' };
    });

    this.registerHandler('file:pickFile', async (options = {}) => {
      const { filePaths } = await dialog.showOpenDialog(this.mainWindow, {
        properties: ['openFile'],
        ...options
      });
      return filePaths?.[0] || null;
    });

    this.registerHandler('file:pickFolder', async () => {
      const { filePaths } = await dialog.showOpenDialog(this.mainWindow, {
        properties: ['openDirectory']
      });
      return filePaths?.[0] || null;
    });

    // Settings handlers
    this.registerHandler('settings:get', async ({ key }, _event, plugin) => {
      return this.settingsStore.get(plugin.manifest.name, key) ?? null;
    });

    this.registerHandler('settings:register', async ({ key, defaultValue, metadata }, _event, plugin) => {
      this.settingsStore.register(plugin.manifest.name, key, defaultValue, metadata);
      return { success: true };
    });

    this.registerHandler('settings:set', async ({ key, value }, _event, plugin) => {
      const pluginId = plugin.manifest.name;
      const change = { key, value, pluginId };
      this.settingsStore.set(pluginId, key, value);
      this.mainWindow.webContents.send('settings:changed', change);
      if (plugin.window && !plugin.window.isDestroyed()) {
        plugin.window.webContents.send('settings:changed', { key, value });
      }
      return { success: true };
    });

    this.registerHandler('settings:getAll', async (_payload, _event, plugin) => {
      return this.settingsStore.getAll(plugin.manifest.name);
    });

    // UI handlers
    this.registerHandler('ui:addMenuItem', async ({ section, item }, _event, plugin) => {
      if (!['file', 'edit', 'insert', 'view', 'plugins'].includes(section)) {
        throw new Error('Invalid menu section');
      }
      if (
        !item
        || typeof item.id !== 'string'
        || !/^[a-z0-9-:]+$/.test(item.id)
        || typeof item.label !== 'string'
        || item.label.length > 200
      ) {
        throw new Error('Invalid plugin menu item');
      }
      plugin.uiMenuItems.add(item.id);
      this.mainWindow.webContents.send('ui:addMenuItem', {
        section,
        item,
        pluginId: plugin.manifest.name,
      });
      return { success: true };
    });

    this.registerHandler('ui:removeMenuItem', async ({ itemId }, _event, plugin) => {
      if (!plugin.uiMenuItems.has(itemId)) {
        throw new Error('Plugin does not own this menu item');
      }
      plugin.uiMenuItems.delete(itemId);
      this.mainWindow.webContents.send('ui:removeMenuItem', {
        itemId,
        pluginId: plugin.manifest.name,
      });
      return { success: true };
    });

    this.registerHandler('ui:setStatusBar', async ({ text, ...options }, _event, plugin) => {
      const pluginId = plugin.manifest.name;
      this.mainWindow.webContents.send('ui:setStatusBar', { text, pluginId, ...options });
      return { success: true };
    });

    this.registerHandler('ui:showNotification', async ({ title, body, ...options }, _event, plugin) => {
      this.mainWindow.webContents.send('ui:showNotification', {
        title,
        body,
        ...options,
        pluginId: plugin.manifest.name,
      });
      return { success: true };
    });

    // UPDATE THIS HANDLER:
    this.registerHandler('ui:registerCommand', async ({ command }, _event, plugin) => {
      const pluginId = plugin.manifest.name;
      if (
        !command
        || typeof command.id !== 'string'
        || !/^[a-z0-9-:]+$/.test(command.id)
        || typeof command.label !== 'string'
        || command.label.length > 200
      ) {
        throw new Error('Invalid plugin command');
      }
      plugin.uiCommands.add(command.id);
      // Forward command registration to the main renderer window
      this.mainWindow.webContents.send('plugin:registerCommand', { pluginId, command });
      return { success: true };
    });

    this.registerHandler('ui:registerSidebarPanel', async ({ panel }, _event, plugin) => {
      if (!panel || typeof panel.id !== 'string' || !/^[a-z0-9-:]+$/.test(panel.id)
        || typeof panel.title !== 'string' || panel.title.length > 200
        || (panel.icon !== undefined && (typeof panel.icon !== 'string' || panel.icon.length > 64))) {
        throw new Error('Invalid sidebar panel');
      }
      const location = panel.location ?? 'right';
      if (location !== 'left' && location !== 'right') {
        throw new Error('Sidebar panel location must be "left" or "right"');
      }
      let entryUrl = null;
      if (typeof panel.entry === 'string') {
        const entryPath = path.resolve(plugin.path, panel.entry);
        if (!entryPath.startsWith(path.resolve(plugin.path) + path.sep)) {
          throw new Error('Sidebar panel entry must remain inside the plugin directory');
        }
        if (!fs.existsSync(entryPath)) throw new Error('Sidebar panel entry not found');
        entryUrl = pathToFileURL(entryPath).href;
      }
      plugin.uiSidebarPanels.add(panel.id);
      const registered = {
        id: panel.id,
        title: panel.title,
        icon: typeof panel.icon === 'string' ? panel.icon : 'panel-right',
        location,
        entryUrl,
        pluginId: plugin.manifest.name,
      };
      this.mainWindow.webContents.send('ui:registerSidebarPanel', registered);
      return { success: true };
    });

    this.registerHandler('ui:removeSidebarPanel', async ({ panelId }, _event, plugin) => {
      if (!plugin.uiSidebarPanels.has(panelId)) throw new Error('Plugin does not own this sidebar panel');
      plugin.uiSidebarPanels.delete(panelId);
      this.mainWindow.webContents.send('ui:removeSidebarPanel', {
        panelId,
        pluginId: plugin.manifest.name,
      });
      return { success: true };
    });

    this.registerHandler('ui:registerFloatingWidget', async ({ widget }, _event, plugin) => {
      if (!widget || typeof widget.id !== 'string' || !/^[a-z0-9-:]+$/.test(widget.id)
        || typeof widget.title !== 'string' || widget.title.length > 200) {
        throw new Error('Invalid floating widget');
      }
      const position = widget.position ?? 'right';
      if (position !== 'left' && position !== 'right' && position !== 'float') {
        throw new Error('Floating widget position must be "left", "right", or "float"');
      }
      let entryUrl = null;
      if (typeof widget.entry === 'string') {
        const entryPath = path.resolve(plugin.path, widget.entry);
        if (!entryPath.startsWith(path.resolve(plugin.path) + path.sep)) {
          throw new Error('Floating widget entry must remain inside the plugin directory');
        }
        if (!fs.existsSync(entryPath)) throw new Error('Floating widget entry not found');
        entryUrl = pathToFileURL(entryPath).href;
      }
      plugin.uiFloatingWidgets.add(widget.id);
      const registered = {
        id: widget.id,
        title: widget.title,
        position,
        collapsible: widget.collapsible !== false,
        entryUrl,
        width: typeof widget.width === 'number' ? widget.width : undefined,
        height: typeof widget.height === 'number' ? widget.height : undefined,
        pluginId: plugin.manifest.name,
      };
      this.mainWindow.webContents.send('ui:registerFloatingWidget', registered);
      return { success: true };
    });

    this.registerHandler('ui:registerFloatingToolbar', async ({ toolbar }, _event, plugin) => {
      if (!toolbar || typeof toolbar.id !== 'string' || !/^[a-z0-9-:]+$/.test(toolbar.id)
        || !Array.isArray(toolbar.items)) {
        throw new Error('Invalid floating toolbar');
      }
      const position = toolbar.position ?? 'right';
      if (position !== 'left' && position !== 'right' && position !== 'float') {
        throw new Error('Floating toolbar position must be "left", "right", or "float"');
      }
      plugin.uiFloatingWidgets.add(toolbar.id);
      const registered = {
        id: toolbar.id,
        title: toolbar.title || 'Toolbar',
        position,
        collapsible: toolbar.collapsible !== false,
        items: toolbar.items,
        pluginId: plugin.manifest.name,
      };
      this.mainWindow.webContents.send('ui:registerFloatingToolbar', registered);
      return { success: true };
    });

    this.registerHandler('ui:removeFloatingWidget', async ({ widgetId }, _event, plugin) => {
      if (!plugin.uiFloatingWidgets.has(widgetId)) throw new Error('Plugin does not own this floating widget');
      plugin.uiFloatingWidgets.delete(widgetId);
      this.mainWindow.webContents.send('ui:removeFloatingWidget', {
        widgetId,
        pluginId: plugin.manifest.name,
      });
      return { success: true };
    });

    this.registerHandler('ui:toggleFloatingWidget', async ({ widgetId, visible }, _event, plugin) => {
      if (!plugin.uiFloatingWidgets.has(widgetId)) throw new Error('Plugin does not own this floating widget');
      this.mainWindow.webContents.send('ui:toggleFloatingWidget', {
        widgetId,
        visible,
        pluginId: plugin.manifest.name,
      });
      return { success: true };
    });

    this.registerHandler('ui:registerCustomView', async ({ view }, _event, plugin) => {
      if (!view || typeof view.id !== 'string' || !/^[a-z0-9-:]+$/.test(view.id)
        || typeof view.name !== 'string' || !Array.isArray(view.extensions)
        || typeof view.entry !== 'string') {
        throw new Error('Invalid custom view');
      }
      const entryPath = path.resolve(plugin.path, view.entry);
      if (!entryPath.startsWith(path.resolve(plugin.path) + path.sep) || !fs.existsSync(entryPath)) {
        throw new Error('Custom view entry must exist inside the plugin directory');
      }
      plugin.uiCustomViews.add(view.id);
      this.mainWindow.webContents.send('ui:registerCustomView', {
        id: view.id,
        name: view.name,
        extensions: view.extensions,
        entryUrl: pathToFileURL(entryPath).href,
        pluginId: plugin.manifest.name,
      });
      return { success: true };
    });

    this.registerHandler('ui:removeCustomView', async ({ viewId }, _event, plugin) => {
      if (!plugin.uiCustomViews.has(viewId)) throw new Error('Plugin does not own this custom view');
      plugin.uiCustomViews.delete(viewId);
      this.mainWindow.webContents.send('ui:removeCustomView', { viewId, pluginId: plugin.manifest.name });
      return { success: true };
    });

    this.registerHandler('ui:openCustomView', async ({ viewId, name, state }, _event, plugin) => {
      if (typeof viewId !== 'string' || !plugin.uiCustomViews.has(viewId)) {
        throw new Error('Plugin does not own this custom view');
      }
      if (name !== undefined && (typeof name !== 'string' || !name.trim() || name.length > 200)) {
        throw new Error('Invalid custom view tab name');
      }
      let serializedState;
      try {
        serializedState = JSON.stringify(state === undefined ? null : state);
      } catch {
        throw new Error('Custom view state must be JSON-serializable');
      }
      if (typeof serializedState !== 'string' || Buffer.byteLength(serializedState, 'utf8') > 262144) {
        throw new Error('Custom view state must be at most 256 KB');
      }
      const safeState = JSON.parse(serializedState);
      this.mainWindow.webContents.send('ui:openCustomView', {
        pluginId: plugin.manifest.name,
        viewId,
        name: name?.trim(),
        state: safeState,
      });
      return { success: true };
    });

    this.registerHandler('editor:registerSlashCommand', async ({ command }, _event, plugin) => {
      if (!command || typeof command.id !== 'string' || !/^[a-z0-9-:]+$/.test(command.id)
        || typeof command.label !== 'string') {
        throw new Error('Invalid slash command');
      }
      console.log(`[PluginHost] Registering slash command: ${command.id} for ${plugin.manifest.name}`);
      plugin.uiSlashCommands.add(command.id);
      this.mainWindow.webContents.send('plugin:registerSlashCommand', {
        pluginId: plugin.manifest.name,
        command,
      });
      return { success: true };
    });

    this.registerHandler('editor:removeSlashCommand', async ({ commandId }, _event, plugin) => {
      if (!plugin.uiSlashCommands.has(commandId)) throw new Error('Plugin does not own this slash command');
      console.log(`[PluginHost] Removing slash command: ${commandId} for ${plugin.manifest.name}`);
      plugin.uiSlashCommands.delete(commandId);
      this.mainWindow.webContents.send('plugin:removeSlashCommand', {
        pluginId: plugin.manifest.name,
        commandId,
      });
      return { success: true };
    });

    // Clipboard handlers
    this.registerHandler('clipboard:readText', async () => {
      return this.mainWindow.webContents.executeJavaScript('navigator.clipboard.readText()');
    });

    this.registerHandler('clipboard:writeText', async ({ text }) => {
      return this.mainWindow.webContents.executeJavaScript(
        `navigator.clipboard.writeText(${JSON.stringify(text)})`
      );
    });

    this.registerHandler('clipboard:readHTML', async () => {
      return this.mainWindow.webContents.executeJavaScript('navigator.clipboard.readHTML()');
    });

    this.registerHandler('clipboard:writeHTML', async ({ html }) => {
      return this.mainWindow.webContents.executeJavaScript(
        `navigator.clipboard.writeHTML(${JSON.stringify(html)})`
      );
    });

    // Network handler
    this.registerHandler('network:fetch', async ({ url, options = {} }, _event, plugin) => {
      const method = typeof options.method === 'string' ? options.method.toUpperCase() : 'GET';
      if (method !== 'GET' && !plugin.permissions.has('network.request:write')) {
        throw new Error('Missing permission: network.request:write');
      }
      try {
        const response = await fetch(url, options);
        const contentType = response.headers.get('content-type') || '';
        let data;
        if (contentType.includes('application/json')) {
          data = await response.json();
        } else {
          data = await response.text();
        }
        return { status: response.status, data, headers: Object.fromEntries(response.headers) };
      } catch (err) {
        return { error: err.message };
      }
    });

    // Plugin Event Bus - broadcast to other plugins
    this.registerHandler('plugins:broadcast', async ({ channel, data }, _event, plugin) => {
      if (!plugin.permissions.has('plugins.communicate')) {
        throw new Error('Missing permission: plugins.communicate');
      }
      if (!channel || typeof channel !== 'string') {
        throw new Error('Channel is required');
      }
      this.broadcastToPlugins(channel, data, plugin.manifest.name);
      return { success: true };
    });

    // Plugin Event Bus - subscribe to broadcasts
    this.registerHandler('plugins:on', async ({ channel }, _event, plugin) => {
      if (!plugin.permissions.has('plugins.communicate')) {
        throw new Error('Missing permission: plugins.communicate');
      }
      if (!channel || typeof channel !== 'string') {
        throw new Error('Channel is required');
      }
      // The plugin will receive events via the 'plugin:broadcast:<channel>' IPC
      // We just acknowledge the subscription
      if (!plugin.broadcastSubscriptions) plugin.broadcastSubscriptions = new Set();
      plugin.broadcastSubscriptions.add(channel);
      return { success: true };
    });

    // Async Markdown Transforms
    this.markdownTransforms = this.markdownTransforms || [];
    this.registerHandler('editor:registerMarkdownTransform', async ({ fnCode }, _event, plugin) => {
      if (!plugin.permissions.has('markdown.transform')) {
        throw new Error('Missing permission: markdown.transform');
      }
      if (!fnCode || typeof fnCode !== 'string') {
        throw new Error('Function code is required');
      }
      this.markdownTransforms.push({
        pluginId: plugin.manifest.name,
        transform: async (markdown, context) => {
          if (!plugin.window || plugin.window.isDestroyed()) return markdown;
          try {
            return await plugin.window.webContents.executeJavaScript(
              `(${fnCode})(${JSON.stringify(markdown)}, ${JSON.stringify(context)})`
            );
          } catch (e) {
            console.error(`Transform error in ${plugin.manifest.name}:`, e);
            return markdown;
          }
        }
      });
      return { success: true };
    });

    // Workspace Events
    this.registerHandler('workspace:onFileOpen', async ({ pattern }, _event, plugin) => {
      if (!plugin.permissions.has('file.read')) {
        throw new Error('Missing permission: file.read');
      }
      if (!pattern || typeof pattern !== 'string') {
        throw new Error('Glob pattern is required');
      }
      plugin.fileWatchPatterns = plugin.fileWatchPatterns || [];
      plugin.fileWatchPatterns.push(pattern);
      return { success: true };
    });

    this.registerHandler('workspace:onFileSave', async ({ pattern }, _event, plugin) => {
      if (!plugin.permissions.has('file.write')) {
        throw new Error('Missing permission: file.write');
      }
      if (!pattern || typeof pattern !== 'string') {
        throw new Error('Glob pattern is required');
      }
      plugin.fileSavePatterns = plugin.fileSavePatterns || [];
      plugin.fileSavePatterns.push(pattern);
      return { success: true };
    });
  }

  registerHandler(channel, handler) {
    this.requestHandlers.set(channel, handler);
  }

  /**
   * Load and validate plugin manifest
   */
  async loadManifest(pluginPath) {
    const manifestPath = path.join(pluginPath, 'plugin.json');
    if (!fs.existsSync(manifestPath)) {
      throw new Error('Missing plugin.json');
    }
    const raw = fs.readFileSync(manifestPath, 'utf8');
    const manifest = JSON.parse(raw);
    const { ok, data, errors } = validateManifest(manifest);
    if (!ok) throw new Error('Invalid manifest:\n' + errors.join('\n'));
    return data;
  }

  /**
   * Create sandboxed plugin window
   */
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
    pluginWindow.webContents.on('render-process-gone', (_event, details) => {
      if (plugin.window !== pluginWindow) return;

      plugin.state = 'error';
      plugin.error = `Renderer crashed: ${details?.reason || 'unknown'}`;
      plugin.crashCount = (plugin.crashCount || 0) + 1;
      plugin.lastCrash = Date.now();

      plugin.window = null;
      if (!pluginWindow.isDestroyed()) pluginWindow.destroy();
      this._cleanupPluginUI(pluginId, plugin);

      // Auto-recover up to 3 times with 5s delay
      if (plugin.crashCount <= 3) {
        console.log(`[PluginHost] Plugin ${pluginId} crashed (${plugin.crashCount}/3), scheduling recovery...`);
        setTimeout(() => {
          const p = this.plugins.get(pluginId);
          if (p && p.state === 'error') {
            console.log(`[PluginHost] Attempting auto-recovery for ${pluginId}...`);
            this.createPluginWindow(p).catch(err => {
              console.error(`[PluginHost] Auto-recovery failed for ${pluginId}:`, err);
            });
          }
        }, 5000);
      } else {
        console.error(`[PluginHost] Plugin ${pluginId} exceeded max crash recovery attempts`);
      }

      this._notifyPluginsChanged();
    });
    pluginWindow.on('closed', () => {
      if (plugin.window !== pluginWindow) return;
      plugin.window = null;
      // If plugin was intentionally disabled, state is already 'disabled'
      // Only set error if it wasn't an intentional disable
      if (plugin.state !== 'disabled') {
        plugin.state = 'error';
        plugin.error = 'Plugin window closed unexpectedly';
      }
      this._cleanupPluginUI(pluginId, plugin);
      this._notifyPluginsChanged();
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

  /**
   * Install plugin from directory
   */
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
      uiCommands: new Set((manifest.commands || []).map(command => command.id)),
      uiMenuItems: new Set((manifest.menu_items || []).map(item => item.id)),
      uiSidebarPanels: new Set(),
      uiFloatingWidgets: new Set(),
      uiCustomViews: new Set(),
      uiSlashCommands: new Set(),
      stylesheet: manifest.stylesheet || '',
      state: this.savedPluginState[pluginId] !== false ? 'loading' : 'disabled',
      // Use saved enabled state, default to true for new plugins
      _enabled: this.savedPluginState[pluginId] !== false,
    };
    this.plugins.set(pluginId, plugin);   // must exist BEFORE the window loads

    // Only create window if plugin is enabled
    if (plugin.state !== 'disabled') {
      try {
        await this.createPluginWindow(plugin);
      } catch (err) {
      plugin.state = 'error';
      plugin.error = err instanceof Error ? err.message : String(err);
      if (plugin.window && !plugin.window.isDestroyed()) {
        plugin.window.destroy();
      }
      plugin.window = null;
      this._notifyPluginsChanged();
      throw err;
    }
  }
  return pluginId;
  }

  /**
   * Uninstall plugin
   */
  async uninstallPlugin(pluginId) {
    const plugin = this.plugins.get(pluginId);
    if (!plugin) return false;

    await this.setPluginEnabled(pluginId, false);

    // Remove files
    if (fs.existsSync(plugin.path)) {
      fs.rmSync(plugin.path, { recursive: true, force: true });
    }

    this.plugins.delete(pluginId);
    this._notifyPluginsChanged();
    return true;
  }

  /**
   * Enable/disable plugin
   */
  async setPluginEnabled(pluginId, enabled) {
    const plugin = this.plugins.get(pluginId);
    if (!plugin) return false;

    // Persist the enabled state
    this.savedPluginState[pluginId] = enabled;
    this._savePluginState();

    if (enabled) {
      const hasWindow = plugin.window && !plugin.window.isDestroyed();
      if (hasWindow && (plugin.state === 'loading' || plugin.state === 'ready')) return true;
      if (hasWindow) plugin.window.destroy();
      plugin.window = null;
      plugin.state = 'loading';
      plugin.error = null;
      try {
        await this.createPluginWindow(plugin);
      } catch (err) {
        plugin.state = 'error';
        plugin.error = err instanceof Error ? err.message : String(err);
        if (plugin.window && !plugin.window.isDestroyed()) {
          plugin.window.destroy();
        }
        plugin.window = null;
        this._notifyPluginsChanged();
        throw err;
      }
    } else {
      const hasWindow = plugin.window && !plugin.window.isDestroyed();
      if (plugin.state === 'disabled' && !hasWindow) return true;
      if (hasWindow) {
        plugin.state = 'disabled'; // Set BEFORE destroy so closed handler sees it
        plugin.window.destroy();
      }
      plugin.window = null;
      this._cleanupPluginUI(pluginId, plugin);
    }

    this._notifyPluginsChanged();
    return true;
  }

  getPluginsList() {
    const list = [];
    for (const [id, plugin] of this.plugins) {
      list.push({
        name: plugin.manifest.name,
        version: plugin.manifest.version,
        description: plugin.manifest.description,
        author: plugin.manifest.author,
        active: plugin.state === 'ready',
        enabled: plugin.state === 'loading' || plugin.state === 'ready',
        permissions: [...plugin.permissions],
        commands: plugin.manifest.commands || [],
        menuItems: plugin.manifest.menu_items || [],
        sidebarPanels: [...(plugin.uiSidebarPanels || [])],
        floatingWidgets: [...(plugin.uiFloatingWidgets || [])],
        customViews: [...(plugin.uiCustomViews || [])],
        slashCommands: [...(plugin.uiSlashCommands || [])],
        path: plugin.path,
        error: plugin.error
      });
    }
    return list;
  }

  getPluginSettings(pluginId) {
    if (pluginId) {
      return {
        values: this.settingsStore.getAll(pluginId),
        metadata: this.settingsStore.getAllMetadata(pluginId),
      };
    }
    const all = {};
    for (const id of this.plugins.keys()) {
      all[id] = {
        values: this.settingsStore.getAll(id),
        metadata: this.settingsStore.getAllMetadata(id),
      };
    }
    return all;
  }

  async reloadAll() {
    for (const [id, plugin] of this.plugins) {
      if (plugin.state === 'ready' || plugin.state === 'loading' || plugin.state === 'error') {
        try {
          const manifest = await this.loadManifest(plugin.path);
          plugin.manifest = manifest;
          plugin.permissions = new Set(manifest.permissions || []);
          plugin.uiCommands = new Set((manifest.commands || []).map(c => c.id));
          plugin.uiMenuItems = new Set((manifest.menu_items || []).map(i => i.id));
          if (plugin.window && !plugin.window.isDestroyed()) {
            plugin.window.destroy();
          }
          plugin.window = null;
          plugin.state = 'loading';
          plugin.error = null;
          await this.createPluginWindow(plugin);
        } catch (err) {
          plugin.state = 'error';
          plugin.error = err instanceof Error ? err.message : String(err);
          if (plugin.window && !plugin.window.isDestroyed()) {
            plugin.window.destroy();
          }
          plugin.window = null;
        }
      }
    }
    this._notifyPluginsChanged();
    return true;
  }

  _copyDir(src, dest) {
    fs.mkdirSync(dest, { recursive: true });
    for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);
      if (entry.isDirectory()) {
        this._copyDir(srcPath, destPath);
      } else {
        fs.copyFileSync(srcPath, destPath);
      }
    }
  }

  /**
   * Cleanup all plugin windows
   */
  destroy() {
    for (const plugin of this.plugins.values()) {
      if (plugin.window && !plugin.window.isDestroyed()) {
        plugin.window.destroy();
      }
    }
    this.plugins.clear();
  }
}

module.exports = { PluginSandboxHost };
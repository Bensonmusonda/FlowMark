/**
 * Plugin Sandbox Preload Script
 *
 * Injected into each plugin's isolated renderer process (sandbox: true).
 * Provides a secure, permission-gated API surface via contextBridge.
 *
 * This runs with Node integration DISABLED and context isolation ENABLED.
 */

// Polyfill Node.js globals for sandboxed plugins
if (typeof globalThis.global === 'undefined') {
  globalThis.global = globalThis;
}
if (typeof globalThis.process === 'undefined') {
  globalThis.process = { env: {}, platform: 'browser', version: '' };
}
if (typeof globalThis.Buffer === 'undefined') {
  globalThis.Buffer = class Buffer {
    static from(data, encoding) { return new TextEncoder().encode(data); }
    static alloc(size) { return new Uint8Array(size); }
  };
}

const { contextBridge, ipcRenderer } = require('electron');

const arg = (name) => {
  const prefix = `--${name}=`;
  const found = process.argv.find((a) => a.startsWith(prefix));
  return found ? found.slice(prefix.length) : '';
};
const PLUGIN_ID = arg('plugin-id');
const PLUGIN_PERMISSIONS = new Set(arg('plugin-permissions').split(',').filter(Boolean));
const commandHandlers = new Map();
const slashCommandHandlers = new Map();
let currentSlashTriggerPos = null; // Position of '/' trigger for current slash command
const beforeSaveHandlers = [];
const smartPasteHandlers = [];

// Listen for runtime permission changes from host
ipcRenderer.on('permissions:changed', (_, permissions) => {
  if (Array.isArray(permissions)) {
    PLUGIN_PERMISSIONS.clear();
    for (const perm of permissions) PLUGIN_PERMISSIONS.add(perm);
    // Update the exposed API's permissions array
    if (window.flowmarkPlugin) {
      window.flowmarkPlugin.permissions = [...PLUGIN_PERMISSIONS];
    }
  }
});

// Plugin Event Bus - listen for broadcasts from other plugins
const broadcastListeners = new Map(); // channel -> Set of callbacks
ipcRenderer.on('plugin:broadcast:*', (_, { channel, data }) => {
  const listeners = broadcastListeners.get(channel);
  if (listeners) {
    for (const fn of listeners) {
      try { fn(data); } catch (e) { console.error(`[plugin:${PLUGIN_ID}] broadcast listener error:`, e); }
    }
  }
});

// Host tells us a command was clicked in the main window
ipcRenderer.on('plugin:command', (_, { id }) => {
  const fn = commandHandlers.get(id);
  if (fn) { try { fn(); } catch (e) { console.error(e); } }
});

ipcRenderer.on('plugin:slashCommand', (_, { id, triggerPos }) => {
  const fn = slashCommandHandlers.get(id);
  if (fn) {
    // Store triggerPos so the run handler can access it via a getter
    currentSlashTriggerPos = triggerPos;
    try { fn(triggerPos); } catch (e) { console.error(e); }
    currentSlashTriggerPos = null;
  }
});

// Host asks us to transform content before save
ipcRenderer.on('file:beforeSave', async (_, { requestId, content }) => {
  let result = content;
  for (const handler of beforeSaveHandlers) {
    try {
      const transformed = await handler(result);
      if (typeof transformed === 'string') result = transformed;
    } catch (e) {
      console.error(`[plugin:${PLUGIN_ID}] beforeSave handler error:`, e);
    }
  }
  ipcRenderer.send('file:beforeSaveResult', { requestId, content: result });
});

ipcRenderer.on('clipboard:smartPaste', async (_, { requestId, text, html }) => {
  let result = { text, html };
  for (const handler of smartPasteHandlers) {
    try {
      const transformed = await handler(result);
      if (typeof transformed === 'string') result = { text: transformed, html: '' };
      else if (transformed && typeof transformed === 'object') result = { ...result, ...transformed };
    } catch (e) {
      console.error(`[plugin:${PLUGIN_ID}] smartPaste handler error:`, e);
    }
  }
  ipcRenderer.send('clipboard:smartPasteResult', { requestId, result });
});

window.addEventListener('DOMContentLoaded', () => {
  ipcRenderer.send('plugin:ready', { pluginId: PLUGIN_ID });
});

/**
 * Check if plugin has a specific permission
 */
function hasPermission(perm) {
  if (!PLUGIN_PERMISSIONS.has(perm)) {
    console.warn(`[plugin-sandbox] Permission denied: ${perm} (plugin: ${PLUGIN_ID})`);
    return false;
  }
  return true;
}

/**
 * Send request to host and await response
 */
function sendRequest(channel, payload) {
  return new Promise((resolve, reject) => {
    const requestId = `${PLUGIN_ID}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const cleanup = () => {
      ipcRenderer.removeListener('plugin:response', handler);
      clearTimeout(timeout);
    };
    const handler = (_, response) => {
      if (response.requestId !== requestId) return;
      cleanup();
      if (response.error) reject(new Error(response.error));
      else resolve(response.data);
    };

    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error('Request timeout'));
    }, 5000);
    ipcRenderer.on('plugin:response', handler);
    ipcRenderer.send('plugin:request', { requestId, channel, payload });
  });
}

/**
 * Send event to host (fire-and-forget)
 */
function sendEvent(channel, payload) {
  ipcRenderer.send('plugin:event', { pluginId: PLUGIN_ID, channel, payload });
}

/**
 * Plugin API Surface - exposed via contextBridge
 */
const pluginAPI = {
  // Metadata
  id: PLUGIN_ID,
  permissions: [...PLUGIN_PERMISSIONS],
  hasPermission,

  // Editor API
  editor: {
    getContent: () => {
      if (!hasPermission('editor.read')) return Promise.reject(new Error('Permission denied: editor.read'));
      return sendRequest('editor:getContent', {});
    },
    setContent: (content) => {
      if (!hasPermission('editor.write')) return Promise.reject(new Error('Permission denied: editor.write'));
      return sendRequest('editor:setContent', { content });
    },
    getSelection: async () => {
      if (!hasPermission('editor.selection')) return Promise.reject(new Error('Permission denied: editor.selection'));
      const res = await sendRequest('editor:getSelection', {});
      return typeof res === 'string' ? JSON.parse(res) : res;
    },
    setSelection: (selection) => {
      if (!hasPermission('editor.write')) return Promise.reject(new Error('Permission denied: editor.write'));
      return sendRequest('editor:setSelection', { selection });
    },
    replaceSelection: (text, from) => {
      if (!hasPermission('editor.write')) return Promise.reject(new Error('Permission denied: editor.write'));
      const payload = { text };
      const fromPos = typeof from === 'number' ? from : currentSlashTriggerPos;
      if (typeof fromPos === 'number') payload.from = fromPos;
      return sendRequest('editor:replaceSelection', payload);
    },
    executeCommand: (commandId) => {
      if (!hasPermission('editor.commands')) return Promise.reject(new Error('Permission denied: editor.commands'));
      return sendRequest('editor:executeCommand', { commandId });
    },
    onContentChange: (callback) => {
      if (!hasPermission('editor.read')) return () => {};
      const handler = (_, data) => callback(data);
      ipcRenderer.on('editor:contentChanged', handler);
      return () => ipcRenderer.removeListener('editor:contentChanged', handler);
    },
    onSelectionChange: (callback) => {
      if (!hasPermission('editor.selection')) return () => {};
      const handler = (_, data) => callback(data);
      ipcRenderer.on('editor:selectionChanged', handler);
      return () => ipcRenderer.removeListener('editor:selectionChanged', handler);
    },
    registerSlashCommand: (command) => {
      if (!hasPermission('editor.slashCommands')) {
        return Promise.reject(new Error('Permission denied: editor.slashCommands'));
      }
      const { run, ...meta } = command || {};
      if (typeof run === 'function') slashCommandHandlers.set(meta.id, run);
      return sendRequest('editor:registerSlashCommand', { command: meta });
    },
    removeSlashCommand: (commandId) => sendRequest('editor:removeSlashCommand', { commandId }),
    registerMarkdownTransform: (fn) => {
      if (!hasPermission('markdown.transform')) return Promise.reject(new Error('Permission denied: markdown.transform'));
      if (typeof fn !== 'function') return Promise.reject(new Error('Transform must be a function'));
      return sendRequest('editor:registerMarkdownTransform', { fnCode: fn.toString() });
    }
  },

  // File API
  file: {
    read: (path) => {
      if (!hasPermission('file.read')) return Promise.reject(new Error('Permission denied: file.read'));
      return sendRequest('file:read', { path });
    },
    write: (path, content) => {
      if (!hasPermission('file.write')) return Promise.reject(new Error('Permission denied: file.write'));
      return sendRequest('file:write', { path, content });
    },
    save: (content, defaultPath) => {
      if (!hasPermission('file.save')) return Promise.reject(new Error('Permission denied: file.save'));
      return sendRequest('file:save', { content, defaultPath });
    },
    export: (format, content) => {
      if (!hasPermission('file.export')) return Promise.reject(new Error('Permission denied: file.export'));
      return sendRequest('file:export', { format, content });
    },
    pickFile: (options = {}) => {
      if (!hasPermission('file.read')) return Promise.reject(new Error('Permission denied: file.read'));
      return sendRequest('file:pickFile', options);
    },
    pickFolder: () => {
      if (!hasPermission('file.read')) return Promise.reject(new Error('Permission denied: file.read'));
      return sendRequest('file:pickFolder', {});
    }
  },

  // Settings API
  settings: {
    get: (key) => {
      if (!hasPermission('settings.read')) return Promise.reject(new Error('Permission denied: settings.read'));
      return sendRequest('settings:get', { key });
    },
    set: (key, value) => {
      if (!hasPermission('settings.write')) return Promise.reject(new Error('Permission denied: settings.write'));
      return sendRequest('settings:set', { key, value });
    },
    register: (key, defaultValue, metadata = {}) => {
      if (!hasPermission('settings.write')) {
        return Promise.reject(new Error('Permission denied: settings.write'));
      }
      return sendRequest('settings:register', { key, defaultValue, metadata });
    },
    getAll: () => {
      if (!hasPermission('settings.read')) return Promise.reject(new Error('Permission denied: settings.read'));
      return sendRequest('settings:getAll', {});
    },
    onChange: (callback) => {
      if (!hasPermission('settings.read')) return () => {};
      const handler = (_, data) => callback(data.key, data.value);
      ipcRenderer.on('settings:changed', handler);
      return () => ipcRenderer.removeListener('settings:changed', handler);
    }
  },

  // UI API
  ui: {
    addMenuItem: (section, item) => {
      if (!hasPermission('ui.menus')) return Promise.reject(new Error('Permission denied: ui.menus'));
      return sendRequest('ui:addMenuItem', { section, item });
    },
    removeMenuItem: (itemId) => {
      if (!hasPermission('ui.menus')) return Promise.reject(new Error('Permission denied: ui.menus'));
      return sendRequest('ui:removeMenuItem', { itemId });
    },
    setStatusBar: (text, options = {}) => {
      if (!hasPermission('ui.statusbar')) return Promise.reject(new Error('Permission denied: ui.statusbar'));
      return sendRequest('ui:setStatusBar', { text, ...options });
    },
    showNotification: (title, body, options = {}) => {
      if (!hasPermission('ui.notifications')) return Promise.reject(new Error('Permission denied: ui.notifications'));
      return sendRequest('ui:showNotification', { title, body, ...options });
    },
    registerCommand: (command) => {
      const { run, ...meta } = command || {};
      if (typeof run === 'function') commandHandlers.set(meta.id, run);
      if (!hasPermission('editor.commands')) return Promise.reject(new Error('Permission denied: editor.commands'));
      return sendRequest('ui:registerCommand', { command: meta });
    },
    registerSidebarPanel: (panel) => {
      if (!hasPermission('ui.panels')) return Promise.reject(new Error('Permission denied: ui.panels'));
      return sendRequest('ui:registerSidebarPanel', { panel });
    },
    removeSidebarPanel: (panelId) => sendRequest('ui:removeSidebarPanel', { panelId }),
  },

  // Custom tab views
  views: {
    registerCustomView: (view) => {
      if (!hasPermission('ui.customViews')) return Promise.reject(new Error('Permission denied: ui.customViews'));
      return sendRequest('ui:registerCustomView', { view });
    },
    open: (viewId, options = {}) => {
      if (!hasPermission('ui.customViews')) return Promise.reject(new Error('Permission denied: ui.customViews'));
      if (!options || typeof options !== 'object' || Array.isArray(options)) {
        return Promise.reject(new TypeError('Custom view options must be an object'));
      }
      const payload = { viewId };
      if (options.name !== undefined) payload.name = options.name;
      if (options.state !== undefined) payload.state = options.state;
      return sendRequest('ui:openCustomView', payload);
    },
    removeCustomView: (viewId) => sendRequest('ui:removeCustomView', { viewId })
  },

  // Plugin Event Bus (inter-plugin communication)
  events: {
    // Broadcast an event to other plugins
    broadcast: (channel, data) => {
      if (!hasPermission('plugins.communicate')) return Promise.reject(new Error('Permission denied: plugins.communicate'));
      return sendRequest('plugins:broadcast', { channel, data });
    },
    // Subscribe to events from other plugins
    on: (channel, callback) => {
      if (!hasPermission('plugins.communicate')) return () => {};
      const listeners = broadcastListeners.get(channel) || new Set();
      listeners.add(callback);
      broadcastListeners.set(channel, listeners);
      // Subscribe with host
      sendRequest('plugins:on', { channel });
      return () => {
        listeners.delete(callback);
        if (listeners.size === 0) broadcastListeners.delete(channel);
      };
    }
  },

  // Clipboard API
  clipboard: {
    readText: () => {
      if (!hasPermission('clipboard.read')) return Promise.reject(new Error('Permission denied: clipboard.read'));
      return sendRequest('clipboard:readText', {});
    },
    writeText: (text) => {
      if (!hasPermission('clipboard.write')) return Promise.reject(new Error('Permission denied: clipboard.write'));
      return sendRequest('clipboard:writeText', { text });
    },
    readHTML: () => {
      if (!hasPermission('clipboard.read')) return Promise.reject(new Error('Permission denied: clipboard.read'));
      return sendRequest('clipboard:readHTML', {});
    },
    writeHTML: (html) => {
      if (!hasPermission('clipboard.write')) return Promise.reject(new Error('Permission denied: clipboard.write'));
      return sendRequest('clipboard:writeHTML', { html });
    },
    registerSmartPaste: (handler) => {
      if (!hasPermission('clipboard.smartPaste')) {
        return Promise.reject(new Error('Permission denied: clipboard.smartPaste'));
      }
      if (typeof handler === 'function') smartPasteHandlers.push(handler);
      return Promise.resolve({ success: true });
    }
  },

  // Network API (restricted)
  network: {
    fetch: (url, options = {}) => {
      if (!hasPermission('network.request')) return Promise.reject(new Error('Permission denied: network.request'));
      const method = typeof options?.method === 'string' ? options.method.toUpperCase() : 'GET';
      if (method !== 'GET' && !hasPermission('network.request:write')) {
        return Promise.reject(new Error('Permission denied: network.request:write'));
      }
      return sendRequest('network:fetch', { url, options });
    }
  },

  // Events
  on: (event, callback) => {
    // file:beforeSave is handled locally (request/response with host)
    if (event === 'file:beforeSave') {
      beforeSaveHandlers.push(callback);
      return () => {
        const idx = beforeSaveHandlers.indexOf(callback);
        if (idx >= 0) beforeSaveHandlers.splice(idx, 1);
      };
    }
    const handler = (_, data) => callback(data);
    ipcRenderer.on(`plugin:${event}`, handler);
    return () => ipcRenderer.removeListener(`plugin:${event}`, handler);
  },
  emit: (event, data) => {
    if (event !== 'log') throw new Error(`Unsupported plugin event: ${String(event)}`);
    sendEvent(event, data);
  },

  // Utility
  log: (...args) => {
    console.log(`[plugin:${PLUGIN_ID}]`, ...args);
    sendEvent('log', { level: 'info', args });
  },
  warn: (...args) => {
    console.warn(`[plugin:${PLUGIN_ID}]`, ...args);
    sendEvent('log', { level: 'warn', args });
  },
  error: (...args) => {
    console.error(`[plugin:${PLUGIN_ID}]`, ...args);
    sendEvent('log', { level: 'error', args });
  }
};

// Expose API to plugin's global scope
contextBridge.exposeInMainWorld('flowmarkPlugin', pluginAPI);
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
const beforeSaveHandlers = [];

// Host tells us a command was clicked in the main window
ipcRenderer.on('plugin:command', (_, { id }) => {
  const fn = commandHandlers.get(id);
  if (fn) { try { fn(); } catch (e) { console.error(e); } }
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
    }, 30000);
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
    replaceSelection: (text) => {
      if (!hasPermission('editor.write')) return Promise.reject(new Error('Permission denied: editor.write'));
      return sendRequest('editor:replaceSelection', { text });
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
/**
 * PluginManager — local trusted-code plugin system for FlowMark.
 * 
 * Plugins are JavaScript modules in userData/plugins/ with the shape:
 *   module.exports = { name, version, activate(app) }
 * 
 * The `app` API provides:
 *   - registerCommand(id, def)
 *   - registerMarkdownTransform(fn)
 *   - registerStylesheet(cssText)
 *   - registerSetting(key, defaultValue, { type, label, description })
 *   - getSetting(key)
 *   - setSetting(key, value)
 *   - on(event, handler)
 *   - emit(event, ...args)
 *   - commands (CommandRegistry)
 *   - settings (settings store)
 */

import { app } from 'electron';
import fs from 'fs';
import path from 'path';
import { EventEmitter } from 'events';

// Import the command registry API
import * as CommandRegistry from '../commands/registry.js';

const PLUGINS_DIR = path.join(app.getPath('userData'), 'plugins');
const PLUGINS_CONFIG = path.join(app.getPath('userData'), 'plugins.json');

/**
 * Simple settings store with JSON persistence.
 */
class SettingsStore extends EventEmitter {
  constructor() {
    super();
    this._settings = new Map();
    this._defaults = new Map();
    this._metadata = new Map();
    this._loaded = false;
  }

  async load() {
    if (this._loaded) return;
    try {
      if (fs.existsSync(PLUGINS_CONFIG)) {
        const raw = fs.readFileSync(PLUGINS_CONFIG, 'utf8');
        const data = JSON.parse(raw);
        if (data.settings) {
          for (const [key, value] of Object.entries(data.settings)) {
            this._settings.set(key, value);
          }
        }
        if (data.defaults) {
          for (const [key, value] of Object.entries(data.defaults)) {
            this._defaults.set(key, value);
          }
        }
        if (data.metadata) {
          for (const [key, value] of Object.entries(data.metadata)) {
            this._metadata.set(key, value);
          }
        }
      }
    } catch (err) {
      console.warn('Failed to load plugin settings:', err);
    }
    this._loaded = true;
  }

  async save() {
    try {
      const data = {
        settings: Object.fromEntries(this._settings),
        defaults: Object.fromEntries(this._defaults),
        metadata: Object.fromEntries(this._metadata),
      };
      fs.writeFileSync(PLUGINS_CONFIG, JSON.stringify(data, null, 2), 'utf8');
    } catch (err) {
      console.error('Failed to save plugin settings:', err);
    }
  }

  register(key, defaultValue, metadata = {}) {
    if (!this._settings.has(key) && this._defaults.has(key)) {
      // Already registered
      return;
    }
    this._defaults.set(key, defaultValue);
    this._metadata.set(key, {
      type: metadata.type || 'string',
      label: metadata.label || key,
      description: metadata.description || '',
      plugin: metadata.plugin || 'core',
      ...metadata,
    });
    if (!this._settings.has(key)) {
      this._settings.set(key, defaultValue);
    }
    this.save();
  }

  get(key) {
    if (this._settings.has(key)) return this._settings.get(key);
    if (this._defaults.has(key)) return this._defaults.get(key);
    return undefined;
  }

  set(key, value) {
    this._settings.set(key, value);
    this.emit('change', key, value);
    this.save();
  }

  getAll() {
    const result = {};
    for (const [key, value] of this._settings) {
      result[key] = value;
    }
    for (const [key, value] of this._defaults) {
      if (!result.hasOwnProperty(key)) {
        result[key] = value;
      }
    }
    return result;
  }

  getMetadata(key) {
    return this._metadata.get(key);
  }

  getAllMetadata() {
    return Object.fromEntries(this._metadata);
  }
}

/**
 * PluginManager loads, activates, and manages plugins.
 */
export class PluginManager extends EventEmitter {
  constructor() {
    super();
    this.plugins = new Map(); // name -> { manifest, module, active, error }
    this.settings = new SettingsStore();
    this.markdownTransforms = [];
    this.stylesheets = [];
    this._appAPI = null;
  }

  /**
   * Initialize the plugin manager: load settings, scan plugins dir, activate enabled plugins.
   */
  async initialize() {
    await this.settings.load();
    this._ensurePluginsDir();
    await this._autoInstallBundledPlugins();  // Install bundled examples on first run
    await this._loadPluginsConfig();
    await this._activateEnabledPlugins();
    this._buildAppAPI();
  }

  /**
   * On first run, install bundled example plugins from src/plugins/ to userData/plugins/
   * and enable them by default.
   */
  async _autoInstallBundledPlugins() {
    // Use import.meta.url for ES module compatibility
    const currentDir = new URL('.', import.meta.url).pathname;
    const bundledPluginsDir = path.join(currentDir, '..', 'plugins');  // src/plugins/
    const configExists = fs.existsSync(PLUGINS_CONFIG);
    
    // Only auto-install on first run (no config yet)
    if (configExists) return;
    
    try {
      if (!fs.existsSync(bundledPluginsDir)) return;
      
      const entries = fs.readdirSync(bundledPluginsDir, { withFileTypes: true });
      const bundledPlugins = entries
        .filter(e => e.isDirectory())
        .map(e => e.name);
      
      for (const name of bundledPlugins) {
        const sourcePath = path.join(bundledPluginsDir, name);
        const destPath = path.join(PLUGINS_DIR, name);
        
        // Skip if already installed
        if (fs.existsSync(destPath)) continue;
        
        // Copy plugin directory
        this._copyDir(sourcePath, destPath);
        console.log(`[pluginManager] Auto-installed bundled plugin: ${name}`);
      }
      
      // Enable all bundled plugins by default
      if (bundledPlugins.length > 0) {
        const data = { enabled: bundledPlugins };
        fs.writeFileSync(PLUGINS_CONFIG, JSON.stringify(data, null, 2), 'utf8');
        console.log(`[pluginManager] Enabled bundled plugins by default: ${bundledPlugins.join(', ')}`);
      }
    } catch (err) {
      console.warn('[pluginManager] Failed to auto-install bundled plugins:', err);
    }
  }

  _ensurePluginsDir() {
    if (!fs.existsSync(PLUGINS_DIR)) {
      fs.mkdirSync(PLUGINS_DIR, { recursive: true });
    }
  }

  async _loadPluginsConfig() {
    try {
      if (fs.existsSync(PLUGINS_CONFIG)) {
        const raw = fs.readFileSync(PLUGINS_CONFIG, 'utf8');
        const data = JSON.parse(raw);
        if (data.enabled) {
          for (const name of data.enabled) {
            await this._loadPlugin(name);
          }
        }
      }
    } catch (err) {
      console.warn('Failed to load plugins config:', err);
    }
  }

  async _activateEnabledPlugins() {
    for (const [name, plugin] of this.plugins) {
      if (plugin.enabled !== false) {
        try {
          await this._activatePlugin(name);
        } catch (err) {
          console.error(`Failed to activate plugin "${name}":`, err);
          plugin.error = err.message;
          plugin.active = false;
        }
      }
    }
  }

  async _loadPlugin(name) {
    const pluginPath = path.join(PLUGINS_DIR, name, 'index.js');
    if (!fs.existsSync(pluginPath)) {
      // Try package.json main entry
      const pkgPath = path.join(PLUGINS_DIR, name, 'package.json');
      if (fs.existsSync(pkgPath)) {
        try {
          const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
          const main = pkg.main || 'index.js';
          const mainPath = path.join(PLUGINS_DIR, name, main);
          if (fs.existsSync(mainPath)) {
            return this._loadPluginModule(name, mainPath);
          }
        } catch (e) {
          // ignore
        }
      }
      console.warn(`Plugin "${name}" not found at ${pluginPath}`);
      return false;
    }
    return this._loadPluginModule(name, pluginPath);
  }

  _loadPluginModule(name, pluginPath) {
    try {
      // Clear require cache for hot reload during development
      delete require.cache[require.resolve(pluginPath)];
      const module = require(pluginPath);
      
      if (!module || typeof module !== 'object') {
        throw new Error('Plugin must export an object');
      }
      if (!module.name || !module.version || typeof module.activate !== 'function') {
        throw new Error('Plugin must export { name, version, activate(app) }');
      }

      const manifest = {
        name: module.name,
        version: module.version,
        description: module.description,
        author: module.author,
        main: pluginPath,
      };

      this.plugins.set(name, {
        manifest,
        module,
        active: false,
        enabled: true,
        error: null,
      });

      console.log(`Loaded plugin: ${manifest.name} v${manifest.version}`);
      return true;
    } catch (err) {
      console.error(`Failed to load plugin "${name}":`, err);
      this.plugins.set(name, {
        manifest: { name },
        module: null,
        active: false,
        enabled: false,
        error: err.message,
      });
      return false;
    }
  }

  async _activatePlugin(name) {
    const plugin = this.plugins.get(name);
    if (!plugin || !plugin.module) {
      throw new Error(`Plugin "${name}" not loaded`);
    }
    if (plugin.active) return true;

    try {
      await plugin.module.activate(this._appAPI);
      plugin.active = true;
      plugin.error = null;
      this.emit('plugin:activated', name, plugin.manifest);
      console.log(`Activated plugin: ${name}`);
      return true;
    } catch (err) {
      plugin.active = false;
      plugin.error = err.message;
      this.emit('plugin:error', name, err);
      throw err;
    }
  }

  async deactivatePlugin(name) {
    const plugin = this.plugins.get(name);
    if (!plugin || !plugin.active) return false;

    if (typeof plugin.module.deactivate === 'function') {
      try {
        await plugin.module.deactivate(this._appAPI);
      } catch (err) {
        console.warn(`Plugin "${name}" deactivate error:`, err);
      }
    }

    // Remove plugin's markdown transforms
    this.markdownTransforms = this.markdownTransforms.filter(t => t.plugin !== name);
    
    // Remove plugin's stylesheets
    this.stylesheets = this.stylesheets.filter(s => s.plugin !== name);
    
    // Remove plugin's commands (by convention, plugin commands are prefixed with plugin name)
    this._removePluginCommands(name);

    plugin.active = false;
    this.emit('plugin:deactivated', name, plugin.manifest);
    await this._savePluginsConfig();
    return true;
  }

  _removePluginCommands(prefix) {
    const allCommands = CommandRegistry.getAllCommands();
    for (const cmd of allCommands) {
      if (cmd.id.startsWith(`${prefix}:`) || cmd.id === prefix) {
        CommandRegistry.unregisterCommand(cmd.id);
      }
    }
  }

  async enablePlugin(name) {
    const plugin = this.plugins.get(name);
    if (!plugin) return false;
    plugin.enabled = true;
    await this._savePluginsConfig();
    if (!plugin.active) {
      await this._activatePlugin(name);
    }
    return true;
  }

  async disablePlugin(name) {
    const plugin = this.plugins.get(name);
    if (!plugin) return false;
    plugin.enabled = false;
    if (plugin.active) {
      await this.deactivatePlugin(name);
    }
    await this._savePluginsConfig();
    return true;
  }

  async _savePluginsConfig() {
    try {
      const enabled = [];
      for (const [name, plugin] of this.plugins) {
        if (plugin.enabled !== false) {
          enabled.push(name);
        }
      }
      const data = {
        enabled,
        settings: Object.fromEntries(this.settings._settings),
        defaults: Object.fromEntries(this.settings._defaults),
        metadata: Object.fromEntries(this.settings._metadata),
      };
      fs.writeFileSync(PLUGINS_CONFIG, JSON.stringify(data, null, 2), 'utf8');
    } catch (err) {
      console.error('Failed to save plugins config:', err);
    }
  }

  /**
   * Install a plugin from a directory or zip file.
   * @param {string} sourcePath - Path to plugin directory or zip
   * @returns {Promise<boolean>}
   */
  async installPlugin(sourcePath) {
    const stats = fs.statSync(sourcePath);
    let pluginName;

    if (stats.isDirectory()) {
      // Read package.json or index.js to get name
      const pkgPath = path.join(sourcePath, 'package.json');
      if (fs.existsSync(pkgPath)) {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
        pluginName = pkg.name;
      } else {
        // Try to load to get name
        const idxPath = path.join(sourcePath, 'index.js');
        if (fs.existsSync(idxPath)) {
          delete require.cache[require.resolve(idxPath)];
          const mod = require(idxPath);
          pluginName = mod.name;
        }
      }
      if (!pluginName) throw new Error('Could not determine plugin name');

      const destPath = path.join(PLUGINS_DIR, pluginName);
      if (fs.existsSync(destPath)) {
        throw new Error(`Plugin "${pluginName}" already installed`);
      }

      // Copy directory
      this._copyDir(sourcePath, destPath);
    } else {
      throw new Error('Only directory installation supported currently');
    }

    // Load and activate
    await this._loadPlugin(pluginName);
    await this.enablePlugin(pluginName);
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
   * Uninstall a plugin.
   */
  async uninstallPlugin(name) {
    await this.disablePlugin(name);
    const pluginPath = path.join(PLUGINS_DIR, name);
    if (fs.existsSync(pluginPath)) {
      fs.rmSync(pluginPath, { recursive: true, force: true });
    }
    this.plugins.delete(name);
    await this._savePluginsConfig();
  }

  /**
   * Get all plugins with their status.
   */
  getPlugins() {
    const result = [];
    for (const [name, plugin] of this.plugins) {
      result.push({
        name: plugin.manifest.name,
        version: plugin.manifest.version,
        description: plugin.manifest.description,
        author: plugin.manifest.author,
        active: plugin.active,
        enabled: plugin.enabled,
        error: plugin.error,
      });
    }
    return result;
  }

  /**
   * Register a markdown transform function.
   * Transform receives (markdown, context) and returns transformed markdown.
   */
  registerMarkdownTransform(fn, pluginName = 'unknown') {
    this.markdownTransforms.push({ fn, plugin: pluginName });
  }

  /**
   * Apply all registered markdown transforms.
   */
  applyMarkdownTransforms(markdown, context = {}) {
    let result = markdown;
    for (const { fn } of this.markdownTransforms) {
      try {
        result = fn(result, context);
      } catch (err) {
        console.error('Markdown transform error:', err);
      }
    }
    return result;
  }

  /**
   * Register a stylesheet (CSS text) to be injected.
   */
  registerStylesheet(cssText, pluginName = 'unknown') {
    this.stylesheets.push({ css: cssText, plugin: pluginName });
  }

  /**
   * Get all registered stylesheets as a single CSS string.
   */
  getStylesheets() {
    return this.stylesheets.map(s => s.css).join('\n');
  }

  /**
   * Build the app API object passed to plugin activate().
   */
  _buildAppAPI() {
    this._appAPI = {
      // Command registry
      registerCommand: (id, def) => CommandRegistry.registerCommand(id, def),
      unregisterCommand: (id) => CommandRegistry.unregisterCommand(id),
      getCommand: (id) => CommandRegistry.getCommand(id),
      getAllCommands: () => CommandRegistry.getAllCommands(),
      executeCommand: (id, view, state) => CommandRegistry.execute(id, view, state),
      hasCommand: (id) => CommandRegistry.hasCommand(id),

      // Markdown transforms
      registerMarkdownTransform: (fn) => this.registerMarkdownTransform(fn, this._currentPlugin || 'unknown'),

      // Stylesheets
      registerStylesheet: (css) => this.registerStylesheet(css, this._currentPlugin || 'unknown'),

      // Settings
      registerSetting: (key, defaultValue, metadata) => this.settings.register(key, defaultValue, metadata),
      getSetting: (key) => this.settings.get(key),
      setSetting: (key, value) => this.settings.set(key, value),
      getAllSettings: () => this.settings.getAll(),
      getSettingMetadata: (key) => this.settings.getMetadata(key),

      // Events
      on: (event, handler) => this.on(event, handler),
      off: (event, handler) => this.off(event, handler),
      emit: (event, ...args) => this.emit(event, ...args),

      // Plugin lifecycle
      getPlugins: () => this.getPlugins(),

      // Utilities
      getPath: () => PLUGINS_DIR,
    };
  }

  set currentPlugin(name) {
    this._currentPlugin = name;
  }
}

export const pluginManager = new PluginManager();
export default pluginManager;
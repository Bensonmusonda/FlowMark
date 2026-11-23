const fs = require('fs');

const FORMAT_KEY = '__flowmarkPluginSettingsFormat';

class PluginSettingsStore {
  constructor(settingsPath) {
    this.settingsPath = settingsPath;
    this.settings = new Map();
    this.metadata = new Map();
    this.legacySettings = new Map();
    this._load();
  }

  _load() {
    try {
      if (!fs.existsSync(this.settingsPath)) return;
      const data = JSON.parse(fs.readFileSync(this.settingsPath, 'utf8'));

      if (data[FORMAT_KEY] === 1 && data.plugins && typeof data.plugins === 'object') {
        for (const [pluginId, values] of Object.entries(data.plugins)) {
          if (!values || typeof values !== 'object' || Array.isArray(values)) continue;
          this.settings.set(pluginId, new Map(Object.entries(values)));
        }
        if (data.metadata && typeof data.metadata === 'object' && !Array.isArray(data.metadata)) {
          for (const [pluginId, meta] of Object.entries(data.metadata)) {
            if (!meta || typeof meta !== 'object' || Array.isArray(meta)) continue;
            this.metadata.set(pluginId, new Map(Object.entries(meta)));
          }
        }
        if (data.legacy && typeof data.legacy === 'object' && !Array.isArray(data.legacy)) {
          this.legacySettings = new Map(Object.entries(data.legacy));
        }
        return;
      }

      // Older versions stored settings in one flat object; migrate prefixed keys.
      for (const [key, value] of Object.entries(data)) {
        const separator = key.indexOf('.');
        if (separator <= 0) {
          this.legacySettings.set(key, value);
          continue;
        }
        const pluginId = key.slice(0, separator);
        if (!/^[a-z0-9-]+$/.test(pluginId)) {
          this.legacySettings.set(key, value);
          continue;
        }
        this._pluginSettings(pluginId).set(key, value);
      }
    } catch (err) {
      console.warn('Failed to load plugin settings:', err);
    }
  }

  _save() {
    try {
      const plugins = Object.fromEntries(
        [...this.settings].map(([pluginId, values]) => [pluginId, Object.fromEntries(values)])
      );
      const metadata = Object.fromEntries(
        [...this.metadata].map(([pluginId, meta]) => [pluginId, Object.fromEntries(meta)])
      );
      fs.writeFileSync(
        this.settingsPath,
        JSON.stringify({
          [FORMAT_KEY]: 1,
          plugins,
          metadata,
          legacy: Object.fromEntries(this.legacySettings),
        }, null, 2),
        'utf8'
      );
    } catch (err) {
      console.error('Failed to save plugin settings:', err);
    }
  }

  _pluginSettings(pluginId) {
    if (typeof pluginId !== 'string' || !/^[a-z0-9-]+$/.test(pluginId)) {
      throw new TypeError('Invalid plugin identity for settings');
    }
    let values = this.settings.get(pluginId);
    if (!values) {
      values = new Map();
      this.settings.set(pluginId, values);
    }
    return values;
  }

  _pluginMetadata(pluginId) {
    if (typeof pluginId !== 'string' || !/^[a-z0-9-]+$/.test(pluginId)) {
      throw new TypeError('Invalid plugin identity for settings');
    }
    let meta = this.metadata.get(pluginId);
    if (!meta) {
      meta = new Map();
      this.metadata.set(pluginId, meta);
    }
    return meta;
  }

  _validateKey(key) {
    if (typeof key !== 'string' || key.length === 0 || key.length > 256) {
      throw new TypeError('Setting keys must be non-empty strings of at most 256 characters');
    }
  }

  get(pluginId, key) {
    this._validateKey(key);
    return this._pluginSettings(pluginId).get(key);
  }

  register(pluginId, key, defaultValue, metadata = {}) {
    this._validateKey(key);
    const values = this._pluginSettings(pluginId);
    const isNew = !values.has(key);
    if (isNew) {
      values.set(key, defaultValue);
    }

    const pluginMeta = this._pluginMetadata(pluginId);
    const metaType = metadata.type || (typeof defaultValue === 'boolean' ? 'boolean' : typeof defaultValue === 'number' ? 'number' : 'string');
    pluginMeta.set(key, {
      key,
      defaultValue,
      type: metaType,
      label: metadata.label || key,
      description: metadata.description || '',
      options: Array.isArray(metadata.options) ? metadata.options : null,
      ...metadata,
    });

    this._save();
  }

  set(pluginId, key, value) {
    this._validateKey(key);
    this._pluginSettings(pluginId).set(key, value);
    this._save();
  }

  getAll(pluginId) {
    return Object.fromEntries(this._pluginSettings(pluginId));
  }

  getMetadata(pluginId, key) {
    this._validateKey(key);
    return this._pluginMetadata(pluginId).get(key) || null;
  }

  getAllMetadata(pluginId) {
    const meta = this.metadata.get(pluginId);
    return meta ? Object.fromEntries(meta) : {};
  }
}

module.exports = { PluginSettingsStore };

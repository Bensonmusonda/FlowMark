const fs = require('fs');

const FORMAT_KEY = '__flowmarkPluginSettingsFormat';

class PluginSettingsStore {
  constructor(settingsPath) {
    this.settingsPath = settingsPath;
    this.settings = new Map();
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
      fs.writeFileSync(
        this.settingsPath,
        JSON.stringify({
          [FORMAT_KEY]: 1,
          plugins,
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

  _validateKey(key) {
    if (typeof key !== 'string' || key.length === 0 || key.length > 256) {
      throw new TypeError('Setting keys must be non-empty strings of at most 256 characters');
    }
  }

  get(pluginId, key) {
    this._validateKey(key);
    return this._pluginSettings(pluginId).get(key);
  }

  register(pluginId, key, defaultValue) {
    this._validateKey(key);
    const values = this._pluginSettings(pluginId);
    if (!values.has(key)) {
      values.set(key, defaultValue);
      this._save();
    }
  }

  set(pluginId, key, value) {
    this._validateKey(key);
    this._pluginSettings(pluginId).set(key, value);
    this._save();
  }

  getAll(pluginId) {
    return Object.fromEntries(this._pluginSettings(pluginId));
  }
}

module.exports = { PluginSettingsStore };

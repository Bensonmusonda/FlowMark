/**
 * Manifest Schema Validation (plain JavaScript, no external dependencies)
 * Replaces Zod-based validation to avoid npm install issues.
 */

const PERMISSIONS_ENUM = [
  'editor.read', 'editor.write', 'editor.selection', 'editor.commands',
  'file.read', 'file.write', 'file.save', 'file.export',
  'settings.read', 'settings.write',
  'ui.menus', 'ui.statusbar', 'ui.notifications',
  'clipboard.read', 'clipboard.write',
  'ui.panels', 'ui.customViews',
  'editor.slashCommands',
  'clipboard.smartPaste',
  'network.request', 'network.request:write'
];

const MENU_SECTIONS = ['file', 'edit', 'insert', 'view', 'plugins'];
const SETTING_TYPES = ['string', 'number', 'boolean', 'select', 'color', 'path'];

function validateString(value, { minLength = 0, maxLength = Infinity, pattern } = {}) {
  if (typeof value !== 'string') return 'must be a string';
  if (value.length < minLength) return `must be at least ${minLength} characters`;
  if (value.length > maxLength) return `must be at most ${maxLength} characters`;
  if (pattern && !pattern.test(value)) return 'invalid format';
  return null;
}

function validateArray(value, itemValidator) {
  if (!Array.isArray(value)) return 'must be an array';
  for (let i = 0; i < value.length; i++) {
    const err = itemValidator(value[i], i);
    if (err) return `[${i}] ${err}`;
  }
  return null;
}

function validateObject(value, schema) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 'must be an object';
  for (const [key, validator] of Object.entries(schema)) {
    if (validator.required && !(key in value)) return `${key} is required`;
    if (key in value) {
      const err = validator.fn(value[key]);
      if (err) return `${key}: ${err}`;
    }
  }
  return null;
}

function validateEnum(value, allowed) {
  if (!allowed.includes(value)) return `must be one of: ${allowed.join(', ')}`;
  return null;
}

function validateRecord(value, itemValidator) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 'must be an object';
  for (const [key, val] of Object.entries(value)) {
    const err = itemValidator(val);
    if (err) return `${key}: ${err}`;
  }
  return null;
}

function validateManifest(obj) {
  const errors = [];

  if (!obj || typeof obj !== 'object') {
    return { ok: false, errors: ['Manifest must be an object'] };
  }

  // name
  const nameErr = validateString(obj.name, { minLength: 1, pattern: /^[a-z0-9-]+$/ });
  if (nameErr) errors.push(`name: ${nameErr}`);

  // version
  const versionErr = validateString(obj.version, { pattern: /^\d+\.\d+\.\d+$/ });
  if (versionErr) errors.push(`version: ${versionErr}`);

  // manifest_version
  if (obj.manifest_version !== 1) errors.push('manifest_version: must be 1');

  // entry_point
  const entryErr = validateString(obj.entry_point, { minLength: 1 });
  if (entryErr) errors.push(`entry_point: ${entryErr}`);

  // description (optional)
  if (obj.description !== undefined) {
    const descErr = validateString(obj.description, { maxLength: 200 });
    if (descErr) errors.push(`description: ${descErr}`);
  }

  // author (optional)
  if (obj.author !== undefined) {
    const authorErr = validateString(obj.author);
    if (authorErr) errors.push(`author: ${authorErr}`);
  }

  // permissions
  if (obj.permissions !== undefined) {
    const permErr = validateArray(obj.permissions, (v) => validateString(v) || validateEnum(v, PERMISSIONS_ENUM));
    if (permErr) errors.push(`permissions: ${permErr}`);
  }

  // commands
  if (obj.commands !== undefined) {
    const cmdErr = validateArray(obj.commands, (cmd, i) => {
      const cmdErrors = [];
      if (typeof cmd !== 'object' || cmd === null) return 'must be an object';
      const idErr = validateString(cmd.id, { pattern: /^[a-z0-9-:]+$/ });
      if (idErr) cmdErrors.push(`id: ${idErr}`);
      const labelErr = validateString(cmd.label, { minLength: 1, maxLength: 200 });
      if (labelErr) cmdErrors.push(`label: ${labelErr}`);
      if (cmd.shortcut !== undefined) {
        const scErr = validateString(cmd.shortcut);
        if (scErr) cmdErrors.push(`shortcut: ${scErr}`);
      }
      if (cmd.icon !== undefined) {
        const iconErr = validateString(cmd.icon);
        if (iconErr) cmdErrors.push(`icon: ${iconErr}`);
      }
      if (cmd.section !== undefined) {
        const secErr = validateEnum(cmd.section, MENU_SECTIONS);
        if (secErr) cmdErrors.push(`section: ${secErr}`);
      }
      return cmdErrors.length > 0 ? cmdErrors.join('; ') : null;
    });
    if (cmdErr) errors.push(`commands: ${cmdErr}`);
  }

  // menu_items
  if (obj.menu_items !== undefined) {
    const menuErr = validateArray(obj.menu_items, (item, i) => {
      const itemErrors = [];
      if (typeof item !== 'object' || item === null) return 'must be an object';
      const idErr = validateString(item.id, { pattern: /^[a-z0-9-:]+$/ });
      if (idErr) itemErrors.push(`id: ${idErr}`);
      const labelErr = validateString(item.label, { minLength: 1, maxLength: 200 });
      if (labelErr) itemErrors.push(`label: ${labelErr}`);
      const secErr = validateEnum(item.section, MENU_SECTIONS);
      if (secErr) itemErrors.push(`section: ${secErr}`);
      if (item.shortcut !== undefined) {
        const scErr = validateString(item.shortcut);
        if (scErr) itemErrors.push(`shortcut: ${scErr}`);
      }
      if (item.icon !== undefined) {
        const iconErr = validateString(item.icon);
        if (iconErr) itemErrors.push(`icon: ${iconErr}`);
      }
      if (item.order !== undefined && (!Number.isInteger(item.order) || item.order < 0)) {
        itemErrors.push('order: must be a non-negative integer');
      }
      return itemErrors.length > 0 ? itemErrors.join('; ') : null;
    });
    if (menuErr) errors.push(`menu_items: ${menuErr}`);
  }

  // stylesheet (optional)
  if (obj.stylesheet !== undefined) {
    const styleErr = validateString(obj.stylesheet);
    if (styleErr) errors.push(`stylesheet: ${styleErr}`);
  }

  // settings
  if (obj.settings !== undefined) {
    const settingsErr = validateRecord(obj.settings, (setting) => {
      if (typeof setting !== 'object' || setting === null) return 'must be an object';
      const settingErrors = [];
      if (setting.type !== undefined) {
        const typeErr = validateEnum(setting.type, SETTING_TYPES);
        if (typeErr) settingErrors.push(`type: ${typeErr}`);
      }
      if (setting.label !== undefined) {
        const labelErr = validateString(setting.label);
        if (labelErr) settingErrors.push(`label: ${labelErr}`);
      }
      if (setting.description !== undefined) {
        const descErr = validateString(setting.description);
        if (descErr) settingErrors.push(`description: ${descErr}`);
      }
      if (setting.options !== undefined) {
        const optErr = validateArray(setting.options, (v) => validateString(v));
        if (optErr) settingErrors.push(`options: ${optErr}`);
      }
      return settingErrors.length > 0 ? settingErrors.join('; ') : null;
    });
    if (settingsErr) errors.push(`settings: ${settingsErr}`);
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  // Return validated manifest with defaults
  return {
    ok: true,
    data: {
      name: obj.name,
      version: obj.version,
      manifest_version: 1,
      description: obj.description,
      author: obj.author,
      entry_point: obj.entry_point,
      permissions: obj.permissions || [],
      commands: obj.commands || [],
      menu_items: obj.menu_items || [],
      stylesheet: obj.stylesheet,
      settings: obj.settings || {},
    }
  };
}

module.exports = { validateManifest };
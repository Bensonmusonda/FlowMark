/**
 * CommandRegistry — a lightweight, side-effect-free command registry.
 * No editor coupling; pure functions + a Map internally.
 */

const commands = new Map();

/**
 * Normalize a keyboard shortcut to be platform-aware.
 * On macOS, `Ctrl` becomes `Cmd`; on Windows/Linux, `Ctrl` stays `Ctrl`.
 * @param {string} shortcut - e.g. 'Ctrl+Shift+P' or 'Cmd+Shift+P'
 * @returns {string} normalized shortcut
 */
export function normalizeShortcut(shortcut) {
  if (!shortcut) return shortcut;
  const isMac = navigator.platform.startsWith('Mac');
  if (isMac) {
    return shortcut.replace(/^Ctrl\+/, 'Cmd+').replace(/\+Ctrl\+/, '+Cmd+');
  }
  return shortcut.replace(/^Cmd\+/, 'Ctrl+').replace(/\+Cmd\+/, '+Ctrl+');
}

/**
 * Register a command.
 * @param {string} id - unique command identifier (e.g. 'file:save')
 * @param {Object} def - command definition
 * @param {string} def.label - human-readable label
 * @param {string} [def.shortcut] - keyboard shortcut (e.g. 'Ctrl+S')
 * @param {Function} def.run - (view, state) => void
 * @param {Function} def.enabled - (view, state) => boolean
 * @param {string} [def.icon] - optional icon identifier (e.g. 'save', 'bold')
 * @param {string} [def.section] - optional menu section for grouping
 */
export function registerCommand(id, def) {
  if (!id || typeof id !== 'string') {
    throw new Error('Command id must be a non-empty string');
  }
  if (!def || typeof def !== 'object') {
    throw new Error('Command definition must be an object');
  }
  if (typeof def.run !== 'function') {
    throw new Error('Command must have a run function');
  }
  if (typeof def.enabled !== 'function') {
    throw new Error('Command must have an enabled function');
  }
  if (typeof def.label !== 'string' || !def.label.trim()) {
    throw new Error('Command must have a non-empty label');
  }

  const normalizedShortcut = def.shortcut ? normalizeShortcut(def.shortcut) : undefined;

  const command = {
    id,
    label: def.label.trim(),
    shortcut: normalizedShortcut,
    run: def.run,
    enabled: def.enabled,
    icon: def.icon,
    section: def.section,
  };

  commands.set(id, command);
}

/**
 * Get a command by id.
 * @param {string} id
 * @returns {Object|undefined}
 */
export function getCommand(id) {
  return commands.get(id);
}

/**
 * Get all registered commands as an array.
 * @returns {Object[]}
 */
export function getAllCommands() {
  return Array.from(commands.values());
}

/**
 * Execute a command if it exists and is enabled.
 * @param {string} id
 * @param {EditorView} view - CodeMirror EditorView
 * @param {EditorState} state - CodeMirror EditorState
 * @returns {boolean} true if executed, false otherwise
 */
export function execute(id, view, state) {
  const cmd = commands.get(id);
  if (!cmd) return false;
  if (!cmd.enabled(view, state)) return false;
  try {
    cmd.run(view, state);
    return true;
  } catch (err) {
    console.error(`Command "${id}" failed:`, err);
    return false;
  }
}

/**
 * Check if a command is registered.
 * @param {string} id
 * @returns {boolean}
 */
export function hasCommand(id) {
  return commands.has(id);
}

/**
 * Unregister a command (mainly for testing).
 * @param {string} id
 * @returns {boolean} true if removed
 */
export function unregisterCommand(id) {
  return commands.delete(id);
}

/**
 * Clear all commands (mainly for testing).
 */
export function clearCommands() {
  commands.clear();
}

/**
 * Get commands filtered by section.
 * @param {string} section
 * @returns {Object[]}
 */
export function getCommandsBySection(section) {
  return getAllCommands().filter(cmd => cmd.section === section);
}

/**
 * Resolve a shortcut string to its constituent parts.
 * @param {string} shortcut - e.g. 'Ctrl+Shift+P'
 * @returns {{modifiers: string[], key: string}}
 */
export function parseShortcut(shortcut) {
  if (!shortcut) return { modifiers: [], key: '' };
  const parts = shortcut.split('+').map(s => s.trim());
  const key = parts.pop() || '';
  return { modifiers: parts, key: key.toLowerCase() };
}

/**
 * Check if a keyboard event matches a registered shortcut.
 * @param {KeyboardEvent} event
 * @param {string} shortcut - registered shortcut (already normalized)
 * @returns {boolean}
 */
export function matchesShortcut(event, shortcut) {
  const { modifiers, key } = parseShortcut(shortcut);
  const eventKey = event.key.toLowerCase();

  // Normalize common key names
  const keyMap = {
    ' ': 'space',
    escape: 'esc',
    arrowup: 'up',
    arrowdown: 'down',
    arrowleft: 'left',
    arrowright: 'right',
  };
  const normalizedEventKey = keyMap[eventKey] || eventKey;
  const normalizedShortcutKey = keyMap[key] || key;

  if (normalizedEventKey !== normalizedShortcutKey) return false;

  const requiredModifiers = new Set(modifiers.map(m => m.toLowerCase()));
  const hasModifiers = {
    ctrl: event.ctrlKey || event.metaKey, // treat Cmd as Ctrl for matching
    shift: event.shiftKey,
    alt: event.altKey,
    meta: event.metaKey,
  };

  for (const mod of requiredModifiers) {
    if (!hasModifiers[mod]) return false;
  }

  // Ensure no extra modifiers are pressed (strict matching)
  for (const [mod, pressed] of Object.entries(hasModifiers)) {
    if (pressed && !requiredModifiers.has(mod)) return false;
  }

  return true;
}

export default {
  registerCommand,
  getCommand,
  getAllCommands,
  execute,
  hasCommand,
  unregisterCommand,
  clearCommands,
  getCommandsBySection,
  normalizeShortcut,
  parseShortcut,
  matchesShortcut,
};
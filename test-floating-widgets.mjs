/**
 * Automated tests for Floating Widget and Toolbar Platform System
 */

import assert from 'assert';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { validatePluginManifest } = require('./src/plugins/sandbox/manifest-validator.js');
const { authorizePluginRequest } = require('./src/plugins/sandbox/request-authorizer.js');
import { FloatingWidgetManager } from './src/ui/floatingWidgets.js';

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✅ ${name}`);
  } catch (err) {
    failed++;
    console.error(`  ❌ ${name}: ${err.message}`);
  }
}

// ── Lightweight Mock DOM for headless testing ─────────────────────────────
class MockClassList {
  constructor() {
    this.classes = new Set();
  }
  add(...names) { names.forEach(n => this.classes.add(n)); }
  remove(...names) { names.forEach(n => this.classes.delete(n)); }
  toggle(name, force) {
    if (typeof force === 'boolean') {
      if (force) this.classes.add(name);
      else this.classes.delete(name);
      return force;
    }
    if (this.classes.has(name)) {
      this.classes.delete(name);
      return false;
    }
    this.classes.add(name);
    return true;
  }
  contains(name) { return this.classes.has(name); }
}

class MockElement {
  constructor(tagName) {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.classList = new MockClassList();
    this.dataset = {};
    this.style = {};
    this.listeners = new Map();
    this._className = '';
  }

  get className() {
    return Array.from(this.classList.classes).join(' ');
  }

  set className(val) {
    this._className = val || '';
    this.classList.classes = new Set(this._className.split(/\s+/).filter(Boolean));
  }

  appendChild(child) {
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  remove() {
    if (this.parentElement) {
      const idx = this.parentElement.children.indexOf(this);
      if (idx !== -1) this.parentElement.children.splice(idx, 1);
      this.parentElement = null;
    }
  }

  addEventListener(type, handler) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(handler);
  }

  dispatchEvent(event) {
    const handlers = this.listeners.get(event.type) || [];
    for (const h of handlers) h(event);
  }

  setAttribute(name, val) {
    this[name] = val;
  }

  querySelector(selector) {
    // Basic selector matching for mock elements
    if (selector.startsWith('.')) {
      const cls = selector.slice(1);
      const find = (el) => {
        if (el.classList.contains(cls)) return el;
        for (const child of el.children) {
          const res = find(child);
          if (res) return res;
        }
        return null;
      };
      return find(this);
    }
    return null;
  }

  querySelectorAll(selector) {
    const results = [];
    if (selector.startsWith('.')) {
      const cls = selector.slice(1);
      const walk = (el) => {
        if (el !== this && el.classList.contains(cls)) results.push(el);
        for (const child of el.children) walk(child);
      };
      walk(this);
    }
    return results;
  }
}

globalThis.document = {
  createElement: (tag) => new MockElement(tag),
  createElementNS: (_ns, tag) => new MockElement(tag),
};

console.log('\n📦 Floating Widget Manifest & Security Authorization:');

test('Validates manifest containing ui.floatingWidgets permission', () => {
  const manifest = {
    name: 'symbol-palette',
    version: '1.0.0',
    manifest_version: 1,
    entry_point: 'index.js',
    permissions: ['ui.floatingWidgets'],
  };
  const validated = validatePluginManifest(manifest);
  assert.strictEqual(validated.name, 'symbol-palette');
  assert.ok(validated.permissions.includes('ui.floatingWidgets'));
});

test('Rejects unauthorized ui:registerFloatingWidget when permission is missing', () => {
  const pluginMap = new Map();
  const sender = { id: 101 };
  pluginMap.set('test-plugin', {
    manifest: { name: 'test-plugin' },
    window: { webContents: sender },
    permissions: new Set(['editor.read']),
    state: 'ready',
  });

  const res = authorizePluginRequest(pluginMap, sender, 'ui:registerFloatingWidget');
  assert.strictEqual(res.allowed, false);
  assert.match(res.error, /ui\.floatingWidgets/);
});

test('Authorizes ui:registerFloatingWidget and ui:registerFloatingToolbar with permission', () => {
  const pluginMap = new Map();
  const sender = { id: 102 };
  const plugin = {
    manifest: { name: 'symbol-palette' },
    window: { webContents: sender },
    permissions: new Set(['ui.floatingWidgets']),
    state: 'ready',
  };
  pluginMap.set('symbol-palette', plugin);

  const authWidget = authorizePluginRequest(pluginMap, sender, 'ui:registerFloatingWidget');
  assert.strictEqual(authWidget.allowed, true);

  const authToolbar = authorizePluginRequest(pluginMap, sender, 'ui:registerFloatingToolbar');
  assert.strictEqual(authToolbar.allowed, true);

  const authRemove = authorizePluginRequest(pluginMap, sender, 'ui:removeFloatingWidget');
  assert.strictEqual(authRemove.allowed, true);

  const authToggle = authorizePluginRequest(pluginMap, sender, 'ui:toggleFloatingWidget');
  assert.strictEqual(authToggle.allowed, true);
});

console.log('\n🧩 FloatingWidgetManager Component Registration & Lifecycle:');

test('Registers a vertical symbol toolbar with command actions', () => {
  const container = new MockElement('div');
  const commands = new Map();
  let executedCommand = null;

  const mockRegistry = {
    registerCommand: (id, def) => { commands.set(id, def); },
    unregisterCommand: (id) => { commands.delete(id); },
    execute: (id) => { executedCommand = id; },
  };

  const manager = new FloatingWidgetManager({
    container,
    commandRegistry: mockRegistry,
  });

  const registered = manager.registerToolbar({
    id: 'quick-symbols',
    title: 'Quick Symbols',
    position: 'right',
    collapsible: true,
    pluginId: 'symbol-palette',
    items: [
      { id: 'math-sigma', icon: 'sigma', tooltip: 'Insert Sigma (Σ)', command: 'insert:math' },
      { id: 'code-snippet', icon: 'code', tooltip: 'Insert Code Block', command: 'insert:code' },
    ],
  });

  assert.strictEqual(registered, true, 'Toolbar registered successfully');
  assert.strictEqual(container.children.length, 1, 'Toolbar appended to layer');

  const widgetEl = container.children[0];
  assert.ok(widgetEl.classList.contains('dock-right'), 'Has dock-right class');
  assert.ok(widgetEl.classList.contains('fm-floating-toolbar'), 'Has toolbar class');
  assert.strictEqual(widgetEl.dataset.widgetId, 'quick-symbols');
  assert.strictEqual(widgetEl.dataset.pluginId, 'symbol-palette');

  // Verify command registration
  assert.ok(commands.has('view:toggleWidget:quick-symbols'), 'Toggle command registered');

  // Verify item execution
  const toolBtns = widgetEl.querySelectorAll('.fm-floating-tool-btn');
  assert.strictEqual(toolBtns.length, 2, '2 tool buttons rendered');
  assert.strictEqual(toolBtns[0].dataset.tooltip, 'Insert Sigma (Σ)');

  // Trigger click on first tool button
  toolBtns[0].dispatchEvent({ type: 'click', stopPropagation: () => {} });
  assert.strictEqual(executedCommand, 'insert:math', 'Executed insert:math on button click');
});

test('Collapses and expands floating toolbar', () => {
  const container = new MockElement('div');
  const manager = new FloatingWidgetManager({ container });

  manager.registerToolbar({
    id: 'test-collapse',
    position: 'right',
    collapsible: true,
    items: [{ id: 'item1', icon: 'code' }],
  });

  const widgetEl = container.children[0];
  assert.strictEqual(widgetEl.classList.contains('collapsed'), false, 'Initially expanded');

  manager.toggleCollapse('test-collapse');
  assert.strictEqual(widgetEl.classList.contains('collapsed'), true, 'Collapsed after toggle');

  manager.toggleCollapse('test-collapse');
  assert.strictEqual(widgetEl.classList.contains('collapsed'), false, 'Expanded after second toggle');
});

test('Hides and shows floating toolbar via toggleWidget', () => {
  const container = new MockElement('div');
  const manager = new FloatingWidgetManager({ container });

  manager.registerToolbar({
    id: 'test-visibility',
    position: 'left',
    items: [],
  });

  const widgetEl = container.children[0];
  assert.strictEqual(widgetEl.classList.contains('hidden'), false, 'Initially visible');

  manager.toggleWidget('test-visibility', false);
  assert.strictEqual(widgetEl.classList.contains('hidden'), true, 'Hidden after force false');

  manager.toggleWidget('test-visibility', true);
  assert.strictEqual(widgetEl.classList.contains('hidden'), false, 'Visible after force true');
});

test('Registers custom sandboxed iframe widget', () => {
  const container = new MockElement('div');
  const manager = new FloatingWidgetManager({ container });

  const ok = manager.registerWidget({
    id: 'custom-pane',
    title: 'Custom Pane',
    position: 'left',
    width: 280,
    height: 400,
    entryUrl: 'file:///path/to/view.html',
    pluginId: 'custom-plugin',
  });

  assert.strictEqual(ok, true, 'Widget registered');
  const widgetEl = container.children[0];
  assert.ok(widgetEl.classList.contains('dock-left'));
  assert.ok(widgetEl.classList.contains('fm-floating-pane'));
  assert.strictEqual(widgetEl.style.width, '280px');
  assert.strictEqual(widgetEl.style.height, '400px');
});

test('Removes widget and cleans up CommandRegistry and DOM', () => {
  const container = new MockElement('div');
  const commands = new Map();
  const mockRegistry = {
    registerCommand: (id, def) => { commands.set(id, def); },
    unregisterCommand: (id) => { commands.delete(id); },
  };

  const manager = new FloatingWidgetManager({
    container,
    commandRegistry: mockRegistry,
  });

  manager.registerToolbar({
    id: 'remove-me',
    position: 'right',
    items: [],
  });

  assert.strictEqual(container.children.length, 1);
  assert.ok(commands.has('view:toggleWidget:remove-me'));

  manager.removeWidget('remove-me');
  assert.strictEqual(container.children.length, 0, 'DOM element removed');
  assert.strictEqual(commands.has('view:toggleWidget:remove-me'), false, 'Command unregistered');
  assert.strictEqual(manager.getWidget('remove-me'), null, 'Widget removed from manager map');
});

console.log(`\n${passed + failed} tests, ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);

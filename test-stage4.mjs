import assert from 'assert';
import fs from 'fs';
import { createRequire } from 'module';
import { Document, TabManager } from './src/model/document.js';

const require = createRequire(import.meta.url);
const { PluginSandboxHost } = require('./src/plugins/sandbox/plugin-host.js');
const { validatePluginManifest } = require('./src/plugins/sandbox/manifest-validator.js');
const { authorizePluginRequest } = require('./src/plugins/sandbox/request-authorizer.js');

let passed = 0;
let failed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✅ ${name}`);
  } catch (error) {
    failed++;
    console.error(`  ❌ ${name}: ${error.message}`);
  }
}

async function testAsync(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ✅ ${name}`);
  } catch (error) {
    failed++;
    console.error(`  ❌ ${name}: ${error.message}`);
  }
}

console.log('🧩 Stage 4: Right Pane & Extension APIs');

test('Document defaults to markdown viewType', () => {
  const doc = new Document({ name: 'Note.md' });
  assert.strictEqual(doc.viewType, 'markdown');
});

test('Custom view documents preserve markdown tab state separately', () => {
  const doc = new Document({
    id: 'custom-1',
    name: 'Board.kanban.md',
    viewType: 'plugin:kanban',
    viewData: { entry: 'board.html' },
  });
  const tabs = new TabManager();
  tabs.add(doc, true);
  assert.strictEqual(tabs.activeDocument.viewType, 'plugin:kanban');
  assert.deepStrictEqual(tabs.activeDocument.viewData, { entry: 'board.html' });
});

test('Plugins can open only their registered custom views', () => {
  const preload = fs.readFileSync(new URL('./src/plugins/sandbox/plugin-preload.js', import.meta.url), 'utf8');
  const host = fs.readFileSync(new URL('./src/plugins/sandbox/plugin-host.js', import.meta.url), 'utf8');
  const editor = fs.readFileSync(new URL('./src/editor.js', import.meta.url), 'utf8');
  assert.match(preload, /open:\s*\(viewId,\s*options\s*=\s*\{\}\)/);
  assert.match(host, /registerHandler\('ui:openCustomView'/);
  assert.match(host, /plugin\.uiCustomViews\.has\(viewId\)/);
  assert.match(editor, /flowmark:custom-view:init/);
  assert.match(editor, /flowmark:custom-view:state/);
  assert.match(editor, /if \(!active \|\| active\.viewType === 'markdown'/);
});

await testAsync('Custom-view open requests validate ownership and bounded state', async () => {
  const sent = [];
  const host = Object.create(PluginSandboxHost.prototype);
  host.mainWindow = { webContents: { send: (channel, payload) => sent.push({ channel, payload }) } };
  host.requestHandlers = new Map();
  host._registerCoreHandlers();

  const plugin = {
    manifest: { name: 'stage4-plugin' },
    uiCustomViews: new Set(['board']),
  };
  await host.requestHandlers.get('ui:openCustomView')(
    { viewId: 'board', name: 'Board', state: { cards: [{ id: 'one' }] } },
    null,
    plugin
  );
  assert.deepStrictEqual(sent.at(-1), {
    channel: 'ui:openCustomView',
    payload: {
      pluginId: 'stage4-plugin',
      viewId: 'board',
      name: 'Board',
      state: { cards: [{ id: 'one' }] },
    },
  });
  await assert.rejects(
    host.requestHandlers.get('ui:openCustomView')({ viewId: 'other' }, null, plugin),
    /does not own this custom view/
  );
  await assert.rejects(
    host.requestHandlers.get('ui:openCustomView')({ viewId: 'board', state: 'x'.repeat(262145) }, null, plugin),
    /at most 256 KB/
  );
});

test('Inactive custom-view layer does not cover the markdown editor', () => {
  const css = fs.readFileSync(new URL('./src/style.css', import.meta.url), 'utf8');
  assert.match(css, /#custom-view\.hidden\s*\{\s*display:\s*none;\s*\}/);
});

test('Utility pane matches the flush sidebar surface and active buttons stay unfilled', () => {
  const css = fs.readFileSync(new URL('./src/style.css', import.meta.url), 'utf8');
  const utilityPaneRule = css.match(/#utility-pane\s*\{([^}]*)\}/s)?.[1];
  assert.ok(utilityPaneRule);
  assert.doesNotMatch(utilityPaneRule, /\bpadding\s*:/);
  assert.match(css, /\.utility-activity-button\[aria-pressed="true"\]\s*\{[^}]*background:\s*transparent;/s);
});

test('Utility pane width clamps to 220-520px', async () => {
  const { clampUtilityPaneWidth } = await import('./src/ui/utilityPane.js');
  assert.strictEqual(clampUtilityPaneWidth(100), 220);
  assert.strictEqual(clampUtilityPaneWidth(340), 340);
  assert.strictEqual(clampUtilityPaneWidth(900), 520);
});

test('Utility activity bar is in the top bar before window controls', () => {
  const html = fs.readFileSync(new URL('./src/index.html', import.meta.url), 'utf8');
  const activityIndex = html.indexOf('id="utility-activity-bar"');
  const controlsIndex = html.indexOf('id="window-controls"');
  assert.ok(activityIndex > html.indexOf('id="tabbar"'));
  assert.ok(activityIndex < controlsIndex);
  assert.match(html, /<aside id="utility-pane"[^>]*hidden/);
});

test('Manifest accepts sandbox panel, custom-view, slash, and paste permissions', () => {
  const manifest = validatePluginManifest({
    name: 'stage4-plugin',
    version: '1.0.0',
    manifest_version: 1,
    entry_point: 'index.js',
    permissions: [
      'ui.panels',
      'ui.customViews',
      'editor.slashCommands',
      'clipboard.smartPaste',
    ],
  });
  assert.strictEqual(manifest.name, 'stage4-plugin');
});

test('Panel and custom-view requests require explicit permissions', () => {
  const sender = {};
  const plugin = {
    manifest: { name: 'stage4-plugin' },
    permissions: new Set(['editor.read']),
    state: 'ready',
    window: { webContents: sender, isDestroyed: () => false },
  };
  const plugins = new Map([['stage4-plugin', plugin]]);
  assert.strictEqual(authorizePluginRequest(plugins, sender, 'ui:registerSidebarPanel').allowed, false);
  assert.strictEqual(authorizePluginRequest(plugins, sender, 'ui:registerCustomView').allowed, false);
  assert.strictEqual(authorizePluginRequest(plugins, sender, 'ui:openCustomView').allowed, false);
  assert.strictEqual(authorizePluginRequest(plugins, sender, 'editor:registerSlashCommand').allowed, false);
  assert.strictEqual(authorizePluginRequest(plugins, sender, 'clipboard:registerSmartPaste').allowed, false);
});

test('Stage 4 extension requests authorize with matching permissions', () => {
  const sender = {};
  const plugin = {
    manifest: { name: 'stage4-plugin' },
    permissions: new Set([
      'ui.panels',
      'ui.customViews',
      'editor.slashCommands',
      'clipboard.smartPaste',
    ]),
    state: 'ready',
    window: { webContents: sender, isDestroyed: () => false },
  };
  const plugins = new Map([['stage4-plugin', plugin]]);
  assert.strictEqual(authorizePluginRequest(plugins, sender, 'ui:registerSidebarPanel').allowed, true);
  assert.strictEqual(authorizePluginRequest(plugins, sender, 'ui:registerCustomView').allowed, true);
  assert.strictEqual(authorizePluginRequest(plugins, sender, 'ui:openCustomView').allowed, true);
  assert.strictEqual(authorizePluginRequest(plugins, sender, 'editor:registerSlashCommand').allowed, true);
  assert.strictEqual(authorizePluginRequest(plugins, sender, 'clipboard:registerSmartPaste').allowed, true);
});

test('Document serialization includes custom view metadata', () => {
  const doc = new Document({
    id: 'board',
    name: 'Board.md',
    viewType: 'plugin:kanban',
    viewData: {
      pluginId: 'stage4-plugin',
      viewId: 'kanban',
      state: { cards: [{ id: 'task-1', title: 'Review' }] },
    },
  });
  const json = doc.toJSON();
  assert.strictEqual(json.viewType, 'plugin:kanban');
  assert.deepStrictEqual(json.viewData, {
    pluginId: 'stage4-plugin',
    viewId: 'kanban',
    state: { cards: [{ id: 'task-1', title: 'Review' }] },
  });
});

console.log(`\n${passed + failed} tests, ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);

import assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import vm from 'vm';

const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const { validatePluginManifest } = require('./src/plugins/sandbox/manifest-validator.js');
const {
  authorizePluginEvent,
  authorizePluginRequest,
} = require('./src/plugins/sandbox/request-authorizer.js');
const { PluginSettingsStore } = require('./src/plugins/sandbox/plugin-settings-store.js');

let pass = 0;
let fail = 0;

function test(name, fn) {
  try {
    fn();
    pass++;
    console.log(`  ✅ ${name}`);
  } catch (err) {
    fail++;
    console.error(`  ❌ ${name}: ${err.message}`);
  }
}

async function runTests() {
  console.log('\n📦 Plugin Manifest Validation:');
  const plugins = ['insert-date', 'word-count', 'custom-transform'];

  for (const name of plugins) {
    test(`Validates manifest for ${name}`, () => {
      const manifestPath = path.join(__dirname, 'src', 'plugins', name, 'plugin.json');
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      const validated = validatePluginManifest(manifest);
      assert.strictEqual(validated.name, name);
      assert.ok(Array.isArray(validated.permissions));
      assert.ok(validated.permissions.length > 0);
    });
  }

  test('Rejects manifest with invalid permission', () => {
    assert.throws(() => {
      validatePluginManifest({
        name: 'bad-plugin',
        version: '1.0.0',
        manifest_version: 1,
        entry_point: 'index.js',
        permissions: ['unauthorized.root.access'],
      });
    }, /Invalid manifest/);
  });

  test('Rejects manifest with missing version', () => {
    assert.throws(() => {
      validatePluginManifest({
        name: 'no-version',
        manifest_version: 1,
        entry_point: 'index.js',
        permissions: ['editor.read'],
      });
    }, /Invalid manifest/);
  });

  test('Rejects manifest with invalid semver format', () => {
    assert.throws(() => {
      validatePluginManifest({
        name: 'bad-ver',
        version: 'v1',
        manifest_version: 1,
        entry_point: 'index.js',
        permissions: ['editor.read'],
      });
    }, /Invalid manifest/);
  });

  test('Accepts explicit network write permission', () => {
    const manifest = validatePluginManifest({
      name: 'network-writer',
      version: '1.0.0',
      manifest_version: 1,
      entry_point: 'index.js',
      permissions: ['network.request', 'network.request:write'],
    });
    assert.ok(manifest.permissions.includes('network.request:write'));
  });

  test('Rejects menu item IDs unsafe for renderer selectors', () => {
    assert.throws(() => {
      validatePluginManifest({
        name: 'unsafe-menu',
        version: '1.0.0',
        manifest_version: 1,
        entry_point: 'index.js',
        permissions: ['ui.menus'],
        menu_items: [{ id: 'bad"selector', label: 'Unsafe', section: 'plugins' }],
      });
    }, /Invalid manifest/);
  });

  console.log('\n🛡️ Plugin Host Authorization:');
  const sender = {};
  const plugin = {
    manifest: { name: 'word-count' },
    permissions: new Set(['editor.read', 'settings.read']),
    state: 'ready',
    window: { webContents: sender, isDestroyed: () => false },
  };
  const pluginMap = new Map([['word-count', plugin]]);

  test('Authorizes a request using the sender plugin permissions', () => {
    const result = authorizePluginRequest(pluginMap, sender, 'editor:getContent');
    assert.strictEqual(result.allowed, true);
    assert.strictEqual(result.plugin, plugin);
  });

  test('Rejects requests whose permission is not granted', () => {
    const result = authorizePluginRequest(pluginMap, sender, 'editor:setContent');
    assert.strictEqual(result.allowed, false);
    assert.match(result.error, /editor\.write/);
  });

  test('Rejects unknown request channels even when the sender is trusted', () => {
    const result = authorizePluginRequest(pluginMap, sender, 'registerCommand');
    assert.strictEqual(result.allowed, false);
    assert.match(result.error, /Unsupported plugin channel/);
  });

  test('Requires settings.write to register setting defaults', () => {
    const readOnly = authorizePluginRequest(pluginMap, sender, 'settings:register');
    assert.strictEqual(readOnly.allowed, false);

    const writer = {
      ...plugin,
      permissions: new Set(['settings.write']),
    };
    const writeAllowed = authorizePluginRequest(
      new Map([['word-count', writer]]),
      sender,
      'settings:register'
    );
    assert.strictEqual(writeAllowed.allowed, true);
  });

  test('Rejects requests from a sender not owned by an active plugin', () => {
    const result = authorizePluginRequest(pluginMap, {}, 'editor:getContent');
    assert.strictEqual(result.allowed, false);
    assert.match(result.error, /active plugin window/);
  });

  test('Authorizes requests while a plugin window is loading', () => {
    const loadingPlugin = { ...plugin, state: 'loading' };
    const result = authorizePluginRequest(new Map([['word-count', loadingPlugin]]), sender, 'editor:getContent');
    assert.strictEqual(result.allowed, true);
  });

  test('Rejects requests after a plugin is disabled', () => {
    const disabledPlugin = { ...plugin, state: 'disabled' };
    const result = authorizePluginRequest(new Map([['word-count', disabledPlugin]]), sender, 'editor:getContent');
    assert.strictEqual(result.allowed, false);
  });

  test('Rejects unapproved plugin events', () => {
    const result = authorizePluginEvent(pluginMap, sender, 'registerCommand');
    assert.strictEqual(result.allowed, false);
    assert.match(result.error, /Unsupported plugin channel/);
  });

  console.log('\n🔒 Permissions Verification for Bundled Plugins:');
  test('insert-date declares required permissions', () => {
    const m = JSON.parse(fs.readFileSync(path.join(__dirname, 'src/plugins/insert-date/plugin.json'), 'utf8'));
    const perms = new Set(m.permissions);
    assert.ok(perms.has('editor.read'));
    assert.ok(perms.has('editor.write'));
    assert.ok(perms.has('editor.selection'));
    assert.ok(perms.has('editor.commands'));
    assert.ok(perms.has('ui.menus'));
    assert.ok(perms.has('settings.read'));
    assert.ok(perms.has('settings.write'));
  });

  test('word-count declares required permissions', () => {
    const m = JSON.parse(fs.readFileSync(path.join(__dirname, 'src/plugins/word-count/plugin.json'), 'utf8'));
    const perms = new Set(m.permissions);
    assert.ok(perms.has('editor.read'));
    assert.ok(perms.has('ui.statusbar'));
    assert.ok(perms.has('settings.read'));
    assert.ok(perms.has('settings.write'));
  });

  test('custom-transform declares required permissions', () => {
    const m = JSON.parse(fs.readFileSync(path.join(__dirname, 'src/plugins/custom-transform/plugin.json'), 'utf8'));
    const perms = new Set(m.permissions);
    assert.ok(perms.has('editor.read'));
    assert.ok(perms.has('editor.write'));
    assert.ok(perms.has('editor.commands'));
    assert.ok(perms.has('file.save'));
    assert.ok(perms.has('ui.menus'));
    assert.ok(perms.has('settings.read'));
    assert.ok(perms.has('settings.write'));
  });

  console.log('\n⚙️ Plugin Settings Store:');
  test('Isolates settings by plugin and persists scoped values', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flowmark-plugin-settings-'));
    const settingsPath = path.join(tempDir, 'settings.json');
    try {
      const store = new PluginSettingsStore(settingsPath);
      store.register('word-count', 'word-count.showChars', true);
      store.register('word-count', 'word-count.showChars', false);
      store.set('custom-transform', 'custom-transform.enabled', false);

      assert.strictEqual(store.get('word-count', 'word-count.showChars'), true);
      assert.strictEqual(store.get('custom-transform', 'word-count.showChars'), undefined);
      assert.deepStrictEqual(store.getAll('word-count'), { 'word-count.showChars': true });

      const reloaded = new PluginSettingsStore(settingsPath);
      assert.strictEqual(reloaded.get('custom-transform', 'custom-transform.enabled'), false);
      assert.deepStrictEqual(reloaded.getAll('word-count'), { 'word-count.showChars': true });
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test('Migrates legacy plugin-prefixed settings without exposing them cross-plugin', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flowmark-plugin-settings-'));
    const settingsPath = path.join(tempDir, 'settings.json');
    try {
      fs.writeFileSync(settingsPath, JSON.stringify({
        'word-count.showChars': true,
        'custom-transform.enabled': false,
        unscopedLegacyValue: 'preserve',
      }));
      const store = new PluginSettingsStore(settingsPath);
      assert.strictEqual(store.get('word-count', 'word-count.showChars'), true);
      assert.strictEqual(store.get('custom-transform', 'word-count.showChars'), undefined);
      assert.deepStrictEqual(store.getAll('unscoped'), {});

      store.set('word-count', 'word-count.showLines', false);
      const migrated = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
      assert.strictEqual(migrated.legacy.unscopedLegacyValue, 'preserve');
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  console.log('\n🔤 custom-transform Regex Rules:');
  const DEFAULT_RULES = [
    { pattern: '"([^"]*)"', replacement: '\u201c$1\u201d', enabled: true },
    { pattern: "'([^']*)'", replacement: '\u2018$1\u2019', enabled: true },
    { pattern: '\\.\\.\\.', replacement: '\u2026', enabled: true },
    { pattern: '---', replacement: '\u2014', enabled: true },
    { pattern: '--', replacement: '\u2013', enabled: true }
  ];

  function applyRegexRules(text, rules) {
    let frontmatter = '';
    let body = text;
    const fmMatch = text.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/);
    if (fmMatch) {
      frontmatter = fmMatch[0];
      body = text.slice(frontmatter.length);
    }
    let result = body;
    for (const rule of rules) {
      if (!rule.enabled) continue;
      if (rule.pattern === '---') {
        result = result.replace(/(?<!^|\r?\n)---(?!$|\r?\n)/gm, rule.replacement);
        continue;
      }
      if (rule.pattern === '--') {
        result = result.replace(/(?<!-|\r?\n)--(?!-|\r?\n)/gm, rule.replacement);
        continue;
      }
      result = result.replace(new RegExp(rule.pattern, 'g'), rule.replacement);
    }
    return frontmatter + result;
  }

  test('Transforms straight double quotes to smart quotes', () => {
    const input = 'He said "hello world"';
    const output = applyRegexRules(input, DEFAULT_RULES);
    assert.strictEqual(output, 'He said \u201chello world\u201d');
  });

  test('Transforms triple dots to ellipsis', () => {
    const input = 'Wait... what?';
    const output = applyRegexRules(input, DEFAULT_RULES);
    assert.strictEqual(output, 'Wait\u2026 what?');
  });

  test('Transforms double hyphen to en-dash and inline triple to em-dash', () => {
    const input = 'Pages 10--20 word---word';
    const output = applyRegexRules(input, DEFAULT_RULES);
    assert.strictEqual(output, 'Pages 10\u201320 word\u2014word');
  });

  test('Preserves table delimiter hyphens while transforming text in table cells', async () => {
    const pluginPath = path.join(__dirname, 'src', 'plugins', 'custom-transform', 'index.js');
    let command;
    let updatedContent;
    const pluginApi = {
      hasPermission: () => true,
      settings: {
        get: async () => undefined,
        register: async () => {},
      },
      editor: {
        getContent: async () => '',
        setContent: async (content) => { updatedContent = content; },
      },
      ui: {
        registerCommand: (definition) => { command = definition; },
        addMenuItem: () => {},
      },
      on: () => {},
      log: () => {},
      warn: () => {},
      error: () => {},
    };
    vm.runInNewContext(fs.readFileSync(pluginPath, 'utf8'), { flowmarkPlugin: pluginApi });
    const input = '| Term | Notes | Range |\n| -- | :---: | --------- |\n| word---word | x--y | 10--20 |';
    const output = await command.run(input);
    assert.strictEqual(
      output,
      '| Term | Notes | Range |\n| -- | :---: | --------- |\n| word\u2014word | x\u2013y | 10\u201320 |',
    );
    assert.strictEqual(updatedContent, output);
  });

  test('Preserves frontmatter delimiters and horizontal rules', () => {
    const input = '---\ntitle: "Test"\n---\n\nBody text\n\n---\n';
    const output = applyRegexRules(input, DEFAULT_RULES);
    assert.ok(output.startsWith('---\n'));
    assert.ok(output.includes('\n---\n\nBody text'));
    assert.ok(output.endsWith('\n---\n'));
  });

  console.log('\n📊 word-count Calculation:');
  test('Calculates words, chars, and lines accurately', () => {
    const content = 'Hello world from FlowMark!\nSecond line of text.';
    const words = content.trim() ? content.trim().split(/\s+/).length : 0;
    const chars = content.length;
    const lines = content.split('\n').length;
    assert.strictEqual(words, 8);
    assert.strictEqual(chars, 47);
    assert.strictEqual(lines, 2);
  });

  test('Handles empty content cleanly', () => {
    const content = '';
    const words = content.trim() ? content.trim().split(/\s+/).length : 0;
    assert.strictEqual(words, 0);
  });

  console.log('\n📅 insert-date Formatter:');
  test('Formats date string according to template', () => {
    const pad = (n) => String(n).padStart(2, '0');
    const now = new Date(2026, 10, 22, 14, 30, 0); // Nov 22, 2026
    const format = 'YYYY-MM-DD';
    const dateStr = format
      .replace('YYYY', now.getFullYear())
      .replace('MM', pad(now.getMonth() + 1))
      .replace('DD', pad(now.getDate()));
    assert.strictEqual(dateStr, '2026-11-22');
  });

  console.log(`\n${pass + fail} tests, ${pass} passed, ${fail} failed\n`);
  if (fail > 0) process.exit(1);
}

runTests();

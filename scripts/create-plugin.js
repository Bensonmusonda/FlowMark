#!/usr/bin/env node
/**
 * FlowMark Plugin Template Generator
 * Usage: node scripts/create-plugin.js my-plugin-name
 */

const fs = require('fs');
const path = require('path');

const name = process.argv[2];

if (!name) {
  console.error('Usage: node scripts/create-plugin.js <plugin-name>');
  console.error('Example: node scripts/create-plugin.js my-awesome-plugin');
  process.exit(1);
}

// Validate plugin name (kebab-case, lowercase)
if (!/^[a-z0-9-]+$/.test(name)) {
  console.error('Error: Plugin name must be lowercase kebab-case (e.g., my-plugin)');
  process.exit(1);
}

const dir = path.join(process.cwd(), 'plugins', name);

if (fs.existsSync(dir)) {
  console.error(`Error: Plugin directory already exists: ${dir}`);
  process.exit(1);
}

fs.mkdirSync(dir, { recursive: true });

const files = {
  'plugin.json': `{
  "name": "${name}",
  "version": "0.1.0",
  "manifest_version": 1,
  "description": "",
  "entry_point": "index.js",
  "permissions": ["editor.read", "editor.write"],
  "commands": [],
  "menu_items": []
}`,
  'index.js': `const PLUGIN_ID = '${name}';

flowmarkPlugin.editor.registerSlashCommand({
  id: '${name}:hello',
  label: 'Say Hello',
  run: async () => {
    await flowmarkPlugin.editor.replaceSelection('Hello from ${name}!');
  }
});`,
  'README.md': `# ${name}

FlowMark plugin.
`
};

for (const [file, content] of Object.entries(files)) {
  fs.writeFileSync(path.join(dir, file), content);
}

console.log(`Created ${dir}/`);
console.log('Edit plugin.json, then install from the plugin panel.');
console.log('');
console.log('Next steps:');
console.log('  1. Edit plugins/${name}/plugin.json to configure your plugin');
console.log('  2. Write your plugin code in plugins/${name}/index.js');
console.log('  3. Open FlowMark, go to Plugins panel → Install from folder → select the plugin directory');
console.log('  4. For development: run "npm run plugin:dev" to enable hot reload');
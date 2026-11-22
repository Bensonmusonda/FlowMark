/**
 * custom-transform plugin (sandboxed)
 * Applies regex transformations on save.
 */

const DEFAULT_RULES = [
  { pattern: '"([^"]*)"', replacement: '\u201c$1\u201d', description: 'Smart double quotes', enabled: true },
  { pattern: "'([^']*)'", replacement: '\u2018$1\u2019', description: 'Smart single quotes', enabled: true },
  { pattern: '\\.\\.\\.', replacement: '\u2026', description: 'Ellipsis', enabled: true },
  { pattern: '---', replacement: '\u2014', description: 'Em dash', enabled: true },
  { pattern: '--', replacement: '\u2013', description: 'En dash', enabled: true }
];

async function applyTransforms(inputContent) {
  try {
    if (!flowmarkPlugin.hasPermission('editor.read') || !flowmarkPlugin.hasPermission('editor.write')) {
      return typeof inputContent === 'string' ? inputContent : '';
    }

    const content = typeof inputContent === 'string' ? inputContent : await flowmarkPlugin.editor.getContent();
    const rules = await flowmarkPlugin.settings.get('custom-transform.rules') || DEFAULT_RULES;

    // Protect YAML frontmatter from text transformations
    let frontmatter = '';
    let body = content;
    const fmMatch = content.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/);
    if (fmMatch) {
      frontmatter = fmMatch[0];
      body = content.slice(frontmatter.length);
    }

    let result = body;
    for (const rule of rules) {
      if (!rule.enabled) continue;
      try {
        if (rule.pattern === '---') {
          // Never replace '---' when it's alone on a line (horizontal rule or markdown fence)
          result = result.replace(/(?<!^|\r?\n)---(?!$|\r?\n)/gm, rule.replacement);
          continue;
        }
        if (rule.pattern === '--') {
          // Never replace '--' when part of a longer hyphen sequence (like ---) or on line boundaries
          result = result.replace(/(?<!-|\r?\n)--(?!-|\r?\n)/gm, rule.replacement);
          continue;
        }
        const regex = new RegExp(rule.pattern, 'g');
        result = result.replace(regex, rule.replacement);
      } catch (err) {
        flowmarkPlugin.warn('Invalid regex:', rule.pattern, err);
      }
    }

    const fullResult = frontmatter + result;
    if (fullResult !== content) {
      await flowmarkPlugin.editor.setContent(fullResult);
      flowmarkPlugin.log('Applied transforms, changed:', fullResult.length - content.length, 'chars');
    }
    return fullResult;
  } catch (err) {
    flowmarkPlugin.error('Transform error:', err);
    return typeof inputContent === 'string' ? inputContent : '';
  }
}

// Listen for save event
flowmarkPlugin.on('file:beforeSave', async (content) => {
  if (!(await flowmarkPlugin.settings.get('custom-transform.applyOnSave'))) return content;
  return applyTransforms(content);
});

// Register command
flowmarkPlugin.ui.registerCommand({
  id: 'custom-transform:apply',
  label: 'Apply Custom Transforms',
  shortcut: 'Ctrl+Shift+T',
  section: 'edit',
  run: applyTransforms
});

// Register settings
flowmarkPlugin.settings.register('custom-transform.rules', DEFAULT_RULES, {
  type: 'json',
  label: 'Transform Rules',
  description: 'Array of {pattern, replacement, description, enabled} objects'
}).catch(e => flowmarkPlugin.warn('settings.register failed:', e));

flowmarkPlugin.settings.register('custom-transform.enabled', true, {
  type: 'boolean',
  label: 'Enabled',
  description: 'Apply transformations on save'
}).catch(e => flowmarkPlugin.warn('settings.register failed:', e));

flowmarkPlugin.settings.register('custom-transform.applyOnSave', true, {
  type: 'boolean',
  label: 'Apply on Save',
  description: 'Transform content when saving file'
}).catch(e => flowmarkPlugin.warn('settings.register failed:', e));

// Add to Edit menu
flowmarkPlugin.ui.addMenuItem('edit', {
  id: 'custom-transform:apply',
  label: 'Apply Transforms',
  order: 10
});

flowmarkPlugin.log('[custom-transform] Plugin loaded');
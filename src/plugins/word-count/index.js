/**
 * word-count plugin (sandboxed)
 * Shows word/character count in status bar.
 */

let statusBarInterval = null;

async function updateStatusBar() {
  try {
    if (!flowmarkPlugin.hasPermission('editor.read') || !flowmarkPlugin.hasPermission('ui.statusbar')) {
      return;
    }

    const content = await flowmarkPlugin.editor.getContent();
    if (!content) return;

    const words = content.trim() ? content.trim().split(/\s+/).length : 0;
    const chars = content.length;
    const lines = content.split('\n').length;

    let parts = [`${words} words`];
    if (await flowmarkPlugin.settings.get('word-count.showChars')) {
      parts.push(`${chars} chars`);
    }
    if (await flowmarkPlugin.settings.get('word-count.showLines')) {
      parts.push(`${lines} lines`);
    }

    await flowmarkPlugin.ui.setStatusBar(parts.join(' · '), { side: 'left' });
  } catch (err) {
    flowmarkPlugin.error('Failed to update status bar:', err);
  }
}

async function activate() {
  // Register settings (await so defaults exist before first read)
  await flowmarkPlugin.settings.register('word-count.enabled', true, {
    type: 'boolean',
    label: 'Enabled',
    description: 'Show word count in status bar'
  });

  await flowmarkPlugin.settings.register('word-count.showChars', true, {
    type: 'boolean',
    label: 'Show Characters',
    description: 'Display character count alongside word count'
  });

  await flowmarkPlugin.settings.register('word-count.showLines', false, {
    type: 'boolean',
    label: 'Show Lines',
    description: 'Display line count'
  });

  // Start periodic update
  if (statusBarInterval) clearInterval(statusBarInterval);
  statusBarInterval = setInterval(updateStatusBar, 1000);

  // Listen for content changes
  flowmarkPlugin.editor.onContentChange(updateStatusBar);

  // Initial update
  updateStatusBar();

  flowmarkPlugin.log('[word-count] Plugin activated');
}

async function deactivate() {
  if (statusBarInterval) {
    clearInterval(statusBarInterval);
    statusBarInterval = null;
  }
  await flowmarkPlugin.ui.setStatusBar('', { side: 'left' });
  flowmarkPlugin.log('[word-count] Plugin deactivated');
}

// Handle enable/disable via settings
flowmarkPlugin.settings.onChange(async (key, value) => {
  if (key === 'word-count.enabled') {
    if (value) {
      await activate();
    } else {
      await deactivate();
    }
  } else if (key.startsWith('word-count.')) {
    updateStatusBar();
  }
});

// Auto-activate (always activate on load — register sets default to true)
activate().catch(err => flowmarkPlugin.error('Failed to activate:', err));

flowmarkPlugin.log('[word-count] Plugin loaded');
/**
 * insert-date plugin (sandboxed)
 * Inserts current date/time at cursor position.
 */

const pad = (n) => String(n).padStart(2, '0');

function formatDate(format, includeTime) {
  const now = new Date();
  let dateStr = format
    .replace('YYYY', now.getFullYear())
    .replace('MM', pad(now.getMonth() + 1))
    .replace('DD', pad(now.getDate()));

  if (includeTime) {
    dateStr += ` ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
  }

  return dateStr;
}

async function insertDate() {
  try {
    // Get settings
    const format = await flowmarkPlugin.settings.get('insert-date.format') || 'YYYY-MM-DD';
    const includeTime = await flowmarkPlugin.settings.get('insert-date.includeTime') || false;

    const dateStr = formatDate(format, includeTime);

    // Get current selection
    const selection = await flowmarkPlugin.editor.getSelection();

    if (selection && !selection.empty) {
      // Replace selection
      await flowmarkPlugin.editor.replaceSelection(dateStr);
    } else {
      // Insert at cursor
      await flowmarkPlugin.editor.replaceSelection(dateStr);
    }

    flowmarkPlugin.log('Inserted date:', dateStr);
  } catch (err) {
    flowmarkPlugin.error('Failed to insert date:', err);
  }
}

// Register command
flowmarkPlugin.ui.registerCommand({
  id: 'insert-date:insert',
  label: 'Insert Date',
  shortcut: 'Ctrl+Shift+D',
  section: 'insert',
  run: insertDate
});

// Register settings (await not needed — these fire-and-forget before first use)
flowmarkPlugin.settings.register('insert-date.format', 'YYYY-MM-DD', {
  type: 'string',
  label: 'Date Format',
  description: 'Date format (YYYY-MM-DD, MM/DD/YYYY, DD/MM/YYYY, etc.)'
}).catch(e => flowmarkPlugin.warn('settings.register failed:', e));

flowmarkPlugin.settings.register('insert-date.includeTime', false, {
  type: 'boolean',
  label: 'Include Time',
  description: 'Append current time to the date'
}).catch(e => flowmarkPlugin.warn('settings.register failed:', e));

// Add to Insert menu
flowmarkPlugin.ui.addMenuItem('insert', {
  id: 'insert-date:insert',
  label: 'Date',
  order: 10
});

flowmarkPlugin.log('[insert-date] Plugin loaded');
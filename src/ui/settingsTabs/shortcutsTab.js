import { createSettingsTab } from './index.js';
import { Keyboard } from 'lucide';

export const shortcutsTab = createSettingsTab(
  'shortcuts',
  'Shortcuts',
  Keyboard,
  () => {
    const container = document.createElement('div');
    container.className = 'settings-tab-content';
    container.innerHTML = `
      <h3>Keyboard Shortcuts</h3>
      <p class="settings-placeholder">Shortcut editor will be implemented in Phase 4.</p>
      <div class="settings-form">
        <div class="shortcuts-placeholder">
          <p>This will contain:</p>
          <ul>
            <li>Searchable list of all commands grouped by category</li>
            <li>Editable keybinding inputs with conflict detection</li>
            <li>Reset to defaults button</li>
          </ul>
        </div>
      </div>
    `;
    return container;
  }
);

export default shortcutsTab;
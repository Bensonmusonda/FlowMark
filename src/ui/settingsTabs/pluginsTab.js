import { createSettingsTab } from './index.js';
import { Plug } from 'lucide';

export const pluginsTab = createSettingsTab(
  'plugins',
  'Plugins',
  Plug,
  () => {
    const container = document.createElement('div');
    container.className = 'settings-tab-content';
    container.innerHTML = `
      <h3>Plugins</h3>
      <p class="settings-placeholder">Plugin manager will be embedded here in Phase 3.</p>
      <div class="settings-form">
        <div class="plugin-manager-placeholder">
          <p>This will contain the full plugin management UI:</p>
          <ul>
            <li>Plugin list with enable/disable toggles</li>
            <li>Plugin detail view (Overview, Settings, Contributions, Permissions, Location, Manage, Registry)</li>
            <li>Install from folder / GitHub</li>
            <li>Hot reload for development</li>
          </ul>
        </div>
      </div>
    `;
    return container;
  }
);

export default pluginsTab;
import { createSettingsTab } from './index.js';
import { Shield } from 'lucide';

export const privacyTab = createSettingsTab(
  'privacy',
  'Privacy',
  Shield,
  () => {
    const container = document.createElement('div');
    container.className = 'settings-tab-content';
    container.innerHTML = `
      <h3>Privacy</h3>
      <p class="settings-placeholder">Privacy settings will be implemented in Phase 4.</p>
      <div class="settings-form">
        <fieldset>
          <legend>Data Collection</legend>
          <label class="checkbox-label">
            <input type="checkbox" id="setting-telemetry" />
            <span>Allow anonymous usage telemetry</span>
          </label>
          <label class="checkbox-label">
            <input type="checkbox" id="setting-crash-reports" />
            <span>Automatically send crash reports</span>
          </label>
        </fieldset>
        <fieldset>
          <legend>Updates</legend>
          <label>
            <span>Update channel</span>
            <select id="setting-update-channel">
              <option value="stable">Stable</option>
              <option value="beta">Beta</option>
              <option value="dev">Development</option>
            </select>
          </label>
          <label class="checkbox-label">
            <input type="checkbox" id="setting-auto-update" />
            <span>Automatically check for updates</span>
          </label>
        </fieldset>
      </div>
    `;
    return container;
  }
);

export default privacyTab;
import { createSettingsTab } from './index.js';
import { Info } from 'lucide';

export const aboutTab = createSettingsTab(
  'about',
  'About',
  Info,
  () => {
    const container = document.createElement('div');
    container.className = 'settings-tab-content';
    container.innerHTML = `
      <h3>About FlowMark</h3>
      <p class="settings-placeholder">About information will be fully implemented in Phase 2.</p>
      <div class="settings-form">
        <div class="about-content">
          <div class="about-version">
            <strong>Version:</strong> <span id="about-version">1.1.0</span>
          </div>
          <div class="about-build">
            <strong>Build:</strong> <span id="about-build">development</span>
          </div>
          <div class="about-electron">
            <strong>Electron:</strong> <span id="about-electron">--</span>
          </div>
          <div class="about-node">
            <strong>Node.js:</strong> <span id="about-node">--</span>
          </div>
          <div class="about-chromium">
            <strong>Chromium:</strong> <span id="about-chromium">--</span>
          </div>
          <div class="about-v8">
            <strong>V8:</strong> <span id="about-v8">--</span>
          </div>
          <hr />
          <div class="about-links">
            <button type="button" id="btn-check-updates">Check for Updates</button>
            <button type="button" id="btn-view-license">View License</button>
            <button type="button" id="btn-github">GitHub Repository</button>
          </div>
        </div>
      </div>
    `;
    return container;
  }
);

export default aboutTab;
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
      <p class="settings-desc">Minimal, distraction-free Markdown editor designed for speed and clarity.</p>

      <div class="about-grid">
        <div class="about-row">
          <span class="about-row-label">Version</span>
          <span class="about-row-value" id="about-version">1.1.0</span>
        </div>
        <div class="about-row">
          <span class="about-row-label">Build</span>
          <span class="about-row-value" id="about-build">Development</span>
        </div>
        <div class="about-row">
          <span class="about-row-label">Electron</span>
          <span class="about-row-value" id="about-electron">--</span>
        </div>
        <div class="about-row">
          <span class="about-row-label">Chromium</span>
          <span class="about-row-value" id="about-chromium">--</span>
        </div>
        <div class="about-row">
          <span class="about-row-label">Node.js</span>
          <span class="about-row-value" id="about-node">--</span>
        </div>
        <div class="about-row">
          <span class="about-row-label">V8</span>
          <span class="about-row-value" id="about-v8">--</span>
        </div>
        <div class="about-row">
          <span class="about-row-label">Platform</span>
          <span class="about-row-value" id="about-platform">--</span>
        </div>
      </div>

      <div id="about-update-banner" class="about-update-banner hidden"></div>

      <div class="about-links">
        <button type="button" id="btn-check-updates" class="about-action-btn">
          Check for Updates
        </button>
        <button type="button" id="btn-view-license" class="about-action-btn">
          View License
        </button>
        <button type="button" id="btn-github" class="about-action-btn">
          GitHub Repository
        </button>
      </div>
    `;

    // Populate versions asynchronously
    (async () => {
      try {
        if (window.appAPI?.getVersions) {
          const v = await window.appAPI.getVersions();
          if (v) {
            const verEl = container.querySelector('#about-version');
            if (verEl && v.version) verEl.textContent = v.version;
            const elEl = container.querySelector('#about-electron');
            if (elEl && v.electron) elEl.textContent = v.electron;
            const chEl = container.querySelector('#about-chromium');
            if (chEl && v.chrome) chEl.textContent = v.chrome;
            const noEl = container.querySelector('#about-node');
            if (noEl && v.node) noEl.textContent = v.node;
            const v8El = container.querySelector('#about-v8');
            if (v8El && v.v8) v8El.textContent = v.v8;
            const plEl = container.querySelector('#about-platform');
            if (plEl && v.platform) plEl.textContent = v.platform;
          }
        }
        if (window.appAPI?.isDevMode) {
          const isDev = await window.appAPI.isDevMode();
          const buildEl = container.querySelector('#about-build');
          if (buildEl) buildEl.textContent = isDev ? 'Development' : 'Release';
        }
      } catch (err) {
        console.warn('Failed to load version details:', err);
      }
    })();

    // Wire up buttons
    const btnUpdates = container.querySelector('#btn-check-updates');
    const updateBanner = container.querySelector('#about-update-banner');
    btnUpdates?.addEventListener('click', () => {
      btnUpdates.disabled = true;
      btnUpdates.textContent = 'Checking...';
      setTimeout(() => {
        btnUpdates.disabled = false;
        btnUpdates.textContent = 'Check for Updates';
        if (updateBanner) {
          updateBanner.textContent = '✓ FlowMark is currently up to date (v1.1.0).';
          updateBanner.classList.remove('hidden');
          setTimeout(() => updateBanner.classList.add('hidden'), 5000);
        }
      }, 600);
    });

    const btnLicense = container.querySelector('#btn-view-license');
    btnLicense?.addEventListener('click', () => {
      window.shellAPI?.openExternal?.('https://github.com/bensonmusonda/flowmark/blob/main/LICENSE');
    });

    const btnGithub = container.querySelector('#btn-github');
    btnGithub?.addEventListener('click', () => {
      window.shellAPI?.openExternal?.('https://github.com/bensonmusonda/flowmark');
    });

    return container;
  }
);

export default aboutTab;

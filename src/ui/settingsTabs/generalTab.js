import { SettingsTab } from './index.js';
import { FolderOpen } from 'lucide';

export class GeneralTab extends SettingsTab {
  constructor() {
    super({
      id: 'general',
      label: 'General',
      icon: FolderOpen,
    });
    this.element = null;
    this.unsubSettingsChange = null;
  }

  async onActivate() {
    await this.loadSettings();
    if (this.element) this.bindEvents();
  }

  onDeactivate() {
    this.unsubSettingsChange?.();
    this.unsubSettingsChange = null;
  }

  async loadSettings() {
    const defaults = {
      startup: 'welcome',
      autosave: 30,
      defaultFolder: '',
      language: 'auto',
    };

    // Load from settingsAPI
    for (const [key, defaultValue] of Object.entries(defaults)) {
      try {
        const value = await window.settingsAPI?.get(key);
        if (value !== undefined && value !== null) {
          defaults[key] = value;
        }
      } catch (e) {
        console.warn(`Failed to load setting ${key}:`, e);
      }
    }

    // Apply to form
    const startup = this.element?.querySelector('#setting-startup');
    const autosave = this.element?.querySelector('#setting-autosave');
    const defaultFolder = this.element?.querySelector('#setting-default-folder');
    const language = this.element?.querySelector('#setting-language');

    if (startup) startup.value = defaults.startup;
    if (autosave) autosave.value = defaults.autosave;
    if (defaultFolder) defaultFolder.value = defaults.defaultFolder;
    if (language) language.value = defaults.language;
  }

  bindEvents() {
    const saveSetting = async (key, value) => {
      try {
        await window.settingsAPI?.set(key, value);
      } catch (e) {
        console.error(`Failed to save setting ${key}:`, e);
      }
    };

    const startup = this.element.querySelector('#setting-startup');
    const autosave = this.element.querySelector('#setting-autosave');
    const defaultFolder = this.element.querySelector('#setting-default-folder');
    const language = this.element.querySelector('#setting-language');
    const browseBtn = this.element.querySelector('#btn-select-folder');

    startup?.addEventListener('change', () => saveSetting('startup', startup.value));
    autosave?.addEventListener('change', () => saveSetting('autosave', parseInt(autosave.value, 10)));
    language?.addEventListener('change', () => saveSetting('language', language.value));

    browseBtn?.addEventListener('click', async () => {
      try {
        const result = await window.fileAPI?.open();
        if (result && !result.canceled && result.filePath) {
          defaultFolder.value = result.filePath;
          await saveSetting('defaultFolder', result.filePath);
        }
      } catch (e) {
        console.error('Failed to select folder:', e);
      }
    });
  }

  render() {
    this.element = document.createElement('div');
    this.element.className = 'settings-tab-content';
    this.element.innerHTML = `
      <h3>General</h3>
      <div class="settings-form">
        <fieldset>
          <legend>Startup</legend>
          <label>
            <span>On launch</span>
            <select id="setting-startup">
              <option value="welcome">Welcome screen</option>
              <option value="new-file">New file</option>
              <option value="last-session">Restore last session</option>
            </select>
          </label>
          <label>
            <span>Auto-save interval (seconds)</span>
            <input type="number" id="setting-autosave" min="10" max="3600" value="30" />
          </label>
        </fieldset>
        <fieldset>
          <legend>Files</legend>
          <label>
            <span>Default folder</span>
            <div style="display:flex; gap:8px;">
              <input type="text" id="setting-default-folder" placeholder="Select folder..." readonly style="flex:1;" />
              <button type="button" class="settings-btn" id="btn-select-folder">Browse…</button>
            </div>
          </label>
        </fieldset>
        <fieldset>
          <legend>Language</legend>
          <label>
            <span>Interface language</span>
            <select id="setting-language">
              <option value="auto">System default</option>
              <option value="en">English</option>
            </select>
          </label>
        </fieldset>
      </div>
    `;
    return this.element;
  }
}

export const generalTab = new GeneralTab();
export default generalTab;
import { SettingsTab } from './index.js';
import { Palette } from 'lucide';

const ACCENTS = {
  blue:       { dark: '#7cb8f0', light: '#2970c8' },
  steel:      { dark: '#90aac8', light: '#3a5878' },
  sky:        { dark: '#80d0e8', light: '#1888a8' },
  sage:       { dark: '#90c8a0', light: '#2a7a48' },
  mint:       { dark: '#80e0c0', light: '#0a8060' },
  olive:      { dark: '#b0c880', light: '#506820' },
  rose:       { dark: '#f0a0b0', light: '#b83050' },
  coral:      { dark: '#f0907a', light: '#c04030' },
  blush:      { dark: '#e8b0c8', light: '#a03870' },
  lavender:   { dark: '#b8a8f0', light: '#5040b8' },
  mauve:      { dark: '#d0a0d0', light: '#883888' },
  violet:     { dark: '#c0a0e8', light: '#6030b0' },
  peach:      { dark: '#f0b890', light: '#b05820' },
  sand:       { dark: '#d4b896', light: '#7a5030' },
  amber:      { dark: '#e8c870', light: '#987010' },
  slate:      { dark: '#a0b8c8', light: '#305068' },
};

const THEMES = [
  { value: 'theme-dark', label: 'Dark', class: 'dark' },
  { value: 'theme-light', label: 'Light', class: 'light' },
  { value: 'theme-sepia', label: 'Sepia', class: 'sepia' },
  { value: 'system', label: 'System', class: 'system' },
];

const CUSTOM_COLOR_KEYS = [
  { key: '--fm-bg', label: 'Background', type: 'color' },
  { key: '--fm-text', label: 'Text', type: 'color' },
  { key: '--fm-accent', label: 'Accent', type: 'color' },
  { key: '--fm-border', label: 'Border', type: 'color' },
];

export class AppearanceTab extends SettingsTab {
  constructor() {
    super({
      id: 'appearance',
      label: 'Appearance',
      icon: Palette,
    });
    this.element = null;
    this.currentAccent = 'blue';
    this.currentTheme = 'theme-dark';
    this.customColors = {};
  }

  async onActivate() {
    await this.loadSettings();
    if (this.element) this.bindEvents();
  }

  onDeactivate() {
    // Restore theme if user was editing custom
    // (handled by live preview)
  }

  async loadSettings() {
    try {
      const apiTheme = await window.themeAPI?.getTheme?.();
      const settingsTheme = await window.settingsAPI?.get?.('theme');
      this.currentTheme = apiTheme || settingsTheme || window.themeControls?.getTheme() || 'theme-dark';

      const settingsAccent = await window.settingsAPI?.get?.('accent');
      this.currentAccent = settingsAccent || window.themeControls?.getAccent() || 'blue';

      // Custom colors are read from settings or CSS variables
      this.customColors = {};
      const savedCustom = (await window.themeAPI?.getCustomColors?.()) || (await window.settingsAPI?.get?.('customColors'));
      if (savedCustom && typeof savedCustom === 'object') {
        this.customColors = { ...savedCustom };
      } else {
        const CUSTOM_COLOR_KEYS = [
          { key: '--fm-bg', label: 'Background' },
          { key: '--fm-text', label: 'Text' },
          { key: '--fm-accent', label: 'Accent' },
          { key: '--fm-border', label: 'Border' },
        ];
        for (const { key } of CUSTOM_COLOR_KEYS) {
          const value = getComputedStyle(document.documentElement).getPropertyValue(key).trim();
          if (value) this.customColors[key] = value;
        }
      }
    } catch (e) {
      console.warn('Failed to load appearance settings:', e);
    }

    // Apply to form
    if (this.element) {
      const themeRadios = this.element.querySelectorAll('input[name="theme"]');
      themeRadios.forEach(r => r.checked = r.value === this.currentTheme);

      const accentBtns = this.element.querySelectorAll('.accent-opt');
      accentBtns.forEach(btn => btn.classList.toggle('active', btn.dataset.accent === this.currentAccent));

      this.renderCustomColorInputs();
    }
  }

  bindEvents() {
    // Theme radios
    const themeRadios = this.element.querySelectorAll('input[name="theme"]');
    themeRadios.forEach(radio => {
      radio.addEventListener('change', async () => {
        this.currentTheme = radio.value;
        await this.saveTheme();
        this.updateCustomSectionVisibility();
      });
    });

    // Accent colors
    const accentBtns = this.element.querySelectorAll('.accent-opt');
    accentBtns.forEach(btn => {
      btn.addEventListener('click', async () => {
        this.currentAccent = btn.dataset.accent;
        await this.saveAccent();
        this.updateAccentSelection();
      });
    });

    // Font size
    const fontSize = this.element.querySelector('#setting-font-size');
    const fontSizeVal = this.element.querySelector('#font-size-value');
    fontSize?.addEventListener('input', () => {
      fontSizeVal.textContent = fontSize.value + 'px';
    });
    fontSize?.addEventListener('change', async () => {
      await this.saveSetting('fontSize', parseInt(fontSize.value, 10));
    });

    // Line height
    const lineHeight = this.element.querySelector('#setting-line-height');
    const lineHeightVal = this.element.querySelector('#line-height-value');
    lineHeight?.addEventListener('input', () => {
      lineHeightVal.textContent = lineHeight.value;
    });
    lineHeight?.addEventListener('change', async () => {
      await this.saveSetting('lineHeight', parseFloat(lineHeight.value));
    });

    // Editor width
    const editorWidth = this.element.querySelector('#setting-editor-width');
    const editorWidthVal = this.element.querySelector('#editor-width-value');
    editorWidth?.addEventListener('input', () => {
      editorWidthVal.textContent = editorWidth.value + 'px';
    });
    editorWidth?.addEventListener('change', async () => {
      await this.saveSetting('editorWidth', parseInt(editorWidth.value, 10));
    });

    // Custom color inputs
    this.element.querySelectorAll('.custom-color-input').forEach(input => {
      input.addEventListener('input', () => {
        const key = input.dataset.key;
        this.customColors[key] = input.value;
        this.applyCustomColor(key, input.value);
      });
      input.addEventListener('change', async () => {
        await this.saveCustomColors();
      });
    });

    this.updateCustomSectionVisibility();
  }

  async saveTheme() {
    try {
      window.themeControls?.setTheme(this.currentTheme);
      await window.settingsAPI?.set?.('theme', this.currentTheme);
      await window.themeAPI?.setTheme?.(this.currentTheme);
      this.updateCustomSectionVisibility();
    } catch (e) {
      console.error('Failed to save theme:', e);
    }
  }

  async saveAccent() {
    try {
      window.themeControls?.setAccent(this.currentAccent);
      await window.settingsAPI?.set?.('accent', this.currentAccent);
      this.updateAccentSelection();
    } catch (e) {
      console.error('Failed to save accent:', e);
    }
  }

  updateAccentSelection() {
    this.element?.querySelectorAll('.accent-opt').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.accent === this.currentAccent);
    });
  }

  updateCustomSectionVisibility() {
    const customSection = this.element?.querySelector('#custom-colors-section');
    if (customSection) {
      customSection.style.display = this.currentTheme === 'custom' ? 'block' : 'none';
    }
  }

  renderCustomColorInputs() {
    const container = this.element?.querySelector('#custom-color-inputs');
    if (!container) return;

    container.innerHTML = CUSTOM_COLOR_KEYS.map(({ key, label }) => `
      <label class="custom-color-label">
        <span>${label}</span>
        <input type="color" class="custom-color-input" data-key="${key}" value="${this.customColors[key] || '#000000'}" />
      </label>
    `).join('');
  }

  applyCustomColor(key, value) {
    document.documentElement.style.setProperty(key, value);
  }

  async saveCustomColors() {
    try {
      for (const [key, value] of Object.entries(this.customColors)) {
        window.themeControls?.applyCustomColor(key, value);
        await window.themeAPI?.setCustomColor?.(key, value);
      }
      await window.settingsAPI?.set?.('customColors', this.customColors);
    } catch (e) {
      console.error('Failed to save custom colors:', e);
    }
  }

  async saveSetting(key, value) {
    try {
      await window.settingsAPI?.set(key, value);
    } catch (e) {
      console.error(`Failed to save setting ${key}:`, e);
    }
  }

  render() {
    this.element = document.createElement('div');
    this.element.className = 'settings-tab-content';
    this.element.innerHTML = `
      <h3>Appearance</h3>
      <div class="settings-form">
        <fieldset>
          <legend>Base Theme</legend>
          <div class="theme-options">
            ${THEMES.map(t => `
              <label class="theme-option">
                <input type="radio" name="theme" value="${t.value}" />
                <span class="theme-preview ${t.class}"></span>
                <span>${t.label}</span>
              </label>
            `).join('')}
          </div>
        </fieldset>
        <fieldset>
          <legend>Accent Color</legend>
          <div id="accent-options" class="accent-options-grid">
            ${Object.keys(ACCENTS).map(key => `
              <button type="button" class="accent-opt" data-accent="${key}" style="--c:${ACCENTS[key].dark}" title="${key}"></button>
            `).join('')}
          </div>
        </fieldset>
        <fieldset id="custom-colors-section" style="display:none;">
          <legend>Custom Theme Colors</legend>
          <div id="custom-color-inputs" class="custom-color-grid"></div>
        </fieldset>
        <fieldset>
          <legend>Editor</legend>
          <label>
            <span>Font size</span>
            <div style="display:flex; align-items:center; gap:12px;">
              <input type="range" id="setting-font-size" min="12" max="24" value="17" style="flex:1;" />
              <span class="range-value" id="font-size-value">17px</span>
            </div>
          </label>
          <label>
            <span>Line height</span>
            <div style="display:flex; align-items:center; gap:12px;">
              <input type="range" id="setting-line-height" min="1.2" max="2.5" step="0.1" value="1.9" style="flex:1;" />
              <span class="range-value" id="line-height-value">1.9</span>
            </div>
          </label>
          <label>
            <span>Editor width</span>
            <div style="display:flex; align-items:center; gap:12px;">
              <input type="range" id="setting-editor-width" min="560" max="1200" step="40" value="720" style="flex:1;" />
              <span class="range-value" id="editor-width-value">720px</span>
            </div>
          </label>
        </fieldset>
      </div>
    `;
    return this.element;
  }
}

export const appearanceTab = new AppearanceTab();
export default appearanceTab;
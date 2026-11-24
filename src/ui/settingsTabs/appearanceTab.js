import { SettingsTab } from './index.js';
import { Palette } from 'lucide';

export const PALETTES = {
  pastel: {
    id: 'pastel',
    label: 'Pastel',
    accents: {
      blue:       { label: 'Blue', dark: '#7cb8f0', light: '#2970c8' },
      steel:      { label: 'Steel', dark: '#90aac8', light: '#3a5878' },
      sky:        { label: 'Sky', dark: '#80d0e8', light: '#1888a8' },
      sage:       { label: 'Sage', dark: '#90c8a0', light: '#2a7a48' },
      mint:       { label: 'Mint', dark: '#80e0c0', light: '#0a8060' },
      olive:      { label: 'Olive', dark: '#b0c880', light: '#506820' },
      rose:       { label: 'Rose', dark: '#f0a0b0', light: '#b83050' },
      coral:      { label: 'Coral', dark: '#f0907a', light: '#c04030' },
      blush:      { label: 'Blush', dark: '#e8b0c8', light: '#a03870' },
      lavender:   { label: 'Lavender', dark: '#b8a8f0', light: '#5040b8' },
      mauve:      { label: 'Mauve', dark: '#d0a0d0', light: '#883888' },
      violet:     { label: 'Violet', dark: '#c0a0e8', light: '#6030b0' },
      peach:      { label: 'Peach', dark: '#f0b890', light: '#b05820' },
      sand:       { label: 'Sand', dark: '#d4b896', light: '#7a5030' },
      amber:      { label: 'Amber', dark: '#e8c870', light: '#987010' },
      slate:      { label: 'Slate', dark: '#a0b8c8', light: '#305068' },
    }
  },
  vibrant: {
    id: 'vibrant',
    label: 'Vibrant',
    accents: {
      electric:   { label: 'Electric Blue', dark: '#3b82f6', light: '#1d4ed8' },
      emerald:    { label: 'Emerald', dark: '#10b981', light: '#047857' },
      crimson:    { label: 'Crimson', dark: '#ef4444', light: '#b91c1c' },
      sunset:     { label: 'Sunset Orange', dark: '#f97316', light: '#c2410c' },
      royal:      { label: 'Royal Purple', dark: '#a855f7', light: '#7e22ce' },
      cyan:       { label: 'Vibrant Cyan', dark: '#06b6d4', light: '#0e7490' },
      fuchsia:    { label: 'Fuchsia', dark: '#d946ef', light: '#a21caf' },
      gold:       { label: 'Goldenrod', dark: '#eab308', light: '#a16207' },
    }
  },
  earth: {
    id: 'earth',
    label: 'Earth & Warm',
    accents: {
      terracotta: { label: 'Terracotta', dark: '#d97757', light: '#9a3412' },
      moss:       { label: 'Forest Moss', dark: '#709775', light: '#3b5a3e' },
      ochre:      { label: 'Ochre Clay', dark: '#c68b59', light: '#78350f' },
      copper:     { label: 'Rustic Copper', dark: '#b86b53', light: '#7c2d12' },
      clay:       { label: 'Warm Clay', dark: '#b4846c', light: '#6d4c41' },
      forest:     { label: 'Deep Forest', dark: '#588157', light: '#2d4a2d' },
    }
  },
  neon: {
    id: 'neon',
    label: 'Cyber & Neon',
    accents: {
      neonGreen:  { label: 'Neon Green', dark: '#39ff14', light: '#15803d' },
      laserPink:  { label: 'Laser Pink', dark: '#ff007f', light: '#be123c' },
      cyberCyan:  { label: 'Cyber Cyan', dark: '#00f0ff', light: '#0369a1' },
      neonAmber:  { label: 'Neon Amber', dark: '#ffb703', light: '#b45309' },
      neonViolet: { label: 'Electric Violet', dark: '#bf00ff', light: '#6b21a8' },
    }
  },
  minimal: {
    id: 'minimal',
    label: 'Monochrome',
    accents: {
      graphite:   { label: 'Graphite', dark: '#888888', light: '#444444' },
      silver:     { label: 'Cool Silver', dark: '#b0b0b0', light: '#555555' },
      charcoal:   { label: 'Charcoal', dark: '#666666', light: '#222222' },
      pearl:      { label: 'Pearl White', dark: '#d0d0d0', light: '#666666' },
    }
  }
};

export const ACCENTS = Object.values(PALETTES).reduce((acc, pal) => {
  return { ...acc, ...pal.accents };
}, {});

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
    this.selectedPalette = 'pastel';
    this.customColors = {};
  }

  async onActivate() {
    await this.loadSettings();
    if (this.element) this.bindEvents();
  }

  onDeactivate() {
    // Handled by live preview
  }

  async loadSettings() {
    try {
      const apiTheme = await window.themeAPI?.getTheme?.();
      const settingsTheme = await window.settingsAPI?.get?.('theme');
      this.currentTheme = apiTheme || settingsTheme || window.themeControls?.getTheme() || 'theme-dark';

      const settingsAccent = await window.settingsAPI?.get?.('accent');
      this.currentAccent = settingsAccent || window.themeControls?.getAccent() || 'blue';

      // Find which palette contains the active accent
      for (const [palKey, pal] of Object.entries(PALETTES)) {
        if (pal.accents[this.currentAccent]) {
          this.selectedPalette = palKey;
          break;
        }
      }

      this.customColors = {};
      const savedCustom = (await window.themeAPI?.getCustomColors?.()) || (await window.settingsAPI?.get?.('customColors'));
      if (savedCustom && typeof savedCustom === 'object') {
        this.customColors = { ...savedCustom };
      } else {
        for (const { key } of CUSTOM_COLOR_KEYS) {
          const value = getComputedStyle(document.documentElement).getPropertyValue(key).trim();
          if (value) this.customColors[key] = value;
        }
      }
    } catch (e) {
      console.warn('Failed to load appearance settings:', e);
    }

    if (this.element) {
      const themeRadios = this.element.querySelectorAll('input[name="theme"]');
      themeRadios.forEach(r => r.checked = r.value === this.currentTheme);

      this.renderAccentSwatches();
      this.renderCustomColorInputs();
      this.updateCustomSectionVisibility();
    }
  }

  renderAccentSwatches() {
    const container = this.element?.querySelector('#accent-options');
    if (!container) return;

    let accentsToRender = {};
    if (this.selectedPalette === 'all') {
      accentsToRender = ACCENTS;
    } else if (PALETTES[this.selectedPalette]) {
      accentsToRender = PALETTES[this.selectedPalette].accents;
    } else {
      accentsToRender = PALETTES.pastel.accents;
    }

    const isLight = this.currentTheme === 'theme-light' || this.currentTheme === 'theme-sepia';
    container.innerHTML = Object.keys(accentsToRender).map(key => {
      const color = accentsToRender[key][isLight ? 'light' : 'dark'] || accentsToRender[key].dark;
      const label = accentsToRender[key].label || key;
      const isActive = key === this.currentAccent;
      return `
        <button type="button" class="accent-opt ${isActive ? 'active' : ''}" data-accent="${key}" style="--c:${color}" title="${label}"></button>
      `;
    }).join('');

    // Rebind swatch click handlers
    container.querySelectorAll('.accent-opt').forEach(btn => {
      btn.addEventListener('click', async () => {
        this.currentAccent = btn.dataset.accent;
        await this.saveAccent();
        this.updateAccentSelection();
      });
    });

    // Update palette tab buttons active state
    this.element?.querySelectorAll('.palette-cat-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.palette === this.selectedPalette);
    });
  }

  bindEvents() {
    // Theme radios
    const themeRadios = this.element.querySelectorAll('input[name="theme"]');
    themeRadios.forEach(radio => {
      radio.addEventListener('change', async () => {
        this.currentTheme = radio.value;
        await this.saveTheme();
        this.renderAccentSwatches();
        this.updateCustomSectionVisibility();
      });
    });

    // Palette category filters
    const catBtns = this.element.querySelectorAll('.palette-cat-btn');
    catBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        this.selectedPalette = btn.dataset.palette;
        this.renderAccentSwatches();
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

    // Restore to Defaults button
    const restoreBtn = this.element.querySelector('#btn-restore-appearance');
    restoreBtn?.addEventListener('click', async () => {
      await this.restoreDefaults();
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

    this.renderAccentSwatches();
    this.updateCustomSectionVisibility();
  }

  async restoreDefaults() {
    this.currentTheme = 'theme-dark';
    this.currentAccent = 'blue';
    this.selectedPalette = 'pastel';

    this.customColors = {
      '--fm-bg': '#1a1a1a',
      '--fm-text': '#d4d4d4',
      '--fm-accent': '#7cb8f0',
      '--fm-border': '#2a2a2a',
    };

    // Apply via themeControls
    window.themeControls?.setTheme('theme-dark');
    window.themeControls?.setAccent('blue');
    for (const [key, value] of Object.entries(this.customColors)) {
      window.themeControls?.applyCustomColor(key, value);
    }

    // Persist via settingsAPI
    await this.saveTheme();
    await this.saveAccent();
    await this.saveCustomColors();
    await this.saveSetting('fontSize', 17);
    await this.saveSetting('lineHeight', 1.9);
    await this.saveSetting('editorWidth', 720);

    // Update UI elements
    if (this.element) {
      const themeRadios = this.element.querySelectorAll('input[name="theme"]');
      themeRadios.forEach(r => r.checked = r.value === 'theme-dark');

      const fontSize = this.element.querySelector('#setting-font-size');
      const fontSizeVal = this.element.querySelector('#font-size-value');
      if (fontSize) fontSize.value = '17';
      if (fontSizeVal) fontSizeVal.textContent = '17px';

      const lineHeight = this.element.querySelector('#setting-line-height');
      const lineHeightVal = this.element.querySelector('#line-height-value');
      if (lineHeight) lineHeight.value = '1.9';
      if (lineHeightVal) lineHeightVal.textContent = '1.9';

      const editorWidth = this.element.querySelector('#setting-editor-width');
      const editorWidthVal = this.element.querySelector('#editor-width-value');
      if (editorWidth) editorWidth.value = '720';
      if (editorWidthVal) editorWidthVal.textContent = '720px';

      this.renderAccentSwatches();
      this.renderCustomColorInputs();
      this.updateCustomSectionVisibility();
    }
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
          <div class="palette-categories">
            <button type="button" class="palette-cat-btn ${this.selectedPalette === 'pastel' ? 'active' : ''}" data-palette="pastel">Pastel</button>
            <button type="button" class="palette-cat-btn ${this.selectedPalette === 'vibrant' ? 'active' : ''}" data-palette="vibrant">Vibrant</button>
            <button type="button" class="palette-cat-btn ${this.selectedPalette === 'earth' ? 'active' : ''}" data-palette="earth">Earth & Warm</button>
            <button type="button" class="palette-cat-btn ${this.selectedPalette === 'neon' ? 'active' : ''}" data-palette="neon">Cyber & Neon</button>
            <button type="button" class="palette-cat-btn ${this.selectedPalette === 'minimal' ? 'active' : ''}" data-palette="minimal">Monochrome</button>
            <button type="button" class="palette-cat-btn ${this.selectedPalette === 'all' ? 'active' : ''}" data-palette="all">All</button>
          </div>
          <div id="accent-options" class="accent-options-grid"></div>
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
        <div class="settings-restore-row">
          <span style="font-size: 12.5px; color: var(--muted);">Reset appearance preferences back to default</span>
          <button type="button" class="restore-defaults-btn" id="btn-restore-appearance">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>
            <span>Restore Defaults</span>
          </button>
        </div>
      </div>
    `;
    return this.element;
  }
}

export const appearanceTab = new AppearanceTab();
export default appearanceTab;

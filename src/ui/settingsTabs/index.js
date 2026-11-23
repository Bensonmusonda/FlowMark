/**
 * Settings Tabs Registry and Base Class
 * Provides a consistent interface for all settings tabs
 */

export class SettingsTab {
  constructor(options = {}) {
    this.id = options.id || '';
    this.label = options.label || '';
    this.icon = options.icon || null;
    // Provide component property for registration compatibility
    this.component = () => this.render();
  }

  /**
   * Render the tab content. Override in subclasses.
   * @returns {HTMLElement|string} The tab content
   */
  render() {
    return `<div class="settings-tab-placeholder">${this.label} tab content</div>`;
  }

  /**
   * Called when the tab is activated. Override for initialization logic.
   */
  onActivate() {}

  /**
   * Called when the tab is deactivated. Override for cleanup logic.
   */
  onDeactivate() {}

  /**
   * Get the tab configuration for registration
   */
  getConfig() {
    return {
      id: this.id,
      label: this.label,
      icon: this.icon,
      component: this.component,
      onActivate: () => this.onActivate(),
      onDeactivate: () => this.onDeactivate()
    };
  }
}

/**
 * Tab registry - manages all registered settings tabs
 */
export class SettingsTabRegistry {
  constructor() {
    this.tabs = [];
  }

  register(tab) {
    const config = tab instanceof SettingsTab ? tab.getConfig() : tab;
    if (!config.id || !config.label || !config.component) {
      console.warn('Invalid tab config:', config);
      return false;
    }
    // Replace if exists
    const index = this.tabs.findIndex(t => t.id === config.id);
    if (index >= 0) {
      this.tabs[index] = config;
    } else {
      this.tabs.push(config);
    }
    return true;
  }

  unregister(tabId) {
    const index = this.tabs.findIndex(t => t.id === tabId);
    if (index >= 0) {
      this.tabs.splice(index, 1);
      return true;
    }
    return false;
  }

  get(tabId) {
    return this.tabs.find(t => t.id === tabId);
  }

  getAll() {
    return [...this.tabs];
  }

  getOrderedIds() {
    return this.tabs.map(t => t.id);
  }
}

// Default export - singleton registry
export const settingsTabRegistry = new SettingsTabRegistry();

/**
 * Helper to create a simple settings tab from a render function
 */
export function createSettingsTab(id, label, icon, renderFn) {
  return {
    id,
    label,
    icon,
    component: renderFn
  };
}

export default {
  SettingsTab,
  SettingsTabRegistry,
  settingsTabRegistry,
  createSettingsTab
};
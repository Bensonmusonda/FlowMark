import { SettingsTab } from './index.js';
import { Plug } from 'lucide';
import { PluginManagerPanel } from '../plugins-panel.js';

export class PluginsTab extends SettingsTab {
  constructor() {
    super({
      id: 'plugins',
      label: 'Plugins',
      icon: Plug,
    });
    this.element = null;
    this.panelInstance = null;
  }

  render() {
    this.element = document.createElement('div');
    this.element.className = 'settings-tab-content settings-tab-plugins';
    this.element.innerHTML = `
      <div id="settings-plugins-container">
        <div id="plugins-box"></div>
      </div>
    `;

    const container = this.element.querySelector('#settings-plugins-container');
    this.panelInstance = new PluginManagerPanel({
      container,
      pluginManager: window.pluginManager,
      showConfirm: window.showConfirm,
      embedded: true,
    });

    return this.element;
  }

  async onActivate() {
    if (this.panelInstance) {
      await this.panelInstance.open();
    }
  }

  onDeactivate() {
    if (this.panelInstance) {
      this.panelInstance.close();
    }
  }
}

export const pluginsTab = new PluginsTab();
export default pluginsTab;
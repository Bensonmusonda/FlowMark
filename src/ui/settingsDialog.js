import { createElement, Settings, X, ChevronRight } from 'lucide';

export class SettingsDialog {
  constructor() {
    this.tabs = [];
    this.activeTabId = null;
    this.element = null;
    this.previousFocus = null;
    this.boundHandleKeyDown = this.handleKeyDown.bind(this);
    this.boundHandleClickOutside = this.handleClickOutside.bind(this);
    this.render();
  }

  registerTab(tab) {
    if (!tab?.id || !tab?.label || !tab?.component) {
      console.warn('Invalid tab registration:', tab);
      return false;
    }
    this.tabs.push(tab);
    this.renderTabList();
    this.renderContentPane();
    return true;
  }

  open() {
    this.previousFocus = document.activeElement;
    document.body.classList.add('settings-dialog-open');
    this.element.classList.remove('hidden');
    this.element.setAttribute('aria-hidden', 'false');
    if (!this.activeTabId && this.tabs.length > 0) {
      this.activeTabId = this.tabs[0].id;
    }
    this.renderTabList();
    this.renderContentPane();
    const activeTab = this.tabs.find(t => t.id === this.activeTabId);
    if (activeTab && typeof activeTab.onActivate === 'function') {
      try { activeTab.onActivate(); } catch (err) { console.error(err); }
    }
    this.trapFocus();
    this.focusFirstTab();
    document.addEventListener('keydown', this.boundHandleKeyDown);
    document.addEventListener('mousedown', this.boundHandleClickOutside);
    window.dispatchEvent(new CustomEvent('settings:open'));
  }

  close() {
    const activeTab = this.tabs.find(t => t.id === this.activeTabId);
    if (activeTab && typeof activeTab.onDeactivate === 'function') {
      try { activeTab.onDeactivate(); } catch (err) { console.error(err); }
    }
    document.body.classList.remove('settings-dialog-open');
    this.element.classList.add('hidden');
    this.element.setAttribute('aria-hidden', 'true');
    this.restoreFocus();
    document.removeEventListener('keydown', this.boundHandleKeyDown);
    document.removeEventListener('mousedown', this.boundHandleClickOutside);
    window.dispatchEvent(new CustomEvent('settings:close'));
  }

  isOpen() {
    return !this.element.classList.contains('hidden');
  }

  activateTab(tabId) {
    if (this.activeTabId === tabId) return true;
    const prevTab = this.tabs.find(t => t.id === this.activeTabId);
    if (prevTab && typeof prevTab.onDeactivate === 'function') {
      try { prevTab.onDeactivate(); } catch (err) { console.error(err); }
    }
    const tab = this.tabs.find(t => t.id === tabId);
    if (!tab) return false;
    this.activeTabId = tabId;
    this.renderTabList();
    this.renderContentPane();
    if (typeof tab.onActivate === 'function') {
      try { tab.onActivate(); } catch (err) { console.error(err); }
    }
    this.focusTabButton(tabId);
    return true;
  }

  render() {
    this.element = document.createElement('div');
    this.element.id = 'settings-dialog';
    this.element.className = 'settings-dialog hidden';
    this.element.setAttribute('role', 'dialog');
    this.element.setAttribute('aria-modal', 'true');
    this.element.setAttribute('aria-labelledby', 'settings-dialog-title');
    this.element.setAttribute('aria-hidden', 'true');
    this.element.innerHTML = `
      <div class="settings-dialog-backdrop" tabindex="-1"></div>
      <div class="settings-dialog-window">
        <header class="settings-dialog-header">
          <h2 id="settings-dialog-title">Settings</h2>
          <button type="button" class="settings-dialog-close" aria-label="Close settings">
            ${createElement(X, { width: 18, height: 18, 'aria-hidden': 'true', class: 'line-icon' }).outerHTML}
          </button>
        </header>
        <div class="settings-dialog-body">
          <nav class="settings-dialog-tabs" role="tablist" aria-label="Settings categories">
            <!-- Tab buttons rendered here -->
          </nav>
          <div class="settings-dialog-content" role="tabpanel">
            <!-- Tab content rendered here -->
          </div>
        </div>
        <footer class="settings-dialog-footer">
          <button type="button" class="settings-dialog-done">Done</button>
        </footer>
      </div>
    `;

    // Event listeners
    this.element.querySelector('.settings-dialog-close').addEventListener('click', () => this.close());
    this.element.querySelector('.settings-dialog-done').addEventListener('click', () => this.close());
    this.element.querySelector('.settings-dialog-backdrop').addEventListener('click', () => this.close());

    document.body.appendChild(this.element);
  }

  renderTabList() {
    const tabsNav = this.element.querySelector('.settings-dialog-tabs');
    if (!tabsNav) return;

    tabsNav.innerHTML = '';
    for (const tab of this.tabs) {
      const button = document.createElement('button');
      button.type = 'button';
      button.role = 'tab';
      button.id = `settings-tab-${tab.id}`;
      button.dataset.tabId = tab.id;
      button.className = `settings-tab-button ${this.activeTabId === tab.id ? 'active' : ''}`;
      button.setAttribute('aria-selected', this.activeTabId === tab.id ? 'true' : 'false');
      button.setAttribute('aria-controls', `settings-panel-${tab.id}`);
      button.title = tab.label;

      const iconEl = typeof tab.icon === 'string'
        ? tab.icon
        : createElement(tab.icon, { width: 18, height: 18, 'aria-hidden': 'true', class: 'line-icon' }).outerHTML;

      button.innerHTML = `${iconEl}<span class="settings-tab-label">${tab.label}</span>`;
      button.addEventListener('click', () => this.activateTab(tab.id));
      tabsNav.appendChild(button);
    }

    // Set first tab as active if none selected
    if (!this.activeTabId && this.tabs.length > 0) {
      this.activeTabId = this.tabs[0].id;
      this.renderTabList();
      this.renderContentPane();
    }
  }

  renderContentPane() {
    const contentEl = this.element.querySelector('.settings-dialog-content');
    if (!contentEl) return;

    const activeTab = this.tabs.find(t => t.id === this.activeTabId);
    if (!activeTab) {
      contentEl.innerHTML = '<div class="settings-placeholder">Select a tab</div>';
      return;
    }

    contentEl.innerHTML = '';
    contentEl.setAttribute('aria-labelledby', `settings-tab-${this.activeTabId}`);
    contentEl.id = `settings-panel-${this.activeTabId}`;
    contentEl.setAttribute('role', 'tabpanel');

    try {
      const component = typeof activeTab.component === 'function'
        ? activeTab.component()
        : activeTab.component;
      if (component instanceof HTMLElement) {
        contentEl.appendChild(component);
      } else if (typeof component === 'string') {
        contentEl.innerHTML = component;
      }
    } catch (err) {
      console.error(`Failed to render tab ${this.activeTabId}:`, err);
      contentEl.innerHTML = '<div class="settings-error">Failed to load tab content</div>';
    }
  }

  focusFirstTab() {
    const firstTab = this.element.querySelector('.settings-tab-button');
    firstTab?.focus();
  }

  focusTabButton(tabId) {
    const button = this.element.querySelector(`[data-tab-id="${tabId}"]`);
    button?.focus();
  }

  trapFocus() {
    const focusableElements = this.element.querySelectorAll(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    const firstElement = focusableElements[0];
    const lastElement = focusableElements[focusableElements.length - 1];

    this.element._focusTrap = (e) => {
      if (e.key !== 'Tab') return;
      if (e.shiftKey) {
        if (document.activeElement === firstElement) {
          e.preventDefault();
          lastElement.focus();
        }
      } else {
        if (document.activeElement === lastElement) {
          e.preventDefault();
          firstElement.focus();
        }
      }
    };
    this.element.addEventListener('keydown', this.element._focusTrap);
  }

  restoreFocus() {
    if (this.element._focusTrap) {
      this.element.removeEventListener('keydown', this.element._focusTrap);
      this.element._focusTrap = null;
    }
    if (this.previousFocus && typeof this.previousFocus.focus === 'function') {
      this.previousFocus.focus();
    }
  }

  handleKeyDown(event) {
    if (event.key === 'Escape') {
      event.preventDefault();
      this.close();
    }
  }

  handleClickOutside(event) {
    const dialogWin = this.element.querySelector('.settings-dialog-window');
    if (dialogWin && !dialogWin.contains(event.target)) {
      this.close();
    }
  }

  destroy() {
    this.close();
    this.element?.remove();
    this.element = null;
  }
}

export default SettingsDialog;
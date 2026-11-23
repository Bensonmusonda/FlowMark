import { createElement, PanelRight, X } from 'lucide';
import { resolvePluginPanelIcon } from './pluginPanelIcons.js';

export function clampUtilityPaneWidth(width) {
  return Math.max(220, Math.min(520, Number(width) || 320));
}

export class UtilityPane {
  constructor({ pane, splitter, activityBar, onWidthChange }) {
    this.pane = pane;
    this.splitter = splitter;
    this.activityBar = activityBar;
    this.onWidthChange = onWidthChange;
    this.width = 320;
    this.activeId = null;
    this.panels = new Map();
    this.bind();
    this.renderActivities();
  }

  bind() {
    const closeButton = this.pane.querySelector('[data-utility-close]');
    if (closeButton) {
      closeButton.replaceChildren(createElement(X, {
        width: 16,
        height: 16,
        'aria-hidden': 'true',
        'focusable': 'false',
        class: 'line-icon',
      }));
    }
    this.splitter.addEventListener('pointerdown', (event) => {
      if (document.body.classList.contains('zen')) return;
      event.preventDefault();
      this.splitter.setPointerCapture(event.pointerId);
      const move = (moveEvent) => {
        const layout = document.getElementById('workspace-layout').getBoundingClientRect();
        this.resize(layout.right - moveEvent.clientX);
      };
      const finish = () => {
        this.splitter.removeEventListener('pointermove', move);
        this.splitter.removeEventListener('pointerup', finish);
        this.splitter.removeEventListener('pointercancel', finish);
      };
      this.splitter.addEventListener('pointermove', move);
      this.splitter.addEventListener('pointerup', finish, { once: true });
      this.splitter.addEventListener('pointercancel', finish, { once: true });
    });

    this.splitter.addEventListener('keydown', (event) => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      event.preventDefault();
      this.resize(this.width + (event.key === 'ArrowLeft' ? 16 : -16));
    });

    this.pane.querySelector('[data-utility-close]')?.addEventListener('click', () => this.close());
    this.activityBar?.addEventListener('click', (event) => {
      const button = event.target.closest('[data-utility-id]');
      if (!button) return;
      const id = button.dataset.utilityId || null;
      if (!id && this.activeId === null && !this.pane.hidden) this.close();
      else this.activate(id);
    });
  }

  resize(width) {
    this.width = clampUtilityPaneWidth(width);
    this.pane.style.width = `${this.width}px`;
    this.pane.style.flexBasis = `${this.width}px`;
    this.onWidthChange?.(this.width);
  }

  registerPanel(panel) {
    if (!panel?.id) return false;
    this.panels.set(panel.instanceId || panel.id, panel);
    this.renderActivities();
    return true;
  }

  unregisterPanel(pluginId, panelIds = []) {
    for (const [id, panel] of this.panels) {
      if (panel.pluginId === pluginId && (!panelIds.length || panelIds.includes(panel.id))) {
        this.panels.delete(id);
      }
    }
    if (this.activeId && !this.panels.has(this.activeId)) this.close();
    this.renderActivities();
  }

  activate(panelId = null) {
    if (panelId && !this.panels.has(panelId)) {
      panelId = null;
    }
    this.activeId = panelId;
    this.pane.hidden = false;
    this.splitter.hidden = false;
    document.body.classList.add('utility-pane-open');
    this.pane.dataset.activeId = panelId || '';
    this.render();
    this.renderActivities();
  }

  close() {
    if (this.pane.contains(document.activeElement)) {
      this.activityBar?.querySelector('.utility-activity-button')?.focus();
    }
    this.pane.hidden = true;
    this.splitter.hidden = true;
    document.body.classList.remove('utility-pane-open');
    delete this.pane.dataset.activeId;
    this.activeId = null;
    this.renderActivities();
  }

  renderActivities() {
    if (!this.activityBar) return;
    this.activityBar.replaceChildren();
    const addButton = (id, title, icon) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'utility-activity-button';
      button.dataset.utilityId = id || '';
      button.title = title;
      button.setAttribute('aria-label', title);
      button.setAttribute('aria-pressed', !this.pane.hidden && this.activeId === id ? 'true' : 'false');
      button.appendChild(createElement(icon, {
        width: 18,
        height: 18,
        'aria-hidden': 'true',
        'focusable': 'false',
        class: 'line-icon',
      }));
      this.activityBar.appendChild(button);
    };
    addButton(null, 'Utility pane', PanelRight);
    for (const panel of this.panels.values()) {
      addButton(panel.instanceId || panel.id, panel.title, resolvePluginPanelIcon(panel.icon));
    }
  }

  render() {
    const title = this.pane.querySelector('[data-utility-title]');
    const content = this.pane.querySelector('[data-utility-content]');
    const panel = this.activeId ? this.panels.get(this.activeId) : null;
    title.textContent = panel?.title || 'Utility';
    content.replaceChildren();

    if (panel?.entryUrl) {
      const frame = document.createElement('iframe');
      frame.className = 'utility-plugin-frame';
      frame.title = panel.title;
      frame.sandbox = 'allow-scripts';
      frame.src = panel.entryUrl;
      content.appendChild(frame);
      return;
    }

    const placeholder = document.createElement('div');
    placeholder.className = 'utility-pane-placeholder';
    placeholder.textContent = 'No plugin or core view owns this panel.';
    content.appendChild(placeholder);
  }
}

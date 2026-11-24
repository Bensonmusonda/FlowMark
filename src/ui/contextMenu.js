/**
 * Unified Context Menu Service for FlowMark.
 * Provides accessible, viewport-clamped HTML context menus styled
 * to match FlowMark's active theme, typography, and accent colors.
 */
export class ContextMenuService {
  constructor() {
    this.activeMenu = null;
    this.dismissListener = null;
    this.keyListener = null;
    this.pluginItems = new Map(); // target -> Set of items
  }

  /**
   * Register a custom item for a context menu target (used by plugins/extensions).
   * @param {string} target - 'editor' | 'tab' | 'file-tree:file' | 'file-tree:folder' | 'file-tree:empty'
   * @param {Object} item
   * @returns {Function} Unregister callback
   */
  registerItem(target, item) {
    if (!this.pluginItems.has(target)) {
      this.pluginItems.set(target, new Set());
    }
    this.pluginItems.get(target).add(item);
    return () => this.pluginItems.get(target)?.delete(item);
  }

  /**
   * Show a context menu at (x, y) with the provided items.
   * @param {Object} options
   * @param {number} options.x - Click clientX
   * @param {number} options.y - Click clientY
   * @param {Array<Object>} options.items - Menu items definition
   * @param {string} [options.target] - Target identifier to query registered plugin items
   * @param {*} [options.contextData] - Context data passed into item action/disabled/hidden callbacks
   */
  show({ x, y, items = [], target = null, contextData = null }) {
    this.close();

    const allItems = [...items];
    if (target && this.pluginItems.has(target)) {
      const extra = Array.from(this.pluginItems.get(target));
      if (extra.length > 0) {
        allItems.push({ divider: true });
        allItems.push(...extra);
      }
    }

    // Filter hidden items
    const visibleItems = allItems.filter(item => {
      if (!item) return false;
      if (item.divider) return true;
      if (typeof item.hidden === 'function') return !item.hidden(contextData);
      return !item.hidden;
    });

    if (visibleItems.length === 0) return;

    const menu = document.createElement('div');
    menu.className = 'fm-context-menu';
    menu.setAttribute('role', 'menu');
    menu.tabIndex = -1;

    visibleItems.forEach((item) => {
      if (item.divider) {
        const div = document.createElement('div');
        div.className = 'fm-context-divider';
        div.setAttribute('role', 'separator');
        menu.appendChild(div);
        return;
      }

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `fm-context-item${item.danger ? ' danger' : ''}`;
      btn.setAttribute('role', 'menuitem');

      const isDisabled = typeof item.disabled === 'function' ? item.disabled(contextData) : !!item.disabled;
      if (isDisabled) {
        btn.disabled = true;
      }

      const left = document.createElement('div');
      left.className = 'fm-context-item-left';

      if (item.icon) {
        const iconSpan = document.createElement('span');
        iconSpan.className = 'fm-context-icon';
        if (typeof item.icon === 'string') {
          iconSpan.innerHTML = item.icon;
        } else if (item.icon instanceof HTMLElement || item.icon instanceof SVGElement) {
          iconSpan.appendChild(item.icon.cloneNode(true));
        }
        left.appendChild(iconSpan);
      }

      const label = document.createElement('span');
      label.className = 'fm-context-label';
      label.textContent = item.label;
      left.appendChild(label);
      btn.appendChild(left);

      if (item.shortcut) {
        const shortcut = document.createElement('span');
        shortcut.className = 'fm-context-shortcut';
        shortcut.textContent = item.shortcut;
        btn.appendChild(shortcut);
      }

      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        this.close();
        try {
          await item.action?.(contextData);
        } catch (err) {
          console.error('[ContextMenu] Action error:', err);
        }
      });

      menu.appendChild(btn);
    });

    document.body.appendChild(menu);
    this.activeMenu = menu;

    // Viewport boundary collision detection
    const menuRect = menu.getBoundingClientRect();
    const maxX = window.innerWidth - menuRect.width - 8;
    const maxY = window.innerHeight - menuRect.height - 8;
    const posX = Math.max(8, Math.min(x, maxX));
    const posY = Math.max(8, Math.min(y, maxY));

    menu.style.left = `${posX}px`;
    menu.style.top = `${posY}px`;

    // Keyboard navigation
    this.keyListener = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        this.close();
        return;
      }

      const buttons = Array.from(menu.querySelectorAll('.fm-context-item:not(:disabled)'));
      if (buttons.length === 0) return;

      const activeIndex = buttons.indexOf(document.activeElement);
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        const next = activeIndex < buttons.length - 1 ? activeIndex + 1 : 0;
        buttons[next]?.focus();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        const prev = activeIndex > 0 ? activeIndex - 1 : buttons.length - 1;
        buttons[prev]?.focus();
      }
    };
    document.addEventListener('keydown', this.keyListener);

    // Dismissal listeners
    this.dismissListener = (e) => {
      if (this.activeMenu && !this.activeMenu.contains(e.target)) {
        this.close();
      }
    };
    setTimeout(() => {
      document.addEventListener('mousedown', this.dismissListener, true);
      document.addEventListener('contextmenu', this.dismissListener, true);
      window.addEventListener('blur', this.close);
      window.addEventListener('resize', this.close);
    }, 0);
  }

  close = () => {
    if (this.dismissListener) {
      document.removeEventListener('mousedown', this.dismissListener, true);
      document.removeEventListener('contextmenu', this.dismissListener, true);
      window.removeEventListener('blur', this.close);
      window.removeEventListener('resize', this.close);
      this.dismissListener = null;
    }
    if (this.keyListener) {
      document.removeEventListener('keydown', this.keyListener);
      this.keyListener = null;
    }
    if (this.activeMenu) {
      this.activeMenu.remove();
      this.activeMenu = null;
    }
  };
}

export const contextMenu = new ContextMenuService();
export default contextMenu;

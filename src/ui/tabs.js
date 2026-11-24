/**
 * Tabs UI component for FlowMark.
 * Handles rendering the tab strip, drag-to-reorder, and tab action events.
 */

import { contextMenu } from './contextMenu.js';

export class TabBarUI {
  /**
   * @param {Object} options
   * @param {HTMLElement} options.container - Tab bar DOM container
   * @param {import('../model/document.js').TabManager} options.tabManager
   * @param {Function} options.onSelect - (docId) => void
   * @param {Function} options.onClose - (docId) => void
   * @param {Function} [options.onCloseOthers] - (docId) => void
   * @param {Function} [options.onCloseToRight] - (docId) => void
   * @param {Function} [options.onCloseSaved] - () => void
   * @param {Function} options.onNewTab - () => void
   * @param {Function} [options.getWorkspacePath] - () => string|null
   */
  constructor({ container, tabManager, onSelect, onClose, onCloseOthers, onCloseToRight, onCloseSaved, onNewTab, getWorkspacePath }) {
    this.container = container;
    this.tabManager = tabManager;
    this.onSelect = onSelect;
    this.onClose = onClose;
    this.onCloseOthers = onCloseOthers;
    this.onCloseToRight = onCloseToRight;
    this.onCloseSaved = onCloseSaved;
    this.onNewTab = onNewTab;
    this.getWorkspacePath = getWorkspacePath;

    this.draggedIndex = null;

    if (this.container) {
      this.container.addEventListener('wheel', (e) => {
        if (e.deltaY !== 0) {
          e.preventDefault();
          this.container.scrollLeft += e.deltaY;
        }
      }, { passive: false });
    }

    this.tabManager.onChange(() => this.render());
    this.render();
  }

  showTabContextMenu(doc, index, e) {
    let relPath = null;
    const wsPath = this.getWorkspacePath ? this.getWorkspacePath() : null;
    if (doc.path && wsPath) {
      const normDoc = doc.path.replace(/\\/g, '/').toLowerCase();
      const normWs = wsPath.replace(/\\/g, '/').toLowerCase().replace(/\/+$/, '');
      if (normDoc.startsWith(normWs + '/')) {
        relPath = doc.path.slice(wsPath.length).replace(/^[\\/]+/, '');
      }
    }

    const items = [
      {
        label: 'Close Tab',
        shortcut: 'Ctrl+W',
        action: () => this.onClose(doc.id),
      },
      {
        label: 'Close Others',
        disabled: this.tabManager.documents.length <= 1,
        action: () => {
          if (this.onCloseOthers) this.onCloseOthers(doc.id);
          else this.tabManager.removeOthers(doc.id);
        },
      },
      {
        label: 'Close to the Right',
        disabled: index >= this.tabManager.documents.length - 1,
        action: () => {
          if (this.onCloseToRight) this.onCloseToRight(doc.id);
          else this.tabManager.removeToRight(doc.id);
        },
      },
      {
        label: 'Close Saved',
        disabled: !this.tabManager.documents.some(d => !d.dirty),
        action: () => {
          if (this.onCloseSaved) this.onCloseSaved();
          else this.tabManager.removeSaved();
        },
      },
      { divider: true },
      {
        label: 'Copy Path',
        disabled: !doc.path,
        action: () => {
          if (doc.path) navigator.clipboard.writeText(doc.path);
        },
      },
      {
        label: 'Copy Relative Path',
        disabled: !relPath,
        action: () => {
          if (relPath) navigator.clipboard.writeText(relPath);
        },
      },
      {
        label: 'Reveal in File Explorer',
        disabled: !doc.path,
        action: () => {
          if (doc.path) window.shellAPI?.showItemInFolder?.(doc.path);
        },
      },
    ];

    contextMenu.show({
      x: e.clientX,
      y: e.clientY,
      items,
      target: 'tab',
      contextData: { doc, index },
    });
  }

  showBackgroundContextMenu(e) {
    const items = [
      {
        label: 'New Tab',
        shortcut: 'Ctrl+N',
        action: () => this.onNewTab(),
      },
      {
        label: 'Close Saved',
        disabled: !this.tabManager.documents.some(d => !d.dirty),
        action: () => {
          if (this.onCloseSaved) this.onCloseSaved();
          else this.tabManager.removeSaved();
        },
      },
    ];

    contextMenu.show({
      x: e.clientX,
      y: e.clientY,
      items,
      target: 'tabbar:empty',
    });
  }

  render() {
    this.container.innerHTML = '';

    const tabList = document.createElement('div');
    tabList.className = 'tab-strip';

    this.tabManager.documents.forEach((doc, index) => {
      const tabEl = document.createElement('div');
      tabEl.className = 'tab-item' + (doc.id === this.tabManager.activeId ? ' active' : '');
      tabEl.dataset.id = doc.id;
      tabEl.dataset.index = index;
      tabEl.draggable = true;

      // Drag and drop events for tab reordering
      tabEl.addEventListener('dragstart', (e) => {
        this.draggedIndex = index;
        tabEl.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
      });

      tabEl.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        tabEl.classList.add('drag-over');
      });

      tabEl.addEventListener('dragleave', () => {
        tabEl.classList.remove('drag-over');
      });

      tabEl.addEventListener('drop', (e) => {
        e.preventDefault();
        tabEl.classList.remove('drag-over');
        if (this.draggedIndex !== null && this.draggedIndex !== index) {
          this.tabManager.reorder(this.draggedIndex, index);
        }
      });

      tabEl.addEventListener('dragend', () => {
        tabEl.classList.remove('dragging');
        this.draggedIndex = null;
      });

      // Tab title
      const titleSpan = document.createElement('span');
      titleSpan.className = 'tab-title';
      titleSpan.textContent = doc.name;
      titleSpan.title = doc.path || doc.name;
      tabEl.appendChild(titleSpan);

      // Dirty indicator
      if (doc.dirty) {
        const dirtyDot = document.createElement('span');
        dirtyDot.className = 'tab-dirty';
        dirtyDot.textContent = '•';
        tabEl.appendChild(dirtyDot);
      }

      // Close button
      const closeBtn = document.createElement('button');
      closeBtn.className = 'tab-close';
      closeBtn.innerHTML = '&times;';
      closeBtn.title = 'Close Tab (Ctrl+W)';
      closeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.onClose(doc.id);
      });
      tabEl.appendChild(closeBtn);

      // Select tab
      tabEl.addEventListener('click', () => {
        this.onSelect(doc.id);
      });

      // Context menu
      tabEl.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.showTabContextMenu(doc, index, e);
      });

      tabList.appendChild(tabEl);
    });

    tabList.addEventListener('contextmenu', (e) => {
      if (e.target.closest('.tab-item')) return;
      e.preventDefault();
      this.showBackgroundContextMenu(e);
    });

    // Add "+" button for new tab
    const addTabBtn = document.createElement('button');
    addTabBtn.className = 'tab-new-btn';
    addTabBtn.innerHTML = '+';
    addTabBtn.title = 'New File (Ctrl+N)';
    addTabBtn.addEventListener('click', () => {
      this.onNewTab();
    });
    tabList.appendChild(addTabBtn);

    this.container.appendChild(tabList);

    // Ensure active tab is visible
    const activeEl = this.container.querySelector('.tab-item.active');
    if (activeEl) {
      activeEl.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
    }
  }
}

export default TabBarUI;

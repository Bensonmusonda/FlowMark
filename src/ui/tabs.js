/**
 * Tabs UI component for FlowMark.
 * Handles rendering the tab strip, drag-to-reorder, and tab action events.
 */

export class TabBarUI {
  /**
   * @param {Object} options
   * @param {HTMLElement} options.container - Tab bar DOM container
   * @param {import('../model/document.js').TabManager} options.tabManager
   * @param {Function} options.onSelect - (docId) => void
   * @param {Function} options.onClose - (docId) => void
   * @param {Function} options.onNewTab - () => void
   */
  constructor({ container, tabManager, onSelect, onClose, onNewTab }) {
    this.container = container;
    this.tabManager = tabManager;
    this.onSelect = onSelect;
    this.onClose = onClose;
    this.onNewTab = onNewTab;

    this.draggedIndex = null;

    this.tabManager.onChange(() => this.render());
    this.render();
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

      tabList.appendChild(tabEl);
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

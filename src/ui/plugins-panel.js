/**
 * Manage Plugins Panel UI component for FlowMark.
 * Centered modal overlay for managing, inspecting, configuring,
 * installing, and toggling plugins.
 */

import {
  createElement,
  Puzzle,
  Search,
  FolderPlus,
  RefreshCw,
  Trash2,
  ChevronRight,
  ArrowLeft,
  AlertTriangle,
  Settings,
  X,
  Folder,
  RotateCw,
  Check,
} from 'lucide';

/**
 * Creates an icon element using Lucide's createElement helper.
 * @param {Object} Icon
 * @param {Object} [props]
 * @returns {SVGElement}
 */
function createIcon(Icon, props = {}) {
  return createElement(Icon, {
    width: 16,
    height: 16,
    'aria-hidden': 'true',
    focusable: 'false',
    ...props,
  });
}

export class PluginManagerPanel {
  /**
   * @param {Object} options
   * @param {HTMLElement} options.container - Modal overlay container (#plugins-panel)
   * @param {Object} options.pluginManager - window.pluginManager API
   * @param {Function} [options.showConfirm] - (message, okLabel) => Promise<boolean>
   * @param {Function} [options.onClose] - () => void
   */
  constructor({ container, pluginManager, showConfirm, onClose }) {
    this.container = container;
    this.pluginManager = pluginManager;
    this.showConfirm = showConfirm;
    this.onClose = onClose;

    this.isOpen = false;
    this.plugins = [];
    this.settingsMap = new Map(); // pluginId -> { values, metadata }
    this.filter = 'all'; // 'all' | 'enabled' | 'disabled' | 'errors'
    this.searchQuery = '';
    this.selectedPluginId = null; // null = list view, string = detail view for that plugin
    this.inFlightActions = new Set();
    this.loading = true;
    this.recentlyInstalled = null;
    this.toast = null;
    this.toastTimeout = null;
    this.isDragging = false;
    this.previousActiveElement = null;
    this.unsubscribePluginsChanged = null;
    this.unsubscribeSettingsChanged = null;

    this.box = this.container.querySelector('#plugins-box');
    if (!this.box) {
      this.box = document.createElement('div');
      this.box.id = 'plugins-box';
      this.container.appendChild(this.box);
    }
    this.box.setAttribute('tabindex', '-1');

    this._bindOverlayEvents();
  }

  /**
   * Attach backdrop, keyboard trap, and drag-and-drop events to the container and modal box.
   * @private
   */
  _bindOverlayEvents() {
    this.container.addEventListener('click', (e) => {
      if (e.target === this.container) {
        this.close();
      }
    });

    this.container.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        if (this.selectedPluginId) {
          this.selectedPluginId = null;
          this.render();
        } else {
          this.close();
        }
        return;
      }

      // Trap focus within the dialog
      if (e.key === 'Tab') {
        const focusables = this.box.querySelectorAll(
          'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        );
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];

        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }

      // "/" or Ctrl+F to focus search input (only in list view)
      if (
        !this.selectedPluginId &&
        (e.key === '/' || ((e.ctrlKey || e.metaKey) && (e.key === 'f' || e.key === 'F')))
      ) {
        const tag = document.activeElement?.tagName?.toLowerCase();
        if (tag !== 'input' && tag !== 'textarea') {
          e.preventDefault();
          const searchInput = this.box.querySelector('.plugins-search-input');
          if (searchInput) {
            searchInput.focus();
            searchInput.select();
          }
        }
      }
    });

    // Drag and drop plugin folder
    this.container.addEventListener('dragenter', (e) => {
      e.preventDefault();
      this.isDragging = true;
      this.box.classList.add('drag-over');
      this._updateDropBanner();
    });

    this.container.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      if (!this.isDragging) {
        this.isDragging = true;
        this.box.classList.add('drag-over');
        this._updateDropBanner();
      }
    });

    this.container.addEventListener('dragleave', (e) => {
      if (e.target === this.container || !this.container.contains(e.relatedTarget)) {
        this.isDragging = false;
        this.box.classList.remove('drag-over');
        this._updateDropBanner();
      }
    });

    this.container.addEventListener('drop', (e) => {
      e.preventDefault();
      this.isDragging = false;
      this.box.classList.remove('drag-over');
      this._updateDropBanner();

      const files = e.dataTransfer?.files;
      if (files && files.length > 0) {
        const folderPath = files[0].path;
        if (folderPath) {
          this.installPluginFromPath(folderPath);
        }
      }
    });
  }

  /**
   * Open the plugins manager dialog.
   */
  async open() {
    if (this.isOpen) return;
    this.isOpen = true;
    this.selectedPluginId = null;
    this.previousActiveElement = document.activeElement;
    this.container.classList.remove('hidden');
    this.loading = true;

    // Render initial state
    this.render();

    // Subscribe to live plugin list changes
    if (this.pluginManager?.onPluginsChanged) {
      this.unsubscribePluginsChanged = this.pluginManager.onPluginsChanged(
        (updatedPlugins) => this.handlePluginsChanged(updatedPlugins)
      );
    }

    if (window.settingsAPI?.onChange) {
      this.unsubscribeSettingsChanged = window.settingsAPI.onChange(() => {
        this.loadSettings();
      });
    }

    await this.loadData();

    // Focus search input on open
    const searchInput = this.box.querySelector('.plugins-search-input');
    if (searchInput) {
      searchInput.focus();
    }
  }

  /**
   * Close the dialog and clean up subscriptions.
   */
  close() {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.selectedPluginId = null;
    this.container.classList.add('hidden');

    if (this.unsubscribePluginsChanged) {
      this.unsubscribePluginsChanged();
      this.unsubscribePluginsChanged = null;
    }
    if (this.unsubscribeSettingsChanged) {
      this.unsubscribeSettingsChanged();
      this.unsubscribeSettingsChanged = null;
    }
    if (this.toastTimeout) {
      clearTimeout(this.toastTimeout);
      this.toastTimeout = null;
    }

    if (this.previousActiveElement && typeof this.previousActiveElement.focus === 'function') {
      try {
        this.previousActiveElement.focus();
      } catch {
        // ignore if element is detached
      }
    }

    this.onClose?.();
  }

  /**
   * Load plugin list and their settings from main.
   */
  async loadData() {
    try {
      if (this.pluginManager?.getPlugins) {
        const plugins = await this.pluginManager.getPlugins();
        this.plugins = Array.isArray(plugins) ? plugins : [];
      }
      await this.loadSettings();
    } catch (err) {
      this.showToast(`Error loading plugins: ${err.message}`, 'error');
    } finally {
      this.loading = false;
      this.render();
    }
  }

  /**
   * Fetch all registered settings and metadata for plugins.
   */
  async loadSettings() {
    try {
      if (this.pluginManager?.getSettings) {
        const result = await this.pluginManager.getSettings();
        if (result && typeof result === 'object') {
          for (const [pluginId, data] of Object.entries(result)) {
            this.settingsMap.set(pluginId, data);
          }
        }
      }
    } catch (err) {
      console.warn('[PluginManagerPanel] Failed to load settings:', err);
    }
  }

  /**
   * Handler for plugins:changed broadcast from main.
   * @param {Array} updatedPlugins
   */
  handlePluginsChanged(updatedPlugins) {
    if (Array.isArray(updatedPlugins)) {
      this.plugins = updatedPlugins;
      this.render();
    }
  }

  /**
   * Show non-blocking inline feedback message.
   * @param {string} message
   * @param {'info'|'success'|'error'} [type]
   */
  showToast(message, type = 'info') {
    this.toast = { message, type };
    if (this.toastTimeout) clearTimeout(this.toastTimeout);
    this.toastTimeout = setTimeout(() => {
      this.toast = null;
      this._updateToast();
    }, 4500);
    this._updateToast();
  }

  /**
   * Install a plugin by picking a folder.
   */
  async installFromFolder() {
    try {
      if (!this.pluginManager?.installFromFolder) return;
      const result = await this.pluginManager.installFromFolder();
      if (result?.success) {
        this.recentlyInstalled = result.pluginId;
        this.showToast(`Plugin "${result.pluginId}" installed successfully!`, 'success');
        await this.loadData();
      } else if (result?.error) {
        this.showToast(`Install failed: ${result.error}`, 'error');
      }
    } catch (err) {
      this.showToast(`Install error: ${err.message}`, 'error');
    }
  }

  /**
   * Install a plugin from a specified directory path (used by drag-and-drop).
   * @param {string} sourcePath
   */
  async installPluginFromPath(sourcePath) {
    try {
      if (!this.pluginManager?.install) return;
      this.showToast('Installing plugin...', 'info');
      const result = await this.pluginManager.install(sourcePath);
      if (result?.success !== false) {
        const id = result?.pluginId || sourcePath.split(/[\\/]/).pop();
        this.recentlyInstalled = id;
        this.showToast(`Plugin "${id}" installed successfully!`, 'success');
        await this.loadData();
      } else {
        this.showToast(`Install failed: ${result?.error || 'Unknown error'}`, 'error');
      }
    } catch (err) {
      this.showToast(`Install error: ${err.message}`, 'error');
    }
  }

  /**
   * Toggle a plugin enabled/disabled with optimistic update and rollback on failure.
   * @param {Object} plugin
   * @param {boolean} enable
   */
  async togglePlugin(plugin, enable) {
    if (this.inFlightActions.has(plugin.name)) return;
    this.inFlightActions.add(plugin.name);

    const prevEnabled = plugin.enabled;
    const prevActive = plugin.active;
    const prevError = plugin.error;

    // Optimistic UI state
    plugin.enabled = enable;
    if (enable) {
      plugin.active = true;
      plugin.error = null;
    } else {
      plugin.active = false;
    }
    this._renderListContent();

    try {
      const res = enable
        ? await this.pluginManager.enable(plugin.name)
        : await this.pluginManager.disable(plugin.name);

      if (res && res.success === false) {
        // Rollback
        plugin.enabled = prevEnabled;
        plugin.active = prevActive;
        plugin.error = res.error || prevError;
        this.showToast(`Failed to ${enable ? 'enable' : 'disable'} ${plugin.name}: ${res.error}`, 'error');
      } else {
        this.showToast(`Plugin "${plugin.name}" ${enable ? 'enabled' : 'disabled'}.`, 'success');
        if (enable) {
          await this.loadSettings();
        }
      }
    } catch (err) {
      plugin.enabled = prevEnabled;
      plugin.active = prevActive;
      plugin.error = err.message;
      this.showToast(`Action failed: ${err.message}`, 'error');
    } finally {
      this.inFlightActions.delete(plugin.name);
      this._renderListContent();
    }
  }

  /**
   * Uninstall a plugin with confirmation.
   * @param {Object} plugin
   */
  async uninstallPlugin(plugin) {
    if (this.inFlightActions.has(plugin.name)) return;

    const message = `Are you sure you want to uninstall "${plugin.name}"? This will permanently remove its files from disk.`;
    const confirmed = this.showConfirm
      ? await this.showConfirm(message, 'Uninstall')
      : confirm(message);

    if (!confirmed) return;

    this.inFlightActions.add(plugin.name);
    this._renderListContent();

    try {
      const res = await this.pluginManager.uninstall(plugin.name);
      if (res && res.success === false) {
        this.showToast(`Failed to uninstall: ${res.error}`, 'error');
      } else {
        if (this.selectedPluginId === plugin.name) {
          this.selectedPluginId = null;
        }
        this.showToast(`Uninstalled "${plugin.name}".`, 'success');
        await this.loadData();
      }
    } catch (err) {
      this.showToast(`Uninstall error: ${err.message}`, 'error');
    } finally {
      this.inFlightActions.delete(plugin.name);
      this._renderListContent();
    }
  }

  /**
   * Enable all currently disabled plugins.
   */
  async enableAll() {
    const disabled = this.plugins.filter((p) => !p.enabled);
    if (disabled.length === 0) return;
    this.showToast(`Enabling ${disabled.length} plugin(s)...`, 'info');
    for (const p of disabled) {
      await this.togglePlugin(p, true);
    }
  }

  /**
   * Disable all currently enabled plugins.
   */
  async disableAll() {
    const enabled = this.plugins.filter((p) => p.enabled);
    if (enabled.length === 0) return;
    this.showToast(`Disabling ${enabled.length} plugin(s)...`, 'info');
    for (const p of enabled) {
      await this.togglePlugin(p, false);
    }
  }

  /**
   * Reload all plugins in sandbox host.
   */
  async reloadPlugins() {
    try {
      this.showToast('Reloading plugins...', 'info');
      const res = await this.pluginManager.reload();
      if (res && res.success === false) {
        this.showToast(`Reload failed: ${res.error}`, 'error');
      } else {
        this.showToast('Plugins reloaded successfully.', 'success');
        await this.loadData();
      }
    } catch (err) {
      this.showToast(`Reload error: ${err.message}`, 'error');
    }
  }

  /**
   * Open the plugins directory in native file explorer.
   */
  async openPluginsFolder() {
    try {
      if (this.pluginManager?.openPluginsFolder) {
        await this.pluginManager.openPluginsFolder();
      }
    } catch (err) {
      this.showToast(`Could not open folder: ${err.message}`, 'error');
    }
  }

  /**
   * Save a single setting change for a plugin.
   * @param {string} pluginId
   * @param {string} key
   * @param {*} value
   */
  async updateSetting(pluginId, key, value) {
    try {
      let data = this.settingsMap.get(pluginId);
      if (!data) {
        data = { values: {}, metadata: {} };
        this.settingsMap.set(pluginId, data);
      }
      data.values[key] = value;

      const res = await this.pluginManager.setSetting(pluginId, key, value);
      if (res && res.success === false) {
        this.showToast(`Setting failed: ${res.error}`, 'error');
      }
    } catch (err) {
      this.showToast(`Setting error: ${err.message}`, 'error');
    }
  }

  /**
   * Filter and sort plugins according to search query, filter segment, and errors.
   * Errored plugins sort to the top.
   * @returns {Array}
   */
  getFilteredPlugins() {
    const q = this.searchQuery.trim().toLowerCase();

    const filtered = this.plugins.filter((plugin) => {
      // Filter dropdown check
      if (this.filter === 'enabled' && !plugin.enabled) return false;
      if (this.filter === 'disabled' && plugin.enabled) return false;
      if (this.filter === 'errors' && !plugin.error) return false;

      // Search query check
      if (q) {
        const name = (plugin.name || '').toLowerCase();
        const desc = (plugin.description || '').toLowerCase();
        const author = (plugin.author || '').toLowerCase();
        if (!name.includes(q) && !desc.includes(q) && !author.includes(q)) {
          return false;
        }
      }
      return true;
    });

    // Errored plugins sort to top, followed by alphabetical order
    return filtered.sort((a, b) => {
      const aErr = !!a.error;
      const bErr = !!b.error;
      if (aErr && !bErr) return -1;
      if (!aErr && bErr) return 1;
      return (a.name || '').localeCompare(b.name || '');
    });
  }

  /**
   * Count plugins per status for filter dropdown options.
   */
  getCounts() {
    let total = this.plugins.length;
    let enabled = 0;
    let disabled = 0;
    let errors = 0;

    for (const p of this.plugins) {
      if (p.enabled) enabled++;
      else disabled++;
      if (p.error) errors++;
    }

    return { total, enabled, disabled, errors };
  }

  /**
   * Update the drag-and-drop indicator banner if present.
   * @private
   */
  _updateDropBanner() {
    let banner = this.box.querySelector('.plugins-drop-banner');
    if (this.isDragging) {
      if (!banner) {
        banner = document.createElement('div');
        banner.className = 'plugins-drop-banner';
        banner.appendChild(createIcon(FolderPlus, { width: 16, height: 16 }));
        const text = document.createElement('span');
        text.textContent = 'Drop plugin folder to install';
        banner.appendChild(text);
        const toolbar = this.box.querySelector('.plugins-toolbar');
        if (toolbar && toolbar.nextSibling) {
          this.box.insertBefore(banner, toolbar.nextSibling);
        } else {
          this.box.prepend(banner);
        }
      }
    } else if (banner) {
      banner.remove();
    }
  }

  /**
   * Update or remove inline toast message element.
   * @private
   */
  _updateToast() {
    let toastEl = this.box.querySelector('.plugins-toast');
    if (!this.toast) {
      toastEl?.remove();
      return;
    }

    if (!toastEl) {
      toastEl = document.createElement('div');
      const content = this.box.querySelector('.plugins-content');
      if (content) {
        this.box.insertBefore(toastEl, content);
      } else {
        this.box.appendChild(toastEl);
      }
    }

    toastEl.className = `plugins-toast plugins-toast-${this.toast.type || 'info'}`;
    toastEl.replaceChildren();

    const msgSpan = document.createElement('span');
    msgSpan.textContent = this.toast.message;
    toastEl.appendChild(msgSpan);

    const closeBtn = document.createElement('button');
    closeBtn.className = 'plugins-toast-close';
    closeBtn.title = 'Dismiss';
    closeBtn.setAttribute('aria-label', 'Dismiss notification');
    closeBtn.appendChild(createIcon(X, { width: 14, height: 14 }));
    closeBtn.addEventListener('click', () => {
      this.toast = null;
      toastEl.remove();
    });
    toastEl.appendChild(closeBtn);
  }

  /**
   * Main render method. Renders either the plugin list or dedicated plugin detail section.
   */
  render() {
    if (this.selectedPluginId) {
      this._renderDetailView();
    } else {
      this._renderListView();
    }
  }

  /**
   * Render the main plugins list view.
   * @private
   */
  _renderListView() {
    const contentEl = this.box.querySelector('.plugins-content');
    const prevScrollTop = contentEl ? contentEl.scrollTop : 0;
    const isSearchFocused = document.activeElement?.classList?.contains('plugins-search-input');

    this.box.replaceChildren();

    // 1. Header
    const header = document.createElement('header');
    header.className = 'plugins-header';

    const titleWrap = document.createElement('div');
    titleWrap.className = 'plugins-header-title-wrap';

    const title = document.createElement('h2');
    title.id = 'plugins-panel-title';
    title.className = 'plugins-title';
    title.appendChild(createIcon(Puzzle, { width: 18, height: 18 }));
    const titleText = document.createElement('span');
    titleText.textContent = 'Manage Plugins';
    title.appendChild(titleText);
    titleWrap.appendChild(title);

    const counts = this.getCounts();
    const countBadge = document.createElement('span');
    countBadge.className = 'plugins-count-badge';
    countBadge.textContent = `${counts.enabled} of ${counts.total} enabled`;
    titleWrap.appendChild(countBadge);

    header.appendChild(titleWrap);

    const headerActions = document.createElement('div');
    headerActions.className = 'plugins-header-actions';

    const installBtn = document.createElement('button');
    installBtn.className = 'plugins-btn-primary';
    installBtn.appendChild(createIcon(FolderPlus, { width: 15, height: 15 }));
    const installBtnText = document.createElement('span');
    installBtnText.textContent = 'Install from folder…';
    installBtn.appendChild(installBtnText);
    installBtn.addEventListener('click', () => this.installFromFolder());
    headerActions.appendChild(installBtn);

    const closeBtn = document.createElement('button');
    closeBtn.className = 'plugins-close-btn';
    closeBtn.title = 'Close (Esc)';
    closeBtn.setAttribute('aria-label', 'Close dialog');
    closeBtn.appendChild(createIcon(X, { width: 16, height: 16 }));
    closeBtn.addEventListener('click', () => this.close());
    headerActions.appendChild(closeBtn);

    header.appendChild(headerActions);
    this.box.appendChild(header);

    // 2. Toolbar (Search Input & Filter Dropdown)
    const toolbar = document.createElement('div');
    toolbar.className = 'plugins-toolbar';

    const searchWrap = document.createElement('div');
    searchWrap.className = 'plugins-search-wrap';
    const searchIconWrap = document.createElement('span');
    searchIconWrap.className = 'plugins-search-icon';
    searchIconWrap.appendChild(createIcon(Search, { width: 14, height: 14 }));
    searchWrap.appendChild(searchIconWrap);

    const searchInput = document.createElement('input');
    searchInput.type = 'search';
    searchInput.className = 'plugins-search-input';
    searchInput.placeholder = 'Search plugins by name, description, author... (press / to focus)';
    searchInput.setAttribute('aria-label', 'Search plugins');
    searchInput.value = this.searchQuery;
    searchInput.addEventListener('input', (e) => {
      this.searchQuery = e.target.value;
      this._renderListContent();
    });
    searchWrap.appendChild(searchInput);

    if (this.searchQuery) {
      const clearBtn = document.createElement('button');
      clearBtn.className = 'plugins-search-clear';
      clearBtn.setAttribute('aria-label', 'Clear search');
      clearBtn.appendChild(createIcon(X, { width: 12, height: 12 }));
      clearBtn.addEventListener('click', () => {
        this.searchQuery = '';
        searchInput.value = '';
        searchInput.focus();
        this._renderListContent();
      });
      searchWrap.appendChild(clearBtn);
    }
    toolbar.appendChild(searchWrap);

    // Filter dropdown (user requested dropdown instead of segmented control)
    const filterSelect = document.createElement('select');
    filterSelect.className = 'plugins-filter-select';
    filterSelect.setAttribute('aria-label', 'Filter plugins');

    const filterOptions = [
      { id: 'all', label: `All (${counts.total})` },
      { id: 'enabled', label: `Enabled (${counts.enabled})` },
      { id: 'disabled', label: `Disabled (${counts.disabled})` },
      { id: 'errors', label: `Errors (${counts.errors})` },
    ];

    filterOptions.forEach((opt) => {
      const option = document.createElement('option');
      option.value = opt.id;
      option.textContent = opt.label;
      if (this.filter === opt.id) option.selected = true;
      filterSelect.appendChild(option);
    });

    filterSelect.addEventListener('change', (e) => {
      this.filter = e.target.value;
      this._renderListContent();
    });
    toolbar.appendChild(filterSelect);

    this.box.appendChild(toolbar);

    // Drop banner if dragging
    this._updateDropBanner();

    // Toast message if present
    this._updateToast();

    // 3. Content area (Flush list)
    const content = document.createElement('div');
    content.className = 'plugins-content';
    this.box.appendChild(content);

    this._renderListContent();

    // 4. Footer
    const footer = document.createElement('footer');
    footer.className = 'plugins-footer';

    const leftGroup = document.createElement('div');
    leftGroup.className = 'plugins-footer-group';

    const enableAllBtn = document.createElement('button');
    enableAllBtn.className = 'plugins-btn-secondary';
    enableAllBtn.textContent = 'Enable all';
    enableAllBtn.addEventListener('click', () => this.enableAll());
    leftGroup.appendChild(enableAllBtn);

    const disableAllBtn = document.createElement('button');
    disableAllBtn.className = 'plugins-btn-secondary';
    disableAllBtn.textContent = 'Disable all';
    disableAllBtn.addEventListener('click', () => this.disableAll());
    leftGroup.appendChild(disableAllBtn);

    footer.appendChild(leftGroup);

    const rightGroup = document.createElement('div');
    rightGroup.className = 'plugins-footer-group';

    const reloadBtn = document.createElement('button');
    reloadBtn.className = 'plugins-btn-secondary';
    reloadBtn.appendChild(createIcon(RefreshCw, { width: 13, height: 13 }));
    const reloadText = document.createElement('span');
    reloadText.textContent = 'Reload plugins';
    reloadBtn.appendChild(reloadText);
    reloadBtn.addEventListener('click', () => this.reloadPlugins());
    rightGroup.appendChild(reloadBtn);

    const openFolderBtn = document.createElement('button');
    openFolderBtn.className = 'plugins-btn-secondary';
    openFolderBtn.appendChild(createIcon(Folder, { width: 13, height: 13 }));
    const openFolderText = document.createElement('span');
    openFolderText.textContent = 'Open plugins folder';
    openFolderBtn.appendChild(openFolderText);
    openFolderBtn.addEventListener('click', () => this.openPluginsFolder());
    rightGroup.appendChild(openFolderBtn);

    footer.appendChild(rightGroup);
    this.box.appendChild(footer);

    // Restore scroll position
    const newContentEl = this.box.querySelector('.plugins-content');
    if (newContentEl && prevScrollTop) {
      newContentEl.scrollTop = prevScrollTop;
    }

    // Restore search input focus
    if (isSearchFocused) {
      const newSearchInput = this.box.querySelector('.plugins-search-input');
      newSearchInput?.focus();
    }
  }

  /**
   * Render the list items inside .plugins-content.
   * @private
   */
  _renderListContent() {
    const content = this.box.querySelector('.plugins-content');
    if (!content) return;

    const prevScrollTop = content.scrollTop;
    content.replaceChildren();

    if (this.loading) {
      for (let i = 0; i < 3; i++) {
        const skeleton = document.createElement('div');
        skeleton.className = 'plugin-row-skeleton';
        const iconBox = document.createElement('div');
        iconBox.className = 'skeleton-box';
        iconBox.style.cssText = 'width: 32px; height: 32px; border-radius: 6px;';
        skeleton.appendChild(iconBox);

        const linesBox = document.createElement('div');
        linesBox.style.cssText = 'flex: 1; display: flex; flex-direction: column; gap: 8px;';
        const line1 = document.createElement('div');
        line1.className = 'skeleton-box';
        line1.style.cssText = 'width: 40%; height: 16px;';
        const line2 = document.createElement('div');
        line2.className = 'skeleton-box';
        line2.style.cssText = 'width: 75%; height: 12px;';
        linesBox.appendChild(line1);
        linesBox.appendChild(line2);
        skeleton.appendChild(linesBox);

        content.appendChild(skeleton);
      }
      return;
    }

    if (this.plugins.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'plugins-empty-state';

      const emptyIcon = document.createElement('div');
      emptyIcon.className = 'plugins-empty-icon';
      emptyIcon.appendChild(createIcon(Puzzle, { width: 44, height: 44 }));
      empty.appendChild(emptyIcon);

      const emptyTitle = document.createElement('div');
      emptyTitle.className = 'plugins-empty-title';
      emptyTitle.textContent = 'No plugins installed';
      empty.appendChild(emptyTitle);

      const emptyDesc = document.createElement('div');
      emptyDesc.className = 'plugins-empty-desc';
      emptyDesc.textContent =
        'Add custom commands, transforms, and UI views to FlowMark by installing plugins.';
      empty.appendChild(emptyDesc);

      const emptyInstallBtn = document.createElement('button');
      emptyInstallBtn.className = 'plugins-btn-primary';
      emptyInstallBtn.appendChild(createIcon(FolderPlus, { width: 15, height: 15 }));
      const emptyInstallText = document.createElement('span');
      emptyInstallText.textContent = 'Install Plugin from Folder…';
      emptyInstallBtn.appendChild(emptyInstallText);
      emptyInstallBtn.addEventListener('click', () => this.installFromFolder());
      empty.appendChild(emptyInstallBtn);

      content.appendChild(empty);
      return;
    }

    const filtered = this.getFilteredPlugins();

    if (filtered.length === 0) {
      const noResults = document.createElement('div');
      noResults.className = 'plugins-empty-state';

      const noResIcon = document.createElement('div');
      noResIcon.className = 'plugins-empty-icon';
      noResIcon.appendChild(createIcon(Search, { width: 36, height: 36 }));
      noResults.appendChild(noResIcon);

      const noResTitle = document.createElement('div');
      noResTitle.className = 'plugins-empty-title';
      noResTitle.textContent = 'No matching plugins found';
      noResults.appendChild(noResTitle);

      const noResDesc = document.createElement('div');
      noResDesc.className = 'plugins-empty-desc';
      noResDesc.textContent = this.searchQuery
        ? `No plugins matched "${this.searchQuery}". Try a different search term or clear the filter.`
        : 'No plugins match the selected filter.';
      noResults.appendChild(noResDesc);

      const clearBtn = document.createElement('button');
      clearBtn.className = 'plugins-btn-secondary';
      clearBtn.textContent = 'Clear filters';
      clearBtn.addEventListener('click', () => {
        this.searchQuery = '';
        this.filter = 'all';
        this.render();
      });
      noResults.appendChild(clearBtn);

      content.appendChild(noResults);
      return;
    }

    // Flush list of plugin rows with dividing lines
    const listWrap = document.createElement('div');
    listWrap.className = 'plugins-list';

    let scrollToRow = null;

    filtered.forEach((plugin) => {
      const row = this._createPluginRow(plugin);
      listWrap.appendChild(row);

      if (this.recentlyInstalled && plugin.name === this.recentlyInstalled) {
        scrollToRow = row;
        row.classList.add('plugin-card-highlight');
      }
    });

    content.appendChild(listWrap);

    if (scrollToRow) {
      this.recentlyInstalled = null;
      setTimeout(() => {
        scrollToRow.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }, 50);
    } else {
      content.scrollTop = prevScrollTop;
    }
  }

  /**
   * Build a single plugin row in the list.
   * Clicking the row or the navigation arrow opens that plugin's section.
   * @param {Object} plugin
   * @returns {HTMLElement}
   * @private
   */
  _createPluginRow(plugin) {
    const row = document.createElement('div');
    const hasError = !!plugin.error;
    const inFlight = this.inFlightActions.has(plugin.name);

    row.className = `plugin-row${hasError ? ' row-error' : ''}`;
    row.dataset.pluginId = plugin.name;
    row.setAttribute('tabindex', '0');
    row.setAttribute('role', 'button');
    row.setAttribute('aria-label', `View details for ${plugin.name}`);

    // Left info
    const leftCol = document.createElement('div');
    leftCol.className = 'plugin-row-left';

    const iconWrap = document.createElement('div');
    iconWrap.className = 'plugin-row-icon';
    iconWrap.appendChild(createIcon(Puzzle, { width: 16, height: 16 }));
    leftCol.appendChild(iconWrap);

    const infoCol = document.createElement('div');
    infoCol.className = 'plugin-row-info';

    const titleRow = document.createElement('div');
    titleRow.className = 'plugin-row-title-row';

    const nameSpan = document.createElement('span');
    nameSpan.className = 'plugin-row-name';
    nameSpan.textContent = plugin.name || 'Unnamed Plugin';
    titleRow.appendChild(nameSpan);

    if (plugin.version) {
      const versionSpan = document.createElement('span');
      versionSpan.className = 'plugin-row-version';
      versionSpan.textContent = `v${plugin.version}`;
      titleRow.appendChild(versionSpan);
    }

    if (plugin.error) {
      const errorBadge = document.createElement('span');
      errorBadge.className = 'plugin-status-badge status-badge-error';
      errorBadge.textContent = 'Error';
      titleRow.appendChild(errorBadge);
    }
    infoCol.appendChild(titleRow);

    if (plugin.description || plugin.author) {
      const metaSpan = document.createElement('div');
      metaSpan.className = 'plugin-row-meta';
      const authorText = plugin.author ? `by ${plugin.author}` : '';
      const descText = plugin.description || '';
      metaSpan.textContent = [authorText, descText].filter(Boolean).join(' — ');
      infoCol.appendChild(metaSpan);
    }

    leftCol.appendChild(infoCol);
    row.appendChild(leftCol);

    // Right actions: Toggle Switch + Navigation Arrow
    const rightCol = document.createElement('div');
    rightCol.className = 'plugin-row-right';

    // iOS-style toggle switch
    const toggleBtn = document.createElement('button');
    toggleBtn.setAttribute('role', 'switch');
    toggleBtn.setAttribute('aria-checked', String(plugin.enabled));
    toggleBtn.className = 'plugin-toggle-switch';
    toggleBtn.setAttribute('aria-label', `Toggle ${plugin.name} plugin`);
    toggleBtn.title = plugin.enabled ? 'Click to disable' : 'Click to enable';
    if (inFlight) toggleBtn.disabled = true;

    const toggleThumb = document.createElement('span');
    toggleThumb.className = 'plugin-toggle-thumb';
    toggleBtn.appendChild(toggleThumb);

    toggleBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.togglePlugin(plugin, !plugin.enabled);
    });
    rightCol.appendChild(toggleBtn);

    // Navigation arrow (taking to this plugin's section)
    const arrowBtn = document.createElement('button');
    arrowBtn.className = 'plugin-nav-arrow';
    arrowBtn.setAttribute('aria-label', `Open ${plugin.name} details`);
    arrowBtn.title = 'View plugin details';
    arrowBtn.appendChild(createIcon(ChevronRight, { width: 16, height: 16 }));
    arrowBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.openPluginDetails(plugin.name);
    });
    rightCol.appendChild(arrowBtn);

    row.appendChild(rightCol);

    // Clicking row opens details
    row.addEventListener('click', () => {
      this.openPluginDetails(plugin.name);
    });

    // Enter key opens details
    row.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        this.openPluginDetails(plugin.name);
      }
    });

    return row;
  }

  /**
   * Navigate to the dedicated details view for a plugin.
   * @param {string} pluginId
   */
  openPluginDetails(pluginId) {
    this.selectedPluginId = pluginId;
    this.render();
  }

  /**
   * Render the dedicated detail section for this.selectedPluginId.
   * @private
   */
  _renderDetailView() {
    this.box.replaceChildren();

    const plugin = this.plugins.find((p) => p.name === this.selectedPluginId);
    if (!plugin) {
      this.selectedPluginId = null;
      this._renderListView();
      return;
    }

    const inFlight = this.inFlightActions.has(plugin.name);

    // 1. Header with Back button
    const header = document.createElement('header');
    header.className = 'plugins-header';

    const leftWrap = document.createElement('div');
    leftWrap.className = 'plugins-header-title-wrap';

    const backBtn = document.createElement('button');
    backBtn.className = 'plugins-back-btn';
    backBtn.appendChild(createIcon(ArrowLeft, { width: 15, height: 15 }));
    const backText = document.createElement('span');
    backText.textContent = 'All Plugins';
    backBtn.appendChild(backText);
    backBtn.title = 'Back to plugin list (Esc)';
    backBtn.addEventListener('click', () => {
      this.selectedPluginId = null;
      this.render();
    });
    leftWrap.appendChild(backBtn);

    const titleSep = document.createElement('span');
    titleSep.className = 'plugins-breadcrumb-sep';
    titleSep.textContent = '/';
    leftWrap.appendChild(titleSep);

    const title = document.createElement('h2');
    title.id = 'plugins-panel-title';
    title.className = 'plugins-title';
    title.textContent = plugin.name;
    leftWrap.appendChild(title);

    header.appendChild(leftWrap);

    const headerActions = document.createElement('div');
    headerActions.className = 'plugins-header-actions';

    const closeBtn = document.createElement('button');
    closeBtn.className = 'plugins-close-btn';
    closeBtn.title = 'Close (Esc)';
    closeBtn.setAttribute('aria-label', 'Close dialog');
    closeBtn.appendChild(createIcon(X, { width: 16, height: 16 }));
    closeBtn.addEventListener('click', () => this.close());
    headerActions.appendChild(closeBtn);

    header.appendChild(headerActions);
    this.box.appendChild(header);

    // Toast message if present
    this._updateToast();

    // 2. Scrollable Detail Content
    const content = document.createElement('div');
    content.className = 'plugins-content plugin-detail-view';

    // Overview Hero Card
    const heroCard = document.createElement('div');
    heroCard.className = 'plugin-detail-hero';

    const iconWrap = document.createElement('div');
    iconWrap.className = 'plugin-detail-icon';
    iconWrap.appendChild(createIcon(Puzzle, { width: 28, height: 28 }));
    heroCard.appendChild(iconWrap);

    const heroBody = document.createElement('div');
    heroBody.className = 'plugin-detail-body';

    const heroTitleRow = document.createElement('div');
    heroTitleRow.className = 'plugin-detail-title-row';

    const heroName = document.createElement('h3');
    heroName.className = 'plugin-detail-name';
    heroName.textContent = plugin.name;
    heroTitleRow.appendChild(heroName);

    if (plugin.version) {
      const heroVersion = document.createElement('span');
      heroVersion.className = 'plugin-detail-version';
      heroVersion.textContent = `v${plugin.version}`;
      heroTitleRow.appendChild(heroVersion);
    }

    if (plugin.error) {
      const errorBadge = document.createElement('span');
      errorBadge.className = 'plugin-status-badge status-badge-error';
      errorBadge.textContent = 'Error';
      heroTitleRow.appendChild(errorBadge);
    }

    // Toggle switch inside hero
    const toggleBtn = document.createElement('button');
    toggleBtn.setAttribute('role', 'switch');
    toggleBtn.setAttribute('aria-checked', String(plugin.enabled));
    toggleBtn.className = 'plugin-toggle-switch';
    toggleBtn.setAttribute('aria-label', `Toggle ${plugin.name} plugin`);
    toggleBtn.title = plugin.enabled ? 'Click to disable' : 'Click to enable';
    if (inFlight) toggleBtn.disabled = true;

    const toggleThumb = document.createElement('span');
    toggleThumb.className = 'plugin-toggle-thumb';
    toggleBtn.appendChild(toggleThumb);

    toggleBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.togglePlugin(plugin, !plugin.enabled);
    });
    heroTitleRow.appendChild(toggleBtn);

    heroBody.appendChild(heroTitleRow);

    if (plugin.author) {
      const heroAuthor = document.createElement('div');
      heroAuthor.className = 'plugin-detail-author';
      heroAuthor.textContent = `Author: ${plugin.author}`;
      heroBody.appendChild(heroAuthor);
    }

    if (plugin.description) {
      const heroDesc = document.createElement('div');
      heroDesc.className = 'plugin-detail-desc';
      heroDesc.textContent = plugin.description;
      heroBody.appendChild(heroDesc);
    }

    heroCard.appendChild(heroBody);
    content.appendChild(heroCard);

    // Error block with Retry button
    if (plugin.error) {
      const errorBlock = document.createElement('div');
      errorBlock.className = 'plugin-card-error-block';

      const errorText = document.createElement('div');
      errorText.className = 'plugin-error-text';
      errorText.appendChild(createIcon(AlertTriangle, { width: 14, height: 14, style: 'vertical-align: middle; margin-right: 6px;' }));
      const errorMsg = document.createElement('span');
      errorMsg.textContent = String(plugin.error);
      errorText.appendChild(errorMsg);
      errorBlock.appendChild(errorText);

      const retryBtn = document.createElement('button');
      retryBtn.className = 'plugin-retry-btn';
      retryBtn.appendChild(createIcon(RotateCw, { width: 12, height: 12 }));
      const retryText = document.createElement('span');
      retryText.textContent = 'Retry';
      retryBtn.appendChild(retryText);
      retryBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.togglePlugin(plugin, true);
      });
      errorBlock.appendChild(retryBtn);

      content.appendChild(errorBlock);
    }

    // Detail Sections
    const detailsContainer = document.createElement('div');
    detailsContainer.className = 'plugin-detail-sections';

    // 1. Settings Section
    const pluginSettingsData = this.settingsMap.get(plugin.name);
    const metadata = pluginSettingsData?.metadata || {};
    const values = pluginSettingsData?.values || {};
    const settingKeys = Object.keys(metadata);

    if (settingKeys.length > 0) {
      const settingsSection = document.createElement('div');
      settingsSection.className = 'plugin-detail-section';

      const settingsTitle = document.createElement('div');
      settingsTitle.className = 'plugin-section-title';
      settingsTitle.textContent = 'Configuration';
      settingsSection.appendChild(settingsTitle);

      const group = document.createElement('div');
      group.className = 'plugin-settings-group';

      settingKeys.forEach((key) => {
        const meta = metadata[key];
        const row = document.createElement('div');
        row.className = 'plugin-setting-row';

        const metaCol = document.createElement('div');
        metaCol.className = 'plugin-setting-meta';

        const label = document.createElement('div');
        label.className = 'plugin-setting-label';
        label.textContent = meta.label || key;
        metaCol.appendChild(label);

        if (meta.description) {
          const desc = document.createElement('div');
          desc.className = 'plugin-setting-desc';
          desc.textContent = meta.description;
          metaCol.appendChild(desc);
        }
        row.appendChild(metaCol);

        const currentValue = values[key] !== undefined ? values[key] : meta.defaultValue;

        if (meta.type === 'boolean') {
          const boolSwitch = document.createElement('button');
          boolSwitch.setAttribute('role', 'switch');
          boolSwitch.setAttribute('aria-checked', String(!!currentValue));
          boolSwitch.className = 'plugin-toggle-switch';
          boolSwitch.setAttribute('aria-label', meta.label || key);

          const thumb = document.createElement('span');
          thumb.className = 'plugin-toggle-thumb';
          boolSwitch.appendChild(thumb);

          boolSwitch.addEventListener('click', (e) => {
            e.stopPropagation();
            const nextVal = !JSON.parse(boolSwitch.getAttribute('aria-checked') || 'false');
            boolSwitch.setAttribute('aria-checked', String(nextVal));
            this.updateSetting(plugin.name, key, nextVal);
          });
          row.appendChild(boolSwitch);
        } else if (meta.type === 'enum' && Array.isArray(meta.options)) {
          const select = document.createElement('select');
          select.className = 'plugin-setting-select';
          meta.options.forEach((opt) => {
            const option = document.createElement('option');
            const optVal = typeof opt === 'object' && opt !== null ? opt.value : opt;
            const optLabel = typeof opt === 'object' && opt !== null ? opt.label : opt;
            option.value = optVal;
            option.textContent = optLabel;
            if (optVal === currentValue) option.selected = true;
            select.appendChild(option);
          });
          select.addEventListener('change', (e) => {
            this.updateSetting(plugin.name, key, e.target.value);
          });
          row.appendChild(select);
        } else if (meta.type === 'number') {
          const input = document.createElement('input');
          input.type = 'number';
          input.className = 'plugin-setting-input';
          input.value = currentValue !== undefined ? currentValue : '';
          input.addEventListener('change', (e) => {
            this.updateSetting(plugin.name, key, parseFloat(e.target.value) || 0);
          });
          row.appendChild(input);
        } else {
          // String / JSON
          const input = document.createElement('input');
          input.type = 'text';
          input.className = 'plugin-setting-input';
          input.value = typeof currentValue === 'object' ? JSON.stringify(currentValue) : (currentValue ?? '');
          input.addEventListener('change', (e) => {
            let val = e.target.value;
            if (meta.type === 'json') {
              try {
                val = JSON.parse(val);
              } catch {
                this.showToast('Invalid JSON for setting', 'error');
                return;
              }
            }
            this.updateSetting(plugin.name, key, val);
          });
          row.appendChild(input);
        }

        group.appendChild(row);
      });

      settingsSection.appendChild(group);
      detailsContainer.appendChild(settingsSection);
    }

    // 2. Contributions Section
    const hasCommands = Array.isArray(plugin.commands) && plugin.commands.length > 0;
    const hasMenuItems = Array.isArray(plugin.menuItems) && plugin.menuItems.length > 0;
    const hasSidebarPanels = Array.isArray(plugin.sidebarPanels) && plugin.sidebarPanels.length > 0;
    const hasCustomViews = Array.isArray(plugin.customViews) && plugin.customViews.length > 0;
    const hasSlashCommands = Array.isArray(plugin.slashCommands) && plugin.slashCommands.length > 0;
    const hasContribs = hasCommands || hasMenuItems || hasSidebarPanels || hasCustomViews || hasSlashCommands;

    if (hasContribs) {
      const contribSection = document.createElement('div');
      contribSection.className = 'plugin-detail-section';

      const contribTitle = document.createElement('div');
      contribTitle.className = 'plugin-section-title';
      contribTitle.textContent = 'Contributed Features';
      contribSection.appendChild(contribTitle);

      const contribGrid = document.createElement('div');
      contribGrid.className = 'plugin-contributions-grid';

      const addContribItem = (type, name, shortcut = null) => {
        const item = document.createElement('div');
        item.className = 'plugin-contribution-item';

        const left = document.createElement('div');
        left.className = 'plugin-contrib-left';

        const typeSpan = document.createElement('span');
        typeSpan.className = 'plugin-contrib-type';
        typeSpan.textContent = type;
        left.appendChild(typeSpan);

        const nameSpan = document.createElement('span');
        nameSpan.className = 'plugin-contrib-name';
        nameSpan.textContent = name;
        left.appendChild(nameSpan);

        item.appendChild(left);

        if (shortcut) {
          const kbd = document.createElement('kbd');
          kbd.className = 'plugin-contribution-shortcut';
          kbd.textContent = shortcut;
          item.appendChild(kbd);
        }

        contribGrid.appendChild(item);
      };

      if (hasCommands) {
        plugin.commands.forEach((cmd) => {
          addContribItem('Command', cmd.label || cmd.id, cmd.shortcut);
        });
      }

      if (hasMenuItems) {
        plugin.menuItems.forEach((menu) => {
          addContribItem('Menu Item', `${menu.section} > ${menu.label || menu.id}`);
        });
      }

      if (hasSidebarPanels) {
        plugin.sidebarPanels.forEach((panelId) => {
          addContribItem('Sidebar Panel', panelId);
        });
      }

      if (hasCustomViews) {
        plugin.customViews.forEach((viewId) => {
          addContribItem('Custom View', viewId);
        });
      }

      if (hasSlashCommands) {
        plugin.slashCommands.forEach((slashId) => {
          addContribItem('Slash Command', `/${slashId}`);
        });
      }

      contribSection.appendChild(contribGrid);
      detailsContainer.appendChild(contribSection);
    }

    // 3. Permissions Section
    if (Array.isArray(plugin.permissions) && plugin.permissions.length > 0) {
      const permSection = document.createElement('div');
      permSection.className = 'plugin-detail-section';

      const permTitle = document.createElement('div');
      permTitle.className = 'plugin-section-title';
      permTitle.textContent = 'Requested Permissions';
      permSection.appendChild(permTitle);

      const permList = document.createElement('div');
      permList.className = 'plugin-tags-list';
      plugin.permissions.forEach((perm) => {
        const tag = document.createElement('span');
        tag.className = 'plugin-tag';
        tag.textContent = perm;
        permList.appendChild(tag);
      });
      permSection.appendChild(permList);
      detailsContainer.appendChild(permSection);
    }

    // 4. Install Path Section
    if (plugin.path) {
      const pathSection = document.createElement('div');
      pathSection.className = 'plugin-detail-section';

      const pathTitle = document.createElement('div');
      pathTitle.className = 'plugin-section-title';
      pathTitle.textContent = 'Location on Disk';
      pathSection.appendChild(pathTitle);

      const pathText = document.createElement('div');
      pathText.className = 'plugin-path-text';
      pathText.textContent = plugin.path;
      pathSection.appendChild(pathText);
      detailsContainer.appendChild(pathSection);
    }

    // 5. Danger Zone (Uninstall)
    const dangerSection = document.createElement('div');
    dangerSection.className = 'plugin-detail-section';

    const dangerTitle = document.createElement('div');
    dangerTitle.className = 'plugin-section-title';
    dangerTitle.textContent = 'Manage Plugin';
    dangerSection.appendChild(dangerTitle);

    const uninstallBtn = document.createElement('button');
    uninstallBtn.className = 'plugin-btn-danger';
    uninstallBtn.appendChild(createIcon(Trash2, { width: 14, height: 14 }));
    const uninstallText = document.createElement('span');
    uninstallText.textContent = 'Uninstall Plugin';
    uninstallBtn.appendChild(uninstallText);
    uninstallBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.uninstallPlugin(plugin);
    });
    dangerSection.appendChild(uninstallBtn);
    detailsContainer.appendChild(dangerSection);

    content.appendChild(detailsContainer);
    this.box.appendChild(content);

    // Focus back button on entering detail view
    backBtn.focus();
  }
}

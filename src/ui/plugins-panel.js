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
  LayoutDashboard,
  Shield,
  HardDrive,
  Copy,
  XCircle,
  GitBranch,
  Globe,
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

function arrayBufferToBase64(buffer) {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const len = bytes.byteLength;
  const chunkSize = 8192;
  for (let i = 0; i < len; i += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(i + chunkSize, len)));
  }
  return btoa(binary);
}

export class PluginManagerPanel {
  /**
   * @param {Object} options
   * @param {HTMLElement} options.container - Modal overlay container (#plugins-panel)
   * @param {Object} options.pluginManager - window.pluginManager API
   * @param {Function} [options.showConfirm] - (message, okLabel) => Promise<boolean>
   * @param {Function} [options.onClose] - () => void
   * @param {boolean} [options.embedded] - Whether mounted inside a parent container (e.g. Settings tab)
   */
  constructor({ container, pluginManager, showConfirm, onClose, embedded = false }) {
    this.container = container;
    this.pluginManager = pluginManager;
    this.showConfirm = showConfirm;
    this.onClose = onClose;
    this.embedded = embedded;

    this.isOpen = false;
    this.plugins = [];
    this.settingsMap = new Map(); // pluginId -> { values, metadata }
    this.filter = 'all'; // 'all' | 'enabled' | 'disabled' | 'errors'
    this.searchQuery = '';
    this.selectedPluginId = null; // null = list view, string = detail view for that plugin
    this.detailTab = 'overview'; // active tab in detail view
    this.inFlightActions = new Set();
    this.loading = true;
    this.recentlyInstalled = null;
    this.toast = null;
    this.toastTimeout = null;
    this.isDragging = false;
    this.previousActiveElement = null;
    this.unsubscribePluginsChanged = null;
    this.unsubscribeSettingsChanged = null;
    this._renderSeq = 0;
    this._isDevMode = null;
    this._detailViewMounted = false;

    this.box = this.container.querySelector('#plugins-box');
    if (!this.box) {
      this.box = document.createElement('div');
      this.box.id = 'plugins-box';
      this.container.appendChild(this.box);
    }
    this.box.setAttribute('tabindex', '-1');

    // Inject CSS to hide scrollbars on tab bar (WebKit + Firefox)
    if (!document.getElementById('plugin-panel-tabbar-styles')) {
      const style = document.createElement('style');
      style.id = 'plugin-panel-tabbar-styles';
      style.textContent = `
        .plugin-detail-tabs::-webkit-scrollbar { display: none; }
        .plugin-detail-tabs { -ms-overflow-style: none; scrollbar-width: none; }
      `;
      document.head.appendChild(style);
    }

    if (!this.embedded) {
      this._bindOverlayEvents();
    }
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
    this._detailViewMounted = false;
    this.detailTab = 'overview';
    this.previousActiveElement = document.activeElement;
    if (!this.embedded) {
      this.container.classList.remove('hidden');
    }
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
    this._detailViewMounted = false;
    if (!this.embedded) {
      this.container.classList.add('hidden');
    }

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
      if (this.inFlightActions.size === 0) {
        this.render();
      }
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
   * Install a plugin from a GitHub repository.
   * Downloads the repo as a zip, extracts it, and installs.
   */
  async installFromGitHub() {
    try {
      const url = prompt('GitHub repo URL (e.g. user/repo or https://github.com/user/repo)');
      if (!url) return;

      // Normalize to zip URL
      let zipUrl;
      if (url.includes('github.com/')) {
        const match = url.match(/github\.com\/([^/]+\/[^/]+)/);
        if (match) {
          zipUrl = `https://github.com/${match[1]}/archive/refs/heads/main.zip`;
        }
      } else if (url.includes('/')) {
        zipUrl = `https://github.com/${url}/archive/refs/heads/main.zip`;
      }
      if (!zipUrl) {
        this.showToast('Invalid GitHub URL', 'error');
        return;
      }

      this.showToast('Downloading plugin from GitHub...', 'info');

      const resp = await fetch(zipUrl);
      if (!resp.ok) {
        throw new Error(`Failed to download: ${resp.status} ${resp.statusText}`);
      }
      const blob = await resp.blob();
      const arrayBuffer = await blob.arrayBuffer();

      // Extract zip using JSZip (loaded dynamically)
      const JSZip = (await import('jszip')).default;
      const zip = new JSZip();
      await zip.loadAsync(arrayBuffer);

      // Find the root folder (first entry that ends with /)
      const rootFolders = Object.keys(zip.files).filter(name => name.endsWith('/'));
      if (rootFolders.length === 0) {
        throw new Error('Zip does not contain a root folder');
      }
      const rootFolder = rootFolders[0].slice(0, -1); // remove trailing /

      // Extract to temp directory
      // Install from extracted zip - send base64 to main process for extraction
      const base64 = arrayBufferToBase64(arrayBuffer);
      if (!this.pluginManager?.installFromGitHubZip) throw new Error('Install API not available');
      const result = await this.pluginManager.installFromGitHubZip(base64);
      if (result?.success !== false) {
        const id = result?.pluginId || rootFolder;
        this.recentlyInstalled = id;
        this.showToast(`Plugin "${id}" installed from GitHub!`, 'success');
        await this.loadData();
      } else {
        this.showToast(`Install failed: ${result?.error || 'Unknown error'}`, 'error');
      }

      // Cleanup temp dir
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch (err) {
      console.error('[PluginManagerPanel] GitHub install error:', err);
      this.showToast(`GitHub install failed: ${err.message}`, 'error');
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

    // Update switch element in-place to prevent layout jitter
    const activeSwitch = this.box.querySelector(
      this.selectedPluginId
        ? '.plugin-detail-hero .plugin-toggle-switch'
        : `.plugin-row[data-plugin-id="${plugin.name}"] .plugin-toggle-switch`
    );
    if (activeSwitch) {
      activeSwitch.setAttribute('aria-checked', String(enable));
      activeSwitch.title = enable ? 'Click to disable' : 'Click to enable';
      activeSwitch.disabled = true;
    } else {
      await this.render();
    }

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
      await this.render();
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
      this.render();
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
   * Show error details modal with copy functionality.
   * @param {string} pluginName
   * @param {string} error
   * @private
   */
  _showErrorModal(pluginName, error) {
    const modal = document.createElement('div');
    modal.className = 'plugin-error-modal-overlay';
    modal.style.cssText = `
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.6);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 10000;
      padding: 20px;
    `;

    const modalContent = document.createElement('div');
    modalContent.className = 'plugin-error-modal';
    modalContent.style.cssText = `
      background: var(--fm-bg-secondary);
      border: 1px solid var(--fm-border);
      border-radius: 12px;
      max-width: 700px;
      width: 100%;
      max-height: 80vh;
      overflow: hidden;
      display: flex;
      flex-direction: column;
    `;

    // Header
    const header = document.createElement('div');
    header.style.cssText = `
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 16px 20px;
      border-bottom: 1px solid var(--fm-border);
    `;
    header.innerHTML = `<h3 style="margin: 0; font-size: 16px; display: flex; align-items: center; gap: 8px;">${createIcon(AlertTriangle, { width: 18, height: 18 }).outerHTML} Error Details: ${pluginName}</h3>`;
    const closeBtn = document.createElement('button');
    closeBtn.className = 'plugin-error-modal-close';
    closeBtn.style.cssText = 'background: none; border: none; cursor: pointer; padding: 4px; color: var(--fm-text-muted);';
    closeBtn.appendChild(createIcon(XCircle, { width: 20, height: 20 }));
    closeBtn.addEventListener('click', () => modal.remove());
    header.appendChild(closeBtn);
    modalContent.appendChild(header);

    // Error content
    const content = document.createElement('div');
    content.style.cssText = `
      padding: 20px;
      overflow-y: auto;
      max-height: 60vh;
    `;

    const errorLabel = document.createElement('div');
    errorLabel.style.cssText = 'font-size: 12px; font-weight: 600; color: var(--fm-text-muted); margin-bottom: 8px; text-transform: uppercase; letter-spacing: 0.5px;';
    errorLabel.textContent = 'Error Message';
    content.appendChild(errorLabel);

    const errorBox = document.createElement('pre');
    errorBox.style.cssText = `
      background: var(--fm-bg-tertiary);
      border: 1px solid var(--fm-border);
      border-radius: 8px;
      padding: 16px;
      font-family: var(--fm-font-mono);
      font-size: 12px;
      line-height: 1.5;
      white-space: pre-wrap;
      word-break: break-word;
      color: var(--fm-text);
      margin: 0 0 16px 0;
      max-height: 400px;
      overflow-y: auto;
    `;
    errorBox.textContent = String(error).slice(-5000); // Show last 5000 chars
    content.appendChild(errorBox);

    // Copy button
    const copyBtn = document.createElement('button');
    copyBtn.className = 'plugin-error-copy-btn plugins-btn-secondary';
    copyBtn.style.cssText = 'display: flex; align-items: center; gap: 8px;';
    copyBtn.appendChild(createIcon(Copy, { width: 14, height: 14 }));
    const copyText = document.createElement('span');
    copyText.textContent = 'Copy Error to Clipboard';
    copyBtn.appendChild(copyText);
    copyBtn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(`${pluginName} Error:\n${error}`);
        copyBtn.innerHTML = '';
        copyBtn.appendChild(createIcon(Check, { width: 14, height: 14 }));
        const copiedText = document.createElement('span');
        copiedText.textContent = 'Copied!';
        copyBtn.appendChild(copiedText);
        setTimeout(() => {
          copyBtn.innerHTML = '';
          copyBtn.appendChild(createIcon(Copy, { width: 14, height: 14 }));
          copyBtn.appendChild(copyText);
        }, 2000);
      } catch (err) {
        this.showToast('Failed to copy to clipboard', 'error');
      }
    });
    content.appendChild(copyBtn);

    modalContent.appendChild(content);
    modal.appendChild(modalContent);
    document.body.appendChild(modal);

    // Close on overlay click
    modal.addEventListener('click', (e) => {
      if (e.target === modal) modal.remove();
    });

    // Close on Escape
    const handleEscape = (e) => {
      if (e.key === 'Escape') {
        modal.remove();
        document.removeEventListener('keydown', handleEscape);
      }
    };
    document.addEventListener('keydown', handleEscape);

    // Focus close button
    closeBtn.focus();
  }

  /**
   * Cached check for developer mode.
   */
  async getDevMode() {
    if (this._isDevMode === null) {
      this._isDevMode = window.appAPI?.isDevMode ? await window.appAPI.isDevMode() : false;
    }
    return this._isDevMode;
  }

  /**
   * Main render method. Renders either the plugin list or dedicated plugin detail section.
   */
  async render() {
    const seq = ++this._renderSeq;
    if (this.selectedPluginId) {
      await this._renderDetailView(seq);
    } else {
      this._renderListView(seq);
    }
  }

  /**
   * Render the main plugins list view.
   * @private
   */
  _renderListView(seq) {
    if (seq !== undefined && seq !== this._renderSeq) return;
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

    // Install from GitHub
    const installGithubBtn = document.createElement('button');
    installGithubBtn.className = 'plugins-btn-secondary';
    installGithubBtn.appendChild(createIcon(GitBranch, { width: 15, height: 15 }));
    const installGithubText = document.createElement('span');
    installGithubText.textContent = 'Install from GitHub…';
    installGithubBtn.appendChild(installGithubText);
    installGithubBtn.addEventListener('click', () => this.installFromGitHub());
    headerActions.appendChild(installGithubBtn);

    if (!this.embedded) {
      const closeBtn = document.createElement('button');
      closeBtn.className = 'plugins-close-btn';
      closeBtn.title = 'Close (Esc)';
      closeBtn.setAttribute('aria-label', 'Close dialog');
      closeBtn.appendChild(createIcon(X, { width: 16, height: 16 }));
      closeBtn.addEventListener('click', () => this.close());
      headerActions.appendChild(closeBtn);
    }

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
    this.detailTab = 'overview';
    this.render();
  }

  /**
   * Render the dedicated detail section for this.selectedPluginId.
   * @private
   */
  async _renderDetailView(seq) {
    if (seq !== undefined && seq !== this._renderSeq) return;
    const prevScrollTop = this.box.querySelector('.plugins-content')?.scrollTop || 0;
    const wasDetailAlreadyOpen = this._detailViewMounted;
    this._detailViewMounted = true;

    this.box.replaceChildren();

    const plugin = this.plugins.find((p) => p.name === this.selectedPluginId);
    if (!plugin) {
      this.selectedPluginId = null;
      this._detailViewMounted = false;
      this._renderListView(seq);
      return;
    }

    const inFlight = this.inFlightActions.has(plugin.name);

    // Initialize tab state if not present
    if (!this.detailTab) this.detailTab = 'overview';

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
      this._detailViewMounted = false;
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

    if (!this.embedded) {
      const closeBtn = document.createElement('button');
      closeBtn.className = 'plugins-close-btn';
      closeBtn.title = 'Close (Esc)';
      closeBtn.setAttribute('aria-label', 'Close dialog');
      closeBtn.appendChild(createIcon(X, { width: 16, height: 16 }));
      closeBtn.addEventListener('click', () => this.close());
      headerActions.appendChild(closeBtn);
    }

    header.appendChild(headerActions);
    this.box.appendChild(header);

    // Toast message if present
    this._updateToast();

    // 2. Tab Navigation Bar
    const tabBar = document.createElement('div');
    tabBar.className = 'plugin-detail-tabs';
    tabBar.setAttribute('role', 'tablist');
    tabBar.style.cssText = 'display: flex; flex-wrap: nowrap; gap: 4px; overflow-x: auto; padding-bottom: 4px; scrollbar-width: none; -ms-overflow-style: none;';

    const tabs = [
      { id: 'overview', label: 'Overview', icon: LayoutDashboard },
      { id: 'settings', label: 'Settings', icon: Settings },
      { id: 'contributions', label: 'Contributions', icon: Puzzle },
      { id: 'permissions', label: 'Permissions', icon: Shield },
      { id: 'location', label: 'Location', icon: HardDrive },
      { id: 'manage', label: 'Manage', icon: Trash2 },
      { id: 'registry', label: 'Registry', icon: Globe },
    ];

    tabs.forEach((tab) => {
      const btn = document.createElement('button');
      btn.className = `plugin-tab-btn${this.detailTab === tab.id ? ' active' : ''}`;
      btn.setAttribute('role', 'tab');
      btn.setAttribute('aria-selected', this.detailTab === tab.id);
      btn.setAttribute('aria-controls', `panel-${tab.id}`);
      btn.id = `tab-${tab.id}`;
      btn.style.cssText = 'flex-shrink: 0; white-space: nowrap;';
      btn.appendChild(createIcon(tab.icon, { width: 14, height: 14 }));
      const label = document.createElement('span');
      label.textContent = tab.label;
      btn.appendChild(label);
      btn.addEventListener('click', () => {
        this.detailTab = tab.id;
        this.render();
      });
      tabBar.appendChild(btn);
    });

    this.box.appendChild(tabBar);

    // 3. Scrollable Detail Content
    const content = document.createElement('div');
    content.className = 'plugins-content plugin-detail-view';

    // Overview Hero Card (always shown)
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

    // Error block with Retry button and View Details
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

      const errorActions = document.createElement('div');
      errorActions.className = 'plugin-error-actions';
      errorActions.style.cssText = 'display: flex; gap: 8px; margin-top: 8px;';

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
      errorActions.appendChild(retryBtn);

      const viewErrorBtn = document.createElement('button');
      viewErrorBtn.className = 'plugin-btn-secondary';
      viewErrorBtn.appendChild(createIcon(AlertTriangle, { width: 12, height: 12 }));
      const viewErrorText = document.createElement('span');
      viewErrorText.textContent = 'View Details';
      viewErrorBtn.appendChild(viewErrorText);
      viewErrorBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this._showErrorModal(plugin.name, plugin.error);
      });
      errorActions.appendChild(viewErrorBtn);

      errorBlock.appendChild(errorActions);
      content.appendChild(errorBlock);
    }

    // Tab Panels Container
    const panelsContainer = document.createElement('div');
    panelsContainer.className = 'plugin-detail-panels';

    // --- Overview Panel ---
    const overviewPanel = document.createElement('div');
    overviewPanel.id = 'panel-overview';
    overviewPanel.setAttribute('role', 'tabpanel');
    overviewPanel.setAttribute('aria-labelledby', 'tab-overview');
    overviewPanel.hidden = this.detailTab !== 'overview';
    overviewPanel.className = 'plugin-tab-panel';

    // Quick stats
    const statsGrid = document.createElement('div');
    statsGrid.className = 'plugin-stats-grid';

    const statItems = [
      { label: 'Status', value: plugin.active ? 'Active' : 'Inactive', icon: plugin.active ? Check : AlertTriangle },
      { label: 'Version', value: plugin.version || '—', icon: Puzzle },
      { label: 'Commands', value: (plugin.commands || []).length.toString(), icon: ChevronRight },
      { label: 'Menu Items', value: (plugin.menuItems || []).length.toString(), icon: ChevronRight },
    ];

    statItems.forEach((stat) => {
      const statCard = document.createElement('div');
      statCard.className = 'plugin-stat-card';
      const statIcon = document.createElement('div');
      statIcon.className = 'plugin-stat-icon';
      statIcon.appendChild(createIcon(stat.icon, { width: 16, height: 16 }));
      statCard.appendChild(statIcon);
      const statInfo = document.createElement('div');
      statInfo.className = 'plugin-stat-info';
      const statLabel = document.createElement('div');
      statLabel.className = 'plugin-stat-label';
      statLabel.textContent = stat.label;
      statInfo.appendChild(statLabel);
      const statValue = document.createElement('div');
      statValue.className = 'plugin-stat-value';
      statValue.textContent = stat.value;
      statInfo.appendChild(statValue);
      statCard.appendChild(statInfo);
      statsGrid.appendChild(statCard);
    });

    overviewPanel.appendChild(statsGrid);

    // Description
    if (plugin.description) {
      const descSection = document.createElement('div');
      descSection.className = 'plugin-detail-section';
      const descTitle = document.createElement('div');
      descTitle.className = 'plugin-section-title';
      descTitle.textContent = 'Description';
      descSection.appendChild(descTitle);
      const descText = document.createElement('div');
      descText.className = 'plugin-detail-desc';
      descText.textContent = plugin.description;
      descSection.appendChild(descText);
      overviewPanel.appendChild(descSection);
    }

    // Author
    if (plugin.author) {
      const authorSection = document.createElement('div');
      authorSection.className = 'plugin-detail-section';
      const authorTitle = document.createElement('div');
      authorTitle.className = 'plugin-section-title';
      authorTitle.textContent = 'Author';
      authorSection.appendChild(authorTitle);
      const authorText = document.createElement('div');
      authorText.textContent = plugin.author;
      authorSection.appendChild(authorText);
      overviewPanel.appendChild(authorSection);
    }

    panelsContainer.appendChild(overviewPanel);

    // --- Settings Panel ---
    const settingsPanel = document.createElement('div');
    settingsPanel.id = 'panel-settings';
    settingsPanel.setAttribute('role', 'tabpanel');
    settingsPanel.setAttribute('aria-labelledby', 'tab-settings');
    settingsPanel.hidden = this.detailTab !== 'settings';
    settingsPanel.className = 'plugin-tab-panel';

    // Get manifest settings schema and stored values
    const manifestSettings = plugin.manifest?.settings || {};
    const pluginSettingsData = this.settingsMap.get(plugin.name);
    const storedMetadata = pluginSettingsData?.metadata || {};
    const storedValues = pluginSettingsData?.values || {};

    // Merge manifest schema with stored metadata
    const allSettingKeys = new Set([...Object.keys(manifestSettings), ...Object.keys(storedMetadata)]);

    if (allSettingKeys.size > 0) {
      const settingsSection = document.createElement('div');
      settingsSection.className = 'plugin-detail-section';

      const settingsTitle = document.createElement('div');
      settingsTitle.className = 'plugin-section-title';
      settingsTitle.textContent = 'Configuration';
      settingsSection.appendChild(settingsTitle);

      const group = document.createElement('div');
      group.className = 'plugin-settings-group';

      allSettingKeys.forEach((key) => {
        const manifestMeta = manifestSettings[key] || {};
        const storedMeta = storedMetadata[key] || {};
        const meta = { ...storedMeta, ...manifestMeta };
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

        const currentValue = storedValues[key] !== undefined ? storedValues[key] : (meta.default !== undefined ? meta.default : meta.defaultValue);

        const type = meta.type || (typeof currentValue === 'boolean' ? 'boolean' : typeof currentValue === 'number' ? 'number' : 'string');

        if (type === 'boolean') {
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
        } else if ((type === 'select' || type === 'enum') && Array.isArray(meta.options)) {
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
        } else if (type === 'number') {
          const input = document.createElement('input');
          input.type = 'number';
          input.className = 'plugin-setting-input';
          input.value = currentValue !== undefined ? currentValue : '';
          input.addEventListener('change', (e) => {
            this.updateSetting(plugin.name, key, parseFloat(e.target.value) || 0);
          });
          row.appendChild(input);
        } else if (type === 'color') {
          const input = document.createElement('input');
          input.type = 'color';
          input.className = 'plugin-setting-input plugin-setting-color';
          input.value = typeof currentValue === 'string' && currentValue.startsWith('#') ? currentValue : '#000000';
          input.addEventListener('change', (e) => {
            this.updateSetting(plugin.name, key, e.target.value);
          });
          row.appendChild(input);
        } else if (type === 'path') {
          const input = document.createElement('input');
          input.type = 'text';
          input.className = 'plugin-setting-input';
          input.placeholder = 'Select a file or folder...';
          input.value = currentValue ?? '';
          input.readOnly = true;
          input.addEventListener('click', async () => {
            const path = await this.pluginManager.pickFile?.({ title: `Select ${meta.label || key}` });
            if (path) {
              input.value = path;
              this.updateSetting(plugin.name, key, path);
            }
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
            if (type === 'json') {
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
      settingsPanel.appendChild(settingsSection);
    } else {
      const emptyState = document.createElement('div');
      emptyState.className = 'plugin-settings-empty';
      emptyState.textContent = 'This plugin has no configurable settings.';
      settingsPanel.appendChild(emptyState);
    }

    panelsContainer.appendChild(settingsPanel);

    // --- Contributions Panel ---
    const contribPanel = document.createElement('div');
    contribPanel.id = 'panel-contributions';
    contribPanel.setAttribute('role', 'tabpanel');
    contribPanel.setAttribute('aria-labelledby', 'tab-contributions');
    contribPanel.hidden = this.detailTab !== 'contributions';
    contribPanel.className = 'plugin-tab-panel';

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
      contribPanel.appendChild(contribSection);
    } else {
      const emptyState = document.createElement('div');
      emptyState.className = 'plugin-contributions-empty';
      emptyState.textContent = 'This plugin contributes no features.';
      contribPanel.appendChild(emptyState);
    }

    panelsContainer.appendChild(contribPanel);

    // --- Permissions Panel ---
    const permPanel = document.createElement('div');
    permPanel.id = 'panel-permissions';
    permPanel.setAttribute('role', 'tabpanel');
    permPanel.setAttribute('aria-labelledby', 'tab-permissions');
    permPanel.hidden = this.detailTab !== 'permissions';
    permPanel.className = 'plugin-tab-panel';

    // All known permissions from manifest schema
    const ALL_PERMISSIONS = [
      'editor.read', 'editor.write', 'editor.selection', 'editor.commands',
      'file.read', 'file.write', 'file.save', 'file.export',
      'settings.read', 'settings.write',
      'ui.menus', 'ui.statusbar', 'ui.notifications',
      'clipboard.read', 'clipboard.write',
      'ui.panels', 'ui.customViews',
      'editor.slashCommands',
      'clipboard.smartPaste',
      'network.request', 'network.request:write'
    ];

    const requestedPerms = plugin.manifest?.permissions || [];
    const grantedPerms = plugin.permissions || [];

    if (requestedPerms.length > 0 || grantedPerms.length > 0) {
      const permSection = document.createElement('div');
      permSection.className = 'plugin-detail-section';

      const permTitle = document.createElement('div');
      permTitle.className = 'plugin-section-title';
      permTitle.textContent = 'Permissions';
      permSection.appendChild(permTitle);

      // Requested permissions (from manifest) - always shown
      if (requestedPerms.length > 0) {
        const requestedTitle = document.createElement('div');
        requestedTitle.className = 'plugin-subsection-title';
        requestedTitle.textContent = 'Requested (from manifest)';
        requestedTitle.style.cssText = 'font-size: 12px; font-weight: 600; color: var(--fm-text-muted); margin: 16px 0 8px 0;';
        permSection.appendChild(requestedTitle);

        const requestedList = document.createElement('div');
        requestedList.className = 'plugin-permission-list';
        requestedPerms.forEach((perm) => {
          const row = document.createElement('div');
          row.className = 'plugin-permission-row';
          row.style.cssText = 'display: flex; align-items: center; gap: 12px; padding: 8px 0;';

          const label = document.createElement('label');
          label.className = 'plugin-permission-label';
          label.style.cssText = 'flex: 1; display: flex; align-items: center; gap: 8px; cursor: pointer;';

          const checkbox = document.createElement('input');
          checkbox.type = 'checkbox';
          checkbox.checked = grantedPerms.includes(perm);
          checkbox.disabled = true; // Requested perms are always granted when plugin is enabled
          checkbox.style.cssText = 'width: 16px; height: 16px; accent-color: var(--fm-accent);';
          label.appendChild(checkbox);

          const permName = document.createElement('span');
          permName.textContent = perm;
          permName.style.cssText = 'font-family: var(--fm-font-mono); font-size: 12px;';
          label.appendChild(permName);

          row.appendChild(label);
          requestedList.appendChild(row);
        });
        permSection.appendChild(requestedList);
      }

      // Additional available permissions that can be granted/revoked at runtime
      const additionalPerms = ALL_PERMISSIONS.filter(p => !requestedPerms.includes(p));
      if (additionalPerms.length > 0) {
        const additionalTitle = document.createElement('div');
        additionalTitle.className = 'plugin-subsection-title';
        additionalTitle.textContent = 'Available (grant at runtime)';
        additionalTitle.style.cssText = 'font-size: 12px; font-weight: 600; color: var(--fm-text-muted); margin: 16px 0 8px 0;';
        permSection.appendChild(additionalTitle);

        const additionalList = document.createElement('div');
        additionalList.className = 'plugin-permission-list';
        additionalPerms.forEach((perm) => {
          const row = document.createElement('div');
          row.className = 'plugin-permission-row';
          row.style.cssText = 'display: flex; align-items: center; gap: 12px; padding: 8px 0;';

          const label = document.createElement('label');
          label.className = 'plugin-permission-label';
          label.style.cssText = 'flex: 1; display: flex; align-items: center; gap: 8px; cursor: pointer;';

          const checkbox = document.createElement('input');
          checkbox.type = 'checkbox';
          checkbox.checked = grantedPerms.includes(perm);
          checkbox.style.cssText = 'width: 16px; height: 16px; accent-color: var(--fm-accent);';
          label.appendChild(checkbox);

          const permName = document.createElement('span');
          permName.textContent = perm;
          permName.style.cssText = 'font-family: var(--fm-font-mono); font-size: 12px;';
          label.appendChild(permName);

          const status = document.createElement('span');
          status.textContent = grantedPerms.includes(perm) ? 'Granted' : 'Revoked';
          status.className = grantedPerms.includes(perm) ? 'plugin-perm-status granted' : 'plugin-perm-status revoked';
          status.style.cssText = 'font-size: 11px; padding: 2px 8px; border-radius: 10px; background: var(--fm-bg-tertiary);';
          label.appendChild(status);

          row.appendChild(label);
          additionalList.appendChild(row);

          checkbox.addEventListener('change', async (e) => {
            e.stopPropagation();
            checkbox.disabled = true;
            try {
              if (checkbox.checked) {
                await this.pluginManager.grantPermission?.(plugin.name, perm);
                status.textContent = 'Granted';
                status.className = 'plugin-perm-status granted';
              } else {
                await this.pluginManager.revokePermission?.(plugin.name, perm);
                status.textContent = 'Revoked';
                status.className = 'plugin-perm-status revoked';
              }
              // Reload plugin data to reflect changes
              await this.loadData();
            } catch (err) {
              this.showToast(`Failed to update permission: ${err.message}`, 'error');
              checkbox.checked = !checkbox.checked; // revert
            } finally {
              checkbox.disabled = false;
            }
          });
        });
        permSection.appendChild(additionalList);
      }

      permPanel.appendChild(permSection);
    } else {
      const emptyState = document.createElement('div');
      emptyState.className = 'plugin-permissions-empty';
      emptyState.textContent = 'This plugin requests no permissions.';
      permPanel.appendChild(emptyState);
    }

    panelsContainer.appendChild(permPanel);

    // --- Location Panel ---
    const locationPanel = document.createElement('div');
    locationPanel.id = 'panel-location';
    locationPanel.setAttribute('role', 'tabpanel');
    locationPanel.setAttribute('aria-labelledby', 'tab-location');
    locationPanel.hidden = this.detailTab !== 'location';
    locationPanel.className = 'plugin-tab-panel';

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

      const openBtn = document.createElement('button');
      openBtn.className = 'plugins-btn-secondary';
      openBtn.appendChild(createIcon(Folder, { width: 13, height: 13 }));
      const openText = document.createElement('span');
      openText.textContent = 'Open in Explorer';
      openBtn.appendChild(openText);
      openBtn.addEventListener('click', () => {
        this.pluginManager.openPath?.(plugin.path);
      });
      pathSection.appendChild(openBtn);

      locationPanel.appendChild(pathSection);
    } else {
      const emptyState = document.createElement('div');
      emptyState.className = 'plugin-location-empty';
      emptyState.textContent = 'Plugin location unknown.';
      locationPanel.appendChild(emptyState);
    }

    panelsContainer.appendChild(locationPanel);

    // --- Manage Panel ---
    const managePanel = document.createElement('div');
    managePanel.id = 'panel-manage';
    managePanel.setAttribute('role', 'tabpanel');
    managePanel.setAttribute('aria-labelledby', 'tab-manage');
    managePanel.hidden = this.detailTab !== 'manage';
    managePanel.className = 'plugin-tab-panel';

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
    managePanel.appendChild(dangerSection);

    // Add reload button
    const reloadSection = document.createElement('div');
    reloadSection.className = 'plugin-detail-section';

    const reloadTitle = document.createElement('div');
    reloadTitle.className = 'plugin-section-title';
    reloadTitle.textContent = 'Reload Plugin';
    reloadSection.appendChild(reloadTitle);

    const reloadBtn = document.createElement('button');
    reloadBtn.className = 'plugins-btn-secondary';
    reloadBtn.appendChild(createIcon(RotateCw, { width: 13, height: 13 }));
    const reloadText = document.createElement('span');
    reloadText.textContent = 'Reload this plugin';
    reloadBtn.appendChild(reloadText);
    reloadBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (this.inFlightActions.has(plugin.name)) return;
      this.inFlightActions.add(plugin.name);
      this.render();
      try {
        if (this.pluginManager.reloadPlugin) {
          await this.pluginManager.reloadPlugin(plugin.name);
        } else {
          // Fallback: disable then enable
          await this.togglePlugin(plugin, false);
          await this.togglePlugin(plugin, true);
        }
        this.showToast(`Plugin "${plugin.name}" reloaded.`, 'success');
      } catch (err) {
        this.showToast(`Reload failed: ${err.message}`, 'error');
      } finally {
        this.inFlightActions.delete(plugin.name);
        this.render();
      }
    });
    reloadSection.appendChild(reloadBtn);
    managePanel.appendChild(reloadSection);

    // Dev Mode: Hot Reload (only shown when FLOWMARK_DEV=1)
    if (window.appAPI?.isDevMode) {
      const isDev = await this.getDevMode();
      if (seq !== undefined && seq !== this._renderSeq) return;
      if (isDev) {
        const devReloadSection = document.createElement('div');
        devReloadSection.className = 'plugin-detail-section';

        const devReloadTitle = document.createElement('div');
        devReloadTitle.className = 'plugin-section-title';
        devReloadTitle.textContent = 'Dev Mode: Hot Reload';
        devReloadSection.appendChild(devReloadTitle);

        const devReloadBtn = document.createElement('button');
        devReloadBtn.className = 'plugins-btn-primary';
        devReloadBtn.appendChild(createIcon(RotateCw, { width: 13, height: 13 }));
        const devReloadText = document.createElement('span');
        devReloadText.textContent = 'Hot Reload (instant)';
        devReloadBtn.appendChild(devReloadText);
        devReloadBtn.addEventListener('click', async (e) => {
          e.stopPropagation();
          this.inFlightActions.add(plugin.name);
          this.render();
          try {
            if (this.pluginManager.devReload) {
              const result = await this.pluginManager.devReload(plugin.name);
              if (result?.success) {
                this.showToast(`Plugin "${plugin.name}" hot reloaded.`, 'success');
              } else {
                this.showToast(`Hot reload failed: ${result?.error || 'Unknown error'}`, 'error');
              }
            } else {
              this.showToast('Hot reload not available', 'error');
            }
          } catch (err) {
            this.showToast(`Hot reload error: ${err.message}`, 'error');
          } finally {
            this.inFlightActions.delete(plugin.name);
            this.render();
          }
        });
        devReloadSection.appendChild(devReloadBtn);
        managePanel.appendChild(devReloadSection);
      }
    }

    panelsContainer.appendChild(managePanel);

    // --- Registry Panel ---
    const registryPanel = document.createElement('div');
    registryPanel.id = 'panel-registry';
    registryPanel.setAttribute('role', 'tabpanel');
    registryPanel.setAttribute('aria-labelledby', 'tab-registry');
    registryPanel.hidden = this.detailTab !== 'registry';
    registryPanel.className = 'plugin-tab-panel';

    // Load registry index
    this._renderRegistryPanel(registryPanel);

    panelsContainer.appendChild(registryPanel);

    content.appendChild(panelsContainer);
    if (seq !== undefined && seq !== this._renderSeq) return;

    const existingContent = this.box.querySelector('.plugins-content');
    if (existingContent) {
      existingContent.replaceWith(content);
    } else {
      this.box.appendChild(content);
    }

    if (prevScrollTop) {
      content.scrollTop = prevScrollTop;
    }

    // Only focus back button on initial entry into detail view
    if (!wasDetailAlreadyOpen) {
      backBtn.focus();
    }
  }

  /**
   * Render the Registry panel with available plugins from registry index.
   * @private
   */
  async _renderRegistryPanel(container) {
    container.replaceChildren();

    const section = document.createElement('div');
    section.className = 'plugin-detail-section';

    const title = document.createElement('div');
    title.className = 'plugin-section-title';
    title.textContent = 'Plugin Registry';
    section.appendChild(title);

    const desc = document.createElement('div');
    desc.className = 'plugin-detail-desc';
    desc.textContent = 'Browse and install plugins from the FlowMark registry.';
    desc.style.marginBottom = '16px';
    section.appendChild(desc);

    try {
      // Load registry index via IPC
      const registry = await window.pluginRegistryAPI?.getRegistry?.() || {};

      const entries = Array.isArray(registry?.extensions)
        ? registry.extensions.map(ext => [ext.id, ext])
        : Object.entries(registry);
      if (entries.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'plugin-registry-empty';
        empty.textContent = 'No plugins in registry yet.';
        section.appendChild(empty);
        container.appendChild(section);
        return;
      }

      const grid = document.createElement('div');
      grid.className = 'plugin-registry-grid';
      grid.style.cssText = 'display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 12px;';

      for (const [key, plugin] of entries) {
        const card = document.createElement('div');
        card.className = 'plugin-registry-card';
        card.style.cssText = 'background: var(--fm-bg-secondary); border: 1px solid var(--fm-border); border-radius: 8px; padding: 16px; display: flex; flex-direction: column; gap: 12px;';

        const header = document.createElement('div');
        header.style.cssText = 'display: flex; align-items: flex-start; justify-content: space-between; gap: 12px;';

        const info = document.createElement('div');
        const name = document.createElement('div');
        name.style.cssText = 'font-weight: 600; font-size: 14px;';
        name.textContent = plugin.name || key;
        info.appendChild(name);

        const version = document.createElement('div');
        version.style.cssText = 'font-size: 12px; color: var(--fm-text-muted);';
        version.textContent = `v${plugin.version}`;
        info.appendChild(version);

        if (plugin.description) {
          const descEl = document.createElement('div');
          descEl.style.cssText = 'font-size: 12px; color: var(--fm-text-muted); margin-top: 4px;';
          descEl.textContent = plugin.description;
          info.appendChild(descEl);
        }

        header.appendChild(info);
        card.appendChild(header);

        const actions = document.createElement('div');
        actions.style.cssText = 'display: flex; gap: 8px; margin-top: auto;';

        const installBtn = document.createElement('button');
        installBtn.className = 'plugins-btn-primary';
        installBtn.style.flex = '1';
        installBtn.textContent = 'Install';
        installBtn.addEventListener('click', async () => {
          installBtn.disabled = true;
          installBtn.textContent = 'Downloading...';
          try {
            if (!plugin.repo) throw new Error('No repository URL in registry');
            const zipUrl = `${plugin.repo}/archive/refs/heads/main.zip`;
            const resp = await fetch(zipUrl);
            if (!resp.ok) throw new Error(`Failed to download: ${resp.status}`);
            const blob = await resp.blob();
            const arrayBuffer = await blob.arrayBuffer();
            const base64 = arrayBufferToBase64(arrayBuffer);

            installBtn.textContent = 'Installing...';

            if (!this.pluginManager?.installFromGitHubZip) throw new Error('Install API not available');
            const result = await this.pluginManager.installFromGitHubZip(base64);
            if (result?.success) {
              this.showToast(`Plugin "${plugin.name}" installed!`, 'success');
              await this.loadData();
              this.render(); // Refresh registry panel
            } else {
              throw new Error(result?.error || 'Unknown error');
            }
          } catch (err) {
            this.showToast(`Install failed: ${err.message}`, 'error');
            installBtn.disabled = false;
            installBtn.textContent = 'Install';
          }
        });
        actions.appendChild(installBtn);

        if (plugin.repo) {
          const repoBtn = document.createElement('button');
          repoBtn.className = 'plugins-btn-secondary';
          repoBtn.style.cssText = 'padding: 0 12px;';
          repoBtn.appendChild(createIcon(GitBranch, { width: 14, height: 14 }));
          const repoText = document.createElement('span');
          repoText.textContent = ' View Source';
          repoBtn.appendChild(repoText);
          repoBtn.addEventListener('click', () => {
            window.shellAPI.openExternal(plugin.repo);
          });
          actions.appendChild(repoBtn);
        }

        card.appendChild(actions);
        grid.appendChild(card);
      }

      section.appendChild(grid);
    } catch (err) {
      console.error('[PluginManagerPanel] Registry load error:', err);
      const errorEl = document.createElement('div');
      errorEl.className = 'plugin-registry-error';
      errorEl.style.cssText = 'color: var(--fm-error); padding: 16px; text-align: center;';
      errorEl.textContent = `Failed to load registry: ${err.message}`;
      section.appendChild(errorEl);
    }

    container.appendChild(section);
  }
}
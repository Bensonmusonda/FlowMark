import {
  createElement,
  Search,
  RefreshCw,
  FolderPlus,
} from 'lucide';

function icon(Component, size = 14) {
  return createElement(Component, {
    width: size,
    height: size,
    'aria-hidden': 'true',
    focusable: 'false',
  });
}

function compareSemver(a = '0.0.0', b = '0.0.0') {
  const pa = String(a).replace(/^v/, '').split('.').map(n => parseInt(n, 10) || 0);
  const pb = String(b).replace(/^v/, '').split('.').map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) > (pb[i] || 0)) return 1;
    if ((pa[i] || 0) < (pb[i] || 0)) return -1;
  }
  return 0;
}

export class ExtensionsSidebarView {
  constructor({ container, onOpenExtension, onUpdateCountChange } = {}) {
    this.container = container;
    this.onOpenExtension = onOpenExtension;
    this.onUpdateCountChange = onUpdateCountChange;
    this.installed = [];
    this.registry = [];
    this.registryOffline = false;
    this.searchQuery = '';
    this.loadingRegistry = false;
    this.busyIds = new Set();
    this.statusMessage = null;
    this.initialized = false;
    this.unsubscribe = null;
    this.renderShell();
    if (typeof window !== 'undefined' && window.pluginRegistryAPI?.getRegistry) {
      setTimeout(() => this.activate(), 1500);
    }
  }

  activate() {
    if (!this.initialized) {
      this.initialized = true;
      if (window.pluginManager?.onPluginsChanged) {
        this.unsubscribe = window.pluginManager.onPluginsChanged((plugins) => {
          this.installed = Array.isArray(plugins) ? plugins : [];
          this.renderLists();
        });
      }
      this.refreshAll();
    } else {
      this.loadInstalled();
    }
  }

  async refreshAll() {
    await Promise.all([this.loadInstalled(), this.loadRegistry()]);
  }

  async loadInstalled() {
    try {
      const list = await window.pluginManager?.getPlugins?.();
      this.installed = Array.isArray(list) ? list : [];
    } catch (_) {
      this.installed = [];
    }
    this.renderLists();
  }

  async loadRegistry() {
    this.loadingRegistry = true;
    this.renderLists();
    try {
      const data = await window.pluginRegistryAPI?.getRegistry?.();
      if (Array.isArray(data?.extensions)) {
        this.registry = data.extensions;
        this.registryOffline = Boolean(data.offline);
      } else if (data && typeof data === 'object') {
        this.registry = Object.entries(data).map(([id, item]) => ({ id, ...item }));
        this.registryOffline = true;
      } else {
        this.registry = [];
      }
    } catch (_) {
      this.registryOffline = true;
    } finally {
      this.loadingRegistry = false;
      this.renderLists();
    }
  }

  setStatus(text, isError = false) {
    this.statusMessage = text ? { text, isError } : null;
    this.renderStatus();
    if (text) {
      clearTimeout(this._statusTimer);
      this._statusTimer = setTimeout(() => {
        this.statusMessage = null;
        this.renderStatus();
      }, 3500);
    }
  }

  renderShell() {
    this.container.replaceChildren();

    const header = document.createElement('div');
    header.className = 'sidebar-heading';

    const title = document.createElement('span');
    title.className = 'sidebar-title';
    title.textContent = 'Extensions';
    header.appendChild(title);

    const refreshBtn = document.createElement('button');
    refreshBtn.type = 'button';
    refreshBtn.className = 'sidebar-icon-button';
    refreshBtn.title = 'Refresh Extensions Registry';
    refreshBtn.setAttribute('aria-label', 'Refresh Extensions Registry');
    refreshBtn.appendChild(icon(RefreshCw, 14));
    refreshBtn.addEventListener('click', () => this.refreshAll());
    header.appendChild(refreshBtn);

    const localBtn = document.createElement('button');
    localBtn.type = 'button';
    localBtn.className = 'sidebar-icon-button';
    localBtn.title = 'Install from Local Folder...';
    localBtn.setAttribute('aria-label', 'Install from Local Folder');
    localBtn.appendChild(icon(FolderPlus, 14));
    localBtn.addEventListener('click', async () => {
      const res = await window.pluginManager?.installFromFolder?.();
      if (res?.success) {
        this.setStatus(`Installed "${res.pluginId}"`);
        await this.loadInstalled();
      } else if (res?.error && res.error !== 'Canceled') {
        this.setStatus(res.error, true);
      }
    });
    header.appendChild(localBtn);

    this.container.appendChild(header);

    const searchWrap = document.createElement('div');
    searchWrap.className = 'ext-search-wrap';
    searchWrap.appendChild(icon(Search, 13));
    const searchInput = document.createElement('input');
    searchInput.type = 'text';
    searchInput.className = 'ext-search-input';
    searchInput.placeholder = 'Search extensions...';
    searchInput.setAttribute('aria-label', 'Search extensions');
    searchInput.addEventListener('input', (e) => {
      this.searchQuery = e.target.value.trim().toLowerCase();
      this.renderLists();
    });
    searchWrap.appendChild(searchInput);
    this.container.appendChild(searchWrap);

    this.statusEl = document.createElement('div');
    this.statusEl.className = 'ext-status-banner hidden';
    this.container.appendChild(this.statusEl);

    this.bodyEl = document.createElement('div');
    this.bodyEl.className = 'ext-sidebar-body';
    this.container.appendChild(this.bodyEl);
  }

  renderStatus() {
    if (!this.statusEl) return;
    if (!this.statusMessage) {
      this.statusEl.className = 'ext-status-banner hidden';
      this.statusEl.textContent = '';
      return;
    }
    this.statusEl.className = `ext-status-banner${this.statusMessage.isError ? ' error' : ''}`;
    this.statusEl.textContent = this.statusMessage.text;
  }

  matchesQuery(ext) {
    if (!this.searchQuery) return true;
    const haystack = [
      ext.id,
      ext.name,
      ext.displayName,
      ext.description,
      ext.author,
      ...(Array.isArray(ext.tags) ? ext.tags : []),
    ].join(' ').toLowerCase();
    return haystack.includes(this.searchQuery);
  }

  renderLists() {
    if (!this.bodyEl) return;
    this.bodyEl.replaceChildren();

    const installedMap = new Map(this.installed.map(p => [p.name, p]));
    const registryMap = new Map(this.registry.map(r => [r.id, r]));

    // ── Installed Section ────────────────────────────────────────────────
    const installedFiltered = this.installed.filter(p => this.matchesQuery(p));
    const installedSection = document.createElement('div');
    installedSection.className = 'ext-section';

    const installedHeader = document.createElement('div');
    installedHeader.className = 'ext-section-title';
    installedHeader.textContent = `Installed (${installedFiltered.length})`;
    installedSection.appendChild(installedHeader);

    if (installedFiltered.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'ext-empty';
      empty.textContent = this.searchQuery ? 'No matching installed extensions.' : 'No extensions installed yet.';
      installedSection.appendChild(empty);
    } else {
      for (const plugin of installedFiltered) {
        installedSection.appendChild(this.createInstalledCard(plugin, registryMap.get(plugin.name)));
      }
    }
    this.bodyEl.appendChild(installedSection);

    // ── Marketplace / Discover Section ───────────────────────────────────
    const discoverFiltered = this.registry.filter(r => this.matchesQuery(r));
    const discoverSection = document.createElement('div');
    discoverSection.className = 'ext-section';

    const discoverHeader = document.createElement('div');
    discoverHeader.className = 'ext-section-title';
    discoverHeader.textContent = this.registryOffline ? 'Marketplace (Offline Cache)' : 'Marketplace';
    discoverSection.appendChild(discoverHeader);

    if (this.loadingRegistry && this.registry.length === 0) {
      const loading = document.createElement('div');
      loading.className = 'ext-empty';
      loading.textContent = 'Fetching extensions from GitHub...';
      discoverSection.appendChild(loading);
    } else if (discoverFiltered.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'ext-empty';
      empty.textContent = this.searchQuery ? 'No matching marketplace extensions.' : 'No extensions found in registry.';
      discoverSection.appendChild(empty);
    } else {
      for (const item of discoverFiltered) {
        discoverSection.appendChild(this.createRegistryCard(item, installedMap.get(item.id)));
      }
    }
    this.bodyEl.appendChild(discoverSection);

    let updateCount = 0;
    for (const plugin of this.installed) {
      const reg = registryMap.get(plugin.name);
      if (reg?.downloadUrl && compareSemver(reg.version, plugin.version) > 0) {
        updateCount++;
      }
    }
    this.onUpdateCountChange?.(updateCount);
  }

  createCardElement({ title, description, author, hasUpdate = false, onOpen }) {
    const card = document.createElement('div');
    card.className = 'ext-card';
    card.setAttribute('role', 'button');
    card.tabIndex = 0;

    if (hasUpdate) {
      const head = document.createElement('div');
      head.className = 'ext-card-head';
      const nameEl = document.createElement('div');
      nameEl.className = 'ext-card-name';
      nameEl.textContent = title;
      head.appendChild(nameEl);
      const badge = document.createElement('span');
      badge.className = 'ext-card-update-badge';
      badge.textContent = 'Update';
      head.appendChild(badge);
      card.appendChild(head);
    } else {
      const nameEl = document.createElement('div');
      nameEl.className = 'ext-card-name';
      nameEl.textContent = title;
      card.appendChild(nameEl);
    }

    if (description) {
      const desc = document.createElement('div');
      desc.className = 'ext-card-desc';
      desc.textContent = description;
      card.appendChild(desc);
    }

    const authorEl = document.createElement('div');
    authorEl.className = 'ext-card-author';
    authorEl.textContent = author || 'FlowMark';
    card.appendChild(authorEl);

    card.addEventListener('click', () => onOpen?.());
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onOpen?.();
      }
    });

    return card;
  }

  createInstalledCard(plugin, registryEntry) {
    const title = plugin.displayName || plugin.name;
    const author = plugin.author || registryEntry?.author || 'FlowMark';
    const hasUpdate = Boolean(
      registryEntry?.downloadUrl && compareSemver(registryEntry.version, plugin.version) > 0
    );
    return this.createCardElement({
      title,
      description: plugin.description,
      author,
      hasUpdate,
      onOpen: () => this.onOpenExtension?.({
        id: plugin.name,
        name: title,
        version: plugin.version || '1.0.0',
        description: plugin.description || '',
        author,
        permissions: plugin.permissions || [],
        active: Boolean(plugin.active),
        installed: true,
        error: plugin.error || null,
        downloadUrl: registryEntry?.downloadUrl || null,
        registryVersion: registryEntry?.version || null,
        homepage: registryEntry?.homepage || null,
        readmeUrl: registryEntry?.readmeUrl || null,
      }),
    });
  }

  createRegistryCard(item, installedPlugin) {
    const title = item.name || item.id;
    const author = item.author || 'Community';
    return this.createCardElement({
      title,
      description: item.description,
      author,
      onOpen: () => this.onOpenExtension?.({
        id: item.id,
        name: title,
        version: installedPlugin?.version || item.version || '1.0.0',
        description: item.description || installedPlugin?.description || '',
        author,
        permissions: item.permissions || installedPlugin?.permissions || [],
        active: Boolean(installedPlugin?.active),
        installed: Boolean(installedPlugin),
        error: installedPlugin?.error || null,
        downloadUrl: item.downloadUrl || null,
        registryVersion: item.version || null,
        homepage: item.homepage || null,
        readmeUrl: item.readmeUrl || null,
      }),
    });
  }

  async installFromRegistry(item, isUpdate) {
    this.busyIds.add(item.id);
    this.renderLists();
    try {
      const res = await window.pluginManager?.installFromUrl?.({
        url: item.downloadUrl,
        pluginId: item.id,
        update: isUpdate,
      });
      if (res?.success) {
        this.setStatus(`${isUpdate ? 'Updated' : 'Installed'} "${item.name || item.id}"`);
        await this.loadInstalled();
      } else {
        this.setStatus(res?.error || 'Installation failed', true);
      }
    } catch (err) {
      this.setStatus(err.message || 'Installation failed', true);
    } finally {
      this.busyIds.delete(item.id);
      this.renderLists();
    }
  }
}

export default ExtensionsSidebarView;

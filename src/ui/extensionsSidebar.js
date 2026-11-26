import {
  createElement,
  Puzzle,
  Search,
  RefreshCw,
  FolderPlus,
  Download,
  Trash2,
  Check,
  ArrowUpCircle,
  Power,
  ExternalLink,
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
  constructor({ container }) {
    this.container = container;
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
  }

  createInstalledCard(plugin, registryEntry) {
    const card = document.createElement('div');
    card.className = `ext-card${plugin.active ? ' is-active' : ''}`;

    const top = document.createElement('div');
    top.className = 'ext-card-top';

    const titleWrap = document.createElement('div');
    titleWrap.className = 'ext-card-title-wrap';
    const nameEl = document.createElement('span');
    nameEl.className = 'ext-card-name';
    nameEl.textContent = plugin.displayName || plugin.name;
    titleWrap.appendChild(nameEl);

    const verEl = document.createElement('span');
    verEl.className = 'ext-card-version';
    verEl.textContent = `v${plugin.version || '1.0.0'}`;
    titleWrap.appendChild(verEl);
    top.appendChild(titleWrap);

    const badge = document.createElement('span');
    badge.className = `ext-state-dot${plugin.active ? ' active' : plugin.error ? ' error' : ''}`;
    badge.title = plugin.active ? 'Enabled' : plugin.error ? `Error: ${plugin.error}` : 'Disabled';
    top.appendChild(badge);
    card.appendChild(top);

    if (plugin.description) {
      const desc = document.createElement('div');
      desc.className = 'ext-card-desc';
      desc.textContent = plugin.description;
      card.appendChild(desc);
    }

    const actions = document.createElement('div');
    actions.className = 'ext-card-actions';

    const isBusy = this.busyIds.has(plugin.name);

    const toggleBtn = document.createElement('button');
    toggleBtn.type = 'button';
    toggleBtn.className = 'ext-btn';
    toggleBtn.disabled = isBusy;
    toggleBtn.appendChild(icon(Power, 12));
    toggleBtn.appendChild(document.createTextNode(plugin.active ? ' Disable' : ' Enable'));
    toggleBtn.addEventListener('click', async () => {
      this.busyIds.add(plugin.name);
      this.renderLists();
      try {
        if (plugin.active) await window.pluginManager?.disable?.(plugin.name);
        else await window.pluginManager?.enable?.(plugin.name);
        await this.loadInstalled();
      } catch (err) {
        this.setStatus(err.message || 'Action failed', true);
      } finally {
        this.busyIds.delete(plugin.name);
        this.renderLists();
      }
    });
    actions.appendChild(toggleBtn);

    if (registryEntry?.downloadUrl && compareSemver(registryEntry.version, plugin.version) > 0) {
      const updateBtn = document.createElement('button');
      updateBtn.type = 'button';
      updateBtn.className = 'ext-btn ext-btn-primary';
      updateBtn.disabled = isBusy;
      updateBtn.appendChild(icon(ArrowUpCircle, 12));
      updateBtn.appendChild(document.createTextNode(` Update v${registryEntry.version}`));
      updateBtn.addEventListener('click', () => this.installFromRegistry(registryEntry, true));
      actions.appendChild(updateBtn);
    }

    const uninstallBtn = document.createElement('button');
    uninstallBtn.type = 'button';
    uninstallBtn.className = 'ext-btn ext-btn-icon';
    uninstallBtn.title = 'Uninstall';
    uninstallBtn.setAttribute('aria-label', `Uninstall ${plugin.name}`);
    uninstallBtn.disabled = isBusy;
    uninstallBtn.appendChild(icon(Trash2, 12));
    uninstallBtn.addEventListener('click', async () => {
      this.busyIds.add(plugin.name);
      this.renderLists();
      try {
        await window.pluginManager?.uninstall?.(plugin.name);
        this.setStatus(`Uninstalled "${plugin.name}"`);
        await this.loadInstalled();
      } catch (err) {
        this.setStatus(err.message || 'Uninstall failed', true);
      } finally {
        this.busyIds.delete(plugin.name);
        this.renderLists();
      }
    });
    actions.appendChild(uninstallBtn);

    card.appendChild(actions);
    return card;
  }

  createRegistryCard(item, installedPlugin) {
    const card = document.createElement('div');
    card.className = 'ext-card';

    const top = document.createElement('div');
    top.className = 'ext-card-top';

    const titleWrap = document.createElement('div');
    titleWrap.className = 'ext-card-title-wrap';
    const nameEl = document.createElement('span');
    nameEl.className = 'ext-card-name';
    nameEl.textContent = item.name || item.id;
    titleWrap.appendChild(nameEl);

    const verEl = document.createElement('span');
    verEl.className = 'ext-card-version';
    verEl.textContent = `v${item.version || '1.0.0'}`;
    titleWrap.appendChild(verEl);
    top.appendChild(titleWrap);
    card.appendChild(top);

    if (item.author) {
      const authorEl = document.createElement('div');
      authorEl.className = 'ext-card-author';
      authorEl.textContent = `by ${item.author}`;
      card.appendChild(authorEl);
    }

    if (item.description) {
      const desc = document.createElement('div');
      desc.className = 'ext-card-desc';
      desc.textContent = item.description;
      card.appendChild(desc);
    }

    if (Array.isArray(item.permissions) && item.permissions.length > 0) {
      const perms = document.createElement('div');
      perms.className = 'ext-perms';
      for (const p of item.permissions.slice(0, 3)) {
        const pill = document.createElement('span');
        pill.className = 'ext-perm-pill';
        pill.textContent = p;
        perms.appendChild(pill);
      }
      card.appendChild(perms);
    }

    const actions = document.createElement('div');
    actions.className = 'ext-card-actions';

    const isBusy = this.busyIds.has(item.id);
    if (installedPlugin) {
      const installedBadge = document.createElement('span');
      installedBadge.className = 'ext-installed-pill';
      installedBadge.appendChild(icon(Check, 12));
      installedBadge.appendChild(document.createTextNode(' Installed'));
      actions.appendChild(installedBadge);
    } else if (item.downloadUrl) {
      const installBtn = document.createElement('button');
      installBtn.type = 'button';
      installBtn.className = 'ext-btn ext-btn-primary';
      installBtn.disabled = isBusy;
      installBtn.appendChild(icon(Download, 12));
      installBtn.appendChild(document.createTextNode(isBusy ? ' Installing...' : ' Install'));
      installBtn.addEventListener('click', () => this.installFromRegistry(item, false));
      actions.appendChild(installBtn);
    }

    if (item.homepage) {
      const linkBtn = document.createElement('button');
      linkBtn.type = 'button';
      linkBtn.className = 'ext-btn ext-btn-icon';
      linkBtn.title = 'Open on GitHub';
      linkBtn.setAttribute('aria-label', 'Open on GitHub');
      linkBtn.appendChild(icon(ExternalLink, 12));
      linkBtn.addEventListener('click', () => {
        window.shellAPI?.openExternal?.(item.homepage);
      });
      actions.appendChild(linkBtn);
    }

    card.appendChild(actions);
    return card;
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

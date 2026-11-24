import {
  createElement,
  Folder,
  FolderOpen,
  FolderPlus,
  File,
  FilePlus2,
  ChevronRight,
  ChevronDown,
  Pencil,
  Trash2,
  FolderRoot,
  Settings,
} from 'lucide';
import { resolvePluginPanelIcon } from './pluginPanelIcons.js';
import { contextMenu } from './contextMenu.js';

function normalizedPath(value) {
  return String(value || '').replace(/\\/g, '/').toLowerCase();
}

export class FileTreeUI {
  constructor({ container, onOpenFolder, onOpenFile, onCreate, onRename, onDelete, onDuplicate, onRefresh, onToggleSidebar }) {
    this.container = container;
    this.onOpenFolder = onOpenFolder;
    this.onOpenFile = onOpenFile;
    this.onCreate = onCreate;
    this.onRename = onRename;
    this.onDelete = onDelete;
    this.onDuplicate = onDuplicate;
    this.onRefresh = onRefresh;
    this.onToggleSidebar = onToggleSidebar;
    this.rootPath = null;
    this.tree = [];
    this.activePath = null;
    this.selectedDirectory = '';
    this.expanded = new Set(['']);
    this.pendingInput = null;
    this.panels = new Map();
    this.panelViews = new Map();
    this.activeViewId = 'workspace';
    this.nav = document.createElement('nav');
    this.nav.className = 'sidebar-nav';
    this.nav.setAttribute('aria-label', 'Workspace views');
    this.viewContainer = document.createElement('div');
    this.viewContainer.className = 'sidebar-view-container';
    this.workspaceView = document.createElement('div');
    this.workspaceView.className = 'sidebar-panel sidebar-workspace-view';
    this.workspaceView.addEventListener('contextmenu', (e) => {
      if (e.target.closest('.tree-row') || e.target.closest('.sidebar-heading')) return;
      e.preventDefault();
      this.showBackgroundContextMenu(e);
    });
    this.viewContainer.appendChild(this.workspaceView);
    this.container.replaceChildren(this.nav, this.viewContainer);
    this.renderNavigation();
    this.render();
  }

  setWorkspace({ rootPath, tree }) {
    if (this.rootPath !== rootPath) {
      this.expanded = new Set(['']);
      this.selectedDirectory = '';
      this.pendingInput = null;
    }
    this.rootPath = rootPath || null;
    this.tree = Array.isArray(tree) ? tree : [];
    if (this.selectedDirectory && !this.hasDirectory(this.tree, this.selectedDirectory)) {
      this.selectedDirectory = '';
    }
    this.render();
  }

  hasDirectory(entries, relativePath) {
    return entries.some(entry =>
      (entry.type === 'directory' && entry.relativePath === relativePath) ||
      this.hasDirectory(entry.children || [], relativePath));
  }

  hasEntry(relativePath) {
    const norm = (p) => String(p || '').replace(/\\/g, '/').toLowerCase();
    const target = norm(relativePath);
    const search = (nodes) => nodes.some(n => norm(n.relativePath) === target || (n.children && search(n.children)));
    return search(this.tree);
  }

  showFileContextMenu(entry, absolutePath, e) {
    const items = [
      {
        label: 'Open',
        action: () => this.onOpenFile(entry.relativePath),
      },
      {
        label: 'Rename...',
        shortcut: 'F2',
        action: () => this.beginRename(entry),
      },
      {
        label: 'Duplicate',
        action: () => this.onDuplicate?.(entry),
      },
      {
        label: 'Delete',
        danger: true,
        action: () => this.onDelete(entry),
      },
      { divider: true },
      {
        label: 'Copy Path',
        action: () => navigator.clipboard.writeText(absolutePath),
      },
      {
        label: 'Copy Relative Path',
        action: () => navigator.clipboard.writeText(entry.relativePath),
      },
      {
        label: 'Reveal in File Explorer',
        action: () => window.shellAPI?.showItemInFolder?.(absolutePath),
      },
    ];

    contextMenu.show({
      x: e.clientX,
      y: e.clientY,
      items,
      target: 'file-tree:file',
      contextData: { entry, absolutePath },
    });
  }

  showFolderContextMenu(entry, absolutePath, e) {
    const items = [
      {
        label: 'New Note',
        action: () => this.beginCreate(entry.relativePath, 'file'),
      },
      {
        label: 'New Folder',
        action: () => this.beginCreate(entry.relativePath, 'directory'),
      },
      { divider: true },
      {
        label: 'Rename...',
        shortcut: 'F2',
        action: () => this.beginRename(entry),
      },
      {
        label: 'Delete',
        danger: true,
        action: () => this.onDelete(entry),
      },
      { divider: true },
      {
        label: 'Copy Path',
        action: () => navigator.clipboard.writeText(absolutePath),
      },
      {
        label: 'Copy Relative Path',
        action: () => navigator.clipboard.writeText(entry.relativePath),
      },
      {
        label: 'Reveal in File Explorer',
        action: () => window.shellAPI?.showItemInFolder?.(absolutePath),
      },
    ];

    contextMenu.show({
      x: e.clientX,
      y: e.clientY,
      items,
      target: 'file-tree:folder',
      contextData: { entry, absolutePath },
    });
  }

  showBackgroundContextMenu(e) {
    const hasRoot = Boolean(this.rootPath);
    const items = [
      {
        label: 'New Note',
        disabled: !hasRoot,
        action: () => this.beginCreate('', 'file'),
      },
      {
        label: 'New Folder',
        disabled: !hasRoot,
        action: () => this.beginCreate('', 'directory'),
      },
      { divider: true },
      {
        label: 'Refresh',
        disabled: !hasRoot,
        action: () => this.onRefresh?.(),
      },
      {
        label: 'Collapse All Folders',
        disabled: !hasRoot || this.expanded.size <= 1,
        action: () => {
          this.expanded = new Set(['']);
          this.render();
        },
      },
    ];

    contextMenu.show({
      x: e.clientX,
      y: e.clientY,
      items,
      target: 'file-tree:empty',
      contextData: { rootPath: this.rootPath },
    });
  }

  setActivePath(filePath) {
    this.activePath = filePath || null;
    this.render();
  }

  createIcon(name) {
    const iconNodes = {
      workspace: FolderRoot,
      folder: Folder,
      file: File,
      plusFile: FilePlus2,
      plusFolder: FolderPlus,
      openFolder: FolderOpen,
      chevronRight: ChevronRight,
      chevronDown: ChevronDown,
      rename: Pencil,
      remove: Trash2,
    };
    return this.createLucideIcon(iconNodes[name] || Folder);
  }

  createLucideIcon(icon) {
    return createElement(icon, {
      width: 20,
      height: 20,
      'aria-hidden': 'true',
      'focusable': 'false',
      class: 'line-icon',
    });
  }

  registerPanel(panel) {
    if (!panel?.id || (panel.location && panel.location !== 'left')) return false;
    const key = panel.instanceId || panel.id;
    const wasActive = this.activeViewId === key;
    this.unregisterPanelByKey(key);
    this.panels.set(key, panel);
    if (wasActive) this.activeViewId = key;
    const panelView = document.createElement('div');
    panelView.className = 'sidebar-panel sidebar-plugin-view';

    const header = document.createElement('div');
    header.className = 'sidebar-heading';
    const title = document.createElement('span');
    title.className = 'sidebar-title';
    title.textContent = panel.title || 'Plugin';
    header.appendChild(title);
    panelView.appendChild(header);

    const content = document.createElement('div');
    content.className = 'sidebar-plugin-content';
    if (!panel.entryUrl) {
      const placeholder = document.createElement('div');
      placeholder.className = 'sidebar-plugin-placeholder';
      placeholder.textContent = 'This plugin panel has no view.';
      content.appendChild(placeholder);
    }
    panelView.appendChild(content);
    panelView.hidden = true;
    this.panelViews.set(key, panelView);
    this.viewContainer.appendChild(panelView);
    this.renderNavigation();
    this.updateActiveView();
    return true;
  }

  unregisterPanel(pluginId, panelIds = []) {
    for (const [key, panel] of this.panels) {
      if (panel.pluginId !== pluginId || (panelIds.length && !panelIds.includes(panel.id))) continue;
      this.unregisterPanelByKey(key);
    }
    this.renderNavigation();
    this.updateActiveView();
  }

  unregisterPanelByKey(key) {
    this.panels.delete(key);
    this.panelViews.get(key)?.remove();
    this.panelViews.delete(key);
    if (this.activeViewId === key) this.activeViewId = 'workspace';
  }

  beginCreate(parentPath, type) {
    if (!this.rootPath) {
      this.onOpenFolder();
      return;
    }
    this.pendingInput = { parentPath, type };
    if (parentPath) this.expanded.add(parentPath);
    this.render();
    this.container.querySelector('.tree-inline-input')?.focus();
  }

  render() {
    const previousTree = this.workspaceView.querySelector('.file-tree');
    const previousScrollTop = previousTree ? previousTree.scrollTop : 0;
    const previousScrollLeft = previousTree ? previousTree.scrollLeft : 0;
    this.workspaceView.replaceChildren();

    const header = document.createElement('div');
    header.className = 'sidebar-heading';
    const title = document.createElement('span');
    title.className = 'sidebar-title';
    title.textContent = this.rootPath
      ? this.rootPath.split(/[\\/]/).filter(Boolean).pop() || this.rootPath
      : 'Workspace';
    title.title = this.rootPath || 'No folder open';
    header.appendChild(title);

    const openButton = document.createElement('button');
    openButton.className = 'sidebar-icon-button';
    openButton.type = 'button';
    openButton.replaceChildren(this.createIcon('openFolder'));
    openButton.title = 'Open Folder';
    openButton.setAttribute('aria-label', 'Open Folder');
    openButton.addEventListener('click', () => this.onOpenFolder());
    header.appendChild(openButton);

    for (const [type, label, titleText] of [
      ['file', 'plusFile', 'New Markdown File'],
      ['directory', 'plusFolder', 'New Folder'],
    ]) {
      const button = document.createElement('button');
      button.className = 'sidebar-icon-button';
      button.type = 'button';
      button.appendChild(this.createIcon(label));
      button.title = titleText;
      button.setAttribute('aria-label', titleText);
      button.disabled = !this.rootPath;
      button.addEventListener('click', () => this.beginCreate(this.selectedDirectory, type));
      header.appendChild(button);
    }
    this.workspaceView.appendChild(header);

    const treeRoot = document.createElement('ul');
    treeRoot.className = 'file-tree';
    if (!this.rootPath) {
      const empty = document.createElement('li');
      empty.className = 'tree-empty';
      empty.textContent = 'Open a folder to browse Markdown files';
      treeRoot.appendChild(empty);
    } else {
      this.renderEntries(this.tree, treeRoot);
      if (this.pendingInput?.parentPath === '') {
        treeRoot.appendChild(this.createInputRow(this.pendingInput));
      }
      if (!this.tree.length && !this.pendingInput) {
        const empty = document.createElement('li');
        empty.className = 'tree-empty';
        empty.textContent = 'No folders or Markdown files';
        treeRoot.appendChild(empty);
      }
    }
    this.workspaceView.appendChild(treeRoot);
    this.updateActiveView();

    requestAnimationFrame(() => {
      const nextTree = this.workspaceView.querySelector('.file-tree');
      if (nextTree) {
        nextTree.scrollTop = previousScrollTop;
        nextTree.scrollLeft = previousScrollLeft;
      }
    });
  }

  renderNavigation() {
    const focusedId = this.nav.contains(document.activeElement)
      ? document.activeElement.dataset.sidebarPanelId
      : null;
    this.nav.replaceChildren();

    const addButton = (id, icon, title) => {
      const button = document.createElement('button');
      const active = this.activeViewId === id;
      button.type = 'button';
      button.className = `sidebar-nav-button${active ? ' active' : ''}`;
      button.dataset.sidebarPanelId = id;
      button.title = title;
      button.setAttribute('aria-label', title);
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
      if (id === 'workspace') {
        const collapsed = document.body.classList.contains('sidebar-collapsed');
        button.title = collapsed ? 'Expand workspace' : 'Collapse workspace';
        button.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
      }
      button.appendChild(this.createLucideIcon(icon));
      button.addEventListener('click', () => this.selectView(id));
      this.nav.appendChild(button);
    };

    addButton('workspace', FolderRoot, 'Explorer');
    for (const [id, panel] of this.panels) {
      addButton(id, resolvePluginPanelIcon(panel.icon, Folder), panel.title || 'Plugin panel');
    }

    // Settings entry at bottom with divider
    const divider = document.createElement('div');
    divider.className = 'sidebar-nav-divider';
    divider.setAttribute('role', 'separator');
    this.nav.appendChild(divider);

    const settingsButton = document.createElement('button');
    settingsButton.type = 'button';
    settingsButton.className = 'sidebar-nav-button sidebar-nav-settings';
    settingsButton.dataset.sidebarPanelId = 'settings';
    settingsButton.title = 'Settings';
    settingsButton.setAttribute('aria-label', 'Settings');
    settingsButton.appendChild(this.createLucideIcon(Settings));
    settingsButton.addEventListener('click', () => {
      // Priority: direct dialog instance > editor.js API > preload API
      if (window.settingsDialog?.open) {
        window.settingsDialog.open();
      } else if (window.settingsAPI?.open) {
        window.settingsAPI.open();
      }
    });
    this.nav.appendChild(settingsButton);

    if (focusedId) {
      [...this.nav.querySelectorAll('.sidebar-nav-button')]
        .find(button => button.dataset.sidebarPanelId === focusedId)
        ?.focus();
    }
  }

  selectView(id) {
    const collapsed = document.body.classList.contains('sidebar-collapsed');
    if (this.activeViewId === id && !collapsed) {
      this.onToggleSidebar?.();
      return;
    }
    this.activeViewId = id;
    if (collapsed) this.onToggleSidebar?.();
    this.renderNavigation();
    this.updateActiveView();
  }

  updateActiveView() {
    this.workspaceView.hidden = this.activeViewId !== 'workspace';
    for (const [id, panelView] of this.panelViews) {
      panelView.hidden = id !== this.activeViewId;
    }
    const activePanel = this.panels.get(this.activeViewId);
    if (activePanel) this.mountPluginPanel(activePanel);
  }

  mountPluginPanel(panel) {
    if (!panel.entryUrl) return;
    const key = panel.instanceId || panel.id;
    const content = this.panelViews.get(key)?.querySelector('.sidebar-plugin-content');
    if (!content || content.querySelector('iframe')) return;
    const frame = document.createElement('iframe');
    frame.className = 'sidebar-plugin-frame';
    frame.title = panel.title || 'Plugin panel';
    frame.sandbox = 'allow-scripts';
    frame.src = panel.entryUrl;
    content.appendChild(frame);
  }

  renderEntries(entries, parent) {
    for (const entry of entries) {
      const item = document.createElement('li');
      item.className = `tree-node ${entry.type === 'directory' ? 'tree-directory' : 'tree-file'}`;
      const row = document.createElement('div');
      row.className = 'tree-row';
      const isExpanded = this.expanded.has(entry.relativePath);

      if (entry.type === 'directory') {
        const toggle = document.createElement('button');
        toggle.className = 'tree-toggle';
        toggle.type = 'button';
        toggle.appendChild(this.createIcon(isExpanded ? 'chevronDown' : 'chevronRight'));
        toggle.setAttribute('aria-label', `${isExpanded ? 'Collapse' : 'Expand'} ${entry.name}`);
        toggle.addEventListener('click', () => {
          if (isExpanded) this.expanded.delete(entry.relativePath);
          else this.expanded.add(entry.relativePath);
          this.render();
        });
        row.appendChild(toggle);
      } else {
        const spacer = document.createElement('span');
        spacer.className = 'tree-toggle-spacer';
        row.appendChild(spacer);
      }

      if (entry.type === 'directory') {
        const folderIcon = document.createElement('span');
        folderIcon.className = 'tree-folder-icon';
        folderIcon.appendChild(this.createIcon('folder'));
        row.appendChild(folderIcon);
      } else {
        const fileIcon = document.createElement('span');
        fileIcon.className = 'tree-file-icon';
        fileIcon.appendChild(this.createIcon('file'));
        row.appendChild(fileIcon);
      }

      const select = document.createElement('button');
      const separator = this.rootPath.includes('\\') ? '\\' : '/';
      const root = this.rootPath.replace(/[\\/]+$/, '');
      const absolutePath = `${root}${separator}${entry.relativePath}`;
      select.className = 'tree-entry' +
        (entry.type === 'directory' && this.selectedDirectory === entry.relativePath ? ' active' : '') +
        (entry.type === 'file' && normalizedPath(this.activePath) === normalizedPath(absolutePath)
          ? ' active'
          : '');
      select.type = 'button';
      select.textContent = entry.name;
      select.title = entry.relativePath;
      select.addEventListener('click', () => {
        if (entry.type === 'directory') {
          this.selectedDirectory = entry.relativePath;
          if (isExpanded) this.expanded.delete(entry.relativePath);
          else this.expanded.add(entry.relativePath);
          this.render();
        } else {
          this.onOpenFile(entry.relativePath);
        }
      });
      row.appendChild(select);

      const rename = document.createElement('button');
      rename.className = 'tree-row-action';
      rename.type = 'button';
      rename.appendChild(this.createIcon('rename'));
      rename.title = `Rename ${entry.name}`;
      rename.setAttribute('aria-label', `Rename ${entry.name}`);
      rename.addEventListener('click', () => this.beginRename(entry));
      row.appendChild(rename);

      const remove = document.createElement('button');
      remove.className = 'tree-row-action';
      remove.type = 'button';
      remove.appendChild(this.createIcon('remove'));
      remove.title = `Delete ${entry.name}`;
      remove.setAttribute('aria-label', `Delete ${entry.name}`);
      remove.addEventListener('click', () => this.onDelete(entry));
      row.appendChild(remove);

      row.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (entry.type === 'directory') {
          this.showFolderContextMenu(entry, absolutePath, e);
        } else {
          this.showFileContextMenu(entry, absolutePath, e);
        }
      });

      item.appendChild(row);

      if (entry.type === 'directory' && isExpanded) {
        const children = document.createElement('ul');
        children.className = 'file-tree-children';
        this.renderEntries(entry.children || [], children);
        if (this.pendingInput?.parentPath === entry.relativePath) {
          children.appendChild(this.createInputRow(this.pendingInput));
        }
        item.appendChild(children);
      }
      parent.appendChild(item);
    }
  }

  createInputRow(pending) {
    const item = document.createElement('li');
    item.className = 'tree-node tree-pending';
    const row = document.createElement('div');
    row.className = 'tree-row';
    const spacer = document.createElement('span');
    spacer.className = 'tree-toggle-spacer';
    row.appendChild(spacer);
    const input = document.createElement('input');
    input.className = 'tree-inline-input';
    input.type = 'text';
    input.placeholder = pending.type === 'file' ? 'filename.md' : 'Folder name';
    input.setAttribute('aria-label', input.placeholder);
    input.addEventListener('keydown', async (event) => {
      if (event.key === 'Escape') {
        this.pendingInput = null;
        this.render();
      } else if (event.key === 'Enter' && input.value.trim()) {
        await this.onCreate(pending.parentPath, input.value.trim(), pending.type);
        this.pendingInput = null;
        this.render();
      }
    });
    row.appendChild(input);
    item.appendChild(row);
    return item;
  }

  beginRename(entry) {
    const target = this.container.querySelectorAll('.tree-entry');
    const buttons = [...target];
    const button = buttons.find(candidate => candidate.title === entry.relativePath);
    if (!button) return;

    const input = document.createElement('input');
    input.className = 'tree-inline-input';
    input.value = entry.name;
    input.setAttribute('aria-label', `Rename ${entry.name}`);
    button.replaceWith(input);
    input.focus();
    input.select();
    const finish = async (save) => {
      if (!input.isConnected) return;
      if (save && input.value.trim() && input.value.trim() !== entry.name) {
        await this.onRename(entry, input.value.trim());
      }
      this.render();
    };
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') finish(false);
      else if (event.key === 'Enter') finish(true);
    });
    input.addEventListener('blur', () => finish(false), { once: true });
  }
}

export default FileTreeUI;

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
} from 'lucide';

function normalizedPath(value) {
  return String(value || '').replace(/\\/g, '/').toLowerCase();
}

export class FileTreeUI {
  constructor({ container, onOpenFolder, onOpenFile, onCreate, onRename, onDelete, onToggleSidebar }) {
    this.container = container;
    this.onOpenFolder = onOpenFolder;
    this.onOpenFile = onOpenFile;
    this.onCreate = onCreate;
    this.onRename = onRename;
    this.onDelete = onDelete;
    this.onToggleSidebar = onToggleSidebar;
    this.rootPath = null;
    this.tree = [];
    this.activePath = null;
    this.selectedDirectory = '';
    this.expanded = new Set(['']);
    this.pendingInput = null;
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
    const svg = createElement(iconNodes[name] || Folder, {
      width: 20,
      height: 20,
      'aria-hidden': 'true',
      'focusable': 'false',
      class: 'line-icon',
    });
    return svg;
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
    const previousTree = this.container.querySelector('.file-tree');
    const previousScrollTop = previousTree ? previousTree.scrollTop : 0;
    const previousScrollLeft = previousTree ? previousTree.scrollLeft : 0;
    this.container.replaceChildren();

    const nav = document.createElement('nav');
    nav.className = 'sidebar-nav';
    nav.setAttribute('aria-label', 'Workspace navigation');
    const workspaceNavButton = document.createElement('button');
    workspaceNavButton.type = 'button';
    workspaceNavButton.className = 'sidebar-nav-button active';
    const collapsed = document.body.classList.contains('sidebar-collapsed');
    workspaceNavButton.title = collapsed ? 'Expand workspace' : 'Collapse workspace';
    workspaceNavButton.setAttribute('aria-label', collapsed ? 'Expand workspace' : 'Collapse workspace');
    workspaceNavButton.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
    workspaceNavButton.appendChild(this.createIcon('workspace'));
    workspaceNavButton.addEventListener('click', () => {
      if (this.onToggleSidebar) this.onToggleSidebar();
    });
    nav.appendChild(workspaceNavButton);
    this.container.appendChild(nav);

    const panel = document.createElement('div');
    panel.className = 'sidebar-panel';

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
    panel.appendChild(header);

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
    panel.appendChild(treeRoot);
    this.container.appendChild(panel);

    requestAnimationFrame(() => {
      const nextTree = this.container.querySelector('.file-tree');
      if (nextTree) {
        nextTree.scrollTop = previousScrollTop;
        nextTree.scrollLeft = previousScrollLeft;
      }
    });
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

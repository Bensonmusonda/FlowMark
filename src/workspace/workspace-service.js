const fs = require('fs');
const path = require('path');

class WorkspaceService {
  constructor(onChange = () => {}) {
    this.rootPath = null;
    this.onChange = onChange;
    this.watcher = null;
    this.changeTimer = null;
    this.pendingChanges = new Set();
  }

  setRoot(rootPath) {
    const resolved = fs.realpathSync(rootPath);
    if (!fs.statSync(resolved).isDirectory()) {
      throw new Error('Workspace path must be a directory');
    }
    const tree = this.readDirectory(resolved, '');

    this.close();
    this.rootPath = resolved;
    try {
      this.watcher = fs.watch(resolved, { recursive: true }, (_, filename) => {
        if (filename == null) {
          this.pendingChanges.clear();
          this.pendingChanges.add(null);
        } else if (!this.pendingChanges.has(null)) {
          this.pendingChanges.add(String(filename));
        }
        if (this.changeTimer) clearTimeout(this.changeTimer);
        this.changeTimer = setTimeout(() => {
          this.changeTimer = null;
          const relativePaths = [...this.pendingChanges];
          this.pendingChanges.clear();
          this.onChange({ relativePaths });
        }, 100);
      });
    } catch (error) {
      this.rootPath = null;
      throw error;
    }
    this.watcher.on('error', (error) => {
      this.closeWatcher();
      this.onChange({ error: error.message });
    });

    return { rootPath: resolved, tree };
  }

  getTree() {
    if (!this.rootPath) return [];
    return this.readDirectory(this.rootPath, '');
  }

  openFile(relativePath) {
    const filePath = this.resolvePath(relativePath);
    if (!fs.statSync(filePath).isFile() || !/\.md$/i.test(filePath)) {
      throw new Error('Only Markdown files can be opened from the workspace');
    }
    return { filePath, content: fs.readFileSync(filePath, 'utf8') };
  }

  readDirectory(directoryPath, relativeDirectory) {
    return fs.readdirSync(directoryPath, { withFileTypes: true })
      .filter(entry => !entry.isSymbolicLink())
      .map(entry => {
        const relativePath = relativeDirectory
          ? path.join(relativeDirectory, entry.name)
          : entry.name;
        const fullPath = path.join(directoryPath, entry.name);
        if (entry.isDirectory()) {
          return {
            name: entry.name,
            relativePath,
            type: 'directory',
            children: this.readDirectory(fullPath, relativePath),
          };
        }
        return entry.isFile() && /\.md$/i.test(entry.name)
          ? { name: entry.name, relativePath, type: 'file' }
          : null;
      })
      .filter(Boolean)
      .sort((a, b) => {
        if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
        return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
      });
  }

  create(relativePath, type) {
    const targetPath = this.resolvePath(relativePath, false);
    if (type === 'directory') {
      fs.mkdirSync(targetPath);
      return { path: targetPath };
    }
    if (type !== 'file') throw new Error('Unsupported workspace item type');
    if (path.extname(targetPath) && !/\.md$/i.test(targetPath)) {
      throw new Error('Workspace files must use the .md extension');
    }
    const markdownPath = /\.md$/i.test(targetPath) ? targetPath : `${targetPath}.md`;
    this.assertInsideRoot(markdownPath);
    fs.writeFileSync(markdownPath, '', { flag: 'wx', encoding: 'utf8' });
    return { path: markdownPath, content: '' };
  }

  rename(relativePath, newName) {
    const oldPath = this.resolvePath(relativePath);
    let cleanName = String(newName || '').trim();
    if (!cleanName || cleanName === '.' || cleanName === '..' || /[<>:"/\\|?*\x00-\x1f]/.test(cleanName)) {
      throw new Error('Invalid name');
    }
    const oldIsFile = fs.statSync(oldPath).isFile();
    if (oldIsFile && path.extname(cleanName) && !/\.md$/i.test(cleanName)) {
      throw new Error('Markdown files must keep the .md extension');
    }
    if (oldIsFile && !/\.md$/i.test(cleanName)) cleanName += '.md';
    const newPath = path.join(path.dirname(oldPath), cleanName);
    this.assertInsideRoot(newPath);
    if (oldPath !== newPath && fs.existsSync(newPath)) {
      throw new Error('A file or folder with that name already exists');
    }
    fs.renameSync(oldPath, newPath);
    return { oldPath, newPath };
  }

  delete(relativePath) {
    const targetPath = this.resolvePath(relativePath);
    fs.rmSync(targetPath, { recursive: true, force: false });
    return { path: targetPath };
  }

  resolvePath(relativePath, mustExist = true) {
    if (!this.rootPath) throw new Error('No workspace is open');
    if (typeof relativePath !== 'string' || !relativePath.trim()) {
      throw new Error('A workspace-relative path is required');
    }
    if (path.isAbsolute(relativePath)) {
      throw new Error('Workspace paths must be relative');
    }
    const targetPath = path.resolve(this.rootPath, relativePath);
    this.assertInsideRoot(targetPath);

    const relative = path.relative(this.rootPath, targetPath);
    let currentPath = this.rootPath;
    for (const part of relative.split(path.sep).filter(Boolean)) {
      currentPath = path.join(currentPath, part);
      if (!fs.existsSync(currentPath)) {
        if (mustExist) throw new Error('Workspace item not found');
        break;
      }
      if (fs.lstatSync(currentPath).isSymbolicLink()) {
        throw new Error('Symbolic links are not supported in the workspace');
      }
    }
    if (mustExist && !fs.existsSync(targetPath)) {
      throw new Error('Workspace item not found');
    }
    return targetPath;
  }

  assertInsideRoot(targetPath) {
    const relative = path.relative(this.rootPath, targetPath);
    if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      throw new Error('Workspace operation is outside the open folder');
    }
  }

  closeWatcher() {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
  }

  close() {
    this.closeWatcher();
    if (this.changeTimer) {
      clearTimeout(this.changeTimer);
      this.changeTimer = null;
    }
    this.pendingChanges.clear();
    this.rootPath = null;
  }
}

module.exports = { WorkspaceService };

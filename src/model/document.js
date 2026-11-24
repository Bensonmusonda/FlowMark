/**
 * Document model for FlowMark tabs.
 * Encapsulates per-file state, including path, name, EditorState, dirty flag, and scroll position.
 */

let nextDocId = 1;

export class Document {
  /**
   * @param {Object} options
   * @param {string} [options.id]
   * @param {string|null} [options.path] - Full file system path
   * @param {string} [options.name] - Tab display name
   * @param {import('@codemirror/state').EditorState} [options.editorState]
   * @param {boolean} [options.dirty]
   * @param {number} [options.scrollPosition]
   * @param {string} [options.initialContent]
   * @param {string} [options.viewType] - Document view kind ('markdown' or 'plugin:<id>')
   * @param {Object} [options.viewData] - Serialized state/data for custom views
   */
  constructor(options = {}) {
    this.id = options.id || `doc_${nextDocId++}_${Date.now()}`;
    this.path = options.path || null;
    this.name = options.name || (this.path ? this._basename(this.path) : `Untitled ${nextDocId}`);
    this.editorState = options.editorState || null;
    this.dirty = Boolean(options.dirty);
    this.scrollPosition = options.scrollPosition || 0;
    this.selection = options.selection || null;
    this.viewType = options.viewType || 'markdown';
    this.viewData = options.viewData || null;
  }

  _basename(filePath) {
    if (!filePath) return 'untitled.md';
    return filePath.split(/[\\/]/).pop() || filePath;
  }

  /**
   * Set or update file path.
   * @param {string|null} newPath
   */
  setPath(newPath) {
    this.path = newPath;
    if (newPath) {
      this.name = this._basename(newPath);
    }
  }

  /**
   * Set or update document display name.
   * @param {string} newName
   */
  setName(newName) {
    if (!newName || !newName.trim()) {
      this.name = this.path ? this._basename(this.path) : 'Untitled';
    } else {
      this.name = newName.trim();
    }
  }

  /**
   * Mark document dirty or clean.
   * @param {boolean} [dirty=true]
   */
  markDirty(dirty = true) {
    this.dirty = Boolean(dirty);
  }

  /**
   * Get current EditorState.
   * @returns {import('@codemirror/state').EditorState|null}
   */
  getState() {
    return this.editorState;
  }

  /**
   * Set EditorState.
   * @param {import('@codemirror/state').EditorState} state
   */
  setState(state) {
    this.editorState = state;
  }

  /**
   * Get doc text content string.
   * @returns {string}
   */
  getText() {
    if (this.editorState) {
      return this.editorState.doc.toString();
    }
    return '';
  }

  /**
   * Save document to disk via fileAPI.
   * @param {Object} fileAPI
   * @returns {Promise<{ canceled?: boolean, filePath?: string, noPath?: boolean }>}
   */
  async save(fileAPI) {
    const content = this.getText();
    if (!this.path) {
      const res = await fileAPI.saveAs({ defaultPath: this.name, content });
      if (!res.canceled && res.filePath) {
        this.setPath(res.filePath);
        this.markDirty(false);
      }
      return res;
    }
    const res = await fileAPI.save({ filePath: this.path, content });
    if (!res.noPath) {
      this.markDirty(false);
    }
    return res;
  }

  /**
   * Serialize for session storage.
   */
  toJSON() {
    return {
      id: this.id,
      path: this.path,
      name: this.name,
      dirty: this.dirty,
      scrollPosition: this.scrollPosition,
      viewType: this.viewType,
      viewData: this.viewData,
      // For unsaved (no path) documents, preserve content in session
      content: !this.path ? this.getText() : undefined,
    };
  }
}

/**
 * TabManager manages open Document instances.
 */
export class TabManager {
  constructor() {
    /** @type {Document[]} */
    this.documents = [];
    /** @type {string|null} */
    this.activeId = null;
    /** @type {Set<Function>} */
    this._listeners = new Set();
  }

  get activeDocument() {
    return this.documents.find(d => d.id === this.activeId) || null;
  }

  get count() {
    return this.documents.length;
  }

  get(id) {
    return this.documents.find(d => d.id === id) || null;
  }

  getByPath(filePath) {
    if (!filePath) return null;
    return this.documents.find(d => d.path === filePath) || null;
  }

  indexOf(id) {
    return this.documents.findIndex(d => d.id === id);
  }

  /**
   * Add a document.
   * @param {Document} doc
   * @param {boolean} [activate=true]
   */
  add(doc, activate = true) {
    // If a document with same path already open, activate it instead
    if (doc.path) {
      const existing = this.getByPath(doc.path);
      if (existing) {
        if (activate) this.setActive(existing.id);
        return existing;
      }
    }
    this.documents.push(doc);
    if (activate || !this.activeId) {
      this.activeId = doc.id;
    }
    this._notify();
    return doc;
  }

  /**
   * Remove a document by ID.
   * @param {string} id
   * @returns {Document|null} the removed document
   */
  remove(id) {
    const index = this.indexOf(id);
    if (index === -1) return null;

    const [removed] = this.documents.splice(index, 1);

    if (this.activeId === id) {
      if (this.documents.length > 0) {
        // Activate adjacent tab (right or left)
        const nextIndex = Math.min(index, this.documents.length - 1);
        this.activeId = this.documents[nextIndex].id;
      } else {
        this.activeId = null;
      }
    }

    this._notify();
    return removed;
  }

  /**
   * Remove all documents except keepId.
   * @param {string} keepId
   * @returns {Document[]} Array of removed documents
   */
  removeOthers(keepId) {
    const keepDoc = this.get(keepId);
    if (!keepDoc) return [];
    const removed = this.documents.filter(d => d.id !== keepId);
    this.documents = [keepDoc];
    this.activeId = keepId;
    this._notify();
    return removed;
  }

  /**
   * Remove all documents to the right of targetId.
   * @param {string} targetId
   * @returns {Document[]} Array of removed documents
   */
  removeToRight(targetId) {
    const index = this.indexOf(targetId);
    if (index === -1 || index >= this.documents.length - 1) return [];
    const removed = this.documents.splice(index + 1);
    if (!this.documents.some(d => d.id === this.activeId)) {
      this.activeId = targetId;
    }
    this._notify();
    return removed;
  }

  /**
   * Remove all saved (non-dirty) documents.
   * @returns {Document[]} Array of removed documents
   */
  removeSaved() {
    const dirtyDocs = this.documents.filter(d => d.dirty);
    if (dirtyDocs.length === this.documents.length) return [];
    const removed = this.documents.filter(d => !d.dirty);
    this.documents = dirtyDocs;
    if (this.documents.length > 0) {
      if (!this.documents.some(d => d.id === this.activeId)) {
        this.activeId = this.documents[0].id;
      }
    } else {
      this.activeId = null;
    }
    this._notify();
    return removed;
  }

  /**
   * Set active document by ID.
   * @param {string} id
   */
  setActive(id) {
    if (this.activeId === id) return;
    const doc = this.get(id);
    if (!doc) return;
    this.activeId = id;
    this._notify();
  }

  /**
   * Switch to next tab.
   */
  next() {
    if (this.documents.length <= 1) return;
    const currentIndex = this.indexOf(this.activeId);
    const nextIndex = (currentIndex + 1) % this.documents.length;
    this.setActive(this.documents[nextIndex].id);
  }

  /**
   * Switch to previous tab.
   */
  prev() {
    if (this.documents.length <= 1) return;
    const currentIndex = this.indexOf(this.activeId);
    const prevIndex = (currentIndex - 1 + this.documents.length) % this.documents.length;
    this.setActive(this.documents[prevIndex].id);
  }

  /**
   * Reorder tabs (e.g. from drag & drop).
   * @param {number} fromIndex
   * @param {number} toIndex
   */
  reorder(fromIndex, toIndex) {
    if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0) return;
    if (fromIndex >= this.documents.length || toIndex >= this.documents.length) return;
    const [moved] = this.documents.splice(fromIndex, 1);
    this.documents.splice(toIndex, 0, moved);
    this._notify();
  }

  onChange(listener) {
    this._listeners.add(listener);
    return () => this._listeners.delete(listener);
  }

  _notify() {
    for (const listener of this._listeners) {
      try {
        listener(this);
      } catch (err) {
        console.error('Error in TabManager listener:', err);
      }
    }
  }
}

export default {
  Document,
  TabManager,
};

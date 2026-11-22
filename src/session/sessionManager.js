/**
 * Session persistence manager for FlowMark.
 * Saves open tabs, active tab, scroll positions, and unsaved contents to userData/session.json.
 */

import { Document } from '../model/document.js';

let saveTimeout = null;

export class SessionManager {
  /**
   * @param {Object} options
   * @param {import('../model/document.js').TabManager} options.tabManager
   * @param {Function} options.createEditorState - (initialContent) => EditorState
   * @param {Function} [options.getWorkspacePath] - Returns the current workspace path
   * @param {Function} [options.restoreWorkspace] - Opens the restored workspace path
   */
  constructor({ tabManager, createEditorState, getWorkspacePath, restoreWorkspace }) {
    this.tabManager = tabManager;
    this.createEditorState = createEditorState;
    this.getWorkspacePath = getWorkspacePath || (() => null);
    this.restoreWorkspace = restoreWorkspace || (async () => {});
  }

  /**
   * Save session data (debounced).
   */
  scheduleSave() {
    if (saveTimeout) clearTimeout(saveTimeout);
    saveTimeout = setTimeout(() => {
      this.saveNow();
    }, 1000);
  }

  /**
   * Save session data immediately.
   */
  async saveNow() {
    if (!window.fileAPI || !window.fileAPI.saveSession) return;

    const tabsData = this.tabManager.documents.map(doc => {
      return {
        path: doc.path,
        name: doc.name,
        dirty: doc.dirty,
        scrollPosition: doc.scrollPosition,
        // If untitled or dirty, preserve content
        content: (!doc.path || doc.dirty) ? doc.getText() : undefined,
      };
    });

    const activeIndex = this.tabManager.indexOf(this.tabManager.activeId);

    const sessionData = {
      version: 1,
      tabs: tabsData,
      activeIndex: activeIndex >= 0 ? activeIndex : 0,
      workspacePath: this.getWorkspacePath(),
      timestamp: Date.now(),
    };

    try {
      await window.fileAPI.saveSession(sessionData);
    } catch (err) {
      console.warn('Failed to save session:', err);
    }
  }

  /**
   * Restore session from disk.
   * @returns {Promise<boolean>} true if session was restored
   */
  async restore() {
    if (!window.fileAPI || !window.fileAPI.loadSession) return false;

    try {
      const session = await window.fileAPI.loadSession();
      if (!session || !Array.isArray(session.tabs) || session.tabs.length === 0) {
        if (session?.workspacePath) {
          try {
            await this.restoreWorkspace(session.workspacePath);
          } catch (err) {
            console.warn('Failed to restore workspace:', err);
          }
        }
        return false;
      }

      if (session.workspacePath) {
        try {
          await this.restoreWorkspace(session.workspacePath);
        } catch (err) {
          console.warn('Failed to restore workspace:', err);
        }
      }

      for (let i = 0; i < session.tabs.length; i++) {
        const item = session.tabs[i];
        let content = '';

        if (item.path) {
          const res = await window.fileAPI.openPath(item.path);
          if (res && !res.canceled && res.content !== undefined) {
            content = item.dirty && item.content !== undefined ? item.content : res.content;
          } else if (item.content !== undefined) {
            content = item.content;
          } else {
            // File might have been moved or deleted, skip
            continue;
          }
        } else if (item.content !== undefined) {
          content = item.content;
        }

        const state = this.createEditorState(content);
        const doc = new Document({
          path: item.path || null,
          name: item.name,
          editorState: state,
          dirty: Boolean(item.dirty),
          scrollPosition: item.scrollPosition || 0,
        });

        this.tabManager.add(doc, false);
      }

      if (this.tabManager.count > 0) {
        const targetIndex = Math.min(Math.max(0, session.activeIndex || 0), this.tabManager.count - 1);
        this.tabManager.setActive(this.tabManager.documents[targetIndex].id);
        return true;
      }
    } catch (err) {
      console.error('Failed to restore session:', err);
    }

    return false;
  }
}

export default SessionManager;

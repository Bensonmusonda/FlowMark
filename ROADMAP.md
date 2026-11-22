# FlowMark Development Roadmap

This document outlines the execution roadmap for FlowMark, prioritizing core editor ergonomics and stability before structural UI expansions.

---

## Stage 1 — Fluid Editor Polish (Core Interaction Fixes)
**Goal:** Eliminate visual jitter, selection snapping, and syntax explosions to deliver a seamless writing feel.
**Reference Document:** `EDITOR_ISSUES_AUDIT.md`

### 1.1 Fix Selection Snapping & Layout Reflow
- [x] **Freeze Concealment on Active Drag:** When `!view.state.selection.main.empty`, freeze syntax concealment states so formatting (`**`, `*`, `~~`, links) never collapses or expands mid-drag.
- [x] **Protect Block Embeds During Selection:** Prevent tables, callouts, and math blocks from collapsing into raw markdown pipes on passive mouse drag selections.
- [x] **Debounce Selection IPC:** Debounce `window.editorAPI.notifySelectionChange` (50–100ms) to stop IPC flooding during rapid mouse movements.

### 1.2 Fix List & Task Item Syntax Explosion
- [x] **Decouple Bullet & Checkbox from `lineIsActive`:** Do not destroy styled bullets (`.cm-list-mark-active::before { content: none }`) merely because the caret is on that line.
- [x] **Persistent Checkbox Widget:** Keep `<input type="checkbox">` rendered and clickable while typing on a task line; only reveal raw `[ ]` if the caret is positioned directly between/around the brackets.
- [x] **Localized Inline Reveal:** Ensure clicking a link or bold text inside a list item only reveals that specific token's syntax, not the entire list item prefix and markers.

### 1.3 Ergonomic Quick Wins
- [x] **External Links on Ctrl+Click:** Add a listener in `editor-wrap` targeting markdown links (`[text](url)`) to call `shell.openExternal(url)`.
- [x] **Heading Marker Scaling:** Style `HeaderMark` (`#`) with a fixed, muted scale (`0.7em`, opacity 0.4) so entering heading lines does not cause a horizontal text jump.

---

## Stage 2 — Milestone Commit & Repository Cleanup
**Goal:** Lock in Phase 4-5 features and Stage 1 fixes in git.

- [x] Remove temporary diagnostic files (`test-bindings.js`, `test-electron.js`, `test-electron-full.js`, `test-main.js`).
- [x] Verify test suite passes (`npm test` — 207 tests passing).
- [x] Create milestone commit: `feat: complete Phases 4-5 and Stage 1 editor polish`.

---

## Stage 3 — Core Workspace & Sidebar Architecture (Phase 6)
**Goal:** Native multi-file workspace and folder explorer built into the core editor.

- [ ] **Collapsible, Resizable Sidebar:**
  - Layout container (`#sidebar`) with splitter drag-handle.
  - Keyboard toggle (`Ctrl+B`) and Zen mode integration (`body.zen #sidebar { display: none }`).
- [ ] **File & Folder Tree Explorer:**
  - "Open Folder" command $\rightarrow$ native directory picker.
  - Hierarchical tree rendering of `.md` files and folders with expand/collapse.
  - Active tab ↔ active tree item synchronization.
  - File/folder creation, inline renaming, and deletion.
  - Persist open workspace directory across restarts in `session.json`.
- [ ] **File System Watcher:** Integrate `fs.watch` / `chokidar` in main process to update tree on external file changes.

---

## Stage 4 — Plugin System Extensions (Panels & Custom Views)
**Goal:** Extend the sandboxed plugin system to hook into the new workspace and tab surfaces.
**Reference Document:** `PLUGIN_IDEAS.md`

- [ ] **Sidebar Activity Bar & Panel API:**
  - Allow sandboxed plugins to register secondary panels (`flowmarkPlugin.ui.registerSidebarPanel({ id, title, icon, render })`).
  - Examples: Table of Contents / Outline, Tag Explorer, Backlinks, Calendar.
- [ ] **Custom Tab Views API:**
  - Support `Document.viewType !== 'markdown'` so tabs can host non-text views (Excalidraw canvas, Kanban, Preview) via sandboxed `<iframe>` / `<webview>`.
- [ ] **Slash Command & Smart Paste Extensions:**
  - Floating `/` insert menu and clipboard conversion hooks.

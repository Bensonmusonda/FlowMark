# FlowMark Plugin System — Design Roadmap & Ideas

This document logs approved architectural concepts, mechanics, and future extension points for the FlowMark plugin system.

---

## 1. Custom Tab Views (Canvas, Excalidraw, Kanban)
**Concept:** Allow plugins to take over a tab pane to render non-text visual interfaces (e.g., Excalidraw whiteboard, Kanban board, CSV table editor, PDF reader) while still participating in FlowMark's core tab and document lifecycle.

### Mechanics:
- **`Document.viewType`**:
  - Default: `'markdown'` (CodeMirror 6 editor).
  - Custom: `'plugin:<viewId>'` (e.g. `'plugin:excalidraw'`).
- **Tab Switching**:
  - When switching tabs, if `doc.viewType === 'markdown'`, the main CodeMirror container is shown.
  - If `doc.viewType !== 'markdown'`, CodeMirror is hidden and the plugin's isolated container (`<iframe>` / `<webview>`) is mounted.
- **Underlying File Format**:
  - Remains plain Markdown with frontmatter and embedded data blocks (e.g. ````json:excalidraw ... ````).
- **Lifecycle Integration**:
  - Plugins hook into `doc.isDirty`, `save()`, `undo()`, `redo()`, and tab reordering.
- **Proposed API**:
  ```js
  flowmarkPlugin.views.registerCustomView({
    id: 'excalidraw',
    name: 'Excalidraw Canvas',
    extensions: ['.sketch.md', '.drawing.md'],
    icon: 'canvas-icon',
    entry: 'canvas.html'
  });
  ```

---

## 2. Activity Bar & Sidebar Panels
**Concept:** A collapsible left sidebar where the Core Workspace/Folder Explorer lives, alongside panels contributed by plugins.

### Mechanics:
- **Core Sidebar**: FlowMark core provides the resizable split pane, collapse/expand toggle (`Ctrl+B`), and the native Folder/File Explorer.
- **Plugin Panel Extension**: Plugins can register secondary panels that appear as icon tabs in the activity bar.
- **Example Plugin Panels**:
  - **Outline / Table of Contents**: Parsed `# Headings` tree with click-to-scroll.
  - **Tag Explorer**: Aggregates all `#tags` across workspace notes.
  - **Backlinks / Graph View**: Displays document connections.
  - **Calendar / Daily Notes**: Mini calendar for date-based note taking.
- **Proposed API**:
  ```js
  flowmarkPlugin.ui.registerSidebarPanel({
    id: 'outline',
    title: 'Document Outline',
    icon: 'list-tree',
    render(container) { ... }
  });
  ```

---

## 3. CodeMirror Decorations & Inline Embeds
**Concept:** Plugins that inject live visual elements directly into the markdown editor scroller.

### Mechanics:
- Communicates CodeMirror `StateField` / `ViewPlugin` decorations over IPC or renderer bridge.
- **Examples**:
  - Mermaid diagram live previews inline.
  - LaTeX math equation live renderers.
  - Color picker swatch next to `#HEX` color codes.
  - Task progress bars next to `- [ ]` lists.

---

## 4. Writing & Reading Analysis
**Concept:** Headless background plugins that analyze content without heavy UI.

### Mechanics:
- Consumes `editor:contentChanged` events.
- **Examples**:
  - Readability score (Flesch-Kincaid) in status bar.
  - Hemingway-style prose linter (flags passive voice, adverbs).
  - Live link-checker (warns of broken URLs or missing internal links).

---

## 5. Slash Command (`/`) Provider
**Concept:** Typing `/` on an empty line opens an autocomplete menu, allowing plugins to register quick-insert actions.

### Mechanics:
- Core listens for `/` keypress and renders the floating menu.
- Plugins register items with labels, icons, keywords, and insertion actions:
  ```js
  flowmarkPlugin.editor.registerSlashCommand({
    id: 'insert-callout',
    label: 'Callout Box',
    description: 'Insert a stylized note or warning',
    run: (editor) => editor.replaceSelection('> [!NOTE]\n> ')
  });
  ```

---

## 6. Smart Paste & Web Clipping
**Concept:** Intercept and intelligently transform pasted clipboard content into clean Markdown.

### Mechanics:
- Core passes clipboard data (`text/html`, `text/plain`, files) through registered transform filters.
- **Examples**:
  - HTML tables (from Excel, Google Sheets, or browsers) auto-convert to Markdown tables.
  - Pasting a raw URL fetches the page title and formats as `[Title](url)`.
  - Pasting an image binary saves to an `assets/` subfolder and inserts `![alt](assets/image.png)`.

---

## 7. Custom Exporters & Publishing
**Concept:** Expand FlowMark's export capabilities beyond default PDF and HTML.

### Mechanics:
- Plugins register export targets under the File menu:
  ```js
  flowmarkPlugin.export.registerExporter({
    id: 'slides',
    label: 'Export as Interactive Slides (Reveal.js)',
    extension: 'html',
    transform: (markdown) => convertToRevealJs(markdown)
  });
  ```
- **Examples**: EPUB e-books, Reveal.js/Marp presentation slides, publishing to GitHub Gists or static site generators.

---

## 8. Theme & Style Packs
**Concept:** Community themes and color palettes beyond the built-in dark, light, and sepia.

### Mechanics:
- Plugins contribute CodeMirror highlight themes and CSS variables (`--bg`, `--accent`, `--text`).
- **Examples**: Catppuccin, Nord, Dracula, Tokyo Night, Solarized, Gruvbox.

---

## 9. Template & Snippet Engine
**Concept:** Insert pre-structured notes with dynamic variable resolution.

### Mechanics:
- Core or plugin stores markdown templates containing variables (`{{date}}`, `{{title}}`, `{{time}}`, `{{clipboard}}`).
- Commands: "Insert Template" or "New Note from Template".

---

## 10. AI / Local LLM Assist (Privacy-First)
**Concept:** Optional writing enhancements connected to local models (e.g. Ollama) or user API keys.

### Mechanics:
- Plugin uses `editor.getSelection()`, `editor.replaceSelection()`, and `network.request`.
- Core FlowMark remains strictly offline and private by default.
- **Examples**: Grammar cleanup, bullet point summarization, tone adjustment.

---

## 11. Plugin API Contract & Lifecycle Hardening
**Concept:** Stabilize the plugin contract before adding more ways for plugins to affect editor and workspace behavior.

### Mechanics:
- Define consistent plugin lifecycle hooks and cleanup behavior for load, enable, disable, and unload.
- Document and validate capability permissions and the scope of each exposed API.
- Surface plugin errors and permission denials through clear diagnostics without breaking the editor.
- Add focused tests for lifecycle cleanup, denied capabilities, and plugin failures.

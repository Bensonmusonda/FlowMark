# FlowMark Product & Architectural Roadmap

This document serves as the single source of truth for FlowMark's current architecture, floating component design patterns, feature gap analysis, and future implementation roadmap.

---

## 1. FlowMark Architectural Overview

FlowMark is an Electron-based distraction-free markdown workstation engineered around **CodeMirror 6** with an emphasis on hybrid in-line rendering, high-performance typography, and a secure, sandboxed plugin system.

### Core Architectural Pillars
- **In-Line Hybrid Markdown**: Real-time concealment and widget rendering (callouts, table formatting, frontmatter cards, KaTeX math blocks, and emoji/fence completions) without the cognitive load of a split preview pane.
- **Unified Workspace Chrome**:
  - Horizontal scrollable tab bar with mousewheel redirection.
  - Collapsible, resizable left file tree explorer (`Ctrl+B`).
  - Collapsible, resizable right utility pane for extensions, AI, and document metadata.
  - Pure HTML context menu system with submenus and keyboard accelerators across the Editor, Tab bar, and File Tree.
  - Settings dialog with modular tabs (General, Appearance, Plugins, Shortcuts, Privacy, About).
- **Sandboxed Plugin Isolation**: Plugins run in an isolated process with zero direct access to Electron or Node.js primitives. Every request passes through manifest permission gating (`editor.read`, `editor.write`, `ui.sidebarPanel`, `ui.customView`, `ui.floatingWidgets`, `slashCommands`), with automatic cleanup upon plugin disable.

---

## 2. Floating Component Architectural Approaches

Floating components in FlowMark provide lightweight, context-aware tools directly above the editing canvas without consuming permanent sidebar or toolbar real estate.

### Approach A: Canvas-Anchored Declarative Toolbars (Implemented in `feat/floating-widget-system`)
- **Container**: Layered inside `#editor-wrap` (`position: absolute; inset: 0; pointer-events: none;`) ensuring the toolbar moves dynamically when sidebars/panes resize and never clips into other UI panels.
- **Layout & Docking**: `.dock-right` or `.dock-left` strips with vertical tool buttons, Lucide icons, hover tooltips, and click-to-run commands.
- **Collapse Mechanics**: Smooth CSS transform (`translateX(calc(100% - 24px))`) leaving a sleek 20px chevron toggle handle visible at the viewport edge.
- **Dismiss & Palette Binding**: Dismissing with the close handle hides the toolbar and automatically registers a command (`view:toggleWidget:<id>`) in `CommandRegistry` to reopen it anytime.
- **Best For**: Quick-insert symbol palettes, formatting strips, Zen-mode floating action bars.

### Approach B: Sandboxed Iframe Floating Panes (Implemented in `feat/floating-widget-system`)
- **Structure**: Floating cards hosting sandboxed `<iframe>` panels with script execution permitted (`sandbox="allow-scripts"`).
- **Security & IPC**: Plugin sends HTML entry point; plugin host resolves file URLs; iframe communicates strictly via structured messaging.
- **Best For**: Mini scratchpads, quick-reference cheat sheets, live word frequency analyzers, floating AI prompt chips.

### Approach C: Selection-Attached Bubble / Floating Menus (Future Extension)
- **Mechanics**: CodeMirror 6 `ViewPlugin` or `tooltip` extension attached directly to the active text selection range.
- **Behavior**: Appears immediately above highlighted text on mouse-up; dismisses on caret movement or Escape.
- **Controls**: Bold, Italic, Strikethrough, Code, Link, and Heading level toggles.
- **Best For**: Mouse-centric editing, tablet/touch ergonomics, Typora/Medium-style floating formatting.

### Approach D: Draggable & Dockable Floating Windows (Future Extension)
- **Mechanics**: Absolute positioning with pointer drag handles (`mousedown`/`mousemove`/`mouseup` bounds clamping) and snap-to-edge docking.
- **State Persistence**: Position (`x, y, collapsed, dockedEdge`) persisted across sessions per workspace in `session.json`.
- **Best For**: Detached Excalidraw mini-canvases, floating media players, persistent sticky notes.

---

## 3. Product Gap Analysis (Missing Capabilities)

To rival top-tier editors (Obsidian, Typora, MarkText), FlowMark needs the following capabilities:

| Gap Area | Missing Capability | Impact & Urgency |
| :--- | :--- | :--- |
| **Navigation** | **Document Outline / TOC** | **High**: Long documents require a live `# Headings` tree in the utility pane with active scroll tracking. |
| **Search** | **Global Workspace Search** | **High**: Ripgrep-style multi-file search across all `.md` files in the open folder. |
| **Media** | **Image Drag & Drop / Paste** | **High**: Auto-saving clipboard images to `./assets/` and auto-generating markdown links. |
| **Knowledge** | **Wikilinks (`[[Note]]`)** | **Medium**: Auto-completing `[[...]]` links to workspace notes and `Ctrl+Click` navigation. |
| **Visuals** | **Mermaid Diagram Rendering** | **Medium**: Rendering fenced ````mermaid```` blocks into interactive SVG diagrams inline. |
| **Publishing** | **PDF & Styled HTML Export** | **Medium**: Exporting clean, styled documents adhering to the active editor theme. |

---

## 4. UI Polish & Backlog Items

- **Appearance Settings Reset**: Add a "Restore Defaults" button in `appearanceTab.js` to reset theme, accent color, font family, and font size.
- **Expanded Color Palettes**: Supplement the pastel theme palette with vibrant, earth tone, and monochrome sets.
- **Focus Ring & Accent Consistency**: Audit and replace remaining system blue focus rings (`:focus-visible`) with `--accent` tokens.
- **Settings Layout Spacing**: Improve vertical rhythm between form elements in `privacyTab.js` and `generalTab.js`.
- **Slash Command Fuzzy Search**: Dynamically filter slash commands by label or command ID prefix as the user types after `/`.

---

## 5. Prioritized Development Roadmap

### Phase 1: Floating Reference Plugin & Writing Ergonomics
1. **Quick-Insert Symbol Palette Plugin**: Build the reference vertical symbol palette plugin to validate the floating toolbar platform APIs.
2. **Clipboard Image Paste & Drag-and-Drop**: Intercept paste/drop events, persist image files to `assets/`, and insert markdown syntax.

### Phase 2: Navigation & Multi-File Discovery
1. **Document Outline Panel (TOC)**: Parse document headings via Lezer syntax tree, display hierarchical list in the right Utility Pane, and support click-to-scroll.
2. **Global Workspace Search**: Multi-file text search indexing open workspace files with regex support and preview snippets.

### Phase 3: Visuals & Knowledge
1. **Live Mermaid Rendering**: Embed Mermaid.js renderer for fenced ````mermaid```` blocks.
2. **Wikilinks Auto-Completion & Resolution**: Support `[[Document]]` completions and click-to-open across workspace files.

### Phase 4: Sharing & Community
1. **PDF & HTML Export Engine**: Electron print-to-PDF and standalone HTML generator with bundled KaTeX and theme CSS.
2. **Plugin Distribution & Settings UI**: Individual plugin settings tab panels in the Settings dialog.

# FlowMark Feature Tracker

Based on the feature planning session — tracks implementation phases for the editor.

---

## Phase 1 — Command Registry + Toolbar Edit/Insert Menus
**Status:** `done` ✅  
**Effort:** Small  
**Dependencies:** None  
**Goal:** Central command registry so Edit/Insert menus, shortcuts, and future plugins share one path.

### Tasks
- [x] Create `CommandRegistry` module (`src/commands/registry.js`)
  - [x] `registerCommand(id, { label, shortcut, run, enabled, ... })`
  - [x] `getCommand(id)`, `getAllCommands()`, `execute(id, view, state)`
  - [x] Keyboard shortcut resolution (platform-aware)
- [x] Refactor existing actions (bold, italic, etc.) into registered commands
- [x] Build **Edit menu** dropdown (Undo, Redo, Cut, Copy, Paste, Select All, Find/Replace)
- [x] Build **Insert menu** dropdown with selection-aware wrap/toggle:
  - [x] Bold (`**text**`)
  - [x] Italic (`*text*`)
  - [x] Strikethrough (`~~text~~`)
  - [x] Inline code (`` `code` ``)
  - [x] Code block (```)
  - [x] Link (`[text](url)`)
  - [x] Image (`![alt](url)`)
  - [x] Table (insert markdown table skeleton)
  - [x] Callout (`> [!type]`)
  - [x] Math inline (`$...$`) / block (`$$...$$`)
  - [x] Footnote (`[^1]`)
  - [x] Horizontal rule (`---`)
  - [x] Quote (`> `)
  - [x] Task list (`- [ ] `)
  - [x] Heading (`# ` through `###### `)
- [x] Reuse existing `.cm-context-menu` styling for dropdowns
- [x] Headless tests: state in → expected doc/selection out for each Insert transform

### Inline Rendering in Callouts/Table Cells (folded into Phase 1)
- [x] Shared inline renderer for: bold, italic, code, strikethrough, links
- [x] Apply to callout bodies and table cells

---

## Phase 2 — Smart Typing + Autocomplete
**Status:** `done` ✅  
**Effort:** Small (brackets) / Medium (completion)  
**Dependencies:** `@codemirror/autocomplete` already in deps  
**Goal:** Auto-close pairs + Markdown-aware completions.

### Tasks
- [x] Wire `closeBrackets()` for: `()`, `[]`, `{}`, `""`, `''`, `` `` ``, `$...$`
- [x] Wire `closeBracketsKeymap` (Backspace deletes bracket pairs)
- [x] Wire `autocompletion()` with Markdown-specific sources:
  - [x] Callout types (`NOTE`, `WARNING`, `TIP`, `DANGER`, etc.) — after `> [!`
  - [x] Fence languages (`javascript`, `python`, `rust`, `json`, etc.) — after ``` 
  - [x] Emoji shortcodes (`:smile:`, `:rocket:`, etc.) — after `:xx`
- [x] Wire `completionKeymap` (Ctrl+Space, Escape, Enter, arrows)
- [x] Theme autocomplete tooltip to match editor (dark/light/sepia)
- [x] Headless tests: 28 tests for completion sources and data integrity

---

## Phase 3 — Tabs + Session Model
**Status:** `done` ✅  
**Effort:** Large (structural refactor)  
**Dependencies:** Phase 1 (commands), Phase 2 (completion for filenames)  
**Goal:** Multi-document tabs with per-tab state, session persistence.

### Tasks
- [x] Create `Document` class (`src/model/document.js`)
  - [x] `path`, `name`, `editorState`, `dirty`, `scrollPosition`, `selection`
  - [x] Methods: `save()`, `markDirty()`, `getState()`, `setState()`
- [x] Refactor `editor.js` singletons → per-document instances
  - [x] `currentDocPath` → `documents[]` array via `TabManager`
  - [x] `EditorView` state swapped via `view.setState(doc.editorState)`
  - [x] History lives in `EditorState` → undo is automatically per-tab
- [x] Tab bar UI (`src/ui/tabs.js`)
  - [x] Render tabs with name, dirty indicator, close button
  - [x] Click to switch, drag to reorder
  - [x] `Ctrl+W` close, `Ctrl+Tab` / `Ctrl+Shift+Tab` navigate
  - [x] Unsaved-close prompt (uses command registry `file:closeTab` and confirmation)
- [x] Session persistence (`src/session/sessionManager.js`)
  - [x] Save to `userData/session.json`: open tabs, active tab, scroll, selection, unsaved draft text
  - [x] Restore on startup (re-open files, recreate `EditorState`)
- [x] Welcome screen: show when no tabs open; "New File" creates first tab
- [x] Word count / status bar per active tab
- [x] Automated unit tests: 50 tests covering Document, TabManager, SessionManager

---

## Phase 4 — Metadata / Properties Card
**Status:** `pending`  
**Effort:** Medium  
**Dependencies:** Phase 3 (per-tab document model)  
**Goal:** Frontmatter rendered as editable properties card at top of document.

### Tasks
- [ ] Lightweight YAML subset parser (`src/parser/frontmatter.js`)
  - [ ] `key: value` (strings, numbers, booleans)
  - [ ] Quoted strings (`"..."`, `'...'`)
  - [ ] Inline arrays: `[a, b, c]`
  - [ ] Block lists (`- a\n- b`)
  - [ ] Nested objects (shallow, for tags/category)
- [ ] Detect frontmatter at line 1 (before HR scanner)
- [ ] Properties card UI (`src/ui/propertiesCard.js`)
  - [ ] Key/value rows with inline edit
  - [ ] Tag chips (add/remove, autocomplete from existing tags)
  - [ ] "Add property" button → new row
  - [ ] Raw YAML revealed when caret enters frontmatter region
  - [ ] Same interaction model as math/table: click to edit, Enter to commit, Escape to cancel
- [ ] Sync card ↔ editor state (changes in card update frontmatter, vice versa)
- [ ] Tags feed into search/sidebar (future)

---

## Phase 5 — Plugin MVP
**Status:** `pending`  
**Effort:** Small (narrow scope)  
**Dependencies:** Phase 1 (command registry API), Phase 3 (session for plugin settings)  
**Goal:** Local JS plugins with trusted-code model — commands, markdown transforms, stylesheets.

### Tasks
- [ ] Plugin loader (`src/plugins/pluginManager.js`)
  - [ ] Scan `userData/plugins/` on startup
  - [ ] Each plugin: `module.exports = { name, version, activate(app) }`
  - [ ] `app` API: `registerCommand`, `registerMarkdownTransform`, `registerStylesheet`, `registerSetting`
- [ ] Settings: `userData/plugins.json` (enabled/disabled, per-plugin config)
- [ ] Example plugins to validate API:
  - [ ] `insert-date` — inserts current date at cursor
  - [ ] `word-count` — status bar word count (alternative impl)
  - [ ] `custom-transform` — regex replace on save
- [ ] No custom views, no settings UI beyond JSON, no sandbox (local = trusted)

---

## Cross-Phase / Future

| Feature | Target Phase | Notes |
|---|---|---|
| Clickable external links (Ctrl+click) | Phase 1 | Uses command registry |
| Clickable internal links (`[[wiki]]`) | Phase 4 | Needs frontmatter/tags |
| Find & Replace panel | Phase 1 | `@codemirror/search` |
| Export / Print | Phase 3.5 | Needs tab model |
| Autosave | Phase 3.5 | Per-tab dirty tracking |
| Tag search / sidebar | Phase 4+ | Feeds from properties |

---

## Decision Log

| Date | Decision | Rationale |
|---|---|---|
| 2026-11-01 | Tracker created | From planning session response |
| 2026-11-02 | Phase 1 complete | All 6 prompts implemented: registry, edit menu, insert menu, inline renderer, shortcuts |
| 2026-11-02 | Phase 2 complete | closeBrackets + autocompletion with callout/fence/emoji sources, themed tooltip |
| 2026-11-02 | Phase 3 complete | Document & TabManager model, Tab bar UI with drag reorder, Session persistence, multi-tab routing |

---

## Progress Summary

```
Phase 1: ██████████  12/12 tasks ✅
Phase 2: ██████████   6/6  tasks ✅
Phase 3: ██████████  15/15 tasks ✅
Phase 4: ░░░░░░░░░░   0/10 tasks
Phase 5: ░░░░░░░░░░   0/8  tasks
```
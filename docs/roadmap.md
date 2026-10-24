# FlowMark Roadmap

Living tracker. Update status here when a phase starts or closes; do not keep
parallel plans elsewhere.

Last updated: 2026-10-24
Current release: **v1.0.0** (release one — see `docs/release-workflow.md`)

---

## How we work

- One phase at a time. Each phase gets a short spec in `docs/` before code, and
  the spec is updated when behaviour changes.
- Scope changes are allowed only for:
  1. a bug found while implementing the current phase, or
  2. a demonstrably better approach that removes work or risk.
  Every change of plan is recorded in the **Decision log** below, with a reason.
- A phase is done when: `npm run build` is green, logic is verified headlessly
  where possible (parser/transaction probes), the user has tested it in the app,
  the spec/roadmap is updated, and it is committed.

## Architectural rules that features must respect

- Block replacements come from a `StateField` (`EditorView.decorations.from`),
  never from a plugin: CM6 rejects block decorations from plugins.
- Any block widget must keep a stable box (constant line count, `estimatedHeight`
  + `ResizeObserver` → `requestMeasure`) so the height map does not jump.
- Edits are one transaction with a `userEvent`; undo is a single step.
- Undo selection comes from the transaction *before* the change: park the caret
  first (selection-only transaction), then dispatch the change. See
  `parkTableCaret` / `parkCaretOutside`.
- Any commit computed from captured offsets must re-resolve the construct
  (`resolveTableSpec`, fresh `scanEmbeds`) before writing.
- Never emit overlapping replacements: construct scanners consume their own
  lines and drops overlap (image vs math etc.).

---

## Phase 1 — Command registry, Edit/Insert menus, inline rendering in callouts

**Status: next**

Goal: one command layer shared by menus, keyboard shortcuts and future plugins;
toolbar dropdowns for edit and insert actions; callout bodies render inline
markdown instead of plain text.

Scope:
- `Command` objects: `{ id, label, shortcut, run(view), enabled(view) }` plus a
  registry with lookup by id.
- Edit menu: undo, redo, cut, copy, paste, select all, delete line.
- Insert menu: bold, italic, strikethrough, inline code, code block, link,
  image, table, callout, inline math, block math, footnote, horizontal rule,
  quote, task list, heading.
- Selection-aware wrap/toggle helpers; caret placement after insert; inserting
  without a selection places the caret between the markers.
- Inline markdown renderer shared by table cells and callout bodies
  (strong/em/code/strike/link; math inside these is Phase 2+ unless trivial).
- Menus reuse `.cm-context-menu`; anchored under the toolbar button, dismiss on
  outside click/Escape/scroll.

Out of scope: find & replace, link navigation, plugin loading.

Verification: headless probes that apply each insert command to an `EditorState`
and assert document text and selection; menu UI is user-tested.

Spec: `docs/phase-1-commands.md` (to be written before implementation).

---

## Phase 2 — Smart typing and completion

**Status: pending**

- `closeBrackets()` for `()[]{}` plus markdown pairs: backticks, `**`, `_`,
  `$`, `[[`.
- Pair deletion on empty pair, and skipping over a closing pair.
- Completion sources: callout types, fence languages, footnote labels,
  table/callout snippets; file names once Phase 3 exists.
- Must not fight live-preview concealment (typing a closing `**` must not
  swallow focus; verify with an `EditorState` probe).

---

## Phase 3 — Tabs and session model

**Status: pending**

- Per-document model: `{ path, name, state, dirty, scroll }`.
- One `EditorView`, `view.setState(doc.state)` on switch; history lives in
  `EditorState`, so undo is per tab automatically.
- Tab bar: new/close/reorder, dirty dot, unsaved-close prompt, keyboard
  (`Ctrl+W`, `Ctrl+Tab`, `Ctrl+Shift+Tab`, middle-click close).
- Refactor `editor.js` singletons (`currentDocPath`, `markClean`, word count,
  welcome screen) to read the active document.
- Session persistence (paths + scroll + active tab) in `app.getPath('userData')`;
  missing files are dropped silently.

Must land before Phase 4 so properties and dirty state are per tab.

---

## Phase 4 — Metadata / properties

**Status: pending**

- YAML frontmatter at the very start of a document (`---` … `---`) becomes a
  properties card: key/value rows, tag chips, add/remove property, editing
  overlay, raw YAML revealed when the caret enters the block.
- Frontmatter detection must run before the horizontal-rule scanner.
- Minimal YAML subset parser (`key: value`, quoted strings, `[a, b]`, block
  lists); `js-yaml` only if the subset proves insufficient.
- Properties are per file — no vault concept.

---

## Phase 5 — Plugin MVP

**Status: deferred (design seams now)**

- Depends on Phase 1's registry.
- Plugins live in `userData/plugins/*.js`, loaded by the main process, trusted
  local code.
- API: `registerCommand`, `registerMarkdownTransform`, `registerStylesheet`,
  `registerSetting`. No custom views, no settings UI beyond a JSON file.
- Full Obsidian-style API parity is explicitly out of scope.

---

## Backlog (unsequenced)

- Clickable links in live preview (external via shell, internal note links).
- Find & replace (`@codemirror/search`).
- Export to HTML/PDF and print.
- Autosave + crash-safe restore.
- Footnote definitions rendering; `~~strike~~`, `==highlight==`, `%%comments%%`.
- Math inside table cells and callout bodies.
- Image paste/drag, image resize, code-block language picker.
- Large-document performance pass (document-wide scans per keystroke).
- Undo grouping for multi-step structural table operations.

---

## Decision log

| Date | Decision | Reason |
|---|---|---|
| 2026-10-24 | Order: commands → smart typing → tabs → metadata → plugins | Registry unblocks menus and plugins; tabs must precede per-file metadata; plugin API needs the registry. |
| 2026-10-24 | Plugin system restricted to commands/transforms/CSS | Full plugin API is a platform-sized effort with no current consumer. |
| 2026-10-24 | Metadata is per file, not per vault | FlowMark opens arbitrary files; there is no vault root. |
| 2026-10-24 | Release packaging uses electron-builder with `portable` + `nsis` targets | One binary to run without installing, one conventional installer. |

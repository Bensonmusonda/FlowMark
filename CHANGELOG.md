# Changelog

All notable changes to FlowMark. Format loosely follows Keep a Changelog.

## [1.1.0] — 2026-11-23

Major plugin system enhancement release.

### Plugin System
- **Settings UI**: Dynamic settings panel per plugin, generated from manifest schema
- **Manifest validation**: Zod schema validation with friendly error messages
- **Error boundaries**: Plugin crash auto-recovery (3× retry with 5s delay), error display in plugin panel
- **Permission management**: Grant/revoke permissions per plugin at runtime
- **Hot reload**: `npm run plugin:dev` — edit plugin code, click Reload in panel, instant update
- **Template generator**: `node scripts/create-plugin.js <name>` — creates installable plugin scaffold
- **Event bus**: Plugin-to-plugin communication via `broadcastToPlugins(channel, data)`
- **Async markdown transforms**: Non-blocking markdown pipeline for LSP/external processing
- **Workspace events**: Hooks for file open/save (`workspace:onFileOpen`, `workspace:onFileSave`)
- **GitHub install**: One-click install from GitHub repo zip
- **Local registry**: Curated plugin gallery with install buttons

### Core Editor
- **Slash command trigger removal**: `/snippet` now inserts `snippet` cleanly (trigger char removed)
- **Focus restoration**: Editor regains focus after plugin changes

### DevEx
- Comprehensive TypeScript definitions (`src/plugins/plugin-api.d.ts`)
- Full plugin documentation in `docs/plugins/`

## [1.0.0] — 2026-10-24

Release one: a stable live-preview markdown editor.

### Editing
- Live syntax concealment with per-line/per-span reveal (`#`, quotes, emphasis
  marks, link marks, code fences).
- Height-map-stable block widgets: callouts, images, code blocks, tables, math.
- GFM tables rendered as a widget with in-grid editing, alignment menu, row
  insert/delete, column insert/delete, and a phantom row for appending.
- Undo returns the caret to the edited construct (parked selection), including
  table and math edits.
- Keyboard navigation inside tables (`Tab`, arrows, `Enter`, `Shift+Backspace`)
  and an escape hatch to raw source via double-click padding.

### Markdown
- Callout admonitions with icons and colours.
- Images with document-relative path resolution.
- Fenced code blocks with language pill and copy badge.
- KaTeX math: inline `$…$` and block `$$…$$`, hover card, TeX copy, in-place
  overlay editor with live preview, error fallback.
- Footnote references as superscript markers; horizontal rules; inline-code
  chips; brighter blockquote text.

### App
- Dark, light (solid white) and sepia themes with accent colours; zen mode.
- Native window background follows the theme (no black gutter while resizing).
- Electron upgraded to 39.8.10 (Chromium DirectComposition resize fix).
- DevTools disabled (`devTools: false`).
- File new/open/save/save-as, recent files, word count and reading time.
- Export to PDF/HTML as a plain white paper document (app theme not applied).
- Vendored KaTeX CSS + woff2 fonts for fully offline math.

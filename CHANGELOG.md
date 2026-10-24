# Changelog

All notable changes to FlowMark. Format loosely follows Keep a Changelog.

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

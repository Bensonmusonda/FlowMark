# GFM Tables — Live Preview & In-Grid Editing Spec

Status: phases 1–4 implemented.
Scope: `src/editor.js` (`TableBlockWidget`, embed field), `src/style.css`.

## 1. Core model

The markdown text is the document; the grid is a **view** of one contiguous table.
Tables render as a single `Decoration.replace({ block: true })` produced by the
state field (block widgets are rejected from ViewPlugins). Cell editing happens in
an `<input>` overlay, so the document selection never enters the table range and the
widget stays rendered.

Four conceptual states:

| State | Visible | Entered by | Left by |
|---|---|---|---|
| Rendered | grid | default, click outside, `Esc` | cell click → Editing; double-click padding → Source |
| Editing | grid + cell input | click cell, `Enter`/`Tab` from another cell | commit/navigation, `Esc` |
| Source | raw pipes | arrow into block, double-click padding, invalid table | click outside |
| (Selected) | grid + ring | deferred (phase 5) | — |

Rules:

- Anything that is not a complete table (header + delimiter row) is never rendered;
  it is ordinary text. Typing/pasting a table therefore never snaps mid-entry.
- While the caret is inside the table range the widget is not emitted (CM6
  constraint). This is the only way back to raw syntax besides double-clicking the
  table padding.
- A cell commit is a single replace transaction against that cell's exact source
  range (`userEvent`-tagged, one undo step per commit).

## 2. Keyboard contract (cell editor focused)

| Key | Behaviour |
|---|---|
| `Enter` | commit; focus same column, next row. On the last row → phantom row |
| `Shift+Enter` | commit; same column, previous row |
| `Tab` / `Shift+Tab` | commit; next / previous cell, wrapping across rows; past the last cell → exit below |
| `ArrowDown` / `ArrowUp` | commit; same column, next / previous **row** (input is single-line). Never creates a row: from the last row it exits below |
| `ArrowRight` | native caret move; at end of text → next cell (same row) |
| `ArrowLeft` | native caret move; at start of text → previous cell (same row) |
| `Esc` | discard the edit, close the overlay, return to grid |

Only `Enter` reaches the phantom row, so navigation can never silently create one.
Arrow left/right are deliberately boundary-gated so multi-character cell text stays
fully editable. Up/down are free because the input is single-line.

Exit boundaries: `Up` from the header row places the caret on the line above the
table; `Down` from an empty phantom row (or `Tab` past the last cell of the phantom)
places it on the line below.

## 3. Phantom row

The extra row shown after `Enter` on the last row **does not exist in the document**.

- It is rendered only in the widget while a pending target points past the last row.
- The first commit with content inserts a real row in the same transaction that
  edits the cell, so there is never an empty row to clean up and no extra undo step.
- Leaving it empty (`Enter` again, `Esc`, blur, or another cell click) writes nothing.

This replaces the original "add row then delete if empty" plan and removes the
associated undo noise and edge cases.

## 4. Structural operations

Right-click a cell or header:

- Insert row above / below
- Insert column left / right
- Delete row / delete column
- Column alignment: left / center / right (rewrites the delimiter row)
- Copy table as Markdown
- Edit source (reveals raw pipes, caret at the table start)

Each operation is one transaction that rewrites the affected lines; the widget
re-renders from the new scan. Deleting the header row is refused (header context
disables it), and the last remaining column cannot be deleted. A right-click on a
phantom row commits it away first, so the menu always acts on real rows.

`Shift+Backspace` in a cell editor deletes the current row: immediately when the
cell (and its row) is empty, with a confirmation dialog when the row has content.
The phantom row is discarded by `Enter`/`Esc` instead; it is never written.

## 5. Invariants

- Height map: `estimatedHeight = rowCount × editorLineHeight` (measured line height,
  fallback 28, minimum 48). `ResizeObserver → view.requestMeasure()` after column
  reflow. Commits do not change the widget's vertical extent beyond the actual row.
- `eq()` compares the raw table source key plus a UI key (pending phantom/editor
  target), so typing elsewhere never rebuilds an untouched table and UI-only changes
  still force a rebuild.
- Cell markup is built with DOM nodes and `textContent`; no `innerHTML` for table
  content. Inline support per cell: `` `code` ``, `**strong**`, `*em*`.
- Horizontal overflow: cells cap their intrinsic width (`.fm-cell`, 360px) so long
  text wraps; the table is `width: max-content; min-width: 100%` inside a
  `contain: paint` scroller, so narrow windows scroll only once the summed columns
  exceed the container.
- Cell editing is an `<input>` absolutely positioned over the cell with the same
  padding and inherited typography, while the rendered text is hidden with
  `visibility: hidden`; the row height and text position do not change.

## 6. Known gaps

- Arrow keys cannot *enter* the grid from the surrounding lines; the caret entering
  the block still reveals source. Intercepting that requires faking selection
  movement and is deferred.
- Ragged rows: editing a cell that does not exist rewrites that row in a canonical
  pipe shape (`| a | b |`), normalizing its spacing.
- `\|` inside a cell is shown escaped in the editor and committed verbatim.
- Newlines cannot be typed in a cell (GFM cells are single-line); a multi-line paste
  is not supported inside the overlay.

# FlowMark Editor & Formatting Engine Audit

**Audit Date:** November 2026
**Scope:** `src/editor.js`, `src/style.css`, CodeMirror 6 extensions, active syntax concealment, embed widgets, and selection behavior.

---

## Part 1: Deep Dive into the Two Reported Issues

### Issue 1: "Selecting text is snappy / jumpy"

#### Root Causes:
1. **Horizontal Layout Shifts During Drag Selection (`inlineIsActive` collapse/expand)**:
   - In `src/editor.js` (`inlineIsActive`), an inline construct (e.g. `**bold**`, `*italic*`, `[text](url)`) is only active when the entire selection range is strictly inside it:
     ```js
     function inlineIsActive(view, from, to) {
       for (const r of view.state.selection.ranges) {
         if (r.from >= from && r.to <= to) return true;
       }
       return false;
     }
     ```
   - **What happens during drag selection:** When the user starts dragging inside a bold word, the `**` markers are revealed. As soon as the drag crosses even 1 character outside the bold word, `r.to <= to` becomes `false`. CodeMirror immediately applies `HIDE` (`Decoration.replace({})`), collapsing the `**` markers.
   - **The snap:** The word instantly jumps 2 characters left at the start and 2 characters left at the end (4 characters total). Because the text physically moves under the mouse pointer while dragging, CodeMirror's `posAtCoords` recalculates, jumping the selection forward, which then triggers more layout shifts.

2. **Block Embeds Collapsing During Drag Selection (`rangeTouches`)**:
   - In `buildEmbedDecos`, tables, callouts, and math blocks check:
     ```js
     if (rangeTouches(selection, table.from, table.to)) continue;
     ```
   - When selecting text downward from a paragraph above a table, the instant the selection touches `table.from`, the **entire 200px+ rendered HTML table widget is instantly destroyed and replaced with raw markdown pipes (`| --- |`)**.
   - This causes an immediate, massive vertical layout shift ($\sim 100\text{–}300\text{px}$) right under the user's mouse during a drag.

3. **IPC Event Flooding on Every Mouse Movement**:
   - In `dispatchTransactions` (`src/editor.js` line 3161):
     ```js
     const selChanged = trs.some(tr => tr.selection);
     if (selChanged && window.editorAPI?.notifySelectionChange) {
       window.editorAPI.notifySelectionChange({ anchor, head, empty });
     }
     ```
   - During a mouse drag, CodeMirror dispatches dozens of transactions per second. This sends rapid IPC messages to the Electron main process, which then broadcasts across all sandboxed plugin windows.

---

### Issue 2: "In a list item, clicking a formatted item shows syntax of everything (bullet, checkbox, etc.)"

#### Root Causes:
1. **The Overly Broad `lineIsActive` Scope**:
   - In `src/editor.js`, list marks, checkboxes, and wikilinks check `lineIsActive(view, pos)`:
     ```js
     function lineIsActive(view, pos) {
       const line = view.state.doc.lineAt(pos);
       for (const r of view.state.selection.ranges) {
         if (r.from >= line.from && r.to <= line.to) return true;
       }
       return false;
     }
     ```
   - If the caret or selection touches **any position on that line**, `lineIsActive` returns `true` for every construct on the entire line.

2. **List Bullet Destruction**:
   - In `bulletPlugin` (line 2136), `active = lineIsActive(view, info.markFrom)`.
   - When active, it adds `.cm-list-mark-active`.
   - In `src/style.css` (line 464):
     ```css
     .cm-list-mark.cm-list-mark-active { color: var(--text); }
     .cm-list-mark.cm-list-mark-active::before { content: none; }
     ```
   - **Result:** The styled bullet dot (`::before`) is removed, and the raw markdown bullet `-` or `*` is printed in text color.

3. **Checkbox Widget Unmounting**:
   - In `checkboxPlugin` (line 2208):
     ```js
     if (lineIsActive(view, t.from)) continue;
     ```
   - When `lineIsActive` is true, the `CheckboxWidget` is completely skipped, exposing the raw text `[ ]` or `[x]`.

4. **The Cascade on Click**:
   - If a list line contains `- [ ] An important [link](https://...) and **bold** note`:
   - Clicking on the link or bold word turns `lineIsActive` to `true`.
   - The bullet dot reverts to `-`, the checkbox reverts to `[ ]`, and `[[wikilinks]]` reveal `[[...]]`. Everything on the line explodes into raw syntax simultaneously.

---

## Part 2: Comprehensive Scan of Other Formatting & Editor Issues

### 3. Checkbox Cannot Be Toggled While Editing a Task Line
- **Problem:** Because `checkboxPlugin` skips emitting the `CheckboxWidget` whenever `lineIsActive(view, t.from)` is true, the moment you place your cursor on a task list line to edit text, the interactive checkbox disappears and becomes raw `- [ ]` text.
- **Expected Behavior:** In Obsidian/Typora, the checkbox widget remains rendered and clickable at all times. Raw `[ ]` should only be revealed if the caret is positioned directly between or immediately next to the brackets.

### 4. External Markdown Links Don't Open on Click
- **Problem:** In `src/editor.js`, `document.getElementById('editor-wrap')` only has a handler for `handleNoteLinkClick` (`[[internal-notes]]`). There is no click handler or `shell.openExternal` call for standard markdown links `[Label](https://...)`.
- **Symptom:** Clicking a link merely reveals the markdown URL syntax rather than opening the link in the user's default browser (even with `Ctrl+Click`).

### 5. Heading Syntax (`#`) Visual Jump
- **Problem:** Heading text is styled with `fontSize: 2em` (`t.heading1`) or `1.5em` (`t.heading2`). When `lineIsActive` is triggered on a heading line, the `# ` mark is un-concealed.
- **Symptom:** Because `# ` inherits the large heading font size, clicking into an H1 causes two massive `# ` characters to pop into the line, suddenly pushing the heading text $\sim 60\text{px}$ to the right under the user's caret.

### 6. Code Block Language Badge Layout Race
- **Problem:** In `addCodeBlockDecorations`, `LangBadgeWidget` is inserted at `line.to` of the opening fence. When clicking inside the code block, `isActive` becomes `true`, causing the badge to unmount and the opening/closing ```` ``` ```` fences to un-conceal.
- **Symptom:** Fences snap into view, and if code blocks contain long lines, line-wrapping metrics reflow abruptly.

### 7. Selection Disappearing When Dragging Across Frontmatter Properties Card
- **Problem:** `PropertiesCardWidget` uses `block: true`. When dragging a selection from the title area down into the editor, crossing the properties card boundary causes selection rendering artifacts because native browser selections cannot seamlessly bridge non-editable custom block widgets and CodeMirror text nodes.

### 8. Inline Code (`` `code` ``) Concealment Flaws
- **Problem:** In `activeSyntaxPlugin`:
  ```js
  if (node.to - node.from > 2 && !inlineIsActive(view, node.from, node.to)) {
    decos.push(Decoration.mark({ class: 'cm-inline-code' }).range(node.from + 1, node.to - 1));
  }
  ```
  The backtick marks `` ` `` are neither concealed nor styled separately—the mark is placed on `node.from + 1` to `node.to - 1`. If the cursor enters, the code styling class is dropped entirely instead of just revealing the backtick characters.

### 9. Lack of Selection Debouncing for Plugin IPC
- **Problem:** `notifySelectionChange` fires synchronously inside CodeMirror's transaction pipeline. Rapid typing, arrow key navigation, or mouse dragging floods Electron's IPC channel with hundreds of unnecessary selection payload messages.

---

## Part 3: Architectural Solutions Roadmap

| Area | Current Behavior | Recommended Fix |
|------|------------------|-----------------|
| **Selection Snapping** | Formatting collapses/expands mid-drag when selection bounds cross markers. | When `view.state.selection.main.empty === false` (user is actively selecting text), **freeze existing concealment states** so text never shifts under the dragging cursor. |
| **List Items** | Entire line syntax explodes when clicking anywhere on the line. | Decouple bullet & checkbox reveal from `lineIsActive`. Only reveal raw `[ ]` if the caret offset is literally between `node.from` and `node.to`. Keep the styled bullet dot permanently rendered. |
| **Checkboxes** | Checkbox widget disappears while editing the line. | Always keep `CheckboxWidget` mounted; allow toggling even when caret is on the task line. |
| **External Links** | No action on Ctrl+Click. | Add `Ctrl+Click` listener in `editor-wrap` targeting `Link` nodes, extracting `URL`, and calling `window.shellAPI.openExternal(url)`. |
| **Heading Jump** | Huge `#` symbols appear with large heading font sizes. | Style `HeaderMark` with a fixed, subtle font size and muted color (`0.7em`, opacity 0.4) so un-concealing it does not jolt the line. |
| **Embeds (Tables/Math)** | Collapse into raw source on simple selection touch. | Only un-conceal to raw source on explicit double-click or keyboard navigation into the embed, never during passive mouse drag selections. |
| **Selection IPC** | Fires on every micro-transaction. | Debounce `notifySelectionChange` by 50–100ms. |

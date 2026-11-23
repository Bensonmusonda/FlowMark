# UI, Settings & Extensions Backlog

Documented from user feedback on 2026-11-24.

---

### 1. Appearance Tab Enhancements
- **Restore to Default:** Add a "Restore Defaults" button under the Appearance tab in [appearanceTab.js](file:///d:/Lab/Reverse Engineering/REA-Workspace/FlowMark%20Markdown%20Editor/src/ui/settingsTabs/appearanceTab.js) to reset theme, accent color, font family, and font size back to factory defaults.
- **Additional Color Palettes:** Expand beyond the pastel palette to include additional curated palettes (e.g., vibrant, earth tones, monochrome, neon/cyberpunk).

### 2. General Tab & Form Controls
- **Browse Button Styling:** Ensure the directory/file "Browse" button under the General tab in [generalTab.js](file:///d:/Lab/Reverse Engineering/REA-Workspace/FlowMark%20Markdown%20Editor/src/ui/settingsTabs/generalTab.js) matches the primary/secondary button design system in [style.css](file:///d:/Lab/Reverse Engineering/REA-Workspace/FlowMark%20Markdown%20Editor/src/style.css).

### 3. Accent Color Consistency & Elimination of Stray Blue Highlights
- Audit and eliminate default browser/system blue focus rings, selection backgrounds, and outline highlights across FlowMark.
- Ensure all focus rings (`:focus-visible`), outlines, and selection indicators strictly use CSS variables derived from `--accent` (or translucent variations like `rgba(var(--accent-rgb), 0.25)`).

### 4. Settings Dialog Layout & Spacing Polish
- In [privacyTab.js](file:///d:/Lab/Reverse Engineering/REA-Workspace/FlowMark%20Markdown%20Editor/src/ui/settingsTabs/privacyTab.js), [generalTab.js](file:///d:/Lab/Reverse Engineering/REA-Workspace/FlowMark%20Markdown%20Editor/src/ui/settingsTabs/generalTab.js), and other tabs:
  - Add consistent vertical spacing between form rows (e.g., the "Update channel" dropdown and "Automatically check for updates" checkbox currently sit directly against each other).
  - Align checkboxes and labels vertically with proper padding (`gap: 12px` between setting controls within a group).

### 5. Slash Command Fuzzy / Incremental Filtering (Snippet Pack)
- When typing after `/`, ensure FlowMark's slash command menu in [editor.js](file:///d:/Lab/Reverse Engineering/REA-Workspace/FlowMark%20Markdown%20Editor/src/editor.js#L4870) dynamically filters registered slash commands by prefix/substring of the command label or ID as the user types.

### 6. Embedded Plugins Manager inside Settings
- Migrate / embed the full plugin manager view (browse, installed list, enable/disable, detail views) directly into the Settings Dialog under [pluginsTab.js](file:///d:/Lab/Reverse Engineering/REA-Workspace/FlowMark%20Markdown%20Editor/src/ui/settingsTabs/pluginsTab.js).

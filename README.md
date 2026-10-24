# FlowMark

A minimalistic **viewing** and **editing** program for *markdown* files written in ***Electron***.

## Features

- **Live preview** — markdown renders as you type; syntax marks conceal when the caret is elsewhere and return when you edit them.
- **Clean minimal UI** — dark, light (solid white) and sepia themes, accent colours, distraction-free mode (`F11`).
- **Callouts** — GitHub/Obsidian admonitions with icons and colours.
- **Images** — resolved relative to the current document.
- **Code blocks** — language pill and copy button; fenced blocks keep their fences visible at the boundary.
- **GFM tables** — rendered as a widget with in-grid editing, alignment and row/column operations, phantom row for appending.
- **Math** — KaTeX inline `$…$` and block `$$…$$`, hover card, TeX copy, in-place editor with live preview.
- **Find & Replace** — `Ctrl+F` panel with match navigation and replace-all.
- **Export** — PDF and self-contained HTML from the menu.
- **File operations** — new (`Ctrl+N`), open (`Ctrl+O`), save (`Ctrl+S`), save-as (`Ctrl+Shift+S`), quick open (`Ctrl+P`), recents, word count and reading time.

## Running from source

```cmd
git clone https://github.com/Bensonmusonda/FlowMark
cd FlowMark
npm install
npm start
```

## Building a release

```cmd
npm run dist              # portable .exe + NSIS installer in dist/
npm run dist:portable     # portable only
npm run dist:installer    # installer only
```

Builds are unsigned (SmartScreen will warn on first run) and currently use the
default Electron icon. See `docs/release-workflow.md` for the full checklist.

## Documentation

- `docs/roadmap.md` — phases, backlog and decision log
- `docs/release-workflow.md` — versioning, packaging, release steps
- `docs/table-live-preview-spec.md` — table live-preview design

## License

This project is licensed under the MIT License — see the [LICENSE](LICENSE) file for details. In short: you're free to use, modify, and distribute this code, including commercially, as long as the original copyright notice is kept.

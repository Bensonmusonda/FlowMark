# Release workflow

## Versioning

- Semver in `package.json` (`version`). electron-builder uses it for artifact
  names and the installer metadata.
- Release one is **1.0.0**, tagged `v1.0.0`.
- Tags are annotated: `git tag -a v1.0.0 -m "FlowMark 1.0.0"`.

## Packaging

electron-builder, configured in `package.json` under `"build"`:

| Target | Artifact | Use |
|---|---|---|
| `portable` | `dist/FlowMark 1.0.0.exe` | run without installing |
| `nsis` | `dist/FlowMark Setup 1.0.0.exe` | conventional installer, per-user, directory selectable |

Both are unsigned. Windows SmartScreen will warn on first run until a code
signing certificate is added (future work).

`win.signAndEditExecutable` is `false` on purpose: electron-builder otherwise
extracts the `winCodeSign` cache, which contains macOS symlinks and fails on
Windows without Developer Mode/admin (`Cannot create symbolic link: A required
privilege is not held by the client`). The cost is that the exe keeps the
default Electron icon and metadata. To enable icon/signing later, run on a
machine with symlink privileges (or enable Windows Developer Mode) and remove
that flag.

The app icon is still the Electron default; add `build/icon.ico` (256×256) and
point `win.icon` at it before a public release.

## Release checklist

1. `npm start` — smoke test the running app (open, edit, save, tables, math,
   tabs when they exist).
2. `npm run build` — confirm `EXIT=0` and `src/editor.bundle.js` updated.
3. Update `docs/roadmap.md` (phase status) and `CHANGELOG.md`.
4. Bump `version` in `package.json`.
5. `npm run dist` — produces portable + installer in `dist/`.
6. Run the portable exe from a clean folder and the installer on a clean
   profile; check open/save and that `src/vendor/katex/fonts` load (math).
7. Commit: `release: vX.Y.Z`.
8. Tag: `git tag -a vX.Y.Z -m "FlowMark X.Y.Z"`.
9. Push: `git push origin main --tags`.
10. GitHub → Releases → draft from the tag, attach both artifacts, paste the
    changelog section.

## Git notes

- Remote: `https://github.com/Bensonmusonda/FlowMark` (branch `main`).
- Identity is configured (`Benson Musonda <Bensonmusonda12@gmail.com>`).
- `dist/`, `build/`, `node_modules/`, `test-docs/` are ignored.
- `src/editor.bundle.js` is committed on purpose: the app loads it directly, so
  a clone runs without a build step.
- The working copy was moved between machines; before the first push of a
  release, run `git fetch origin` and confirm `git rev-list --left-right --count
  main...origin/main` is `0 0` (or reconcile) so the tag does not point at a
  divergent history.

## Smoke-test checklist (release one)

- [ ] Launch, welcome screen, recent files.
- [ ] Open the benchmark document.
- [ ] Headings, lists, quotes, code fences, tables, math render.
- [ ] Table: insert row, edit several cells in the new row, alignment menu.
- [ ] Math: click a block equation, edit TeX, live preview, commit, undo.
- [ ] Save, Save As, reopen.
- [ ] Resize the window — no black gutter on the right/bottom.
- [ ] Themes: dark, light, sepia; window background follows the theme.
- [ ] DevTools do not open.

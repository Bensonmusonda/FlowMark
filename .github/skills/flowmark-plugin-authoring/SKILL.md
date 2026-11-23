---
name: flowmark-plugin-authoring
description: Create or modify plugins for FlowMark's sandboxed plugin system. Use when implementing a plugin, adding a plugin command, panel, custom tab view, slash command, smart-paste transform, or plugin-facing API.
---

# FlowMark plugin authoring

Build against FlowMark's implemented sandbox contract. Do not infer support from roadmap entries, `PLUGIN_IDEAS.md`, or the separate legacy plugin manager.

## Start with the contract

1. Read `docs/plugins/README.md` and the relevant guide under `docs/plugins/`.
2. Verify exact behavior in `src/plugins/sandbox/manifest-schema.json`, `plugin-preload.js`, `request-authorizer.js`, and `plugin-host.js`.
3. Identify the plugin context before writing code:
   - The primary plugin window has `flowmarkPlugin`.
   - Panel and custom-view iframes do not have `flowmarkPlugin`.
   - Custom views support only the documented init/state message protocol; panels currently have no host message bridge.
4. If the requested feature is not exposed by the current contract, do not fake it with direct DOM access, Node APIs, or undocumented IPC. Explain the missing API and implement only if the user asks for that host/API change.

## Implement a plugin

1. Keep `plugin.json` at the selected plugin-folder root. Validate it against the JSON schema.
2. Use a lowercase kebab-case plugin name and prefix command, menu, panel, and view IDs with that name.
3. Declare the minimum permissions for the exact APIs used. Remember that manifest permissions are enforced by the host but are not separately approved through an installer permission dialog.
4. Keep `.js` entry points as classic scripts. The runner does not implement ES-module loading; bundle dependencies or use an HTML entry with a bundled script.
5. Handle rejected promises, user cancellation, missing Markdown documents, and malformed or stale view state. Do not silently convert errors into success.
6. Keep custom-view state JSON-serializable and below 256 KB. Treat it as persisted session data.
7. If a plugin owns registered commands or panels, provide clear activation and removal behavior. Do not open custom views automatically on every startup unless the requested UX explicitly requires it.
8. For a menu action, register both the menu item and the runtime command with the same ID. Manifest command metadata alone does not provide a callback.
9. Keep plugin-local HTML/CSS self-contained. Do not depend on application DOM or undocumented CSS selectors.

## Validate and document

- Run the focused test relevant to the change, then `npm test` and `npm run build` when changing the app or plugin contract.
- Exercise user-visible behavior in Electron when practical: install the folder, enable the plugin, invoke its feature, disable it, and confirm cleanup.
- For host API changes, add focused tests for permitted and denied requests, update the schema/authorizer/preload/host as appropriate, and update the matching guide under `docs/plugins/`.
- Report what was implemented, permissions required, validation run, and any API limitation left unresolved.

## Current boundaries to state accurately

- `ui.panels` supports left/right panel registration, but panel iframes cannot call plugin APIs today.
- `ui.customViews` registers a view; it does not automatically route ordinary files based on `extensions`.
- Custom-view iframes can initialize and persist bounded JSON state, but cannot call editor APIs.
- App-wide themes, arbitrary overlays, and CodeMirror plugin decorations are not exposed by the sandbox API.
- Sandbox PDF export is not implemented. Settings metadata does not currently create a settings form.

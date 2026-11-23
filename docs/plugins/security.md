# Security model

FlowMark runs plugin code in isolated Electron renderer windows and mediates supported host operations through a permission-checked IPC API. This reduces direct access to the application, but it does not make an installed plugin harmless.

## Trust and installation

The current UI installs a selected local directory after validating its manifest. It does not display a separate prompt asking the user to approve each listed permission. Installing a plugin therefore means trusting the plugin's code and its declared capabilities. Only install code you trust and can inspect.

The primary plugin window is configured with `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`, and `webSecurity: true`. `flowmarkPlugin` is exposed through a narrow preload bridge. The plugin's panel and custom-view iframes have scripts enabled but do not receive that bridge or access to the host DOM.

Treat these boundaries as defense in depth, not a guarantee against malicious code, resource exhaustion, or misuse of capabilities the plugin was granted.

## Permission impact

Choose the smallest set of permissions that implements the feature:

- `editor.write` can alter the active Markdown document.
- `file.write` writes directly to a caller-supplied path, without a save dialog or path allowlist.
- `file.read` uses a native picker, but the user-selected file contents are then available to the plugin.
- `clipboard.read` exposes clipboard text/HTML to the plugin.
- `network.request` permits network requests; the host does not apply a plugin-specific origin allowlist. Non-GET methods also need `network.request:write`.
- `ui.panels` and `ui.customViews` allow registration of their respective iframe surfaces, not access to the parent DOM.
- `file.save` uses a native save dialog and opts the plugin into the host's before-save transform flow.

Host IPC requests are checked against the manifest permission set. A permission declaration is not a substitute for validating inputs, checking returned data, or explaining sensitive behavior to users.

## Authoring checklist

1. Declare only permissions used by the plugin.
2. Keep the primary `entry_point`, panel entries, and view entries inside the plugin directory. Panel and custom-view registrations are checked for directory containment. The primary `entry_point` is currently checked for existence but is not checked for directory containment; this should be hardened before treating arbitrary third-party packages as safe.
3. Do not add code that downloads and executes remote scripts. Bundle reviewed dependencies into the classic-script entry.
4. Validate strings, paths, and remote response data before use. Avoid logging document contents or credentials.
5. Keep custom-view state small, JSON-only, and free of secrets; it is persisted with the app session.
6. Handle permission errors and user cancellation explicitly.
7. Prefer `file.save` when the user should choose the destination. Use direct `file.write` only when its broader path-writing behavior is required and clearly explained.

## Reporting implementation risks

When changing the plugin host, review `manifest-schema.json`, `request-authorizer.js`, `plugin-preload.js`, and `plugin-host.js` together. Tests should verify both allowed requests and requests rejected when a permission is missing. Do not assume that a renderer-side permission check is sufficient; the host authorizer is the security boundary for IPC.

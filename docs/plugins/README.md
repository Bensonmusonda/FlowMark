# FlowMark plugin development

This documentation describes the **sandboxed plugin system** used by the current app. It is based on the implementation in `src/plugins/sandbox/`, not on proposals in `PLUGIN_IDEAS.md`.

## Guides

- [Getting started](./getting-started.md) — create, register, and install a minimal plugin.
- [Manifest and permissions](./manifest-and-permissions.md) — valid manifest fields and the capabilities each permission grants.
- [API reference](./api-reference.md) — methods available on `flowmarkPlugin`.
- [Panels and custom tabs](./panels-and-custom-tabs.md) — panel registration, custom views, and their current limits.
- [Security model](./security.md) — trust assumptions and safe permission choices.
- [Testing and troubleshooting](./testing-and-troubleshooting.md) — validate plugins and diagnose common failures.

Agent skills for this repository:

- [FlowMark plugin authoring](../../.github/skills/flowmark-plugin-authoring/SKILL.md)
- [FlowMark plugin review](../../.github/skills/flowmark-plugin-review/SKILL.md)

## Current capabilities

Plugins are installed from a local folder through **Plugins > Install Plugin from Folder...**. The selected folder must contain `plugin.json`; FlowMark validates it and copies the plugin into its application data directory. ZIP installation, an online catalog, and an in-app update flow are not currently provided.

The sandbox API supports editor access, commands and menus, local settings, file and clipboard operations, network requests, status/notification UI, sidebar panels, custom tab views, slash commands, and smart-paste transforms. Every API call should declare its required permission in the manifest.

Important boundaries:

- A `.js` `entry_point` is loaded as a **classic script**, not an ES module. It cannot use browser `import`/`export` directly; bundle dependencies into the entry script. An `.html` entry point is loaded directly.
- Panel and custom-view HTML runs in a separate sandboxed iframe. It does not receive `flowmarkPlugin` or direct access to FlowMark's DOM. Panels currently have no host messaging bridge. Custom views have a limited initialization/state `postMessage` protocol, but no editor API inside their iframe.
- Registering a custom view does not redirect ordinary file opening. The plugin must explicitly call `flowmarkPlugin.views.open(...)`.
- Arbitrary overlays over tabs, application-wide plugin themes, and plugin-owned CodeMirror decorations are not part of the current sandbox API. Treat ideas for those as proposals unless implemented and documented here.
- `src/plugins/pluginManager.js` contains a separate legacy manager; use `src/plugins/sandbox/` and `src/plugins/sandbox/manifest-schema.json` as the contract for the currently exposed sandbox API.

## Implementation sources

When a guide and implementation disagree, verify the current contract in these files:

- [`manifest-schema.json`](../../src/plugins/sandbox/manifest-schema.json) — manifest fields and permission names.
- [`plugin-preload.js`](../../src/plugins/sandbox/plugin-preload.js) — exposed API methods and callback behavior.
- [`request-authorizer.js`](../../src/plugins/sandbox/request-authorizer.js) — permission checks for host requests.
- [`plugin-host.js`](../../src/plugins/sandbox/plugin-host.js) — validation, sandbox creation, and host-side API behavior.
- [`plugin-runner.html`](../../src/plugins/sandbox/plugin-runner.html) — classic-script entry loading.
- [`pluginPanelIcons.js`](../../src/ui/pluginPanelIcons.js) — supported panel activity icons.

Keep the distinction clear between implemented APIs and future proposals when adding features or updating this documentation.

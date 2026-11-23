# Testing and troubleshooting

## Local test loop

1. Keep a plugin source folder separate from FlowMark's installed application data.
2. Validate `plugin.json` against [`manifest-schema.json`](../../src/plugins/sandbox/manifest-schema.json).
3. Install through **Plugins > Install Plugin from Folder...** and exercise the plugin from the UI.
4. Use `flowmarkPlugin.log`, `.warn`, and `.error`; host messages are prefixed with the plugin ID in the application's console.
5. For FlowMark changes, run the focused test first, then the repository checks:

```powershell
node test-stage4.mjs
npm test
npm run build
```

`npm start` builds the editor bundle and starts Electron. `npm run start:dev` does the same with the app's development flag.

The current test suite includes source-level checks for panel registration, custom views, permission authorization, and plugin installation. A change to the plugin contract should add or update focused tests and its corresponding guide.

## Common issues

| Symptom | Likely cause and next step |
| --- | --- |
| `Missing plugin.json` | The selected folder is not the plugin root. Select the directory containing `plugin.json`. |
| Manifest rejected | Check required fields, unique permission names, the exact permission spellings, and the allowed top-level properties in the schema. |
| `Permission denied` or `Missing permission` | Add only the required permission to `permissions`, then reinstall the plugin. |
| Entry point not found | Check the case and relative path from the plugin root. Keep the file in the plugin folder. |
| `import` or `export` syntax error | A non-HTML `entry_point` is loaded as a classic script, not an ES module. Bundle dependencies into a classic script. |
| Menu item appears but does nothing | Register a runtime callback with `ui.registerCommand` using the same ID as the menu item, and declare `editor.commands`. |
| Editor call fails on a custom tab | Editor API methods require an active Markdown document. |
| Registered extension does not open a file automatically | `extensions` is registration metadata. Call `views.open(...)` explicitly from a user-triggered action. |
| Panel displays a placeholder | Check that `entry` exists under the plugin folder. An omitted `entry` intentionally renders a placeholder. |
| Panel UI cannot modify the editor | Panel iframes currently have no `flowmarkPlugin` bridge or host messaging channel. |
| Custom view says unavailable | The owning plugin may be disabled, failed to load, or no longer register that view. Enable/fix the plugin and reopen the tab. |
| A source edit has no effect | The folder installer copies files into app data. Editing the original folder does not update the installed copy; duplicate plugin IDs are rejected and there is no UI update flow. |
| File/export result contains `{ error }` | Some host operations report unsupported formats as result objects. Sandbox PDF export is not implemented; inspect resolved result values as well as promise rejections. |

## When changing the API

Update the focused tests and docs alongside implementation. Check the manifest schema, renderer preload checks, host-side authorization, host handler, and cleanup when a plugin is disabled. Run `npm test` and `npm run build` for changes that affect the application; also verify the affected flow in Electron when it changes user-visible behavior.

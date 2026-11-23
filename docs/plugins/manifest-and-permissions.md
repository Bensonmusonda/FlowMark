# Manifest and permissions

Each installable sandbox plugin is a directory containing a root-level `plugin.json` and the files referenced by its entry point or registered views.

## Manifest fields

`src/plugins/sandbox/manifest-schema.json` is the authoritative schema. The supported top-level properties are:

| Property | Required | Contract |
| --- | --- | --- |
| `name` | Yes | Lowercase letters, digits, and hyphens only (`^[a-z0-9-]+$`). This is the plugin's stable ID and storage namespace. |
| `version` | Yes | Three numeric components, for example `1.2.3`. |
| `manifest_version` | Yes | Integer `1`. |
| `entry_point` | Yes | Path to the plugin's primary entry. HTML loads directly; other files are loaded as classic scripts, not ES modules. Keep it inside the plugin folder. |
| `permissions` | Yes | Unique array of permission strings from the table below. |
| `description` | No | String up to 200 characters. |
| `author` | No | String. |
| `commands` | No | Command metadata objects with required `id` and `label`, and optional `shortcut` and `section`. |
| `menu_items` | No | Menu metadata objects with required `id`, `label`, and `section`, and optional integer `order` (default `100`). |

`section` is one of `file`, `edit`, `insert`, `view`, or `plugins`. Command and menu IDs may contain lowercase letters, digits, hyphens, and colons. Prefix IDs with the plugin name.

Manifest `commands` and `menu_items` describe metadata; a working command needs a runtime callback registered with `flowmarkPlugin.ui.registerCommand(...)`. A menu item with the same ID as that command invokes it.

The schema rejects unknown top-level properties. Do not copy fields from examples or proposals without checking the schema.

## Permission reference

| Permission | Grants |
| --- | --- |
| `editor.read` | Read active Markdown content and subscribe to content changes. |
| `editor.write` | Replace content, change the selection, or replace selected text in the active Markdown document. |
| `editor.selection` | Read the active Markdown selection and subscribe to selection changes. |
| `editor.commands` | Execute editor commands and register plugin commands. |
| `editor.slashCommands` | Register or remove slash commands. |
| `file.read` | Show file/folder pickers and read the selected file. `file.read(path)` uses `path` as the open dialog's default path; it does not silently read that path. |
| `file.write` | Write content directly to a supplied filesystem path. It does not require the user to choose a save location. |
| `file.save` | Use a native save dialog. Plugins with this permission also participate in FlowMark's normal Markdown before-save transform flow. |
| `file.export` | Export content as HTML. The sandbox host's PDF export is not implemented. |
| `settings.read` | Read this plugin's settings and subscribe to its setting changes. |
| `settings.write` | Register defaults and write this plugin's settings. |
| `ui.menus` | Add or remove plugin menu items. |
| `ui.statusbar` | Set the plugin's status-bar text. |
| `ui.notifications` | Show a FlowMark notification. |
| `ui.panels` | Register or remove a plugin panel in the left or right workspace sidebar. |
| `ui.customViews` | Register, remove, and open this plugin's custom tab views. |
| `clipboard.read` | Read clipboard text or HTML. |
| `clipboard.write` | Write clipboard text or HTML. |
| `clipboard.smartPaste` | Register a transform for pasted text/HTML. |
| `network.request` | Make network requests using GET by default. |
| `network.request:write` | Make non-GET network requests; also declare `network.request`. |

Permissions are enforced by the host for IPC requests. The current installer does **not** show a separate per-permission approval dialog, so a user should treat installing a plugin as trusting its code and declared capabilities. See [Security model](./security.md).

## Minimal manifest example

```json
{
  "name": "outline-panel",
  "version": "1.0.0",
  "manifest_version": 1,
  "description": "A panel example",
  "author": "Example author",
  "entry_point": "index.js",
  "permissions": [
    "ui.panels",
    "editor.read"
  ]
}
```

The manifest version is the schema version, not the plugin's semantic version. Keep `plugin.json` at the selected folder root.

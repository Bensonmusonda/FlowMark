# Sandbox API reference

The API is exposed as `window.flowmarkPlugin` in the primary plugin window by `plugin-preload.js`. Calls that cross into the host generally return promises; handle rejections instead of assuming success.

The panel and custom-view iframes are separate documents and **do not** receive this API.

## Metadata and logging

- `flowmarkPlugin.id` — manifest plugin name.
- `flowmarkPlugin.permissions` — the plugin's declared permission names.
- `flowmarkPlugin.hasPermission(name)` — checks the declared permission set.
- `flowmarkPlugin.log(...args)`, `.warn(...args)`, `.error(...args)` — write to the plugin console and send a prefixed message to the host log.

`flowmarkPlugin.emit(event, data)` currently supports only `event === 'log'`. Prefer the dedicated methods above. `flowmarkPlugin.on('file:beforeSave', callback)` is a supported special case described under [File](#file). Do not assume `on()` is a general FlowMark application event bus.

## Editor

| Method | Permission | Behavior |
| --- | --- | --- |
| `editor.getContent()` | `editor.read` | Resolve with the active Markdown source. |
| `editor.setContent(text)` | `editor.write` | Replace the active Markdown source. |
| `editor.getSelection()` | `editor.selection` | Resolve with `{ from, to, empty, text }`. |
| `editor.setSelection(selection)` | `editor.write` | Set the range using `anchor`/`head` or `from`/`to`. |
| `editor.replaceSelection(text)` | `editor.write` | Replace the current selection and focus the editor. |
| `editor.executeCommand(commandId)` | `editor.commands` | Ask the editor command registry to run a command. |
| `editor.onContentChange(callback)` | `editor.read` | Subscribe to content changes; returns an unsubscribe function. |
| `editor.onSelectionChange(callback)` | `editor.selection` | Subscribe to selection changes; returns an unsubscribe function. |
| `editor.registerSlashCommand(command)` / `removeSlashCommand(id)` | `editor.slashCommands` | Register or remove a command in the slash menu. |

These methods require an active Markdown document. The host rejects them while a custom-view document is active or when no Markdown document is open.

Slash command handlers are local callbacks in the plugin window and run without arguments. Give each command an ID prefixed by the plugin name and a user-facing `label`. Registration accepts additional metadata, but the currently displayed slash menu is based on the registered command's label; do not depend on unimplemented filtering or argument behavior.

## Files

| Method | Permission | Behavior |
| --- | --- | --- |
| `file.read(path)` | `file.read` | Opens a native file picker, using `path` as its default location, then reads the chosen file as UTF-8. Resolves `null` if canceled. |
| `file.pickFile(options)` | `file.read` | Opens a native file picker and resolves with the chosen path or `null`. |
| `file.pickFolder()` | `file.read` | Opens a folder picker and resolves with the chosen path or `null`. |
| `file.write(path, content)` | `file.write` | Writes UTF-8 content directly to the given path. |
| `file.save(content, defaultPath)` | `file.save` | Opens a Markdown save dialog; resolves with `{ filePath }` or `{ canceled: true }`. This plugin-initiated save does not itself run before-save transforms. |
| `file.export(format, content)` | `file.export` | For `html`, resolves with `{ html }`. Other formats resolve with an `{ error }` result; PDF is not implemented by the sandbox host. |

`file:beforeSave` handlers are registered with:

```js
const stop = flowmarkPlugin.on('file:beforeSave', async content => {
  return content;
});
```

Handlers run sequentially for FlowMark's normal Markdown save path. A returned string becomes the content passed to the next handler. A handler that throws or exceeds the host's 1.5-second response window is ignored for that transform. The `file.save` permission opts a plugin into that flow; calling the plugin's own `file.save(...)` method does not trigger it.

## Settings

- `settings.get(key)` and `settings.getAll()` require `settings.read`.
- `settings.set(key, value)` and `settings.register(key, defaultValue, metadata)` require `settings.write`.
- `settings.onChange(callback)` requires `settings.read`, returns an unsubscribe function, and calls the callback with `(key, value)` for this plugin's changes.

Settings are namespaced by plugin ID. `register` stores the default value. Although the preload accepts a `metadata` argument, the sandbox host currently ignores it and does not generate a settings form.

## UI

| Method | Permission | Notes |
| --- | --- | --- |
| `ui.addMenuItem(section, item)` / `removeMenuItem(id)` | `ui.menus` | Sections: `file`, `edit`, `insert`, `view`, `plugins`. Register a command with the same ID for an actionable menu item. |
| `ui.setStatusBar(text, options)` | `ui.statusbar` | Sets status text associated with the plugin. |
| `ui.showNotification(title, body, options)` | `ui.notifications` | Displays a FlowMark notification. |
| `ui.registerCommand(command)` | `editor.commands` | Registers metadata and a local `run` callback invoked when the command is selected. |
| `ui.registerSidebarPanel(panel)` / `removeSidebarPanel(id)` | `ui.panels` | Registers a workspace panel; details are in [Panels and custom tabs](./panels-and-custom-tabs.md). |

The plugin's command callback stays in its own sandboxed window; only command metadata crosses into the main renderer.

## Custom views

- `views.registerCustomView({ id, name, extensions, entry })` and `views.removeCustomView(id)` require `ui.customViews`.
- `views.open(viewId, { name, state })` requires a view registered by the same plugin.

`state` must be JSON-serializable and no larger than 256 KB. See [Panels and custom tabs](./panels-and-custom-tabs.md) for the iframe state protocol and the fact that extension registration does not automatically route normal file opens.

## Clipboard and paste

- `clipboard.readText()` / `readHTML()` require `clipboard.read`.
- `clipboard.writeText(text)` / `writeHTML(html)` require `clipboard.write`.
- `clipboard.registerSmartPaste(handler)` requires `clipboard.smartPaste`.

Smart-paste handlers receive the current `{ text, html }` object. They run sequentially, with a 1.5-second host response window per plugin. Returning a string replaces the text and clears HTML; returning an object merges its fields into the current value. Returning nothing leaves the current value unchanged.

## Network

`network.fetch(url, options)` requires `network.request`. Requests default to GET; any other method also requires `network.request:write`. The host resolves with status, headers, and JSON or text data when the request succeeds; a fetch failure resolves with an `{ error }` result.

The host does not provide a plugin-specific origin allowlist. Only request network access when it is essential, and validate data returned by remote services.

## Not exposed

There is no current sandbox API for application-wide themes, floating overlays over tabs, arbitrary renderer DOM access, or CodeMirror decoration extensions. Do not infer these capabilities from `PLUGIN_IDEAS.md` or from the separate legacy plugin manager.

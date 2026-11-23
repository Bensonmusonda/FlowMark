# Getting started

This guide creates a small plugin that adds an Insert-menu command to replace the current Markdown selection with a greeting.

## 1. Create a plugin folder

Create a folder such as `hello-world` with these files:

```text
hello-world/
  plugin.json
  index.js
```

The folder chosen in FlowMark must itself contain `plugin.json`.

## 2. Add the manifest

Create `plugin.json`:

```json
{
  "name": "hello-world",
  "version": "1.0.0",
  "manifest_version": 1,
  "description": "Adds a greeting command",
  "entry_point": "index.js",
  "permissions": [
    "editor.write",
    "editor.commands",
    "ui.menus"
  ]
}
```

The permission list is intentionally narrow:

- `editor.commands` allows registering and invoking the command.
- `editor.write` allows replacing the active Markdown selection.
- `ui.menus` allows adding a menu item.

See [Manifest and permissions](./manifest-and-permissions.md) for all fields and permissions.

## 3. Add the plugin script

Create `index.js`:

```js
const commandId = 'hello-world:insert-greeting';

async function insertGreeting() {
  try {
    await flowmarkPlugin.editor.replaceSelection('Hello from FlowMark!');
  } catch (error) {
    flowmarkPlugin.error('Could not insert greeting:', error);
  }
}

flowmarkPlugin.ui.registerCommand({
  id: commandId,
  label: 'Insert Greeting',
  section: 'insert',
  run: insertGreeting,
}).catch(error => flowmarkPlugin.error('Command registration failed:', error));

flowmarkPlugin.ui.addMenuItem('insert', {
  id: commandId,
  label: 'Insert Greeting',
  order: 100,
}).catch(error => flowmarkPlugin.error('Menu registration failed:', error));
```

The command handler runs in the plugin's hidden sandboxed window. Its `run` callback receives no arguments. The menu item and command share an ID so the menu action invokes the registered command. Use a plugin-prefixed ID to avoid collisions.

JavaScript entry points are classic scripts: use `flowmarkPlugin` directly, avoid `import`/`export`, and bundle any dependencies into the entry file. HTML entry points are loaded directly and may include their own script tags.

## 4. Install and try it

1. Start FlowMark.
2. Select **Plugins > Install Plugin from Folder...**.
3. Choose the `hello-world` folder.
4. Open a Markdown document, place the cursor or select text, and choose **Insert > Insert Greeting**.

The editor methods reject when no Markdown document is active. A custom-view tab is not a Markdown document.

The install action copies the selected folder to FlowMark's application data. Editing the original source folder does not update the installed copy. An already-installed plugin ID is rejected; the current UI does not provide an update action.

## Next steps

- Read the [API reference](./api-reference.md) before adding capabilities.
- Use [Panels and custom tabs](./panels-and-custom-tabs.md) for UI that belongs in a workspace panel or tab.
- Follow the [security model](./security.md) and request only the permissions your plugin needs.
- Run the repository checks in [Testing and troubleshooting](./testing-and-troubleshooting.md).

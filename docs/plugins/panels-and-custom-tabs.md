# Panels and custom tabs

FlowMark supports two distinct plugin-owned UI surfaces: workspace sidebar panels and custom tab views. Both are loaded in sandboxed iframes, separate from the plugin's primary API window.

## Sidebar panels

Request `ui.panels`, then register a panel from the primary plugin script:

```js
flowmarkPlugin.ui.registerSidebarPanel({
  id: 'outline',
  title: 'Outline',
  icon: 'list-tree',
  location: 'left',
  entry: 'panels/outline.html',
}).catch(error => flowmarkPlugin.error('Panel registration failed:', error));
```

The host contract is:

- `id` is a plugin-owned identifier; use lowercase letters, digits, hyphens, and colons, and prefix it with the plugin name.
- `title` is shown in the panel UI.
- `icon` is an optional supported Lucide icon name. Unknown names fall back to a standard panel icon.
- `location` is `left` or `right`; it defaults to `right`.
- `entry` is an optional path inside the plugin directory. If omitted, FlowMark displays a placeholder. If provided, the file must exist and remain inside the plugin directory.

The user activates a panel by selecting its activity/navigation entry. Registering a panel does not automatically select or open it. `ui.removeSidebarPanel(id)` removes a panel owned by that plugin.

Supported `icon` values are `book-open`, `bot`, `brain`, `calendar-days`, `code-xml`, `file`, `folder-root`, `git-branch`, `layers`, `list-tree`, `message-square`, `network`, `panel-left`, `panel-right`, `puzzle`, `search`, `settings`, and `tags`.

### Panel iframe limits

Panel HTML is loaded with scripts enabled in a sandboxed iframe. It has no Node integration, no `flowmarkPlugin` bridge, no access to the parent app DOM, and currently no host message bridge. It can render its own content, but its controls cannot call the plugin API or mutate the editor through a supported panel-to-plugin channel. Keep panel code self-contained; do not assume `window.parent` is a FlowMark API.

Panel styles belong inside the panel document and should not rely on or modify FlowMark's application CSS. Use ordinary HTML/CSS and keep the interface usable at the sidebar's available width.

## Custom tab views

Request `ui.customViews` and register a view:

```js
const viewId = 'diagram-board';

flowmarkPlugin.views.registerCustomView({
  id: viewId,
  name: 'Diagram Board',
  extensions: ['board'],
  entry: 'views/board.html',
}).catch(error => flowmarkPlugin.error('View registration failed:', error));
```

Registration makes the view available to the plugin; the `extensions` list is metadata and **does not automatically take over normal file opening**. To create a custom-view tab, explicitly call `flowmarkPlugin.views.open(viewId, { name, state })`, typically from a user-triggered command:

```js
async function openBoard() {
  try {
    await flowmarkPlugin.views.open(viewId, {
      name: 'Project Board',
      state: { cards: [] },
    });
  } catch (error) {
    flowmarkPlugin.error('Could not open board:', error);
  }
}
```

The view's `entry` must exist inside the plugin directory. The tab is a FlowMark document with its own view type and JSON state; it does not replace or reinterpret a Markdown document.

### Custom-view state protocol

The custom-view iframe does not receive `flowmarkPlugin`. On load, FlowMark posts this message to the iframe:

```js
{
  type: 'flowmark:custom-view:init',
  viewId,
  state
}
```

The iframe can send updated JSON state back to FlowMark:

```js
const viewId = 'diagram-board';

window.addEventListener('message', event => {
  if (event.source !== window.parent) return;
  if (event.data?.type !== 'flowmark:custom-view:init') return;
  if (event.data.viewId !== viewId) return;

  renderBoard(event.data.state);
});

function saveBoardState(state) {
  window.parent.postMessage({
    type: 'flowmark:custom-view:state',
    viewId,
    state,
  }, '*');
}
```

FlowMark accepts state updates only from the active custom-view iframe and only for its active view ID. State must be JSON-serializable and no more than 256 KB; valid state is included in session persistence. Treat messages as data, not executable code. The current protocol is for initialization and state persistence only; it does not provide editor read/write methods, tab-overlay UI, or a plugin-to-view RPC channel.

## Lifecycle and ownership

- A plugin's primary window runs its entry script and owns registered callbacks.
- Panel and view frames are separate and do not inherit that window's API.
- Disabling a plugin removes its registered panels, commands, slash commands, and custom-view registrations. Existing tabs for a disabled plugin can show an unavailable-view placeholder.
- Custom-view tabs keep their own per-document view state. Switching to a custom view does not make editor APIs available for that tab.

For permissions and threat boundaries, see [Security model](./security.md).

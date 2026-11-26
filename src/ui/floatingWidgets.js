import {
  createElement,
  Table,
  AlertCircle,
  Code,
  CodeXml,
  Sigma,
  CheckSquare,
  Link,
  Image,
  Quote,
  Heading1,
  Heading2,
  Heading3,
  Minus,
  ChevronLeft,
  ChevronRight,
  X,
  GripVertical,
  Sparkles,
} from 'lucide';
import { resolvePluginPanelIcon } from './pluginPanelIcons.js';

const TOOLBAR_ICONS = {
  table: Table,
  callout: AlertCircle,
  alert: AlertCircle,
  'alert-circle': AlertCircle,
  code: Code,
  'code-xml': CodeXml,
  math: Sigma,
  sigma: Sigma,
  task: CheckSquare,
  'check-square': CheckSquare,
  link: Link,
  image: Image,
  quote: Quote,
  heading: Heading1,
  h1: Heading1,
  h2: Heading2,
  h3: Heading3,
  hr: Minus,
  minus: Minus,
  sparkles: Sparkles,
  chevronleft: ChevronLeft,
  chevronright: ChevronRight,
  'chevron-left': ChevronLeft,
  'chevron-right': ChevronRight,
  close: X,
  grip: GripVertical,
};

function createIconEl(iconDef, size = 16) {
  let iconComponent = typeof iconDef === 'string' ? TOOLBAR_ICONS[iconDef.toLowerCase()] : null;
  if (!iconComponent && typeof iconDef === 'string') {
    iconComponent = resolvePluginPanelIcon(iconDef, Sparkles);
  }
  if (!iconComponent) iconComponent = Sparkles;

  return createElement(iconComponent, {
    width: size,
    height: size,
    'aria-hidden': 'true',
    focusable: 'false',
    class: 'fm-floating-icon',
  });
}

export class FloatingWidgetManager {
  /**
   * @param {Object} options
   * @param {HTMLElement} options.container - The #floating-widget-layer element
   * @param {Object} [options.commandRegistry] - FlowMark CommandRegistry
   * @param {Function} [options.onAction] - Action callback for plugin event dispatch
   */
  constructor({ container, commandRegistry, onAction }) {
    this.container = container;
    this.commandRegistry = commandRegistry;
    this.onAction = onAction;
    this.widgets = new Map(); // id -> { element, config, unregisterCommand }
  }

  /**
   * Register a vertical floating toolbar strip.
   * @param {Object} toolbar
   * @param {string} toolbar.id
   * @param {string} [toolbar.title]
   * @param {string} [toolbar.position='right'] - 'right' | 'left' | 'float'
   * @param {boolean} [toolbar.collapsible=true]
   * @param {Array<Object>} toolbar.items - Array of tool buttons
   * @param {string} [toolbar.pluginId]
   */
  registerToolbar(toolbar) {
    if (!toolbar?.id) return false;
    this.removeWidget(toolbar.id);

    const position = toolbar.position || 'right';
    const collapsible = toolbar.collapsible !== false;

    const widgetEl = document.createElement('div');
    widgetEl.className = `fm-floating-widget dock-${position} fm-floating-toolbar`;
    widgetEl.dataset.widgetId = toolbar.id;
    if (toolbar.pluginId) widgetEl.dataset.pluginId = toolbar.pluginId;

    // Toggle collapse handle
    let toggleBtn = null;
    if (collapsible) {
      toggleBtn = document.createElement('button');
      toggleBtn.type = 'button';
      toggleBtn.className = 'fm-floating-toggle-btn';
      toggleBtn.title = 'Collapse / Expand toolbar';
      toggleBtn.setAttribute('aria-label', 'Collapse / Expand toolbar');

      const chevronIcon = position === 'left'
        ? createIconEl('chevronLeft', 14)
        : createIconEl('chevronRight', 14);
      toggleBtn.appendChild(chevronIcon);

      toggleBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.toggleCollapse(toolbar.id);
      });
      widgetEl.appendChild(toggleBtn);
    }

    // Content container
    const content = document.createElement('div');
    content.className = 'fm-floating-content';

    // Header with dismiss button
    const header = document.createElement('div');
    header.className = 'fm-floating-header';

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'fm-floating-close-btn';
    closeBtn.title = 'Hide toolbar (Reopen via View / Command menu)';
    closeBtn.setAttribute('aria-label', 'Hide toolbar');
    closeBtn.appendChild(createIconEl('close', 12));
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggleWidget(toolbar.id, false);
    });
    header.appendChild(closeBtn);
    content.appendChild(header);

    // Items list
    const items = Array.isArray(toolbar.items) ? toolbar.items : [];
    items.forEach((item) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'fm-floating-tool-btn';
      if (item.tooltip) {
        btn.dataset.tooltip = item.tooltip;
        btn.setAttribute('aria-label', item.tooltip);
      }
      if (item.id) btn.dataset.itemId = item.id;

      // Icon
      if (typeof item.icon === 'string' && (item.icon.startsWith('<svg') || item.icon.length <= 3)) {
        const span = document.createElement('span');
        span.innerHTML = item.icon;
        btn.appendChild(span);
      } else {
        btn.appendChild(createIconEl(item.icon || 'sparkles', 16));
      }

      // Click handler
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (item.command && this.commandRegistry) {
          this.commandRegistry.execute(item.command);
        } else if (typeof item.action === 'function') {
          item.action();
        } else if (toolbar.pluginId) {
          this.onAction?.('plugin:floatingToolbarAction', {
            pluginId: toolbar.pluginId,
            toolbarId: toolbar.id,
            itemId: item.id,
          });
        }
      });

      content.appendChild(btn);
    });

    widgetEl.appendChild(content);
    this.container.appendChild(widgetEl);

    // Register toggle command in CommandRegistry
    const commandId = `view:toggleWidget:${toolbar.id}`;
    if (this.commandRegistry?.registerCommand) {
      try {
        this.commandRegistry.registerCommand(commandId, {
          label: `Toggle ${toolbar.title || 'Floating Toolbar'}`,
          section: 'view',
          run: () => this.toggleWidget(toolbar.id),
          enabled: () => true,
        });
      } catch (err) {
        console.warn('Failed to register floating widget command:', err);
      }
    }

    this.widgets.set(toolbar.id, {
      element: widgetEl,
      config: toolbar,
      commandId,
      collapsed: false,
      visible: true,
    });

    return true;
  }

  /**
   * Register a custom iframe floating widget.
   * @param {Object} widget
   */
  registerWidget(widget) {
    if (!widget?.id) return false;
    this.removeWidget(widget.id);

    const position = widget.position || 'right';
    const collapsible = widget.collapsible !== false;

    const widgetEl = document.createElement('div');
    widgetEl.className = `fm-floating-widget dock-${position} fm-floating-pane`;
    widgetEl.dataset.widgetId = widget.id;
    if (widget.pluginId) widgetEl.dataset.pluginId = widget.pluginId;

    if (widget.width) widgetEl.style.width = `${widget.width}px`;
    if (widget.height) widgetEl.style.height = `${widget.height}px`;

    // Toggle collapse handle
    if (collapsible) {
      const toggleBtn = document.createElement('button');
      toggleBtn.type = 'button';
      toggleBtn.className = 'fm-floating-toggle-btn';
      toggleBtn.title = 'Collapse / Expand';
      toggleBtn.appendChild(
        position === 'left' ? createIconEl('chevronLeft', 14) : createIconEl('chevronRight', 14)
      );
      toggleBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.toggleCollapse(widget.id);
      });
      widgetEl.appendChild(toggleBtn);
    }

    // Content container with iframe
    const content = document.createElement('div');
    content.className = 'fm-floating-content';

    const header = document.createElement('div');
    header.className = 'fm-floating-header';

    const titleSpan = document.createElement('span');
    titleSpan.className = 'fm-floating-title';
    titleSpan.textContent = widget.title || 'Widget';
    header.appendChild(titleSpan);

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'fm-floating-close-btn';
    closeBtn.title = 'Close';
    closeBtn.appendChild(createIconEl('close', 12));
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggleWidget(widget.id, false);
    });
    header.appendChild(closeBtn);
    content.appendChild(header);

    if (widget.entryUrl) {
      const frame = document.createElement('iframe');
      frame.className = 'fm-floating-frame';
      frame.title = widget.title || 'Floating widget';
      frame.sandbox = 'allow-scripts';
      frame.src = widget.entryUrl;
      content.appendChild(frame);
    }

    widgetEl.appendChild(content);
    this.container.appendChild(widgetEl);

    const commandId = `view:toggleWidget:${widget.id}`;
    if (this.commandRegistry?.registerCommand) {
      try {
        this.commandRegistry.registerCommand(commandId, {
          label: `Toggle ${widget.title || 'Floating Widget'}`,
          section: 'view',
          run: () => this.toggleWidget(widget.id),
          enabled: () => true,
        });
      } catch (err) {
        console.warn('Failed to register floating widget command:', err);
      }
    }

    this.widgets.set(widget.id, {
      element: widgetEl,
      config: widget,
      commandId,
      collapsed: false,
      visible: true,
    });

    return true;
  }

  /**
   * Remove a widget and clean up DOM and commands.
   * @param {string} id
   */
  removeWidget(id) {
    const record = this.widgets.get(id);
    if (!record) return false;

    if (record.commandId && this.commandRegistry?.unregisterCommand) {
      try {
        this.commandRegistry.unregisterCommand(record.commandId);
      } catch (_) {}
    }

    record.element.remove();
    this.widgets.delete(id);
    return true;
  }

  /**
   * Toggle visibility of a widget.
   * @param {string} id
   * @param {boolean} [force]
   */
  toggleWidget(id, force) {
    const record = this.widgets.get(id);
    if (!record) return false;

    const nextVisible = typeof force === 'boolean' ? force : !record.visible;
    record.visible = nextVisible;
    record.element.classList.toggle('hidden', !nextVisible);
    return nextVisible;
  }

  /**
   * Toggle collapsed state of a widget.
   * @param {string} id
   * @param {boolean} [force]
   */
  toggleCollapse(id, force) {
    const record = this.widgets.get(id);
    if (!record) return false;

    const nextCollapsed = typeof force === 'boolean' ? force : !record.collapsed;
    record.collapsed = nextCollapsed;
    record.element.classList.toggle('collapsed', nextCollapsed);
    return nextCollapsed;
  }

  /**
   * Get a registered widget by ID.
   * @param {string} id
   */
  getWidget(id) {
    return this.widgets.get(id) || null;
  }

  /**
   * Clear all widgets.
   */
  clear() {
    for (const id of Array.from(this.widgets.keys())) {
      this.removeWidget(id);
    }
  }
}

export default FloatingWidgetManager;

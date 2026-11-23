const REQUEST_PERMISSIONS = Object.freeze({
  'editor:getContent': 'editor.read',
  'editor:setContent': 'editor.write',
  'editor:getSelection': 'editor.selection',
  'editor:setSelection': 'editor.write',
  'editor:replaceSelection': 'editor.write',
  'editor:executeCommand': 'editor.commands',
  'file:read': 'file.read',
  'file:write': 'file.write',
  'file:save': 'file.save',
  'file:export': 'file.export',
  'file:pickFile': 'file.read',
  'file:pickFolder': 'file.read',
  'settings:get': 'settings.read',
  'settings:register': 'settings.write',
  'settings:set': 'settings.write',
  'settings:getAll': 'settings.read',
  'ui:addMenuItem': 'ui.menus',
  'ui:removeMenuItem': 'ui.menus',
  'ui:setStatusBar': 'ui.statusbar',
  'ui:showNotification': 'ui.notifications',
  'ui:registerCommand': 'editor.commands',
  'clipboard:readText': 'clipboard.read',
  'clipboard:writeText': 'clipboard.write',
  'clipboard:readHTML': 'clipboard.read',
  'clipboard:writeHTML': 'clipboard.write',
  'ui:registerSidebarPanel': 'ui.panels',
  'ui:removeSidebarPanel': 'ui.panels',
  'ui:registerCustomView': 'ui.customViews',
  'ui:removeCustomView': 'ui.customViews',
  'ui:openCustomView': 'ui.customViews',
  'editor:registerSlashCommand': 'editor.slashCommands',
  'editor:removeSlashCommand': 'editor.slashCommands',
  'clipboard:registerSmartPaste': 'clipboard.smartPaste',
  'network:fetch': 'network.request',
  'editor:registerMarkdownTransform': 'markdown.transform',
  'plugins:broadcast': 'plugins.communicate',
  'plugins:on': 'plugins.communicate',
  'workspace:onFileOpen': 'file.read',
  'workspace:onFileSave': 'file.write',
});

const EVENT_PERMISSIONS = Object.freeze({
  log: null,
});

function findPluginForSender(plugins, sender) {
  if (!sender) return null;
  for (const plugin of plugins.values()) {
    const window = plugin.window;
    if (!window || (typeof window.isDestroyed === 'function' && window.isDestroyed())) continue;
    if (window.webContents === sender && (plugin.state === 'loading' || plugin.state === 'ready')) {
      return plugin;
    }
  }
  return null;
}

function authorizeMessage(plugins, sender, channel, permissionsByChannel) {
  const plugin = findPluginForSender(plugins, sender);
  if (!plugin) {
    return { allowed: false, error: 'Request is not from an active plugin window' };
  }

  if (typeof channel !== 'string' || !Object.hasOwn(permissionsByChannel, channel)) {
    return { allowed: false, plugin, error: `Unsupported plugin channel: ${String(channel)}` };
  }

  const required = permissionsByChannel[channel];
  const allowed = required === null || (
    Array.isArray(required)
      ? required.some(permission => plugin.permissions.has(permission))
      : plugin.permissions.has(required)
  );
  if (!allowed) {
    const permissionLabel = Array.isArray(required) ? required.join(' or ') : required;
    return { allowed: false, plugin, error: `Missing permission: ${permissionLabel}` };
  }
  return { allowed: true, plugin };
}

function authorizePluginRequest(plugins, sender, channel) {
  return authorizeMessage(plugins, sender, channel, REQUEST_PERMISSIONS);
}

function authorizePluginEvent(plugins, sender, channel) {
  return authorizeMessage(plugins, sender, channel, EVENT_PERMISSIONS);
}

module.exports = {
  authorizePluginEvent,
  authorizePluginRequest,
  findPluginForSender,
};

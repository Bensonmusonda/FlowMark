const { z } = require("zod");

const PERMISSIONS_ENUM = [
  'editor.read', 'editor.write', 'editor.selection', 'editor.commands',
  'file.read', 'file.write', 'file.save', 'file.export',
  'settings.read', 'settings.write',
  'ui.menus', 'ui.statusbar', 'ui.notifications',
  'clipboard.read', 'clipboard.write',
  'ui.panels', 'ui.customViews',
  'editor.slashCommands',
  'clipboard.smartPaste',
  'network.request', 'network.request:write',
  'plugins.communicate',
  'markdown.transform'
];

const ManifestSchema = z.object({
  name: z.string().min(1).regex(/^[a-z0-9-]+$/),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  manifest_version: z.literal(1),
  description: z.string().optional(),
  author: z.string().optional(),
  entry_point: z.string().min(1),
  permissions: z.array(z.enum(PERMISSIONS_ENUM)).default([]),
  commands: z.array(z.object({
    id: z.string().regex(/^[a-z0-9-:]+$/),
    label: z.string().min(1).max(200),
    shortcut: z.string().optional(),
    icon: z.string().optional(),
  })).default([]),
  menu_items: z.array(z.object({
    id: z.string().regex(/^[a-z0-9-:]+$/),
    label: z.string().min(1).max(200),
    section: z.enum(["file", "edit", "insert", "view", "plugins"]),
    shortcut: z.string().optional(),
    icon: z.string().optional(),
    order: z.number().int().default(100),
  })).default([]),
  stylesheet: z.string().optional(),
  settings: z.record(z.object({
    type: z.enum(["string", "number", "boolean", "select", "color", "path"]).default("string"),
    label: z.string().optional(),
    description: z.string().optional(),
    default: z.any().optional(),
    options: z.array(z.string()).optional(),
  })).default({}),
});

/**
 * Validate plugin manifest against schema
 */
function validatePluginManifest(manifest) {
  const result = ManifestSchema.safeParse(manifest);
  if (!result.success) {
    const errors = result.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid manifest: ${errors}`);
  }
  return result.data;
}

function validateManifest(manifest) {
  const result = ManifestSchema.safeParse(manifest);
  if (!result.success) {
    const errors = result.error.issues.map(i => `${i.path.join(".")}: ${i.message}`);
    return { ok: false, errors };
  }
  return { ok: true, data: result.data };
}

module.exports = { validatePluginManifest, validateManifest, ManifestSchema, PERMISSIONS_ENUM };

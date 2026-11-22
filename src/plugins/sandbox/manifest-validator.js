const Ajv = require('ajv');
const fs = require('fs');
const path = require('path');

const ajv = new Ajv({ allErrors: true, strict: false });
const schemaPath = path.join(__dirname, 'manifest-schema.json');
const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
const validate = ajv.compile(schema);

/**
 * Validate plugin manifest against schema
 */
function validatePluginManifest(manifest) {
  const valid = validate(manifest);
  if (!valid) {
    const errors = validate.errors.map(e =>
      `${e.instancePath || '/'} ${e.message}`
    ).join('; ');
    throw new Error(`Invalid manifest: ${errors}`);
  }
  return manifest;
}

module.exports = { validatePluginManifest, validate };
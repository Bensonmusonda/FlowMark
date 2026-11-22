/**
 * Lightweight YAML subset parser and serializer for FlowMark frontmatter.
 * Supports:
 *  - key: value (primitives: strings, numbers, booleans, dates)
 *  - Quoted strings ("...", '...')
 *  - Inline arrays: [a, b, c]
 *  - Block lists: - a \n - b
 *  - Shallow nested objects: key: \n   sub: val
 *  - Comments (# ...) and blank lines
 *  - Round-trip serialization
 */

/**
 * Parse a raw scalar string into typed JS value.
 * @param {string} raw
 * @returns {any}
 */
export function parseScalar(raw) {
  if (raw === undefined || raw === null) return '';
  const trimmed = raw.trim();
  if (trimmed === '' || trimmed === '~' || trimmed === 'null') return '';

  // Boolean
  if (/^(true|True|TRUE|yes|Yes|YES)$/.test(trimmed)) return true;
  if (/^(false|False|FALSE|no|No|NO)$/.test(trimmed)) return false;

  // Number
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
    const num = Number(trimmed);
    if (!Number.isNaN(num)) return num;
  }

  // Quoted string: double quotes
  if (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2) {
    try {
      return JSON.parse(trimmed);
    } catch (_) {
      return trimmed.slice(1, -1).replace(/\\"/g, '"');
    }
  }

  // Quoted string: single quotes
  if (trimmed.startsWith("'") && trimmed.endsWith("'") && trimmed.length >= 2) {
    return trimmed.slice(1, -1).replace(/''/g, "'");
  }

  // Inline array: [a, b, c]
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    return parseInlineArray(trimmed);
  }

  return trimmed;
}

/**
 * Parse an inline array [item1, "item 2", item3].
 * @param {string} text
 * @returns {Array<any>}
 */
export function parseInlineArray(text) {
  const content = text.slice(1, -1).trim();
  if (!content) return [];

  const items = [];
  let current = '';
  let inDouble = false;
  let inSingle = false;

  for (let i = 0; i < content.length; i++) {
    const ch = content[i];
    if (ch === '"' && !inSingle && content[i - 1] !== '\\') {
      inDouble = !inDouble;
      current += ch;
    } else if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
      current += ch;
    } else if (ch === ',' && !inDouble && !inSingle) {
      items.push(parseScalar(current));
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.trim() || items.length > 0) {
    items.push(parseScalar(current));
  }
  return items;
}

/**
 * Determine property value type.
 * @param {string} key
 * @param {any} value
 * @returns {'tags'|'list'|'boolean'|'number'|'date'|'object'|'text'}
 */
export function inferType(key, value) {
  const lowerKey = String(key).toLowerCase();
  if (Array.isArray(value)) {
    if (lowerKey === 'tags' || lowerKey === 'tag') return 'tags';
    return 'list';
  }
  if (typeof value === 'boolean') return 'boolean';
  if (typeof value === 'number') return 'number';
  if (value && typeof value === 'object') return 'object';
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return 'date';
  if (lowerKey === 'tags' || lowerKey === 'tag') return 'tags';
  return 'text';
}

/**
 * Parse YAML frontmatter text into a structured result.
 * @param {string} yamlText
 * @returns {{ data: Record<string, any>, entries: Array<{ key: string, value: any, type: string }> }}
 */
export function parseFrontmatter(yamlText) {
  const data = {};
  const entries = [];
  if (!yamlText || typeof yamlText !== 'string') {
    return { data, entries };
  }

  const lines = yamlText.split(/\r?\n/);
  let currentKey = null;
  let currentArray = null;
  let currentObject = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Ignore comments and blank lines if not inside a structure
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    // Check for block list item: `  - item` or `- item`
    const listMatch = line.match(/^(\s*)-\s+(.*)$/);
    if (listMatch && currentKey) {
      const itemVal = parseScalar(listMatch[2]);
      if (!currentArray) {
        currentArray = [];
        data[currentKey] = currentArray;
        const existingEntry = entries.find(e => e.key === currentKey);
        if (existingEntry) {
          existingEntry.value = currentArray;
          existingEntry.type = inferType(currentKey, currentArray);
        }
      }
      currentArray.push(itemVal);
      continue;
    }

    // Check for nested object key-value: indented `  key: value`
    const nestedMatch = line.match(/^\s{2,}([a-zA-Z0-9_-]+)\s*:\s*(.*)$/);
    if (nestedMatch && currentKey && !currentArray) {
      const subKey = nestedMatch[1];
      const subVal = parseScalar(nestedMatch[2]);
      if (!currentObject) {
        currentObject = {};
        data[currentKey] = currentObject;
        const existingEntry = entries.find(e => e.key === currentKey);
        if (existingEntry) {
          existingEntry.value = currentObject;
          existingEntry.type = 'object';
        }
      }
      currentObject[subKey] = subVal;
      continue;
    }

    // Top-level key: value
    const kvMatch = line.match(/^([a-zA-Z0-9_-]+)\s*:\s*(.*)$/);
    if (kvMatch) {
      currentKey = kvMatch[1];
      const rawVal = kvMatch[2].trim();
      currentArray = null;
      currentObject = null;

      if (rawVal === '') {
        // Value might be on following lines (block list or nested object)
        data[currentKey] = '';
        entries.push({
          key: currentKey,
          value: '',
          type: inferType(currentKey, ''),
        });
      } else {
        const parsedVal = parseScalar(rawVal);
        data[currentKey] = parsedVal;
        entries.push({
          key: currentKey,
          value: parsedVal,
          type: inferType(currentKey, parsedVal),
        });
      }
    }
  }

  return { data, entries };
}

/**
 * Format a scalar value for YAML output.
 * @param {any} val
 * @returns {string}
 */
function formatScalar(val) {
  if (val === undefined || val === null || val === '') return '';
  if (typeof val === 'boolean' || typeof val === 'number') return String(val);
  const str = String(val);
  // Check if quoting is needed
  if (
    str.includes(': ') ||
    str.includes('#') ||
    str.startsWith('[') ||
    str.startsWith('{') ||
    str.startsWith('- ') ||
    str.startsWith('"') ||
    str.startsWith("'") ||
    /^(true|false|null|yes|no)$/i.test(str) ||
    /^-?\d+(\.\d+)?$/.test(str)
  ) {
    return JSON.stringify(str);
  }
  return str;
}

/**
 * Convert frontmatter entries or object back to YAML frontmatter string.
 * @param {Array<{ key: string, value: any, type?: string }>|Record<string, any>} entriesOrData
 * @param {boolean} [wrapFences=true] - Whether to include --- fences
 * @returns {string}
 */
export function stringifyFrontmatter(entriesOrData, wrapFences = true) {
  let list = [];
  if (Array.isArray(entriesOrData)) {
    list = entriesOrData;
  } else if (entriesOrData && typeof entriesOrData === 'object') {
    list = Object.entries(entriesOrData).map(([key, value]) => ({
      key,
      value,
      type: inferType(key, value),
    }));
  }

  const lines = [];
  if (wrapFences) lines.push('---');

  for (const item of list) {
    const key = item.key;
    const value = item.value;

    if (Array.isArray(value)) {
      if (value.length === 0) {
        lines.push(`${key}: []`);
      } else {
        lines.push(`${key}:`);
        for (const el of value) {
          lines.push(`  - ${formatScalar(el)}`);
        }
      }
    } else if (value && typeof value === 'object') {
      const subKeys = Object.keys(value);
      if (subKeys.length === 0) {
        lines.push(`${key}: {}`);
      } else {
        lines.push(`${key}:`);
        for (const subKey of subKeys) {
          lines.push(`  ${subKey}: ${formatScalar(value[subKey])}`);
        }
      }
    } else {
      const formatted = formatScalar(value);
      lines.push(`${key}:${formatted ? ' ' + formatted : ''}`);
    }
  }

  if (wrapFences) lines.push('---');
  return lines.join('\n');
}

/**
 * Extract frontmatter block from start of document.
 * Frontmatter MUST start at index 0 on line 1 with `---`.
 * @param {string} fullText
 * @returns {{
 *   hasFrontmatter: boolean,
 *   from: number,
 *   to: number,
 *   yaml: string,
 *   data: Record<string, any>,
 *   entries: Array<{ key: string, value: any, type: string }>,
 *   lineCount: number
 * }|{ hasFrontmatter: false }}
 */
export function extractFrontmatter(fullText) {
  if (!fullText || typeof fullText !== 'string') {
    return { hasFrontmatter: false };
  }

  // Must start at position 0 with `---`
  if (!fullText.startsWith('---')) {
    return { hasFrontmatter: false };
  }

  // Ensure first line is strictly `---`
  const firstNewline = fullText.indexOf('\n');
  if (firstNewline === -1) {
    return { hasFrontmatter: false };
  }
  const firstLine = fullText.slice(0, firstNewline).trim();
  if (firstLine !== '---') {
    return { hasFrontmatter: false };
  }

  // Find closing `---` or `...` line
  const lines = fullText.split(/\r?\n/);
  let closeLineIdx = -1;
  let charOffset = 0;

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === '---' || line.trim() === '...') {
      closeLineIdx = i;
      break;
    }
  }

  if (closeLineIdx === -1) {
    return { hasFrontmatter: false };
  }

  const yamlLines = lines.slice(1, closeLineIdx);
  const yamlText = yamlLines.join('\n');
  const { data, entries } = parseFrontmatter(yamlText);

  // Compute character span [from, to] including trailing newline of closing delimiter
  let toOffset = 0;
  for (let i = 0; i <= closeLineIdx; i++) {
    toOffset += lines[i].length + (i < lines.length - 1 ? 1 : 0);
  }

  return {
    hasFrontmatter: true,
    from: 0,
    to: toOffset,
    yaml: yamlText,
    data,
    entries,
    lineCount: closeLineIdx + 1,
  };
}

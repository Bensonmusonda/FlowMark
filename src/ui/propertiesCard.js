/**
 * Properties Card UI for FlowMark (Phase 4).
 * Renders document frontmatter as an interactive, editable metadata card.
 */

import { WidgetType } from '@codemirror/view';
import { stringifyFrontmatter, inferType, parseScalar } from '../parser/frontmatter.js';

// SVG Icons for property types and actions
export const ICONS = {
  tag: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>',
  text: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="4" y1="7" x2="20" y2="7"/><line x1="12" y1="7" x2="12" y2="17"/></svg>',
  number: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="4" y1="9" x2="20" y2="9"/><line x1="4" y1="15" x2="20" y2="15"/><line x1="10" y1="3" x2="8" y2="21"/><line x1="16" y1="3" x2="14" y2="21"/></svg>',
  boolean: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><path d="m9 12 2 2 4-4"/></svg>',
  date: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>',
  list: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>',
  object: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg>',
  chevron: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>',
  plus: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>',
  raw: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>',
  trash: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>',
  check: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>',
};

export const PROPERTY_TYPES = [
  { id: 'text', label: 'Text', icon: ICONS.text },
  { id: 'number', label: 'Number', icon: ICONS.number },
  { id: 'boolean', label: 'Checkbox', icon: ICONS.boolean },
  { id: 'date', label: 'Date', icon: ICONS.date },
  { id: 'tags', label: 'Tags', icon: ICONS.tag },
  { id: 'list', label: 'List', icon: ICONS.list },
];

/**
 * Scan all tags across the document text to feed autocomplete.
 * @param {string} docText
 * @returns {string[]}
 */
export function collectDocumentTags(docText) {
  const tags = new Set();
  if (!docText) return [];

  // Match tags in frontmatter or in markdown `#tag`
  const hashTagRegex = /(?:^|\s)#([a-zA-Z0-9_\-\/]+)/g;
  let match;
  while ((match = hashTagRegex.exec(docText)) !== null) {
    if (!/^\d+$/.test(match[1])) {
      tags.add(match[1]);
    }
  }
  return Array.from(tags).sort();
}

/**
 * PropertiesCardWidget renders the frontmatter block as a CM6 Widget.
 */
export class PropertiesCardWidget extends WidgetType {
  /**
   * @param {Object} spec
   * @param {number} spec.from
   * @param {number} spec.to
   * @param {string} spec.yaml
   * @param {Array<{ key: string, value: any, type: string }>} spec.entries
   * @param {Record<string, any>} spec.data
   * @param {number} spec.lineCount
   * @param {Function} [spec.onViewSource]
   */
  constructor(spec) {
    super();
    this.spec = spec;
    this._root = null;
    this._resizeObserver = null;
  }

  eq(other) {
    return (
      other instanceof PropertiesCardWidget &&
      this.spec.from === other.spec.from &&
      this.spec.to === other.spec.to &&
      this.spec.yaml === other.spec.yaml
    );
  }

  toDOM(view) {
    const root = document.createElement('div');
    root.className = 'cm-embed-block cm-properties-card-wrap';
    root.tabIndex = -1;
    this._root = root;

    const card = document.createElement('div');
    card.className = 'fm-properties-card';

    // Header bar
    const header = document.createElement('div');
    header.className = 'fm-prop-header';

    const foldBtn = document.createElement('button');
    foldBtn.className = 'fm-prop-fold-btn';
    foldBtn.innerHTML = ICONS.chevron;
    foldBtn.title = 'Toggle properties';

    const titleLabel = document.createElement('span');
    titleLabel.className = 'fm-prop-title';
    titleLabel.textContent = 'Properties';

    const countBadge = document.createElement('span');
    countBadge.className = 'fm-prop-count';
    countBadge.textContent = String(this.spec.entries.length);

    const headerLeft = document.createElement('div');
    headerLeft.className = 'fm-prop-header-left';
    headerLeft.appendChild(foldBtn);
    headerLeft.appendChild(titleLabel);
    headerLeft.appendChild(countBadge);

    const headerActions = document.createElement('div');
    headerActions.className = 'fm-prop-header-actions';

    const addBtn = document.createElement('button');
    addBtn.className = 'fm-prop-btn fm-prop-add-btn';
    addBtn.innerHTML = `${ICONS.plus}<span>Add property</span>`;
    addBtn.title = 'Add property';

    const rawBtn = document.createElement('button');
    rawBtn.className = 'fm-prop-btn fm-prop-raw-btn';
    rawBtn.innerHTML = ICONS.raw;
    rawBtn.title = 'View source (raw YAML)';

    headerActions.appendChild(addBtn);
    headerActions.appendChild(rawBtn);

    header.appendChild(headerLeft);
    header.appendChild(headerActions);
    card.appendChild(header);

    // Body container for property rows
    const body = document.createElement('div');
    body.className = 'fm-prop-body';

    // Fold toggle
    foldBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      card.classList.toggle('collapsed');
      if (typeof view.requestMeasure === 'function') view.requestMeasure();
    });

    const triggerViewSource = () => {
      if (typeof this.spec.onViewSource === 'function') {
        this.spec.onViewSource();
      } else {
        view.dispatch({
          selection: { anchor: Math.min(view.state.doc.length, this.spec.from + 4) },
          scrollIntoView: true,
        });
        view.focus();
      }
    };

    // Switch to raw YAML on raw button click
    rawBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      triggerViewSource();
    });

    // Right-click context menu on properties card: View source, Add property, Fold
    card.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this._showContextMenu(e.clientX, e.clientY, [
        {
          label: 'View source',
          icon: ICONS.raw,
          action: () => triggerViewSource(),
        },
        {
          label: 'Add property',
          icon: ICONS.plus,
          action: () => addBtn.click(),
        },
        {
          label: card.classList.contains('collapsed') ? 'Unfold properties' : 'Fold properties',
          icon: ICONS.chevron,
          action: () => foldBtn.click(),
        },
      ]);
    });

    // Helper to commit updated entries back into the document state
    const commitEntries = (newEntries) => {
      const newYaml = stringifyFrontmatter(newEntries, true);
      const fullDoc = view.state.doc.toString();
      const insertText = (this.spec.to < fullDoc.length && !fullDoc.slice(this.spec.to).startsWith('\n'))
        ? newYaml + '\n'
        : newYaml;

      view.dispatch({
        changes: { from: this.spec.from, to: this.spec.to, insert: insertText },
        userEvent: 'input.frontmatter',
      });
    };

    // Render each property row
    const entries = this.spec.entries.map(e => ({ ...e }));
    const docTags = collectDocumentTags(view.state.doc.toString());

    entries.forEach((entry, index) => {
      const row = this._createPropertyRow(view, entry, index, entries, commitEntries, docTags);
      body.appendChild(row);
    });

    card.appendChild(body);
    root.appendChild(card);

    // "Add property" click handler
    addBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      let keyName = 'property';
      let k = 1;
      while (entries.some(ent => ent.key === keyName)) {
        keyName = `property_${k++}`;
      }
      entries.push({
        key: keyName,
        value: '',
        type: 'text',
      });
      commitEntries(entries);
    });

    if (typeof ResizeObserver !== 'undefined') {
      this._resizeObserver = new ResizeObserver(() => {
        if (typeof view.requestMeasure === 'function') view.requestMeasure();
      });
      this._resizeObserver.observe(root);
    }

    return root;
  }

  /**
   * Display a floating context menu at (x, y).
   */
  _showContextMenu(x, y, items) {
    const existing = document.querySelector('.fm-prop-context-menu');
    if (existing) existing.remove();

    const menu = document.createElement('div');
    menu.className = 'fm-prop-context-menu';

    items.forEach((item) => {
      const row = document.createElement('div');
      row.className = 'fm-prop-menu-item';
      if (item.icon) {
        const iconSpan = document.createElement('span');
        iconSpan.innerHTML = item.icon;
        row.appendChild(iconSpan);
      }
      const label = document.createElement('span');
      label.textContent = item.label;
      row.appendChild(label);

      row.addEventListener('click', (e) => {
        e.stopPropagation();
        menu.remove();
        item.action();
      });
      menu.appendChild(row);
    });

    document.body.appendChild(menu);

    const rect = menu.getBoundingClientRect();
    const posX = Math.min(x, window.innerWidth - rect.width - 8);
    const posY = Math.min(y, window.innerHeight - rect.height - 8);
    menu.style.left = `${Math.max(8, posX)}px`;
    menu.style.top = `${Math.max(8, posY)}px`;

    const closeHandler = (e) => {
      if (!menu.contains(e.target)) {
        menu.remove();
        document.removeEventListener('mousedown', closeHandler);
      }
    };
    setTimeout(() => document.addEventListener('mousedown', closeHandler), 10);
  }

  /**
   * Create an individual property row element.
   */
  _createPropertyRow(view, entry, index, allEntries, commitEntries, docTags) {
    const row = document.createElement('div');
    row.className = 'fm-prop-row';

    // 1. Key column with interactive type icon
    const keyCol = document.createElement('div');
    keyCol.className = 'fm-prop-key-col';

    const iconSpan = document.createElement('span');
    iconSpan.className = 'fm-prop-type-icon fm-prop-type-btn';
    iconSpan.innerHTML = ICONS[entry.type] || ICONS.text;
    iconSpan.title = `Change property type (${entry.type || 'text'})`;

    // Dropdown to select property type
    iconSpan.addEventListener('click', (e) => {
      e.stopPropagation();
      this._showTypeDropdown(iconSpan, entry, allEntries, commitEntries);
    });

    const keyName = document.createElement('span');
    keyName.className = 'fm-prop-key-name';
    keyName.textContent = entry.key;
    keyName.title = 'Click to rename key';

    // Inline key rename
    keyName.addEventListener('click', (e) => {
      e.stopPropagation();
      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'fm-prop-key-input';
      input.value = entry.key;

      const finishRename = (commit) => {
        const newKey = input.value.trim();
        if (commit && newKey && newKey !== entry.key) {
          entry.key = newKey;
          entry.type = inferType(newKey, entry.value);
          commitEntries(allEntries);
        } else {
          keyName.textContent = entry.key;
          keyCol.replaceChild(keyName, input);
        }
      };

      input.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter') {
          ev.preventDefault();
          finishRename(true);
        } else if (ev.key === 'Escape') {
          ev.preventDefault();
          finishRename(false);
        }
      });
      input.addEventListener('blur', () => finishRename(true));

      keyCol.replaceChild(input, keyName);
      input.focus();
      input.select();
    });

    keyCol.appendChild(iconSpan);
    keyCol.appendChild(keyName);
    row.appendChild(keyCol);

    // 2. Value column
    const valCol = document.createElement('div');
    valCol.className = 'fm-prop-val-col';

    if (entry.type === 'tags') {
      this._renderTagChips(valCol, entry, allEntries, commitEntries, docTags);
    } else if (entry.type === 'list') {
      this._renderListChips(valCol, entry, allEntries, commitEntries);
    } else if (entry.type === 'boolean') {
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.className = 'fm-prop-checkbox';
      checkbox.checked = Boolean(entry.value);
      checkbox.addEventListener('change', () => {
        entry.value = checkbox.checked;
        commitEntries(allEntries);
      });
      valCol.appendChild(checkbox);
    } else if (entry.type === 'date') {
      const input = document.createElement('input');
      input.type = 'date';
      input.className = 'fm-prop-text-input fm-prop-date-input';
      input.value = (typeof entry.value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(entry.value))
        ? entry.value.slice(0, 10)
        : '';

      input.addEventListener('change', () => {
        entry.value = input.value;
        commitEntries(allEntries);
      });
      valCol.appendChild(input);
    } else {
      // Text / Number
      const input = document.createElement('input');
      input.type = entry.type === 'number' ? 'number' : 'text';
      input.className = 'fm-prop-text-input';
      input.value = entry.value !== undefined && entry.value !== null ? String(entry.value) : '';
      input.placeholder = 'Empty';

      const originalVal = input.value;
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          input.blur();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          input.value = originalVal;
          input.blur();
        }
      });

      input.addEventListener('blur', () => {
        const newVal = parseScalar(input.value);
        if (newVal !== entry.value) {
          entry.value = newVal;
          commitEntries(allEntries);
        }
      });

      valCol.appendChild(input);
    }
    row.appendChild(valCol);

    // 3. Delete property button
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'fm-prop-del-btn';
    deleteBtn.innerHTML = ICONS.trash;
    deleteBtn.title = 'Delete property';
    deleteBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      allEntries.splice(index, 1);
      commitEntries(allEntries);
    });
    row.appendChild(deleteBtn);

    return row;
  }

  /**
   * Display dropdown to select a type for a property.
   */
  _showTypeDropdown(anchorEl, entry, allEntries, commitEntries) {
    const existing = document.querySelector('.fm-prop-type-dropdown');
    if (existing) existing.remove();

    const dropdown = document.createElement('div');
    dropdown.className = 'fm-prop-type-dropdown';

    PROPERTY_TYPES.forEach((typeOpt) => {
      const item = document.createElement('div');
      item.className = 'fm-prop-menu-item';
      if (entry.type === typeOpt.id) item.classList.add('active');

      const iconSpan = document.createElement('span');
      iconSpan.innerHTML = typeOpt.icon;
      item.appendChild(iconSpan);

      const label = document.createElement('span');
      label.textContent = typeOpt.label;
      label.style.flex = '1';
      item.appendChild(label);

      if (entry.type === typeOpt.id) {
        const check = document.createElement('span');
        check.innerHTML = ICONS.check;
        item.appendChild(check);
      }

      item.addEventListener('click', (e) => {
        e.stopPropagation();
        dropdown.remove();
        if (entry.type === typeOpt.id) return;

        // Convert value to appropriate shape for new type
        const newType = typeOpt.id;
        if (newType === 'boolean') {
          entry.value = Boolean(entry.value);
        } else if (newType === 'number') {
          const num = parseFloat(entry.value);
          entry.value = isNaN(num) ? 0 : num;
        } else if (newType === 'date') {
          entry.value = (typeof entry.value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(entry.value))
            ? entry.value.slice(0, 10)
            : new Date().toISOString().slice(0, 10);
        } else if (newType === 'tags' || newType === 'list') {
          entry.value = Array.isArray(entry.value)
            ? entry.value
            : (entry.value ? [String(entry.value)] : []);
        } else {
          // text
          entry.value = Array.isArray(entry.value) ? entry.value.join(', ') : String(entry.value ?? '');
        }

        entry.type = newType;
        commitEntries(allEntries);
      });

      dropdown.appendChild(item);
    });

    document.body.appendChild(dropdown);

    const anchorRect = anchorEl.getBoundingClientRect();
    const dropRect = dropdown.getBoundingClientRect();
    const posX = Math.min(anchorRect.left, window.innerWidth - dropRect.width - 8);
    const posY = Math.min(anchorRect.bottom + 4, window.innerHeight - dropRect.height - 8);
    dropdown.style.left = `${Math.max(8, posX)}px`;
    dropdown.style.top = `${Math.max(8, posY)}px`;

    const closeHandler = (e) => {
      if (!dropdown.contains(e.target)) {
        dropdown.remove();
        document.removeEventListener('mousedown', closeHandler);
      }
    };
    setTimeout(() => document.addEventListener('mousedown', closeHandler), 10);
  }

  /**
   * Render tag chips with inline add input & autocomplete dropdown.
   */
  _renderTagChips(container, entry, allEntries, commitEntries, docTags) {
    const chipsWrap = document.createElement('div');
    chipsWrap.className = 'fm-tag-chips-wrap';

    const tagsArray = Array.isArray(entry.value)
      ? entry.value.map(String)
      : (entry.value ? String(entry.value).split(/[,\s]+/).filter(Boolean) : []);

    tagsArray.forEach((tag, idx) => {
      const chip = document.createElement('span');
      chip.className = 'fm-tag-chip';

      const label = document.createElement('span');
      label.className = 'fm-tag-label';
      label.textContent = tag.startsWith('#') ? tag : `#${tag}`;

      const removeBtn = document.createElement('button');
      removeBtn.className = 'fm-tag-remove-btn';
      removeBtn.innerHTML = '×';
      removeBtn.title = `Remove ${tag}`;
      removeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        tagsArray.splice(idx, 1);
        entry.value = tagsArray;
        commitEntries(allEntries);
      });

      chip.appendChild(label);
      chip.appendChild(removeBtn);
      chipsWrap.appendChild(chip);
    });

    const inputWrap = document.createElement('div');
    inputWrap.className = 'fm-tag-input-wrap';

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'fm-tag-add-input';
    input.placeholder = '+ tag';

    const dropdown = document.createElement('div');
    dropdown.className = 'fm-tag-autocomplete-dropdown hidden';

    const showSuggestions = () => {
      const query = input.value.trim().toLowerCase().replace(/^#/, '');
      const available = docTags.filter(t => !tagsArray.includes(t) && t.toLowerCase().includes(query));

      if (available.length === 0) {
        dropdown.classList.add('hidden');
        dropdown.innerHTML = '';
        return;
      }

      dropdown.innerHTML = '';
      available.slice(0, 8).forEach(t => {
        const item = document.createElement('div');
        item.className = 'fm-tag-autocomplete-item';
        item.textContent = `#${t}`;
        item.addEventListener('mousedown', (e) => {
          e.preventDefault();
          addTag(t);
        });
        dropdown.appendChild(item);
      });
      dropdown.classList.remove('hidden');
    };

    const addTag = (val) => {
      const clean = String(val).trim().replace(/^#/, '');
      if (clean && !tagsArray.includes(clean)) {
        tagsArray.push(clean);
        entry.value = tagsArray;
        commitEntries(allEntries);
      }
      input.value = '';
      dropdown.classList.add('hidden');
    };

    input.addEventListener('input', showSuggestions);
    input.addEventListener('focus', showSuggestions);
    input.addEventListener('blur', () => {
      setTimeout(() => dropdown.classList.add('hidden'), 200);
      if (input.value.trim()) {
        addTag(input.value.trim());
      }
    });

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ',') {
        e.preventDefault();
        if (input.value.trim()) addTag(input.value.trim());
      } else if (e.key === 'Escape') {
        e.preventDefault();
        input.value = '';
        dropdown.classList.add('hidden');
      }
    });

    inputWrap.appendChild(input);
    inputWrap.appendChild(dropdown);
    chipsWrap.appendChild(inputWrap);
    container.appendChild(chipsWrap);
  }

  /**
   * Render list items as chips with inline add input.
   */
  _renderListChips(container, entry, allEntries, commitEntries) {
    const chipsWrap = document.createElement('div');
    chipsWrap.className = 'fm-tag-chips-wrap';

    const itemsArray = Array.isArray(entry.value)
      ? entry.value.map(String)
      : (entry.value ? String(entry.value).split(/[,\s]+/).filter(Boolean) : []);

    itemsArray.forEach((item, idx) => {
      const chip = document.createElement('span');
      chip.className = 'fm-tag-chip fm-list-chip';

      const label = document.createElement('span');
      label.className = 'fm-tag-label';
      label.textContent = item;

      const removeBtn = document.createElement('button');
      removeBtn.className = 'fm-tag-remove-btn';
      removeBtn.innerHTML = '×';
      removeBtn.title = `Remove ${item}`;
      removeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        itemsArray.splice(idx, 1);
        entry.value = itemsArray;
        commitEntries(allEntries);
      });

      chip.appendChild(label);
      chip.appendChild(removeBtn);
      chipsWrap.appendChild(chip);
    });

    const inputWrap = document.createElement('div');
    inputWrap.className = 'fm-tag-input-wrap';

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'fm-tag-add-input';
    input.placeholder = '+ item';

    const addItem = (val) => {
      const clean = String(val).trim();
      if (clean) {
        itemsArray.push(clean);
        entry.value = itemsArray;
        commitEntries(allEntries);
      }
      input.value = '';
    };

    input.addEventListener('blur', () => {
      if (input.value.trim()) addItem(input.value.trim());
    });

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ',') {
        e.preventDefault();
        if (input.value.trim()) addItem(input.value.trim());
      } else if (e.key === 'Escape') {
        e.preventDefault();
        input.value = '';
      }
    });

    inputWrap.appendChild(input);
    chipsWrap.appendChild(inputWrap);
    container.appendChild(chipsWrap);
  }

  // Pass all events inside properties card to widget DOM without CM6 interference
  ignoreEvent() { return true; }

  destroy() {
    if (this._resizeObserver) {
      this._resizeObserver.disconnect();
      this._resizeObserver = null;
    }
  }
}

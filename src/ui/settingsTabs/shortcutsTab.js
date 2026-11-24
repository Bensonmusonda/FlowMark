import { createSettingsTab } from './index.js';
import { Keyboard } from 'lucide';
import CommandRegistry from '../../commands/registry.js';

export const shortcutsTab = createSettingsTab(
  'shortcuts',
  'Shortcuts',
  Keyboard,
  () => {
    const container = document.createElement('div');
    container.className = 'settings-tab-content';
    container.innerHTML = `
      <h3>Keyboard Shortcuts</h3>
      <p class="settings-desc">Quickly reference and search all available editor and workspace keybindings.</p>

      <div class="shortcuts-filter-bar">
        <div class="shortcuts-search-wrap">
          <input
            type="text"
            id="shortcuts-search-input"
            class="shortcuts-search-input"
            placeholder="Search commands or shortcuts (e.g. Save, Bold, Ctrl+K)..."
            autocomplete="off"
            spellcheck="false"
          />
        </div>
        <div class="shortcuts-categories" id="shortcuts-categories">
          <button type="button" class="shortcuts-category-pill active" data-category="all">All</button>
          <button type="button" class="shortcuts-category-pill" data-category="file">File</button>
          <button type="button" class="shortcuts-category-pill" data-category="edit">Edit</button>
          <button type="button" class="shortcuts-category-pill" data-category="insert">Insert</button>
          <button type="button" class="shortcuts-category-pill" data-category="view">View</button>
          <button type="button" class="shortcuts-category-pill" data-category="plugins">Plugins</button>
        </div>
      </div>

      <div class="shortcuts-count-wrap">
        <span id="shortcuts-count" class="shortcuts-count"></span>
      </div>

      <div class="shortcuts-list" id="shortcuts-list"></div>
    `;

    const searchInput = container.querySelector('#shortcuts-search-input');
    const categoriesWrap = container.querySelector('#shortcuts-categories');
    const listEl = container.querySelector('#shortcuts-list');
    const countEl = container.querySelector('#shortcuts-count');

    let currentCategory = 'all';
    let currentQuery = '';

    function renderShortcutBadge(shortcut) {
      if (!shortcut) {
        return '<span class="shortcut-none">—</span>';
      }
      const parts = shortcut.split('+').map(p => p.trim());
      return parts
        .map(p => `<kbd class="shortcut-key">${p}</kbd>`)
        .join('<span class="shortcut-plus">+</span>');
    }

    function renderList() {
      const allCommands = CommandRegistry.getAllCommands();

      const filtered = allCommands.filter(cmd => {
        // Filter by category
        if (currentCategory !== 'all') {
          const section = (cmd.section || 'other').toLowerCase();
          if (currentCategory === 'plugins') {
            if (section !== 'plugins' && !cmd.id.startsWith('plugin:')) return false;
          } else if (section !== currentCategory) {
            return false;
          }
        }

        // Filter by search query
        if (currentQuery) {
          const q = currentQuery.toLowerCase();
          const matchLabel = cmd.label.toLowerCase().includes(q);
          const matchId = cmd.id.toLowerCase().includes(q);
          const matchShortcut = (cmd.shortcut || '').toLowerCase().includes(q);
          const matchSection = (cmd.section || '').toLowerCase().includes(q);
          return matchLabel || matchId || matchShortcut || matchSection;
        }

        return true;
      });

      if (countEl) {
        countEl.textContent = `Showing ${filtered.length} of ${allCommands.length} commands`;
      }
      listEl.innerHTML = '';

      if (filtered.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'shortcuts-empty';
        empty.textContent = 'No commands match your filter.';
        listEl.appendChild(empty);
        return;
      }

      for (const cmd of filtered) {
        const row = document.createElement('div');
        row.className = 'shortcut-row';

        const info = document.createElement('div');
        info.className = 'shortcut-info';

        const label = document.createElement('span');
        label.className = 'shortcut-label';
        label.textContent = cmd.label;
        info.appendChild(label);

        const category = document.createElement('span');
        category.className = 'shortcut-category-badge';
        category.textContent = cmd.section || 'General';
        info.appendChild(category);

        row.appendChild(info);

        const keys = document.createElement('div');
        keys.className = 'shortcut-keys';
        keys.innerHTML = renderShortcutBadge(cmd.shortcut);
        row.appendChild(keys);

        listEl.appendChild(row);
      }
    }

    searchInput?.addEventListener('input', (e) => {
      currentQuery = e.target.value.trim();
      renderList();
    });

    categoriesWrap?.addEventListener('click', (e) => {
      const btn = e.target.closest('.shortcuts-category-pill');
      if (!btn) return;
      categoriesWrap.querySelectorAll('.shortcuts-category-pill').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentCategory = btn.dataset.category || 'all';
      renderList();
    });

    // Initial render
    renderList();

    return container;
  }
);

export default shortcutsTab;

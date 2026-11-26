import { marked } from 'marked';
import {
  createElement,
  Download,
  Trash2,
  ArrowUpCircle,
  Power,
  ExternalLink,
  Check,
  AlertCircle,
} from 'lucide';

function icon(Component, size = 14) {
  return createElement(Component, {
    width: size,
    height: size,
    'aria-hidden': 'true',
    focusable: 'false',
  });
}

function compareSemver(a = '0.0.0', b = '0.0.0') {
  const pa = String(a).replace(/^v/, '').split('.').map(n => parseInt(n, 10) || 0);
  const pb = String(b).replace(/^v/, '').split('.').map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) > (pb[i] || 0)) return 1;
    if ((pa[i] || 0) < (pb[i] || 0)) return -1;
  }
  return 0;
}

export function renderExtensionDetailView(container, doc, { onStateChange } = {}) {
  const data = doc.viewData || {};
  container.replaceChildren();

  const page = document.createElement('div');
  page.className = 'ext-detail-page';

  const header = document.createElement('div');
  header.className = 'ext-detail-header';

  const titleRow = document.createElement('div');
  titleRow.className = 'ext-detail-title-row';

  const title = document.createElement('h1');
  title.className = 'ext-detail-title';
  title.textContent = data.name || data.id || 'Extension';
  titleRow.appendChild(title);

  const version = document.createElement('span');
  version.className = 'ext-detail-version';
  version.textContent = `v${data.version || '1.0.0'}`;
  titleRow.appendChild(version);

  if (data.installed) {
    const statusBadge = document.createElement('span');
    statusBadge.className = `ext-detail-status${data.active ? ' active' : data.error ? ' error' : ''}`;
    if (data.active) {
      statusBadge.appendChild(icon(Check, 12));
      statusBadge.appendChild(document.createTextNode(' Enabled'));
    } else if (data.error) {
      statusBadge.appendChild(icon(AlertCircle, 12));
      statusBadge.appendChild(document.createTextNode(' Error'));
    } else {
      statusBadge.textContent = 'Disabled';
    }
    titleRow.appendChild(statusBadge);
  }
  header.appendChild(titleRow);

  const metaRow = document.createElement('div');
  metaRow.className = 'ext-detail-meta';
  const metaParts = [];
  if (data.author) metaParts.push(data.author);
  if (data.id) metaParts.push(data.id);
  metaRow.textContent = metaParts.join(' · ');
  header.appendChild(metaRow);

  if (data.description) {
    const desc = document.createElement('p');
    desc.className = 'ext-detail-desc';
    desc.textContent = data.description;
    header.appendChild(desc);
  }

  if (Array.isArray(data.permissions) && data.permissions.length > 0) {
    const perms = document.createElement('div');
    perms.className = 'ext-perms ext-detail-perms';
    for (const p of data.permissions) {
      const pill = document.createElement('span');
      pill.className = 'ext-perm-pill';
      pill.textContent = p;
      perms.appendChild(pill);
    }
    header.appendChild(perms);
  }

  const feedbackEl = document.createElement('div');
  feedbackEl.className = 'ext-detail-feedback hidden';

  const actions = document.createElement('div');
  actions.className = 'ext-detail-actions';

  const setBusy = (busy) => {
    for (const btn of actions.querySelectorAll('button')) {
      btn.disabled = busy;
    }
  };

  const showFeedback = (text, isError = false) => {
    feedbackEl.textContent = text;
    feedbackEl.classList.toggle('error', isError);
    feedbackEl.classList.toggle('hidden', !text);
  };

  if (data.installed) {
    const toggleBtn = document.createElement('button');
    toggleBtn.type = 'button';
    toggleBtn.className = 'ext-btn';
    toggleBtn.appendChild(icon(Power, 13));
    toggleBtn.appendChild(document.createTextNode(data.active ? ' Disable' : ' Enable'));
    toggleBtn.addEventListener('click', async () => {
      setBusy(true);
      try {
        if (data.active) await window.pluginManager?.disable?.(data.id);
        else await window.pluginManager?.enable?.(data.id);
        await onStateChange?.();
      } catch (err) {
        showFeedback(err.message || 'Action failed', true);
      } finally {
        setBusy(false);
      }
    });
    actions.appendChild(toggleBtn);

    if (data.downloadUrl && data.registryVersion && compareSemver(data.registryVersion, data.version) > 0) {
      const updateBtn = document.createElement('button');
      updateBtn.type = 'button';
      updateBtn.className = 'ext-btn ext-btn-primary';
      updateBtn.appendChild(icon(ArrowUpCircle, 13));
      updateBtn.appendChild(document.createTextNode(` Update to v${data.registryVersion}`));
      updateBtn.addEventListener('click', async () => {
        setBusy(true);
        try {
          const res = await window.pluginManager?.installFromUrl?.({
            url: data.downloadUrl,
            pluginId: data.id,
            update: true,
          });
          if (res?.success) {
            await onStateChange?.();
          } else {
            showFeedback(res?.error || 'Update failed', true);
          }
        } catch (err) {
          showFeedback(err.message || 'Update failed', true);
        } finally {
          setBusy(false);
        }
      });
      actions.appendChild(updateBtn);
    }

    const uninstallBtn = document.createElement('button');
    uninstallBtn.type = 'button';
    uninstallBtn.className = 'ext-btn';
    uninstallBtn.appendChild(icon(Trash2, 13));
    uninstallBtn.appendChild(document.createTextNode(' Uninstall'));
    uninstallBtn.addEventListener('click', async () => {
      setBusy(true);
      try {
        await window.pluginManager?.uninstall?.(data.id);
        await onStateChange?.();
      } catch (err) {
        showFeedback(err.message || 'Uninstall failed', true);
      } finally {
        setBusy(false);
      }
    });
    actions.appendChild(uninstallBtn);
  } else if (data.downloadUrl) {
    const installBtn = document.createElement('button');
    installBtn.type = 'button';
    installBtn.className = 'ext-btn ext-btn-primary';
    installBtn.appendChild(icon(Download, 13));
    installBtn.appendChild(document.createTextNode(' Install'));
    installBtn.addEventListener('click', async () => {
      setBusy(true);
      try {
        const res = await window.pluginManager?.installFromUrl?.({
          url: data.downloadUrl,
          pluginId: data.id,
          update: false,
        });
        if (res?.success) {
          await onStateChange?.();
        } else {
          showFeedback(res?.error || 'Installation failed', true);
        }
      } catch (err) {
        showFeedback(err.message || 'Installation failed', true);
      } finally {
        setBusy(false);
      }
    });
    actions.appendChild(installBtn);
  }

  if (data.homepage) {
    const linkBtn = document.createElement('button');
    linkBtn.type = 'button';
    linkBtn.className = 'ext-btn';
    linkBtn.appendChild(icon(ExternalLink, 13));
    linkBtn.appendChild(document.createTextNode(' GitHub'));
    linkBtn.addEventListener('click', () => {
      window.shellAPI?.openExternal?.(data.homepage);
    });
    actions.appendChild(linkBtn);
  }

  header.appendChild(actions);
  header.appendChild(feedbackEl);
  page.appendChild(header);

  const readmeWrap = document.createElement('div');
  readmeWrap.className = 'ext-detail-readme';
  page.appendChild(readmeWrap);

  container.appendChild(page);

  // Load README asynchronously; leave blank if none exists
  window.pluginManager?.getReadme?.({
    id: data.id,
    readmeUrl: data.readmeUrl,
    homepage: data.homepage,
  }).then((res) => {
    if (!container.contains(page)) return;
    if (!res?.found || !res.content) return;
    readmeWrap.innerHTML = marked.parse(res.content);
    readmeWrap.addEventListener('click', (e) => {
      const anchor = e.target.closest('a[href]');
      if (!anchor) return;
      const href = anchor.getAttribute('href');
      if (href && /^https?:/i.test(href)) {
        e.preventDefault();
        window.shellAPI?.openExternal?.(href);
      }
    });
  }).catch(() => {});
}

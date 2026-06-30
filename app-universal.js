(() => {
  'use strict';
  document.documentElement.classList.toggle('pwa-standalone', window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true);

  async function getRuntimeConfig() {
    try {
      const r = await fetch('/api/runtime-config', { cache: 'no-store' });
      return r.ok ? await r.json() : {};
    } catch (_) { return {}; }
  }
  function localSeniorBaseUrl() {
    return `${location.protocol}//${location.hostname}:31001`;
  }
  function applySeniorLinks(baseUrl) {
    const base = String(baseUrl || localSeniorBaseUrl()).replace(/\/$/, '');
    document.querySelectorAll('a[href*="localhost:31001"],a[href*="127.0.0.1:31001"],a[data-senior-link]').forEach(link => {
      link.href = `${base}/pages/senior-login.html`;
    });
  }
  document.addEventListener('DOMContentLoaded', async () => {
    const cfg = await getRuntimeConfig();
    applySeniorLinks(cfg.seniorBaseUrl || '');
  }, { once: true });

  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    window.addEventListener('load', () => navigator.serviceWorker.register('/service-worker.js').then(() => { document.documentElement.dataset.pwaReady='true'; }).catch(() => { document.documentElement.dataset.pwaReady='false'; }));
  }

  let installPrompt = null;
  const installButton = document.createElement('button');
  installButton.type = 'button';
  installButton.className = 'pwa-install-button';
  installButton.textContent = 'Instalează aplicația';
  installButton.hidden = true;
  installButton.addEventListener('click', async () => {
    if (!installPrompt) return;
    installPrompt.prompt();
    await installPrompt.userChoice;
    installPrompt = null;
    installButton.hidden = true;
  });
  document.addEventListener('DOMContentLoaded', () => {
    document.body.appendChild(installButton);
    const nav = document.querySelector('.nav');
    if (nav && !nav.querySelector('[data-device-test-link]')) {
      const link = document.createElement('a');
      link.href = 'device-test.html';
      link.dataset.deviceTestLink = 'true';
      link.classList.toggle('active', location.pathname.endsWith('/device-test.html'));
      link.innerHTML = '<span class="ico">▣</span><span>Test ecrane</span>';
      const seniorLink = nav.querySelector('a[href*="31001"],a[data-senior-link]');
      nav.insertBefore(link, seniorLink || null);
    }
  }, {once:true});
  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    installPrompt = event;
    installButton.hidden = false;
  });
  window.addEventListener('appinstalled', () => { installButton.hidden = true; installPrompt = null; });

  function labelResponsiveTables(root = document) {
    root.querySelectorAll('table').forEach(table => {
      const headerRow = table.querySelector('thead tr') || table.querySelector('tr');
      if (!headerRow) return;
      const headers = Array.from(headerRow.querySelectorAll('th')).map(cell => cell.textContent.trim());
      if (!headers.length) return;
      table.classList.add('responsive-table');
      table.querySelectorAll('tr').forEach(row => {
        if (row === headerRow) return;
        Array.from(row.children).forEach((cell, index) => {
          if (cell.tagName === 'TD' && !cell.hasAttribute('colspan') && !cell.dataset.label) {
            cell.dataset.label = headers[index] || '';
          }
        });
      });
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    labelResponsiveTables();
    let scheduled = false;
    const observer = new MutationObserver(() => {
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(() => { scheduled = false; labelResponsiveTables(); });
    });
    observer.observe(document.body, { childList:true, subtree:true });
  }, {once:true});
})();

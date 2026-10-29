'use strict';
// Démarrage, connexion, navigation
(function () {
  const h = M.h; const app = document.getElementById('app');
  const GROUPS = ['Personnel', 'Clients et contrats', 'Exploitation', 'Nettoyage', 'Ressources', 'Finance', 'Administration'];
  let navEl, contentEl, titleEl, bellN, netEl;

  function loginScreen(msg) {
    M.clear(app); M.user = null; M.meta = null;
    const u = h('input', { type: 'text', autocomplete: 'username', required: true, autocapitalize: 'off', autofocus: true }), p = h('input', { type: 'password', autocomplete: 'current-password', required: true });
    const err = h('div', { 'aria-live': 'assertive' }); if (msg) err.append(h('div', { class: 'alert warn' }, msg));
    const btn = h('button', { class: 'btn pri', style: 'width:100%;justify-content:center' }, 'Se connecter');
    app.append(h('div', { class: 'login' }, h('form', { class: 'box', onsubmit: async (e) => { e.preventDefault(); btn.disabled = true; M.clear(err);
      try { await M.api('POST', '/auth/login', { username: u.value, password: p.value }); await M.boot(); } catch (er) { btn.disabled = false; err.append(h('div', { class: 'alert bad' }, er.message)); p.value = ''; p.focus(); } } },
      h('img', { src: '/icons/logo.png', alt: 'MARONET' }), h('h1', null, 'MARONET 360'), h('p', { class: 'sub' }, 'Sécurité · Nettoyage · Gestion'),
      h('label', { class: 'f' }, h('span', null, 'Identifiant'), u), h('label', { class: 'f' }, h('span', null, 'Mot de passe'), p), err, btn,
      h('p', { class: 'small muted', style: 'text-align:center;margin-top:1rem' }, 'Accès réservé aux utilisateurs autorisés. Les actions sont journalisées.'))));
  }
  M.onLoggedOut = () => { if (M.user) loginScreen('Session expirée : reconnectez-vous.'); };

  M.boot = async function () {
    try {
      const me = await M.api('GET', '/auth/me');
      if (!me.user) return loginScreen();
      M.user = me.user;
      if (me.user.must_change) { M.clear(app); app.append(h('div', { class: 'login' }, h('div', { class: 'box' }, h('h1', null, 'MARONET 360'), M.passwordForm(true)))); return; }
      M.meta = await M.api('GET', '/meta'); M.user = M.meta.user; shell(); route(); M.flushQueue();
    } catch (e) { if (e.status === 0) { app.append(h('div', { class: 'alert bad', style: 'margin:1rem' }, 'Serveur injoignable. Vérifiez le réseau puis rechargez.')); } else loginScreen(); }
  };

  function navItems() {
    const r = M.meta.resources, role = M.role(), items = [];
    if (M.isAgent()) items.push({ g: null, href: '#/home', ic: '🏠', t: 'Accueil' }, { g: null, href: '#/mon-planning', ic: '📅', t: 'Mon planning' });
    else { items.push({ g: null, href: '#/dashboard', ic: '📊', t: 'Tableau de bord' }, { g: null, href: '#/alertes', ic: '🔔', t: 'Alertes' });
      if (r.shifts && r.postes) items.push({ g: null, href: '#/planning', ic: '📅', t: 'Planning et couverture' }); }
    for (const g of GROUPS) {
      for (const [k, x] of Object.entries(r)) if (x.group === g) items.push({ g, href: '#/' + k, ic: x.icon, t: x.label, key: k });
      if (g === 'Finance') { if (['dg', 'comptable', 'auditeur'].includes(role)) items.push({ g, href: '#/rentabilite', ic: '📈', t: 'Rentabilité' }); if (['dg', 'rh', 'comptable'].includes(role)) items.push({ g: 'Personnel', href: '#/recap', ic: '🧮', t: 'Éléments de paie (préparation)' }); }
      if (g === 'Administration' && ['admin', 'dg'].includes(role)) items.push({ g, href: '#/parametres', ic: '⚙', t: 'Paramètres' });
    }
    return items;
  }
  function shell() {
    M.clear(app);
    const items = navItems(); navEl = h('nav', { class: 'nav', 'aria-label': 'Navigation' });
    let lastG = undefined;
    for (const it of items) { if (it.g !== lastG && it.g) navEl.append(h('h4', null, it.g)); lastG = it.g; navEl.append(h('a', { href: it.href, dataset: { h: it.href }, onclick: () => side.classList.remove('open') }, h('span', { class: 'ic' }, it.ic), it.t)); }
    const side = h('aside', { class: 'sidebar' }, h('div', { class: 'brand' }, h('img', { src: '/icons/logo.png', alt: '' }), h('span', null, 'MARONET 360')), navEl,
      h('div', { class: 'side-foot' }, h('div', null, h('strong', null, M.user.username)), h('div', { class: 'muted' }, M.user.role_label), h('a', { href: '#/compte', style: 'color:#ddd', onclick: () => side.classList.remove('open') }, 'Mon compte'),
        h('button', { class: 'btn sm', onclick: logout }, 'Se déconnecter')));
    titleEl = h('div', { class: 'title' }, 'MARONET 360'); bellN = h('span', { class: 'n', hidden: true }, '0'); netEl = h('span', { class: 'netbadge', hidden: true });
    const top = h('div', { class: 'topbar' }, h('button', { class: 'burger', 'aria-label': 'Menu', onclick: () => side.classList.toggle('open') }, '☰'), titleEl, netEl, h('a', { class: 'bell', href: '#/notifications', 'aria-label': 'Notifications' }, '🔔', bellN));
    contentEl = h('main', { class: 'content', id: 'main' });
    const main = h('div', { class: 'main' }, top, contentEl);
    app.append(h('div', { class: 'shell' }, side, main));
    if (M.isAgent()) app.append(h('div', { class: 'tabbar' }, [['#/home', '🏠', 'Accueil'], ['#/mon-planning', '📅', 'Planning'], ['#/taches', '🧹', 'Tâches', 'agent_nettoyage'], ['#/incidents', '🚨', 'Incidents'], ['#/compte', '👤', 'Compte']].filter((x) => !x[3] || x[3] === M.role()).map(([href, ic, t]) => h('a', { href, dataset: { h: href } }, h('span', { class: 'ic' }, ic), t))));
    M.updateBell(); M.updateNet();
  }
  async function logout() {
    if (M.queueSize() && !(await M.confirm(`${M.queueSize()} action(s) hors ligne n’ont pas encore été envoyées. Se déconnecter quand même ? (Elles seront envoyées à votre prochaine connexion.)`, 'Se déconnecter'))) return;
    try { await M.api('POST', '/auth/logout', {}); } catch {} loginScreen();
  }
  M.updateBell = async () => { if (!M.user || !bellN) return; try { const d = await M.get('/notifications'); bellN.textContent = d.unread; bellN.hidden = !d.unread; } catch {} };
  M.updateNet = () => { if (!netEl) return; const q = M.queueSize(); netEl.hidden = M.online && !q; netEl.textContent = !M.online ? 'Hors ligne' + (q ? ` · ${q} en attente` : '') : `${q} en attente`; };

  function route() {
    if (!M.meta) return;
    const raw = (location.hash || '#/').replace(/^#\/?/, '').split('?')[0]; const parts = raw.split('/').filter(Boolean);
    let key = parts[0] || (M.isAgent() ? 'home' : 'dashboard');
    document.querySelectorAll('[data-h]').forEach((a) => a.classList.toggle('on', a.dataset.h === '#/' + key));
    document.querySelector('.sidebar') && document.querySelector('.sidebar').classList.remove('open');
    M.clear(contentEl); M.refresh = null; contentEl.scrollTo && window.scrollTo(0, 0);
    const res = M.meta.resources[key];
    titleEl.textContent = res ? res.label : ({ dashboard: 'Tableau de bord', home: 'Accueil', planning: 'Planning', alertes: 'Alertes', rentabilite: 'Rentabilité', recap: 'Éléments de paie', parametres: 'Paramètres', compte: 'Mon compte', notifications: 'Notifications', employee: 'Fiche employé', client: 'Fiche client', 'mon-planning': 'Mon planning' })[key] || 'MARONET 360';
    try {
      if (M.pages[key]) return M.pages[key](contentEl, { id: parts[1] });
      if ((key === 'employee' || key === 'client')) return M.pages[key](contentEl, { id: parts[1] });
      if (res) return M.listView(key, contentEl, { openId: parts[1] && /^\d+$/.test(parts[1]) ? Number(parts[1]) : null });
      contentEl.append(h('div', { class: 'alert warn' }, 'Page introuvable ou non autorisée pour votre profil. ', h('a', { href: '#/' }, 'Retour à l’accueil')));
    } catch (e) { contentEl.append(h('div', { class: 'alert bad' }, e.message)); }
  }
  // /planning est une page à part entière ; paramètres de requête (#/planning?from=…)
  const paramsOfHash = () => Object.fromEntries(new URLSearchParams((location.hash.split('?')[1]) || ''));
  const origPlanning = M.pages.planning; M.pages.planning = (root) => origPlanning(root, paramsOfHash());
  window.addEventListener('hashchange', route);

  if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
  M.boot();
})();

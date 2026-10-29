'use strict';
// MARONET 360 — noyau : DOM, API, file d'attente hors ligne, fenêtres, formats
// append() ignore null/undefined/false (évite d'afficher « null »)
const _ap = Element.prototype.append; Element.prototype.append = function (...a) { return _ap.apply(this, a.filter((x) => x !== null && x !== undefined && x !== false)); };
const M = window.M = { meta: null, user: null, online: navigator.onLine };

// ---- DOM
M.h = function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k === 'value') el.value = v;
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  const add = (c) => { if (c === null || c === undefined || c === false) return; if (Array.isArray(c)) c.forEach(add); else el.append(c.nodeType ? c : document.createTextNode(String(c))); };
  kids.forEach(add);
  return el;
};
const h = M.h;
M.clear = (el) => { while (el.firstChild) el.removeChild(el.firstChild); return el; };

// ---- formats
M.fmtDate = (d) => { if (!d) return '—'; const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d); return m ? `${m[3]}/${m[2]}/${m[1]}` : d; };
M.fmtDT = (d) => { if (!d) return '—'; const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}:\d{2})/.exec(d); return m ? `${m[3]}/${m[2]}/${m[1]} ${m[4]}` : d; };
M.money = (n) => (n === null || n === undefined || n === '' ? '—' : Number(n).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' MAD');
M.num = (n) => (n === null || n === undefined ? '—' : Number(n).toLocaleString('fr-FR', { maximumFractionDigits: 2 }));
M.today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
M.addDays = (s, n) => { const [y, m, d] = s.split('-').map(Number); const t = new Date(y, m - 1, d + n); return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`; };
M.DOW = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];
M.dow = (s) => { const [y, m, d] = s.split('-').map(Number); return M.DOW[new Date(y, m - 1, d).getDay()]; };
M.optLabel = (opts, v) => { const o = (opts || []).find((x) => (Array.isArray(x) ? x[0] : x) === v); return o ? (Array.isArray(o) ? o[1] : o) : (v ?? '—'); };
M.qs = (o) => { const p = new URLSearchParams(); for (const [k, v] of Object.entries(o || {})) if (v !== '' && v !== null && v !== undefined) p.set(k, v); const s = p.toString(); return s ? '?' + s : ''; };
const TONE = { actif: 'ok', affilie: 'ok', conforme: 'ok', fait: 'ok', payee: 'ok', resolu: 'ok', clos: 'mut', terminee: 'ok', validee: 'ok', verifie: 'ok', disponible: 'ok', termine: 'ok', confirme: 'ok', a_jour: 'ok', valide: 'ok',
  suspendu: 'warn', reserves: 'warn', en_cours: 'info', demande: 'warn', depose: 'info', emise: 'info', a_faire: 'mut', a_renouveler: 'warn', planifie: 'info', elevee: 'warn', maintenance: 'warn', attribue: 'info', en_retard: 'bad',
  sorti: 'mut', non_conforme: 'bad', anomalie: 'bad', critique: 'bad', impayee: 'bad', refusee: 'bad', refuse: 'bad', ouvert: 'warn', expire: 'bad', absent: 'bad', hors_service: 'bad', non_affilie: 'bad', annulee: 'mut', annule: 'mut', remplace: 'mut', normale: 'mut', faible: 'mut', brouillon: 'mut', resilie: 'bad' };
M.badge = (v, label) => h('span', { class: 'badge ' + (TONE[v] || '') }, label ?? v);
M.ETAT = { valide: ['Valide', 'ok'], a_jour: ['À jour', 'ok'], a_renouveler: ['À renouveler', 'warn'], expire: ['Expiré', 'bad'], en_retard: ['En retard', 'bad'], sans_echeance: ['Sans échéance', 'mut'], ok: ['OK', 'ok'] };

// ---- toasts / dialogues
M.toast = (msg, kind) => {
  const t = h('div', { class: 'toast ' + (kind || ''), role: 'status' }, msg);
  document.getElementById('toasts').append(t); setTimeout(() => t.remove(), kind === 'bad' ? 7000 : 3800);
};
M.modal = ({ title, body, footer, onClose, wide }) => {
  const prev = document.activeElement;
  const close = () => { ov.remove(); document.removeEventListener('keydown', esc); if (prev && prev.focus) try { prev.focus(); } catch {} if (onClose) onClose(); };
  const esc = (e) => { if (e.key === 'Escape' && ov === [...document.querySelectorAll('.overlay')].pop()) close(); };
  const m = h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': title, style: wide ? 'width:min(1000px,96vw)' : null },
    h('header', null, h('h2', null, title), h('button', { class: 'x', 'aria-label': 'Fermer', onclick: close }, '×')),
    h('div', { class: 'body' }, body), footer ? h('footer', null, footer) : null);
  const ov = h('div', { class: 'overlay', onmousedown: (e) => { if (e.target === ov) close(); } }, m);
  document.body.append(ov); document.addEventListener('keydown', esc);
  const first = m.querySelector('input,select,textarea,button.pri'); if (first && !('ontouchstart' in window)) first.focus();
  return { close, el: m };
};
M.confirm = (msg, okLabel = 'Confirmer', danger = false) => new Promise((res) => {
  let ans = false;
  const mm = M.modal({ title: 'Confirmation', body: h('p', null, msg), onClose: () => res(ans),
    footer: [h('button', { class: 'btn', onclick: () => mm.close() }, 'Annuler'),
      h('button', { class: 'btn ' + (danger ? 'dng' : 'pri'), onclick: () => { ans = true; mm.close(); } }, okLabel)] });
});
M.prompt = (title, label, opts = {}) => new Promise((res) => {
  const inp = opts.multiline ? h('textarea', { required: true }) : h('input', { type: 'text' });
  let done = false;
  const mm = M.modal({ title, body: h('label', { class: 'f' }, h('span', null, label), inp), onClose: () => { if (!done) res(null); },
    footer: [h('button', { class: 'btn', onclick: () => mm.close() }, 'Annuler'),
      h('button', { class: 'btn pri', onclick: () => { if (opts.required && !inp.value.trim()) { inp.focus(); return; } done = true; res(inp.value.trim()); mm.close(); } }, 'Valider')] });
});

// ---- file d'attente hors ligne (pointage, fin de service, incident, tâche)
const QKEY = 'm360q';
const qLoad = () => { try { return JSON.parse(localStorage.getItem(QKEY) || '[]'); } catch { return []; } };
const qSave = (q) => { try { localStorage.setItem(QKEY, JSON.stringify(q)); } catch {} };
M.queueSize = () => qLoad().filter((x) => M.user && x.uid === M.user.id).length;
const QUEUABLE = [/^\/shifts\/\d+\/(checkin|checkout)$/, /^\/taches\/\d+\/done$/, /^\/r\/incidents$/];
const isQueuable = (method, path) => method === 'POST' && QUEUABLE.some((r) => r.test(path.split('?')[0]));
function enqueue(method, path, body, label) {
  const q = qLoad(); const b = { ...(body || {}) };
  if (/(checkin|checkout)$/.test(path)) b.at = new Date().toISOString(); // l'heure réelle est conservée
  q.push({ uid: M.user.id, method, path, body: b, label, t: Date.now() }); qSave(q);
  M.updateNet && M.updateNet();
}

// ---- API
class ApiError extends Error { constructor(msg, status, extra) { super(msg); this.status = status; this.extra = extra; } }
M.ApiError = ApiError;
M.api = async function api(method, path, body, opts = {}) {
  const init = { method, credentials: 'same-origin', headers: { 'X-M360': '1' } };
  if (body !== undefined && !(body instanceof FormData)) { init.headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(body); }
  else if (body instanceof FormData) init.body = body;
  let rsp;
  try { rsp = await fetch('/api' + path, init); }
  catch (e) {
    M.online = false; M.updateNet && M.updateNet();
    if (opts.queue && M.user && isQueuable(method, path)) { enqueue(method, path, body, opts.queue); return { queued: true }; }
    throw new ApiError('Connexion impossible. Vérifiez le réseau.', 0);
  }
  M.online = true;
  let data = null; const ct = rsp.headers.get('content-type') || '';
  if (ct.includes('json')) data = await rsp.json().catch(() => null);
  if (!rsp.ok) {
    if (rsp.status === 401 && !path.startsWith('/auth/') && M.onLoggedOut) M.onLoggedOut();
    throw new ApiError((data && data.error) || `Erreur ${rsp.status}`, rsp.status, data);
  }
  return data;
};
M.get = (p, q) => M.api('GET', p + (q ? M.qs(q) : ''));
M.post = (p, b, o) => M.api('POST', p, b === undefined ? {} : b, o);
M.put = (p, b) => M.api('PUT', p, b);
M.del = (p) => M.api('DELETE', p);
M.fail = (e) => { if (e && e.status === 401) return; M.toast(e && e.message ? e.message : 'Erreur inattendue.', 'bad'); };

M.flushQueue = async function () {
  if (!M.user || M.flushing) return; M.flushing = true;
  try {
    let q = qLoad(); let sent = 0, dropped = 0;
    for (const it of q.filter((x) => x.uid === M.user.id)) {
      try { await fetch('/api' + it.path, { method: it.method, credentials: 'same-origin', headers: { 'X-M360': '1', 'Content-Type': 'application/json' }, body: JSON.stringify(it.body) }).then(async (r) => {
        if (r.status >= 500 || r.status === 401) throw new Error('retry');
        q = qLoad().filter((x) => x.t !== it.t); qSave(q);
        if (r.ok) sent++; else { dropped++; const d = await r.json().catch(() => ({})); M.toast(`Envoi différé refusé (${it.label}) : ${d.error || r.status}`, 'bad'); }
      }); } catch { break; }
    }
    if (sent) { M.toast(`${sent} action(s) enregistrée(s) hors ligne ont été envoyées.`, 'ok'); M.refresh && M.refresh(); }
    M.updateNet && M.updateNet();
  } finally { M.flushing = false; }
};
window.addEventListener('online', () => { M.online = true; M.updateNet && M.updateNet(); M.flushQueue(); });
window.addEventListener('offline', () => { M.online = false; M.updateNet && M.updateNet(); });
setInterval(() => { if (M.user && M.queueSize()) M.flushQueue(); }, 30000);

// ---- utilitaires UI
M.can = (key, a) => !!(M.meta && M.meta.resources[key] && M.meta.resources[key].perms[a]);
M.has = (key) => !!(M.meta && M.meta.resources[key]);
M.role = () => M.user && M.user.role;
M.isAgent = () => ['agent_securite', 'agent_nettoyage'].includes(M.role());
M.download = (path) => { const a = h('a', { href: '/api' + path, download: '' }); document.body.append(a); a.click(); a.remove(); };
M.spinner = () => h('p', { class: 'boot' }, 'Chargement…');
M.empty = (t) => h('div', { class: 'empty' }, t);
M.kpi = (label, value, sub, tone, href) => { const el = h(href ? 'a' : 'div', { class: 'kpi ' + (tone || ''), href: href || null, style: href ? 'text-decoration:none;color:inherit;display:block' : null }, h('div', { class: 'v' }, value), h('div', { class: 'l' }, label), sub ? h('div', { class: 's' }, sub) : null); return el; };

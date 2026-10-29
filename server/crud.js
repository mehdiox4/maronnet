'use strict';
// API générique : liste, lecture, création, modification, suppression, options, export CSV, métadonnées.
const express = require('express');
const fs = require('fs');
const path = require('path');
const db = require('./db');
const hooks = require('./hooks');
const { resources, ROLES, AG } = require('./schema');
const L = require('./lib');
const { HttpError, can, scopeOf, fieldReadable, todayStr, addDays, isDate, isTime, audit } = L;

resources.employees.computed = ['completude'];
const COMPUTED = {
  etat: { n: 'etat', l: 'Échéance', t: 'etat', list: true },
  paye: { n: 'paye', l: 'Payé (MAD)', t: 'money', list: true },
  reste: { n: 'reste', l: 'Reste à payer (MAD)', t: 'money', list: true },
  ttc: { n: 'ttc', l: 'Montant TTC (MAD)', t: 'money', list: true },
  completude: { n: 'completude', l: 'Complétude du dossier', t: 'percent', list: true },
};
const DATECOL = { documents: 'date_expiration', formations: 'date_expiration', assurances: 'date_fin', cnss: 'date_echeance', contrats: 'date_fin' };
const DATEF = { shifts: 'date', taches: 'date', controles: 'date', factures: 'date', depenses: 'date', paiements: 'date', absences: 'date_debut', incidents: 'substr(t.created_at,1,10)', audit: 'substr(t.at,1,10)', mouvements: 'date' };
const OPT_EXTRA = { postes: ['activite', 'heure_debut', 'heure_fin', 'site_id', 'effectif_requis'], sites: ['client_id'], contrats: ['client_id', 'site_id'], employees: ['activite'], factures: ['contrat_id'] };
const OPT_ACTIVE = { employees: "t.statut = 'actif'", postes: 't.actif = 1', sites: 't.actif = 1', users: 't.active = 1' };
const DOC_REQUIS = ['Pièce d’identité', 'Contrat de travail', 'CNSS'];

const likeEsc = (s) => '%' + String(s).replace(/[\\%_]/g, (m) => '\\' + m) + '%';
const visibleFields = (res, user) => res.fields.filter((f) => fieldReadable(f, user));
const writable = (f, res, user, action) => {
  if (f.readonly) return false;
  if (f.fw) return f.fw.includes(user.role);
  return can(user, res, action);
};

// ---------------------------------------------------------------- champs calculés
function daysLeft(dateStr) { return dateStr ? L.daysBetween(todayStr(), dateStr) : null; }
function etatOf(key, row) {
  if (key === 'cnss') { if (row.statut === 'terminee') return 'ok'; }
  if (key === 'contrats') {
    if (['termine', 'resilie', 'brouillon'].includes(row.statut)) return 'termine';
    const d = daysLeft(row.date_fin); if (d === null) return 'sans_echeance';
    return d < 0 ? 'expire' : d <= (row.preavis_jours || 90) ? 'a_renouveler' : 'valide';
  }
  if (key === 'factures') {
    if (row.type !== 'facture' || ['payee', 'annulee', 'brouillon'].includes(row.statut)) return '';
    const reste = row._reste; const d = daysLeft(row.echeance);
    return reste > 0.005 && d !== null && d < 0 ? 'en_retard' : 'en_cours';
  }
  const col = DATECOL[key]; const d = daysLeft(row[col]);
  if (d === null) return 'sans_echeance';
  return d < 0 ? 'expire' : d <= 30 ? 'a_renouveler' : 'valide';
}
function decorate(key, rows) {
  const res = resources[key];
  if (!res.computed || !rows.length) return rows;
  if (key === 'factures') {
    const ids = rows.map((r) => r.id);
    const sums = db.all(`SELECT facture_id, SUM(montant) s FROM paiements WHERE facture_id IN (${ids.map(() => '?').join(',')}) GROUP BY facture_id`, ...ids);
    const m = Object.fromEntries(sums.map((x) => [x.facture_id, x.s]));
    for (const r of rows) {
      const ttc = r.montant_ht * (1 + (r.tva_taux || 0) / 100) * (r.type === 'avoir' ? -1 : 1);
      r.ttc = Math.round(ttc * 100) / 100; r.paye = Math.round((m[r.id] || 0) * 100) / 100;
      r.reste = r.type === 'facture' && !['brouillon', 'annulee'].includes(r.statut) ? Math.max(0, Math.round((ttc - r.paye) * 100) / 100) : 0;
      r._reste = r.reste; r.etat = etatOf(key, r); delete r._reste;
    }
  } else if (key === 'employees') {
    const ids = rows.map((r) => r.id);
    const docs = db.all(`SELECT employee_id, categorie, statut_verif, date_expiration FROM documents WHERE employee_id IN (${ids.map(() => '?').join(',')})`, ...ids);
    const t = todayStr();
    for (const r of rows) {
      const filled = ['cin', 'tel', 'adresse', 'date_naissance', 'urgence_tel', 'date_embauche', 'type_contrat', 'cnss_numero'].filter((k) => r[k]).length;
      const have = DOC_REQUIS.filter((c) => docs.some((d) => d.employee_id === r.id && d.categorie === c && d.statut_verif !== 'refuse' && (!d.date_expiration || d.date_expiration >= t))).length;
      r.completude = Math.round((filled / 8) * 50 + (have / DOC_REQUIS.length) * 50);
    }
  } else {
    for (const r of rows) r.etat = etatOf(key, r);
  }
  return rows;
}
// Éléments manquants d'un dossier employé
function missingForEmployee(emp) {
  const out = [];
  const lab = { cin: 'N° pièce d’identité', tel: 'Téléphone', adresse: 'Adresse', date_naissance: 'Date de naissance', urgence_tel: 'Contact d’urgence', date_embauche: 'Date d’embauche', type_contrat: 'Type de contrat', cnss_numero: 'N° CNSS' };
  for (const k of Object.keys(lab)) if (!emp[k]) out.push(lab[k]);
  const docs = db.all('SELECT categorie, statut_verif, date_expiration FROM documents WHERE employee_id = ?', emp.id);
  const t = todayStr();
  for (const c of DOC_REQUIS) if (!docs.some((d) => d.categorie === c && d.statut_verif !== 'refuse' && (!d.date_expiration || d.date_expiration >= t))) out.push('Document : ' + c);
  return out;
}

// ---------------------------------------------------------------- requêtes
function buildWhere(res, user, query, extra = {}) {
  const sc = scopeOf(res, user);
  if (sc === false) throw new HttpError(403, 'Accès refusé.');
  const where = [], params = [];
  if (sc) { where.push(`(${sc.sql})`); params.push(...sc.params); }
  const q = (query.q || '').toString().trim();
  if (q && res.search) { where.push('(' + res.search.map((c) => `t.${c} LIKE ? ESCAPE '\\'`).join(' OR ') + ')'); res.search.forEach(() => params.push(likeEsc(q))); }
  const vis = visibleFields(res, user);
  for (const f of vis) {
    const v = query['f_' + f.n];
    if (v === undefined || v === '') continue;
    if (['select', 'ref', 'bool'].includes(f.t)) { where.push(`t.${f.n} = ?`); params.push(f.t === 'select' ? String(v) : Number(v)); }
  }
  if (query.etat && DATECOL[res.key]) {
    const c = 't.' + DATECOL[res.key], t = todayStr();
    if (query.etat === 'expire') { where.push(`${c} IS NOT NULL AND ${c} < ?`); params.push(t); }
    else if (query.etat === 'a_renouveler') { where.push(`${c} IS NOT NULL AND ${c} >= ? AND ${c} <= ?`); params.push(t, addDays(t, res.key === 'contrats' ? 90 : 30)); }
    else if (query.etat === 'sans_echeance') where.push(`${c} IS NULL`);
  }
  if (DATEF[res.key]) {
    const c = DATEF[res.key].includes('(') ? DATEF[res.key] : 't.' + DATEF[res.key];
    if (isDate(query.from)) { where.push(`${c} >= ?`); params.push(query.from); }
    if (isDate(query.to)) { where.push(`${c} <= ?`); params.push(query.to); }
  }
  if (extra.where) { where.push(...extra.where); params.push(...(extra.params || [])); }
  return { where, params };
}

function cleanRow(res, user, r) {
  const o = { id: r.id };
  for (const f of visibleFields(res, user)) o[f.n] = r[f.n] === undefined ? null : r[f.n];
  for (const c of res.computed || []) if (r[c] !== undefined) o[c] = r[c];
  return o;
}
function resolveRefs(res, rows, user) {
  const refs = {};
  for (const f of visibleFields(res, user).filter((x) => x.t === 'ref')) {
    const ids = [...new Set(rows.map((r) => r[f.n]).filter(Boolean))];
    if (!ids.length) continue;
    const tr = resources[f.ref];
    const lab = db.all(`SELECT t.id, ${tr.labelSql} AS label FROM ${tr.table} t WHERE t.id IN (${ids.map(() => '?').join(',')})`, ...ids);
    refs[f.n] = Object.fromEntries(lab.map((x) => [x.id, x.label]));
  }
  return refs;
}
// Récupération interne réutilisable (respecte périmètre + champs autorisés)
function fetchRows(key, user, { query = {}, where = [], params = [], limit = 200, offset = 0, order } = {}) {
  const res = resources[key];
  const w = buildWhere(res, user, query, { where, params });
  const sql = `FROM ${res.table} t ${w.where.length ? 'WHERE ' + w.where.join(' AND ') : ''}`;
  const total = db.get(`SELECT COUNT(*) c ${sql}`, ...w.params).c;
  const raw = db.all(`SELECT t.* ${sql} ORDER BY ${order || res.order || 't.id'} LIMIT ? OFFSET ?`, ...w.params, limit, offset);
  const rows = decorate(key, raw).map((r) => cleanRow(res, user, r));
  return { rows, total, refs: resolveRefs(res, rows, user) };
}

// ---------------------------------------------------------------- validation
function coerce(f, v, res) {
  if (v === undefined || v === null || v === '') return null;
  const bad = (m) => new HttpError(400, `${f.l} : ${m}`);
  switch (f.t) {
    case 'text': case 'tel': case 'textarea': case 'email': {
      const s = String(v).trim(); if (s.length > (f.t === 'textarea' ? 5000 : 500)) throw bad('texte trop long');
      if (f.t === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) throw bad('adresse e-mail invalide');
      return s;
    }
    case 'date': if (!isDate(String(v))) throw bad('date invalide (AAAA-MM-JJ)'); return String(v);
    case 'time': if (!isTime(String(v))) throw bad('heure invalide (HH:MM)'); return String(v);
    case 'number': { const n = Number(v); if (!Number.isFinite(n)) throw bad('nombre invalide'); if (Math.abs(n) > 1e12) throw bad('valeur trop grande'); return n; }
    case 'bool': return [true, 1, '1', 'true', 'on'].includes(v) ? 1 : 0;
    case 'select': { const ok = f.opts.some((o) => (Array.isArray(o) ? o[0] : o) === String(v)); if (!ok) throw bad('valeur non autorisée'); return String(v); }
    case 'ref': {
      const id = Number(v); if (!Number.isInteger(id) || id < 1) throw bad('référence invalide');
      const tr = resources[f.ref]; if (!db.get(`SELECT 1 x FROM ${tr.table} WHERE id = ?`, id)) throw bad('élément introuvable');
      return id;
    }
    case 'file': {
      const s = String(v); if (!/^[a-f0-9]{24,}\.[a-z0-9]{2,5}(::.{0,200})?$/i.test(s)) throw bad('fichier invalide');
      if (!fs.existsSync(path.join(db.DATA_DIR, 'uploads', s.split('::')[0]))) throw bad('fichier introuvable (renvoyez-le)');
      return s;
    }
    default: return String(v);
  }
}
function validate(res, user, body, action) {
  const d = {};
  for (const f of res.fields) {
    const has = Object.prototype.hasOwnProperty.call(body, f.n);
    if (writable(f, res, user, action) && has) {
      d[f.n] = coerce(f, body[f.n], res);
      if (f.req && d[f.n] === null) throw new HttpError(400, `${f.l} : champ obligatoire.`);
    } else if (action === 'create') {
      if (f.def !== undefined) d[f.n] = f.def;
      else if (f.req && writable(f, res, user, action)) throw new HttpError(400, `${f.l} : champ obligatoire.`);
    }
  }
  return d;
}
function friendlyDbError(e) {
  const m = String(e.message || e);
  if (/FOREIGN KEY/i.test(m)) return new HttpError(409, 'Suppression impossible : des données y sont rattachées. Archivez plutôt l’élément (changez son statut).');
  if (/UNIQUE/i.test(m)) return new HttpError(409, 'Cette valeur existe déjà.');
  if (/NOT NULL/i.test(m)) return new HttpError(400, 'Un champ obligatoire est manquant.');
  return e;
}

// ---------------------------------------------------------------- routes
const router = express.Router();
const getRes = (req) => {
  const res = resources[req.params.key];
  if (!res) throw new HttpError(404, 'Ressource inconnue.');
  return res;
};

router.get('/meta', (req, rsp) => {
  const u = req.user; const out = {};
  for (const [key, r] of Object.entries(resources)) {
    if (!can(u, r, 'read')) continue;
    out[key] = {
      key, label: r.label, singular: r.singular, group: r.group, icon: r.icon, note: r.note || null, detail: r.detail || null,
      fields: visibleFields(r, u).map((f) => ({ n: f.n, l: f.l, t: f.t, opts: f.opts, req: !!f.req, ref: f.ref, list: !!f.list, filter: !!f.filter, help: f.help, def: f.def, refFilter: f.refFilter,
        w: { create: writable(f, r, u, 'create'), update: writable(f, r, u, 'update') } })),
      computed: (r.computed || []).map((c) => COMPUTED[c]),
      perms: { create: can(u, r, 'create'), update: can(u, r, 'update'), delete: can(u, r, 'delete'), export: can(u, r, 'export') },
      dateFilter: !!DATEF[key], etatFilter: !!DATECOL[key],
    };
  }
  const settings = { societe: db.getSetting('societe'), alerte_jours: db.getSetting('alerte_jours'), seuil_heures_hebdo: db.getSetting('seuil_heures_hebdo'), repos_min_heures: db.getSetting('repos_min_heures'), tva_defaut: db.getSetting('tva_defaut') };
  rsp.json({ user: { ...req.user, role_label: ROLES[req.user.role] }, roles: ROLES, resources: out, settings });
});

router.get('/options/:key', (req, rsp) => {
  const r = getRes(req); const u = req.user;
  if (!(can(u, r, 'read') || (r.optionRoles || []).includes(u.role))) throw new HttpError(403, 'Accès refusé.');
  const sc = r.optionScope ? r.optionScope(u) : (scopeOf(r, u) === false ? null : scopeOf(r, u));
  const where = [], params = [];
  if (sc) { where.push(`(${sc.sql})`); params.push(...sc.params); }
  if (OPT_ACTIVE[r.key] && !req.query.all) where.push(OPT_ACTIVE[r.key]);
  for (const k of ['activite', 'site_id', 'client_id', 'contrat_id', 'type']) {
    if (req.query[k] && r.fields.some((f) => f.n === k)) { where.push(`t.${k} = ?`); params.push(req.query[k]); }
  }
  const q = (req.query.q || '').toString().trim();
  if (q) { where.push(`(${r.labelSql}) LIKE ? ESCAPE '\\'`); params.push(likeEsc(q)); }
  const extra = (OPT_EXTRA[r.key] || []).map((c) => `t.${c}`).join(', ');
  const rows = db.all(`SELECT t.id, (${r.labelSql}) AS label${extra ? ', ' + extra : ''} FROM ${r.table} t ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY label LIMIT 400`, ...params);
  rsp.json({ options: rows });
});

router.get('/r/:key', (req, rsp) => {
  const r = getRes(req);
  const limit = Math.min(Number(req.query.limit) || 200, 1000), offset = Math.max(Number(req.query.offset) || 0, 0);
  rsp.json(fetchRows(r.key, req.user, { query: req.query, limit, offset }));
});

router.get('/r/:key/export.csv', (req, rsp) => {
  const r = getRes(req); const u = req.user;
  if (!can(u, r, 'export')) throw new HttpError(403, 'Export non autorisé pour votre profil.');
  const { rows, refs } = fetchRows(r.key, u, { query: req.query, limit: 20000 });
  const cols = [...visibleFields(r, u), ...(r.computed || []).map((c) => COMPUTED[c])];
  const fmt = (c, row) => {
    let v = row[c.n]; if (v === null || v === undefined) return '';
    if (c.t === 'ref') v = (refs[c.n] || {})[v] || v;
    else if (c.t === 'select') { const o = c.opts.find((x) => (Array.isArray(x) ? x[0] : x) === v); v = o ? (Array.isArray(o) ? o[1] : o) : v; }
    else if (c.t === 'bool') v = v ? 'Oui' : 'Non';
    else if (c.t === 'file') v = String(v).split('::')[1] || 'fichier';
    else if (c.t === 'number' || c.t === 'money') v = String(v).replace('.', ',');
    v = String(v);
    if (/^[=+\-@\t\r]/.test(v)) v = "'" + v; // neutralise l'injection de formules tableur
    return '"' + v.replace(/"/g, '""') + '"';
  };
  const csv = '﻿' + [cols.map((c) => `"${c.l}"`).join(';'), ...rows.map((row) => cols.map((c) => fmt(c, row)).join(';'))].join('\r\n');
  audit(req, 'export_csv', r.key, null, `${rows.length} lignes`);
  rsp.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="maronet360_${r.key}_${todayStr()}.csv"` }).send(csv);
});

router.get('/r/:key/:id', (req, rsp) => {
  const r = getRes(req);
  const { rows, refs } = fetchRows(r.key, req.user, { where: ['t.id = ?'], params: [Number(req.params.id)], limit: 1 });
  if (!rows.length) throw new HttpError(404, 'Introuvable.');
  rsp.json({ row: rows[0], refs });
});

// Après écriture : la ligne doit rester dans le périmètre de l'utilisateur (empêche de créer/déplacer hors périmètre)
function assertInScope(r, u, id) {
  const sc = scopeOf(r, u);
  if (sc && !db.get(`SELECT 1 x FROM ${r.table} t WHERE t.id = ? AND (${sc.sql})`, id, ...sc.params)) throw new HttpError(403, 'Cet élément est en dehors de votre périmètre.');
}
function insertRow(r, d) {
  const cols = Object.keys(d);
  const info = db.run(`INSERT INTO ${r.table}(${cols.join(',')}) VALUES(${cols.map(() => '?').join(',')})`, ...cols.map((c) => d[c]));
  return Number(info.lastInsertRowid);
}

router.post('/r/:key', (req, rsp) => {
  const r = getRes(req); const u = req.user;
  if (r.readonlyAll || !can(u, r, 'create')) throw new HttpError(403, 'Création non autorisée pour votre profil.');
  const h = hooks[r.key] || {};
  try {
    const out = db.tx(() => {
      const d = validate(r, u, req.body || {}, 'create');
      if (r.createCheck) { const m = r.createCheck(u, d); if (m) throw new HttpError(403, m); }
      const warnings = (h.beforeCreate && h.beforeCreate(u, d)) || [];
      const id = insertRow(r, d);
      assertInScope(r, u, id);
      const row = db.get(`SELECT * FROM ${r.table} WHERE id = ?`, id);
      if (h.afterCreate) h.afterCreate(req, row);
      return { id, warnings };
    });
    audit(req, 'creation', r.key, out.id);
    const { rows, refs } = fetchRows(r.key, u, { where: ['t.id = ?'], params: [out.id], limit: 1 });
    rsp.status(201).json({ row: rows[0] || { id: out.id }, refs, warnings: out.warnings });
  } catch (e) { throw friendlyDbError(e); }
});

router.put('/r/:key/:id', (req, rsp) => {
  const r = getRes(req); const u = req.user; const id = Number(req.params.id);
  if (r.readonlyAll || !can(u, r, 'update')) throw new HttpError(403, 'Modification non autorisée pour votre profil.');
  const sc = scopeOf(r, u);
  const old = db.get(`SELECT * FROM ${r.table} t WHERE t.id = ? ${sc ? 'AND (' + sc.sql + ')' : ''}`, id, ...(sc ? sc.params : []));
  if (!old) throw new HttpError(404, 'Introuvable.');
  const h = hooks[r.key] || {};
  try {
    const out = db.tx(() => {
      const d = validate(r, u, req.body || {}, 'update');
      const warnings = (h.beforeUpdate && h.beforeUpdate(u, d, old)) || [];
      const cols = Object.keys(d);
      if (cols.length) db.run(`UPDATE ${r.table} SET ${cols.map((c) => c + ' = ?').join(', ')} WHERE id = ?`, ...cols.map((c) => d[c]), id);
      assertInScope(r, u, id);
      const row = db.get(`SELECT * FROM ${r.table} WHERE id = ?`, id);
      if (h.afterUpdate) h.afterUpdate(req, row, old);
      const changed = cols.filter((c) => String(old[c] ?? '') !== String(row[c] ?? ''));
      return { warnings, changed, row, old };
    });
    const detail = out.changed.map((c) => (['statut', 'valide', 'priorite', 'role', 'active'].includes(c) ? `${c}: ${out.old[c]}→${out.row[c]}` : c)).join(', ');
    audit(req, 'modification', r.key, id, detail);
    const { rows, refs } = fetchRows(r.key, u, { where: ['t.id = ?'], params: [id], limit: 1 });
    rsp.json({ row: rows[0] || { id }, refs, warnings: out.warnings });
  } catch (e) { throw friendlyDbError(e); }
});

router.delete('/r/:key/:id', (req, rsp) => {
  const r = getRes(req); const u = req.user; const id = Number(req.params.id);
  if (r.readonlyAll || !can(u, r, 'delete')) throw new HttpError(403, 'Suppression non autorisée pour votre profil.');
  const sc = scopeOf(r, u);
  const old = db.get(`SELECT * FROM ${r.table} t WHERE t.id = ? ${sc ? 'AND (' + sc.sql + ')' : ''}`, id, ...(sc ? sc.params : []));
  if (!old) throw new HttpError(404, 'Introuvable.');
  const h = hooks[r.key] || {};
  try {
    db.tx(() => {
      if (h.beforeDelete) h.beforeDelete(u, old);
      db.run(`DELETE FROM ${r.table} WHERE id = ?`, id);
      if (h.afterDelete) h.afterDelete(req, old);
    });
  } catch (e) { throw friendlyDbError(e); }
  audit(req, 'suppression', r.key, id);
  rsp.json({ ok: true });
});

module.exports = { router, fetchRows, decorate, missingForEmployee, COMPUTED, DOC_REQUIS };

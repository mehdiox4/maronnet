'use strict';
// Routes spécifiques : session, utilisateurs, planning, pointage, tâches, stock, fichiers, vues consolidées...
const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const QRCode = require('qrcode');
const db = require('./db');
const auth = require('./auth');
const hooks = require('./hooks');
const A = require('./analytics');
const { fetchRows, missingForEmployee } = require('./crud');
const { resources, ROLES, AG, RES, actOf, me } = require('./schema');
const L = require('./lib');
const { HttpError, can, scopeOf, todayStr, nowStr, addDays, isDate, isTime, audit, notify, usersOfEmployee, toMin, shiftRange } = L;

const r = express.Router();
const UP_DIR = path.join(db.DATA_DIR, 'uploads');

// ------------------------------------------------------------------ session
r.post('/auth/login', (req, rsp) => rsp.json({ user: auth.login(req, rsp) }));
r.post('/auth/logout', (req, rsp) => { rsp.clearCookie(auth.COOKIE); if (req.user) audit(req, 'logout', 'users', req.user.id); rsp.json({ ok: true }); });
r.get('/auth/me', (req, rsp) => rsp.json({ user: req.user ? { ...req.user, role_label: ROLES[req.user.role] } : null }));
r.post('/auth/change-password', (req, rsp) => {
  if (!req.user) throw new HttpError(401, 'Non connecté.');
  auth.changePassword(req); rsp.json({ ok: true });
});
r.get('/health', (req, rsp) => rsp.json({ ok: true, app: 'MARONET 360' }));

// Tout ce qui suit exige une session valide
r.use(auth.requireAuth);

// ------------------------------------------------------------------ utilisateurs (admin)
const adminOnly = (req) => { if (req.user.role !== 'admin') throw new HttpError(403, 'Réservé à l’administrateur.'); };
function checkUserLink(role, employee_id) {
  if ((AG.includes(role) || role === 'superviseur') && !employee_id) throw new HttpError(400, 'Un employé doit être lié à ce compte (planning, pointage).');
  if (employee_id) {
    const e = db.get('SELECT activite FROM employees WHERE id = ?', employee_id);
    if (!e) throw new HttpError(400, 'Employé introuvable.');
    if (role === 'agent_securite' && e.activite !== 'securite') throw new HttpError(400, 'Cet employé n’est pas rattaché à l’activité sécurité.');
    if (role === 'agent_nettoyage' && e.activite !== 'nettoyage') throw new HttpError(400, 'Cet employé n’est pas rattaché à l’activité nettoyage.');
  }
}
r.post('/r/users', (req, rsp) => {
  adminOnly(req);
  const b = req.body || {}; const username = String(b.username || '').trim().toLowerCase();
  if (!/^[a-z0-9._-]{3,40}$/.test(username)) throw new HttpError(400, 'Identifiant : 3 à 40 caractères (lettres, chiffres, . _ -).');
  if (!ROLES[b.role]) throw new HttpError(400, 'Rôle invalide.');
  const emp = b.employee_id ? Number(b.employee_id) : null;
  checkUserLink(b.role, emp);
  if (db.get('SELECT 1 x FROM users WHERE username = ?', username)) throw new HttpError(409, 'Cet identifiant existe déjà.');
  const temp = auth.randomPassword();
  const info = db.run('INSERT INTO users(username, password_hash, role, employee_id, active, must_change) VALUES(?,?,?,?,?,1)', username, auth.bcrypt.hashSync(temp, 11), b.role, emp, b.active === 0 || b.active === false ? 0 : 1);
  audit(req, 'creation', 'users', info.lastInsertRowid, `${username} (${b.role})`);
  rsp.status(201).json({ row: { id: Number(info.lastInsertRowid), username }, temp_password: temp, warnings: [] });
});
r.put('/r/users/:id', (req, rsp) => {
  adminOnly(req);
  const id = Number(req.params.id); const u = db.get('SELECT * FROM users WHERE id = ?', id);
  if (!u) throw new HttpError(404, 'Introuvable.');
  const b = req.body || {};
  const role = b.role !== undefined ? b.role : u.role;
  const emp = b.employee_id !== undefined ? (b.employee_id ? Number(b.employee_id) : null) : u.employee_id;
  const active = b.active !== undefined ? (b.active === true || b.active === 1 || b.active === '1' ? 1 : 0) : u.active;
  if (!ROLES[role]) throw new HttpError(400, 'Rôle invalide.');
  checkUserLink(role, emp);
  if (id === req.user.id && (!active || role !== 'admin')) throw new HttpError(400, 'Vous ne pouvez pas retirer vos propres droits d’administration.');
  if (u.role === 'admin' && (!active || role !== 'admin') && db.get("SELECT COUNT(*) c FROM users WHERE role='admin' AND active=1 AND id != ?", id).c === 0) throw new HttpError(400, 'Il doit rester au moins un administrateur actif.');
  db.run('UPDATE users SET role = ?, employee_id = ?, active = ? WHERE id = ?', role, emp, active, id);
  let temp = null;
  if (b.reset_password) { temp = auth.randomPassword(); db.run('UPDATE users SET password_hash = ?, must_change = 1, failed_attempts = 0, locked_until = NULL WHERE id = ?', auth.bcrypt.hashSync(temp, 11), id); }
  if (b.username !== undefined && String(b.username).trim().toLowerCase() !== u.username) {
    const nu = String(b.username).trim().toLowerCase();
    if (!/^[a-z0-9._-]{3,40}$/.test(nu)) throw new HttpError(400, 'Identifiant invalide.');
    if (db.get('SELECT 1 x FROM users WHERE username = ? AND id != ?', nu, id)) throw new HttpError(409, 'Cet identifiant existe déjà.');
    db.run('UPDATE users SET username = ? WHERE id = ?', nu, id);
  }
  audit(req, 'modification', 'users', id, `role:${u.role}→${role} actif:${u.active}→${active}${temp ? ' mot de passe réinitialisé' : ''}`);
  rsp.json({ row: { id }, temp_password: temp, warnings: [] });
});
r.delete('/r/users/:id', (req, rsp) => {
  adminOnly(req); const id = Number(req.params.id);
  if (id === req.user.id) throw new HttpError(400, 'Vous ne pouvez pas supprimer votre propre compte.');
  const u = db.get('SELECT * FROM users WHERE id = ?', id); if (!u) throw new HttpError(404, 'Introuvable.');
  if (u.role === 'admin' && db.get("SELECT COUNT(*) c FROM users WHERE role='admin' AND active=1 AND id != ?", id).c === 0) throw new HttpError(400, 'Il doit rester au moins un administrateur actif.');
  db.run('DELETE FROM users WHERE id = ?', id); audit(req, 'suppression', 'users', id, u.username); rsp.json({ ok: true });
});

// ------------------------------------------------------------------ tableau de bord, alertes, planning
r.get('/dashboard', (req, rsp) => rsp.json(A.dashboard(req.user, req.query)));
r.get('/alerts', (req, rsp) => rsp.json({ items: A.alerts(req.user) }));
r.get('/planning', (req, rsp) => {
  if (!can(req.user, resources.shifts, 'read') || AG.includes(req.user.role)) throw new HttpError(403, 'Accès refusé.');
  const from = isDate(req.query.from) ? req.query.from : L.mondayOf(todayStr());
  const days = Math.min(Math.max(Number(req.query.days) || 7, 1), 31);
  const to = addDays(from, days - 1);
  const cv = A.coverage(req.user, from, to, req.query);
  const abs = db.all("SELECT a.employee_id, a.type, a.date_debut, a.date_fin, e.prenom || ' ' || e.nom AS emp FROM absences a JOIN employees e ON e.id = a.employee_id WHERE a.statut='validee' AND a.date_fin >= ? AND a.date_debut <= ?", from, to);
  rsp.json({ from, to, days, ...cv, absences: abs, canEdit: can(req.user, resources.shifts, 'create') });
});

// Candidats au remplacement / à l'affectation pour un poste et une date
function candidatesFor(poste, date, hd, hf, excludeShiftId) {
  const emps = db.all("SELECT id, prenom, nom, matricule, activite, qualifications FROM employees WHERE statut = 'actif' ORDER BY nom, prenom");
  const out = [];
  for (const e of emps) {
    if (e.activite !== poste.activite && e.activite !== 'administratif') continue;
    const c = hooks.checkShift({ employee_id: e.id, poste_id: poste.id, date, heure_debut: hd, heure_fin: hf }, excludeShiftId);
    if (c.blocking) continue;
    out.push({ id: e.id, label: `${e.prenom} ${e.nom} (${e.matricule || '—'})`, warnings: c.warnings });
  }
  out.sort((a, b) => a.warnings.length - b.warnings.length || a.label.localeCompare(b.label));
  return out.slice(0, 60);
}
const shiftInScope = (req, id) => {
  const s = scopeOf(resources.shifts, req.user);
  if (s === false) throw new HttpError(403, 'Accès refusé.');
  const row = db.get(`SELECT * FROM shifts t WHERE t.id = ? ${s ? 'AND (' + s.sql + ')' : ''}`, id, ...(s ? s.params : []));
  if (!row) throw new HttpError(404, 'Affectation introuvable.');
  return row;
};
r.get('/candidates', (req, rsp) => {
  if (!can(req.user, resources.shifts, 'create')) throw new HttpError(403, 'Accès refusé.');
  const p = db.get('SELECT * FROM postes WHERE id = ?', Number(req.query.poste_id));
  if (!p) throw new HttpError(404, 'Poste introuvable.');
  const sc = resources.postes.scope(req.user);
  if (sc && !db.get(`SELECT 1 x FROM postes t WHERE t.id = ? AND (${sc.sql})`, p.id, ...sc.params)) throw new HttpError(403, 'Poste hors de votre périmètre.');
  const date = isDate(req.query.date) ? req.query.date : todayStr();
  rsp.json({ candidates: candidatesFor(p, date, req.query.hd || p.heure_debut, req.query.hf || p.heure_fin, Number(req.query.exclude) || null) });
});
r.post('/shifts/:id/replace', (req, rsp) => {
  if (!can(req.user, resources.shifts, 'create')) throw new HttpError(403, 'Accès refusé.');
  const old = shiftInScope(req, Number(req.params.id));
  const empId = Number((req.body || {}).employee_id);
  if (!empId) throw new HttpError(400, 'Choisissez un remplaçant.');
  if (empId === old.employee_id) throw new HttpError(400, 'Le remplaçant doit être une autre personne.');
  const out = db.tx(() => {
    const d = { poste_id: old.poste_id, employee_id: empId, date: old.date, heure_debut: old.heure_debut, heure_fin: old.heure_fin };
    db.run("UPDATE shifts SET statut = 'remplace' WHERE id = ?", old.id); // libère le créneau avant le contrôle
    let warnings;
    try { warnings = hooks.shifts.beforeCreate(req.user, d); } catch (e) { throw e; }
    const info = db.run('INSERT INTO shifts(poste_id, employee_id, date, heure_debut, heure_fin, statut, valide, remplace_shift_id, created_by, notes) VALUES(?,?,?,?,?,?,?,?,?,?)',
      d.poste_id, d.employee_id, d.date, d.heure_debut, d.heure_fin, 'planifie', req.user.role === 'superviseur' ? 0 : 1, old.id, req.user.id, `Remplacement de l’affectation n°${old.id}`);
    const row = db.get('SELECT * FROM shifts WHERE id = ?', info.lastInsertRowid);
    hooks.shifts.afterCreate(req, row);
    notify(usersOfEmployee(old.employee_id), 'Vous avez été remplacé(e)', `${old.date} · ${old.heure_debut}-${old.heure_fin}`, '#/mon-planning');
    return { id: Number(info.lastInsertRowid), warnings };
  });
  audit(req, 'remplacement', 'shifts', old.id, `→ employé ${empId}, nouvelle affectation ${out.id}`);
  rsp.json({ ok: true, new_id: out.id, warnings: out.warnings });
});
r.post('/shifts/:id/validate', (req, rsp) => {
  if (!['dg', 'resp_sec', 'resp_net'].includes(req.user.role)) throw new HttpError(403, 'Seuls les responsables d’exploitation valident les plannings.');
  const s = shiftInScope(req, Number(req.params.id));
  db.run('UPDATE shifts SET valide = 1 WHERE id = ?', s.id); audit(req, 'validation_planning', 'shifts', s.id); rsp.json({ ok: true });
});

// ------------------------------------------------------------------ pointage
function pointageAt(req) {
  let at = new Date();
  const c = req.body && req.body.at;
  if (c) {
    const d = new Date(c);
    if (!isNaN(d) && d.getTime() <= Date.now() + 5 * 60000 && d.getTime() >= Date.now() - 48 * 3600000) at = d; // saisie hors ligne rejouée plus tard
  }
  return at;
}
r.post('/shifts/:id/checkin', (req, rsp) => {
  const id = Number(req.params.id); const u = req.user;
  const s = db.get('SELECT s.*, p.pointage_mode, p.qr_token FROM shifts s JOIN postes p ON p.id = s.poste_id WHERE s.id = ?', id);
  if (!s) throw new HttpError(404, 'Affectation introuvable.');
  let method = 'manuel';
  if (AG.includes(u.role)) {
    if (s.employee_id !== u.employee_id) throw new HttpError(403, 'Ce n’est pas votre affectation.');
    if (s.checkin_at) return rsp.json({ ok: true, already: true, checkin_at: s.checkin_at });
    if (s.pointage_mode === 'superviseur') throw new HttpError(403, 'Sur ce poste, la prise de poste est confirmée par le superviseur.');
    if (s.pointage_mode === 'qr') {
      const code = String((req.body || {}).code || '').replace(/^M360:/, '').trim();
      if (!code || code !== s.qr_token) throw new HttpError(400, 'Scannez le QR code affiché sur le poste (code invalide).');
      method = 'qr';
    }
  } else {
    shiftInScope(req, id);
    if (!can(u, resources.shifts, 'update')) throw new HttpError(403, 'Accès refusé.');
    method = 'superviseur';
  }
  if (['annule', 'absent', 'remplace'].includes(s.statut)) throw new HttpError(400, `Affectation ${s.statut}.`);
  if (s.checkin_at) return rsp.json({ ok: true, already: true, checkin_at: s.checkin_at });
  const at = pointageAt(req); const [a, b] = shiftRange(s.date, s.heure_debut, s.heure_fin); const m = Math.floor(at.getTime() / 60000);
  if (m < a - 90 || m > b + 120) throw new HttpError(400, 'Hors de la plage de service (de 1 h 30 avant à 2 h après le service).');
  const stamp = nowStr(at);
  db.run("UPDATE shifts SET checkin_at = ?, checkin_method = ?, statut = 'confirme' WHERE id = ?", stamp, method, id);
  audit(req, 'prise_de_poste', 'shifts', id, method);
  rsp.json({ ok: true, checkin_at: stamp, method });
});
r.post('/shifts/:id/checkout', (req, rsp) => {
  const id = Number(req.params.id); const u = req.user;
  const s = db.get('SELECT * FROM shifts WHERE id = ?', id);
  if (!s) throw new HttpError(404, 'Affectation introuvable.');
  if (AG.includes(u.role)) { if (s.employee_id !== u.employee_id) throw new HttpError(403, 'Ce n’est pas votre affectation.'); }
  else { shiftInScope(req, id); if (!can(u, resources.shifts, 'update')) throw new HttpError(403, 'Accès refusé.'); }
  if (!s.checkin_at) throw new HttpError(400, 'Confirmez d’abord la prise de poste.');
  if (s.checkout_at) return rsp.json({ ok: true, already: true, checkout_at: s.checkout_at });
  const at = pointageAt(req);
  if (nowStr(at) < s.checkin_at) throw new HttpError(400, 'Heure de fin antérieure à la prise de poste.');
  const stamp = nowStr(at);
  db.run("UPDATE shifts SET checkout_at = ?, statut = 'termine' WHERE id = ?", stamp, id);
  audit(req, 'fin_de_service', 'shifts', id);
  rsp.json({ ok: true, checkout_at: stamp });
});

// Accueil de l'employé : mes affectations, mes tâches
r.get('/me/home', (req, rsp) => {
  const u = req.user; const today = todayStr();
  if (!u.employee_id) return rsp.json({ linked: false });
  const shifts = db.all(`SELECT s.id, s.date, s.heure_debut, s.heure_fin, s.statut, s.checkin_at, s.checkout_at, s.valide, p.nom AS poste, p.activite, p.pointage_mode, p.consignes AS poste_consignes,
      si.id AS site_id, si.nom AS site, si.adresse AS site_adresse, si.consignes AS site_consignes, si.contact_site, cl.nom AS client
    FROM shifts s JOIN postes p ON p.id = s.poste_id JOIN sites si ON si.id = p.site_id JOIN clients cl ON cl.id = si.client_id
    WHERE s.employee_id = ? AND s.date BETWEEN ? AND ? AND s.statut NOT IN ('annule','remplace') ORDER BY s.date, s.heure_debut`, u.employee_id, addDays(today, -1), addDays(today, 14));
  const taches = db.all(`SELECT t.id, t.libelle, t.date, t.statut, t.commentaire, p.nom AS zone, si.nom AS site FROM taches t JOIN postes p ON p.id = t.poste_id JOIN sites si ON si.id = p.site_id
    WHERE t.employee_id = ? AND t.date = ? ORDER BY p.nom, t.id`, u.employee_id, today);
  const unread = db.get('SELECT COUNT(*) c FROM notifications WHERE user_id = ? AND lu = 0', u.id).c;
  const emp = db.get('SELECT id, prenom, nom, matricule FROM employees WHERE id = ?', u.employee_id);
  rsp.json({ linked: true, today, employee: emp, shifts, taches, unread });
});

// ------------------------------------------------------------------ tâches de nettoyage
r.post('/taches/generate', (req, rsp) => {
  const u = req.user;
  if (!can(u, resources.taches, 'create')) throw new HttpError(403, 'Accès refusé.');
  const date = isDate((req.body || {}).date) ? req.body.date : todayStr();
  const wd = L.isoWeekday(date);
  const sc = resources.modeles.scope(u);
  const models = db.all(`SELECT t.* FROM modeles_taches t JOIN postes p ON p.id = t.poste_id WHERE t.actif = 1 AND p.actif = 1 AND p.activite = 'nettoyage' ${sc ? 'AND (' + sc.sql + ')' : ''}`, ...(sc ? sc.params : []));
  let created = 0;
  db.tx(() => {
    for (const m of models) {
      if (!m.jours.split(',').map((x) => Number(x.trim())).includes(wd)) continue;
      if (db.get('SELECT 1 x FROM taches WHERE poste_id = ? AND libelle = ? AND date = ?', m.poste_id, m.libelle, date)) continue;
      const sh = db.get("SELECT employee_id FROM shifts WHERE poste_id = ? AND date = ? AND statut NOT IN ('annule','absent','remplace') ORDER BY heure_debut LIMIT 1", m.poste_id, date);
      db.run('INSERT INTO taches(poste_id, employee_id, libelle, date) VALUES(?,?,?,?)', m.poste_id, sh ? sh.employee_id : null, m.libelle, date); created++;
    }
  });
  audit(req, 'generation_taches', 'taches', null, `${date} : ${created}`);
  rsp.json({ created, date });
});
r.post('/taches/:id/done', (req, rsp) => {
  const u = req.user; const id = Number(req.params.id);
  const t = db.get('SELECT * FROM taches WHERE id = ?', id); if (!t) throw new HttpError(404, 'Tâche introuvable.');
  if (u.role === 'agent_nettoyage') { if (t.employee_id !== u.employee_id) throw new HttpError(403, 'Cette tâche ne vous est pas attribuée.'); }
  else {
    if (!can(u, resources.taches, 'update')) throw new HttpError(403, 'Accès refusé.');
    const sc = scopeOf(resources.taches, u);
    if (sc && !db.get(`SELECT 1 x FROM taches t WHERE t.id = ? AND (${sc.sql})`, id, ...sc.params)) throw new HttpError(404, 'Tâche introuvable.');
  }
  const statut = (req.body || {}).statut;
  if (!['fait', 'anomalie', 'a_faire'].includes(statut)) throw new HttpError(400, 'Statut invalide.');
  const com = ((req.body || {}).commentaire || '').toString().slice(0, 1000) || t.commentaire;
  if (statut === 'anomalie' && !com) throw new HttpError(400, 'Décrivez l’anomalie.');
  const at = pointageAt(req);
  db.run('UPDATE taches SET statut = ?, commentaire = ?, done_at = ?, valide = 0, valide_par = NULL WHERE id = ?', statut, com, statut === 'a_faire' ? null : nowStr(at), id);
  if (statut === 'anomalie') {
    const si = db.get('SELECT p.site_id, s.superviseur_id FROM postes p JOIN sites s ON s.id = p.site_id WHERE p.id = ?', t.poste_id);
    if (si && si.superviseur_id) notify(usersOfEmployee(si.superviseur_id), 'Anomalie signalée', `${t.libelle} : ${com}`.slice(0, 160), '#/taches');
  }
  rsp.json({ ok: true });
});
r.post('/taches/:id/validate', (req, rsp) => {
  const u = req.user; if (!['dg', 'resp_net', 'superviseur'].includes(u.role)) throw new HttpError(403, 'Accès refusé.');
  const id = Number(req.params.id); const sc = scopeOf(resources.taches, u);
  if (!db.get(`SELECT 1 x FROM taches t WHERE t.id = ? ${sc ? 'AND (' + sc.sql + ')' : ''}`, id, ...(sc ? sc.params : []))) throw new HttpError(404, 'Tâche introuvable.');
  db.run('UPDATE taches SET valide = 1, valide_par = ? WHERE id = ?', u.username, id); audit(req, 'validation_tache', 'taches', id); rsp.json({ ok: true });
});

// ------------------------------------------------------------------ stock
r.post('/stock/move', (req, rsp) => {
  const u = req.user; if (!can(u, resources.consommables, 'update')) throw new HttpError(403, 'Accès refusé.');
  const b = req.body || {}; const cid = Number(b.consommable_id); const q = Number(b.quantite);
  if (!Number.isFinite(q) || q === 0) throw new HttpError(400, 'Quantité invalide (positive = entrée, négative = sortie).');
  const c = db.get('SELECT * FROM consommables WHERE id = ?', cid); if (!c) throw new HttpError(404, 'Article introuvable.');
  if (c.stock + q < 0) throw new HttpError(409, `Stock insuffisant (disponible : ${c.stock}).`);
  const date = isDate(b.date) ? b.date : todayStr();
  const site = b.site_id ? Number(b.site_id) : null, contrat = b.contrat_id ? Number(b.contrat_id) : null;
  if (site && !db.get('SELECT 1 x FROM sites WHERE id = ?', site)) throw new HttpError(400, 'Site introuvable.');
  if (contrat && !db.get('SELECT 1 x FROM contrats WHERE id = ?', contrat)) throw new HttpError(400, 'Contrat introuvable.');
  db.tx(() => {
    db.run('UPDATE consommables SET stock = stock + ? WHERE id = ?', q, cid);
    db.run('INSERT INTO mouvements_stock(consommable_id, quantite, motif, site_id, contrat_id, date, user_id) VALUES(?,?,?,?,?,?,?)', cid, q, String(b.motif || '').slice(0, 200) || null, site, contrat, date, u.id);
  });
  audit(req, 'mouvement_stock', 'consommables', cid, `${q > 0 ? '+' : ''}${q}`);
  rsp.json({ ok: true, stock: c.stock + q });
});
r.get('/stock/movements/:id', (req, rsp) => {
  if (!can(req.user, resources.consommables, 'read')) throw new HttpError(403, 'Accès refusé.');
  rsp.json({ rows: db.all(`SELECT m.*, s.nom AS site, c.reference AS contrat, u.username FROM mouvements_stock m LEFT JOIN sites s ON s.id = m.site_id LEFT JOIN contrats c ON c.id = m.contrat_id LEFT JOIN users u ON u.id = m.user_id
    WHERE m.consommable_id = ? ORDER BY m.id DESC LIMIT 100`, Number(req.params.id)) });
});

// ------------------------------------------------------------------ finance
const finOnly = (req, roles) => { if (!roles.includes(req.user.role)) throw new HttpError(403, 'Accès refusé pour votre profil.'); };
r.get('/profitability', (req, rsp) => {
  finOnly(req, ['dg', 'comptable', 'auditeur']);
  const m = /^\d{4}-\d{2}$/.test(req.query.month || '') ? req.query.month : null;
  const from = isDate(req.query.from) ? req.query.from : (m ? A.monthRange(m).from : todayStr().slice(0, 7) + '-01');
  const to = isDate(req.query.to) ? req.query.to : (m ? A.monthRange(m).to : A.monthRange(todayStr().slice(0, 7)).to);
  const pf = A.profitability(req.user, from, to);
  if (req.query.format === 'csv') {
    const head = ['Contrat', 'Client', 'Site', 'Prestation', 'Revenus HT', 'Coût personnel', 'Coût consommables', 'Autres dépenses', 'Coûts directs', 'Marge estimée', 'Taux de marge %', 'Heures'];
    const csv = '﻿' + [head.join(';'), ...pf.rows.map((c) => [c.reference, c.client, c.site || '', c.activite, c.revenus, c.cout_personnel, c.cout_consommables, c.cout_depenses, c.couts_directs, c.marge, c.taux_marge ?? '', c.heures].map((x) => `"${String(x).replace(/"/g, '""').replace('.', ',')}"`).join(';'))].join('\r\n');
    audit(req, 'export_csv', 'rentabilite', null, `${from}→${to}`);
    return rsp.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="maronet360_rentabilite_${from}_${to}.csv"` }).send(csv);
  }
  rsp.json(pf);
});
r.get('/recap', (req, rsp) => {
  finOnly(req, ['dg', 'rh', 'comptable']);
  const month = /^\d{4}-\d{2}$/.test(req.query.month || '') ? req.query.month : todayStr().slice(0, 7);
  const data = A.recap(month);
  if (req.query.format === 'csv') {
    const head = ['Matricule', 'Employé', 'Activité', 'Heures planifiées', 'Heures réalisées', 'Jours congé', 'Jours maladie', 'Jours absence', 'Jours formation', 'Semaines à vérifier (heures)', 'Heures par site'];
    const csv = '﻿' + [head.join(';'), ...data.rows.map((x) => [x.matricule, x.nom, x.activite, x.h_planifiees, x.h_realisees, x.jours_conge, x.jours_maladie, x.jours_absence, x.jours_formation, x.semaines_a_verifier, x.sites].map((v) => `"${String(v ?? '').replace(/"/g, '""').replace(/^[=+\-@]/, "'$&")}"`).join(';'))].join('\r\n');
    audit(req, 'export_csv', 'recap', null, month);
    return rsp.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="maronet360_elements_paie_${month}.csv"` }).send(csv);
  }
  rsp.json(data);
});

// ------------------------------------------------------------------ fiches consolidées
function maybe(key, user, opts) { return can(user, resources[key], 'read') ? fetchRows(key, user, opts) : null; }
r.get('/employee360/:id', (req, rsp) => {
  const id = Number(req.params.id); const u = req.user;
  const e = fetchRows('employees', u, { where: ['t.id = ?'], params: [id], limit: 1 });
  if (!e.rows.length) throw new HttpError(404, 'Employé introuvable.');
  const raw = db.get('SELECT * FROM employees WHERE id = ?', id);
  const today = todayStr();
  rsp.json({
    employee: e.rows[0], refs: e.refs,
    missing: ['dg', 'rh', 'adm', 'auditeur', ...AG].includes(u.role) ? missingForEmployee(raw) : null,
    documents: maybe('documents', u, { where: ['t.employee_id = ?'], params: [id] }),
    formations: maybe('formations', u, { where: ['t.employee_id = ?'], params: [id] }),
    absences: maybe('absences', u, { where: ['t.employee_id = ?'], params: [id], limit: 30 }),
    shifts: maybe('shifts', u, { where: ['t.employee_id = ?', 't.date >= ?'], params: [id, addDays(today, -30)], limit: 60, order: 't.date DESC' }),
    equipements: maybe('equipements', u, { where: ['t.employee_id = ?'], params: [id] }),
  });
});
r.get('/client360/:id', (req, rsp) => {
  const id = Number(req.params.id); const u = req.user;
  const c = fetchRows('clients', u, { where: ['t.id = ?'], params: [id], limit: 1 });
  if (!c.rows.length) throw new HttpError(404, 'Client introuvable.');
  const fac = can(u, resources.factures, 'read') ? fetchRows('factures', u, { where: ['t.contrat_id IN (SELECT id FROM contrats WHERE client_id = ?)'], params: [id], limit: 50 }) : null;
  rsp.json({
    client: c.rows[0],
    sites: maybe('sites', u, { where: ['t.client_id = ?'], params: [id] }),
    contrats: maybe('contrats', u, { where: ['t.client_id = ?'], params: [id] }),
    incidents: maybe('incidents', u, { where: ['t.site_id IN (SELECT id FROM sites WHERE client_id = ?)', "t.statut IN ('ouvert','en_cours')"], params: [id], limit: 30 }),
    controles: maybe('controles', u, { where: ['t.site_id IN (SELECT id FROM sites WHERE client_id = ?)'], params: [id], limit: 10 }),
    documents: maybe('documents', u, { where: ['t.client_id = ?'], params: [id] }),
    factures: fac, impayes: fac ? Math.round(fac.rows.reduce((a, f) => a + (f.etat === 'en_retard' ? f.reste : 0), 0) * 100) / 100 : null,
  });
});

// ------------------------------------------------------------------ notifications
r.get('/notifications', (req, rsp) => {
  const rows = db.all('SELECT id, titre, corps, lien, lu, created_at FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 40', req.user.id);
  rsp.json({ rows, unread: db.get('SELECT COUNT(*) c FROM notifications WHERE user_id = ? AND lu = 0', req.user.id).c });
});
r.post('/notifications/read', (req, rsp) => {
  const id = (req.body || {}).id;
  if (id) db.run('UPDATE notifications SET lu = 1 WHERE id = ? AND user_id = ?', Number(id), req.user.id);
  else db.run('UPDATE notifications SET lu = 1 WHERE user_id = ?', req.user.id);
  rsp.json({ ok: true });
});

// ------------------------------------------------------------------ paramètres
const SETTING_RULES = { societe: (v) => String(v).slice(0, 80), seuil_heures_hebdo: (v) => { const n = Number(v); if (!(n > 0 && n <= 120)) throw new HttpError(400, 'Seuil hebdomadaire invalide.'); return String(n); },
  repos_min_heures: (v) => { const n = Number(v); if (!(n >= 0 && n <= 48)) throw new HttpError(400, 'Repos minimal invalide.'); return String(n); },
  retard_pointage_minutes: (v) => { const n = Number(v); if (!(n >= 0 && n <= 240)) throw new HttpError(400, 'Délai invalide.'); return String(n); },
  tva_defaut: (v) => { const n = Number(v); if (!(n >= 0 && n <= 100)) throw new HttpError(400, 'TVA invalide.'); return String(n); } };
r.get('/settings', (req, rsp) => {
  if (!['admin', 'dg'].includes(req.user.role)) throw new HttpError(403, 'Accès refusé.');
  rsp.json(Object.fromEntries(Object.keys(SETTING_RULES).map((k) => [k, db.getSetting(k)])));
});
r.put('/settings', (req, rsp) => {
  if (!['admin', 'dg'].includes(req.user.role)) throw new HttpError(403, 'Accès refusé.');
  for (const [k, v] of Object.entries(req.body || {})) if (SETTING_RULES[k]) db.run('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', k, SETTING_RULES[k](v));
  audit(req, 'modification', 'settings', null, Object.keys(req.body || {}).join(', ')); rsp.json({ ok: true });
});

// ------------------------------------------------------------------ fichiers
const MAGIC = { pdf: [0x25, 0x50, 0x44, 0x46], png: [0x89, 0x50, 0x4e, 0x47], jpg: [0xff, 0xd8, 0xff], jpeg: [0xff, 0xd8, 0xff], webp: [0x52, 0x49, 0x46, 0x46], docx: [0x50, 0x4b], xlsx: [0x50, 0x4b], doc: [0xd0, 0xcf, 0x11, 0xe0], xls: [0xd0, 0xcf, 0x11, 0xe0], txt: null };
const upload = multer({
  storage: multer.diskStorage({ destination: UP_DIR, filename: (q, f, cb) => cb(null, crypto.randomBytes(14).toString('hex') + '.' + path.extname(f.originalname).slice(1).toLowerCase()) }),
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
  fileFilter: (q, f, cb) => { const ext = path.extname(f.originalname).slice(1).toLowerCase(); cb(Object.prototype.hasOwnProperty.call(MAGIC, ext) ? null : new HttpError(400, 'Type de fichier non autorisé (PDF, images, Word, Excel, texte).'), Object.prototype.hasOwnProperty.call(MAGIC, ext)); },
});
r.post('/upload', (req, rsp, next) => {
  if (req.user.role === 'auditeur') return next(new HttpError(403, 'Accès refusé.'));
  upload.single('file')(req, rsp, (err) => {
    if (err) return next(err instanceof HttpError ? err : new HttpError(400, err.code === 'LIMIT_FILE_SIZE' ? 'Fichier trop volumineux (10 Mo maximum).' : 'Envoi impossible.'));
    if (!req.file) return next(new HttpError(400, 'Aucun fichier reçu.'));
    const ext = path.extname(req.file.filename).slice(1); const sig = MAGIC[ext];
    if (sig) { const fd = fs.openSync(req.file.path, 'r'); const buf = Buffer.alloc(sig.length); fs.readSync(fd, buf, 0, sig.length, 0); fs.closeSync(fd); if (!sig.every((b, i) => buf[i] === b)) { fs.unlinkSync(req.file.path); return next(new HttpError(400, 'Le contenu du fichier ne correspond pas à son extension.')); } }
    const safeName = req.file.originalname.replace(/[^\w.\- àâäéèêëîïôöùûüç]/gi, '_').slice(0, 120);
    audit(req, 'upload', 'fichiers', null, safeName);
    rsp.json({ value: `${req.file.filename}::${safeName}`, name: safeName });
  });
});
const FILE_COLS = [['documents', 'fichier'], ['absences', 'justificatif'], ['incidents', 'photo'], ['depenses', 'justificatif']];
r.get('/files/:name', (req, rsp) => {
  const name = req.params.name;
  if (!/^[a-f0-9]{24,}\.[a-z0-9]{2,5}$/.test(name)) throw new HttpError(404, 'Fichier introuvable.');
  let ok = false;
  for (const [key, col] of FILE_COLS) {
    const res = resources[key]; const s = scopeOf(res, req.user); if (s === false) continue;
    const f = res.fields.find((x) => x.n === col); if (f && f.fr && !f.fr.includes(req.user.role)) continue;
    if (db.get(`SELECT 1 x FROM ${res.table} t WHERE t.${col} LIKE ? ${s ? 'AND (' + s.sql + ')' : ''}`, name + '%', ...(s ? s.params : []))) { ok = true; break; }
  }
  if (!ok) throw new HttpError(404, 'Fichier introuvable.');
  const file = path.join(UP_DIR, name); if (!fs.existsSync(file)) throw new HttpError(404, 'Fichier introuvable.');
  audit(req, 'consultation_fichier', 'fichiers', null, name);
  const inline = /\.(png|jpe?g|webp|pdf)$/.test(name) && req.query.dl !== '1';
  rsp.set('Content-Disposition', inline ? 'inline' : 'attachment').set('Cache-Control', 'private, no-store').sendFile(file);
});

// ------------------------------------------------------------------ QR code des postes
r.get('/postes/:id/qr.png', async (req, rsp, next) => {
  try {
    if (!['dg', 'resp_sec', 'resp_net', 'superviseur'].includes(req.user.role)) throw new HttpError(403, 'Accès refusé.');
    const sc = scopeOf(resources.postes, req.user);
    const p = db.get(`SELECT t.* FROM postes t WHERE t.id = ? ${sc ? 'AND (' + sc.sql + ')' : ''}`, Number(req.params.id), ...(sc ? sc.params : []));
    if (!p) throw new HttpError(404, 'Poste introuvable.');
    const png = await QRCode.toBuffer('M360:' + p.qr_token, { width: 480, margin: 2, errorCorrectionLevel: 'M' });
    rsp.set('Content-Type', 'image/png').set('Cache-Control', 'private, no-store').send(png);
  } catch (e) { next(e); }
});
r.post('/postes/:id/qr-reset', (req, rsp) => {
  if (!['dg', 'resp_sec', 'resp_net'].includes(req.user.role)) throw new HttpError(403, 'Accès refusé.');
  const sc = scopeOf(resources.postes, req.user);
  const p = db.get(`SELECT t.id FROM postes t WHERE t.id = ? ${sc ? 'AND (' + sc.sql + ')' : ''}`, Number(req.params.id), ...(sc ? sc.params : []));
  if (!p) throw new HttpError(404, 'Poste introuvable.');
  db.run('UPDATE postes SET qr_token = ? WHERE id = ?', crypto.randomBytes(8).toString('hex'), p.id); audit(req, 'qr_renouvele', 'postes', p.id); rsp.json({ ok: true });
});

// ------------------------------------------------------------------ sauvegarde
function backupTo(file) { db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`); }
r.get('/admin/backup', (req, rsp) => {
  adminOnly(req);
  const dir = path.join(db.DATA_DIR, 'backups'); fs.mkdirSync(dir, { recursive: true });
  const f = path.join(dir, `manuel_${Date.now()}.db`); backupTo(f);
  audit(req, 'sauvegarde_telechargee', 'admin');
  rsp.download(f, `maronet360_sauvegarde_${todayStr()}.db`, () => fs.unlink(f, () => {}));
});

module.exports = { router: r, backupTo };

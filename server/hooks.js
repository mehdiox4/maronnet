'use strict';
// Règles de gestion propres à chaque ressource (avant / après écriture).
const crypto = require('crypto');
const db = require('./db');
const { resources, AG, RES, actOf, me } = require('./schema');
const L = require('./lib');
const { HttpError, todayStr, addDays, shiftRange, shiftHours, mondayOf, notify, usersOfEmployee, usersOfRoles } = L;

const hooks = {};

// ----------------------------------------------------------------- employés
hooks.employees = {
  beforeCreate(u, d) {
    const n = (db.get("SELECT COALESCE(MAX(CAST(SUBSTR(matricule, 5) AS INTEGER)), 0) m FROM employees WHERE matricule LIKE 'MAR-%'").m || 0) + 1;
    d.matricule = 'MAR-' + String(n).padStart(4, '0');
  },
  beforeUpdate(u, d, old) {
    if (d.responsable_id && Number(d.responsable_id) === old.id) throw new HttpError(400, 'Un employé ne peut pas être son propre responsable.');
  },
  afterUpdate(req, row, old) {
    // Révocation automatique des accès lorsque l'employé sort de l'entreprise
    if (row.statut === 'sorti' && old.statut !== 'sorti') {
      const r = db.run('UPDATE users SET active = 0 WHERE employee_id = ? AND active = 1', row.id);
      L.audit(req, 'revocation_acces', 'employees', row.id, `${r.changes} compte(s) désactivé(s)`);
      const eq = db.all("SELECT libelle FROM equipements WHERE employee_id = ? AND statut = 'attribue'", row.id);
      if (eq.length) notify(usersOfRoles(['rh', 'adm']), 'Matériel à restituer', `${row.prenom} ${row.nom} est sorti : ${eq.map((e) => e.libelle).join(', ')}`, '#/equipements');
    }
  },
};

// ----------------------------------------------------------------- absences
hooks.absences = {
  beforeCreate(u, d) {
    if (AG.includes(u.role)) { if (!u.employee_id) throw new HttpError(400, 'Votre compte n’est lié à aucun employé.'); d.employee_id = u.employee_id; d.statut = 'demande'; }
    if (d.date_fin < d.date_debut) throw new HttpError(400, 'La date de fin précède la date de début.');
  },
  beforeUpdate(u, d, old) {
    const s = d.date_debut || old.date_debut, e = d.date_fin || old.date_fin;
    if (e < s) throw new HttpError(400, 'La date de fin précède la date de début.');
  },
  afterCreate(req, row) {
    if (row.statut === 'demande') notify(usersOfRoles(['rh', 'adm']), 'Nouvelle demande d’absence', `${row.type} du ${row.date_debut} au ${row.date_fin}`, '#/absences');
  },
  afterUpdate(req, row, old) {
    if (row.statut !== old.statut && ['validee', 'refusee'].includes(row.statut)) {
      notify(usersOfEmployee(row.employee_id), `Demande d’absence ${row.statut === 'validee' ? 'validée' : 'refusée'}`, `${row.date_debut} → ${row.date_fin}`, '#/absences');
    }
  },
};

// ----------------------------------------------------------------- documents
hooks.documents = {
  beforeCreate(u, d) {
    if (!d.employee_id && !d.client_id && !(d.categorie && /assurance|cnss|autre/i.test(d.categorie))) throw new HttpError(400, 'Rattachez le document à un employé ou à un client.');
    if (u.role === 'commercial' && !d.client_id) throw new HttpError(403, 'Vous ne pouvez gérer que les documents clients.');
    if (!d.date_creation) d.date_creation = todayStr();
  },
  beforeUpdate(u, d, old) {
    if (u.role === 'commercial' && !old.client_id) throw new HttpError(403, 'Vous ne pouvez gérer que les documents clients.');
    if (d.statut_verif && d.statut_verif !== old.statut_verif) d.valide_par = ['verifie', 'refuse'].includes(d.statut_verif) ? `${u.username} le ${todayStr()}` : null;
  },
};

// ----------------------------------------------------------------- sites / contrats
hooks.contrats = {
  beforeCreate(u, d) { if (d.date_debut && d.date_fin && d.date_fin < d.date_debut) throw new HttpError(400, 'La date de fin précède la date de début.'); },
  beforeUpdate(u, d, old) { const s = d.date_debut || old.date_debut, e = d.date_fin || old.date_fin; if (s && e && e < s) throw new HttpError(400, 'La date de fin précède la date de début.'); },
};

// ----------------------------------------------------------------- postes
hooks.postes = {
  beforeCreate(u, d) { d.qr_token = crypto.randomBytes(8).toString('hex'); if (d.effectif_requis < 1) throw new HttpError(400, 'L’effectif requis doit être au moins 1.'); },
  beforeUpdate(u, d, old) {
    if (RES.includes(u.role) && d.activite && d.activite !== actOf(u.role)) throw new HttpError(403, 'Activité non autorisée pour votre profil.');
    if (d.effectif_requis !== undefined && d.effectif_requis < 1) throw new HttpError(400, 'L’effectif requis doit être au moins 1.');
  },
};

// ----------------------------------------------------------------- incidents
hooks.incidents = {
  beforeCreate(u, d) {
    if (AG.includes(u.role) || u.employee_id) d.employee_id = u.employee_id || null;
    if (AG.includes(u.role)) {
      if (!d.site_id) throw new HttpError(400, 'Indiquez le site concerné.');
      const ok = db.get('SELECT 1 x FROM shifts s JOIN postes p ON p.id = s.poste_id WHERE s.employee_id = ? AND p.site_id = ? LIMIT 1', me(u), d.site_id);
      if (!ok) throw new HttpError(403, 'Ce site ne figure pas dans vos affectations.');
    }
    if (d.poste_id && !d.site_id) { const p = db.get('SELECT site_id FROM postes WHERE id = ?', d.poste_id); if (p) d.site_id = p.site_id; }
  },
  beforeUpdate(u, d, old) {
    if (d.statut && ['resolu', 'clos'].includes(d.statut) && !old.resolved_at) d.resolved_at = L.nowStr();
    if (d.statut && ['ouvert', 'en_cours'].includes(d.statut)) d.resolved_at = null;
  },
  afterCreate(req, row) {
    const targets = [];
    if (row.site_id) { const s = db.get('SELECT superviseur_id FROM sites WHERE id = ?', row.site_id); if (s && s.superviseur_id) targets.push(...usersOfEmployee(s.superviseur_id)); }
    if (['elevee', 'critique'].includes(row.priorite)) targets.push(...usersOfRoles(['dg', 'resp_sec', 'resp_net']));
    notify(targets.filter((id) => id !== req.user.id), `${row.priorite === 'critique' ? '🚨 ' : ''}Incident ${row.priorite} : ${row.titre}`, row.description ? row.description.slice(0, 140) : null, '#/incidents');
  },
};

// ----------------------------------------------------------------- tâches
hooks.taches = {
  beforeUpdate(u, d, old) {
    if (d.statut && d.statut !== old.statut) d.done_at = d.statut === 'a_faire' ? null : L.nowStr();
    if (d.valide !== undefined && !Number(d.valide) !== !old.valide) d.valide_par = Number(d.valide) ? u.username : null;
  },
};

// ----------------------------------------------------------------- factures / paiements
function recalcFacture(id) {
  const f = db.get('SELECT * FROM factures WHERE id = ?', id);
  if (!f || f.type !== 'facture' || ['brouillon', 'annulee'].includes(f.statut)) return;
  const ttc = f.montant_ht * (1 + (f.tva_taux || 0) / 100);
  const paye = db.get('SELECT COALESCE(SUM(montant),0) s FROM paiements WHERE facture_id = ?', id).s;
  let st = f.statut;
  if (paye >= ttc - 0.005) st = 'payee';
  else if (f.statut === 'payee') st = 'emise';
  if (st !== f.statut) db.run('UPDATE factures SET statut = ? WHERE id = ?', st, id);
}
hooks.paiements = {
  beforeCreate(u, d) {
    const f = db.get('SELECT * FROM factures WHERE id = ?', d.facture_id);
    if (!f) throw new HttpError(400, 'Facture introuvable.');
    if (f.type !== 'facture') throw new HttpError(400, 'Un paiement ne peut être rattaché qu’à une facture.');
    if (['brouillon', 'annulee'].includes(f.statut)) throw new HttpError(400, 'La facture doit être émise avant d’enregistrer un paiement.');
    if (d.montant <= 0) throw new HttpError(400, 'Le montant doit être positif.');
  },
  afterCreate(req, row) { recalcFacture(row.facture_id); },
  afterUpdate(req, row) { recalcFacture(row.facture_id); },
  afterDelete(req, row) { recalcFacture(row.facture_id); },
};
hooks.factures = {
  beforeCreate(u, d) { if (!d.tva_taux && d.tva_taux !== 0) d.tva_taux = Number(db.getSetting('tva_defaut') || 20); },
  afterUpdate(req, row) { recalcFacture(row.id); },
};

// ----------------------------------------------------------------- affectations (planning)
function employeeShiftsAround(empId, date, excludeId) {
  return db.all(
    `SELECT s.* FROM shifts s WHERE s.employee_id = ? AND s.date BETWEEN ? AND ? AND s.statut NOT IN ('annule','absent','remplace') ${excludeId ? 'AND s.id != ?' : ''}`,
    ...[empId, addDays(date, -1), addDays(date, 1), ...(excludeId ? [excludeId] : [])]);
}
// Retourne { blocking: msg|null, warnings: [] }
function checkShift({ employee_id, poste_id, date, heure_debut, heure_fin }, excludeId) {
  const warnings = [];
  const emp = db.get('SELECT * FROM employees WHERE id = ?', employee_id);
  const poste = db.get('SELECT * FROM postes WHERE id = ?', poste_id);
  if (!emp) return { blocking: 'Employé introuvable.', warnings };
  if (!poste) return { blocking: 'Poste introuvable.', warnings };
  if (emp.statut !== 'actif') return { blocking: `${emp.prenom} ${emp.nom} n’est pas actif (statut : ${emp.statut}).`, warnings };
  if (emp.date_fin && date > emp.date_fin) return { blocking: `Le contrat de ${emp.prenom} ${emp.nom} se termine le ${emp.date_fin}.`, warnings };
  const abs = db.get("SELECT * FROM absences WHERE employee_id = ? AND statut = 'validee' AND ? BETWEEN date_debut AND date_fin", employee_id, date);
  if (abs) return { blocking: `${emp.prenom} ${emp.nom} est en absence validée (${abs.type}) du ${abs.date_debut} au ${abs.date_fin}.`, warnings };
  const [s, e] = shiftRange(date, heure_debut, heure_fin);
  const others = employeeShiftsAround(employee_id, date, excludeId);
  for (const o of others) {
    const [os, oe] = shiftRange(o.date, o.heure_debut, o.heure_fin);
    if (s < oe && os < e) return { blocking: `Conflit d’horaires : ${emp.prenom} ${emp.nom} est déjà affecté(e) le ${o.date} de ${o.heure_debut} à ${o.heure_fin}.`, warnings };
  }
  const minRest = Number(db.getSetting('repos_min_heures') || 11);
  for (const o of others) {
    const [os, oe] = shiftRange(o.date, o.heure_debut, o.heure_fin);
    const gap = os >= e ? (os - e) / 60 : (s - oe) / 60;
    if (gap >= 0 && gap < minRest) { warnings.push(`Repos de ${gap.toFixed(1)} h seulement avec l’affectation du ${o.date} (seuil paramétré : ${minRest} h — à valider selon la réglementation).`); break; }
  }
  const mon = mondayOf(date);
  const week = db.all("SELECT * FROM shifts WHERE employee_id = ? AND date BETWEEN ? AND ? AND statut NOT IN ('annule','absent','remplace')" + (excludeId ? ' AND id != ?' : ''), ...[employee_id, mon, addDays(mon, 6), ...(excludeId ? [excludeId] : [])]);
  const total = week.reduce((a, o) => a + shiftHours(o.date, o.heure_debut, o.heure_fin), 0) + shiftHours(date, heure_debut, heure_fin);
  const maxH = Number(db.getSetting('seuil_heures_hebdo') || 44);
  if (total > maxH) warnings.push(`Total hebdomadaire de ${total.toFixed(1)} h (seuil paramétré : ${maxH} h — à valider selon la réglementation).`);
  if (poste.qualification_requise) {
    const quals = (emp.qualifications || '').toLowerCase().split(',').map((x) => x.trim());
    const need = poste.qualification_requise.toLowerCase().split(',').map((x) => x.trim()).filter(Boolean);
    const miss = need.filter((n) => !quals.includes(n));
    if (miss.length) warnings.push(`Qualification manquante : ${miss.join(', ')}.`);
    // qualification expirée ?
    const ex = db.all("SELECT intitule FROM formations WHERE employee_id = ? AND date_expiration IS NOT NULL AND date_expiration < ?", employee_id, date);
    const expired = ex.filter((x) => need.some((n) => x.intitule.toLowerCase().includes(n)));
    if (expired.length) warnings.push(`Formation expirée à cette date : ${expired.map((x) => x.intitule).join(', ')}.`);
  }
  if (poste.activite !== emp.activite && emp.activite !== 'administratif') warnings.push(`L’employé relève de l’activité « ${emp.activite} » alors que le poste relève de « ${poste.activite} ».`);
  return { blocking: null, warnings };
}
hooks.shifts = {
  checkShift,
  beforeCreate(u, d) {
    if (d.heure_fin === d.heure_debut) throw new HttpError(400, 'L’heure de fin doit différer de l’heure de début.');
    const res = resources.shifts;
    const p = db.get('SELECT * FROM postes WHERE id = ?', d.poste_id);
    if (!p || !p.actif) throw new HttpError(400, 'Poste introuvable ou inactif.');
    // Le poste doit appartenir au périmètre de l'utilisateur
    const pr = resources.postes; const sc = pr.scope(u);
    if (sc) { const ok = db.get(`SELECT 1 x FROM postes t WHERE t.id = ? AND (${sc.sql})`, d.poste_id, ...sc.params); if (!ok) throw new HttpError(403, 'Ce poste n’est pas dans votre périmètre.'); }
    const c = checkShift(d);
    if (c.blocking) throw new HttpError(409, c.blocking);
    if (u.role === 'superviseur') d.valide = 0; // proposition à valider par le responsable d'exploitation
    d.created_by = u.id;
    return c.warnings;
  },
  beforeUpdate(u, d, old) {
    const merged = { employee_id: old.employee_id, poste_id: old.poste_id, date: old.date, heure_debut: old.heure_debut, heure_fin: old.heure_fin, ...d };
    if (merged.poste_id !== old.poste_id) {
      const sc = resources.postes.scope(u);
      if (sc) { const ok = db.get(`SELECT 1 x FROM postes t WHERE t.id = ? AND (${sc.sql})`, merged.poste_id, ...sc.params); if (!ok) throw new HttpError(403, 'Ce poste n’est pas dans votre périmètre.'); }
    }
    const touches = ['employee_id', 'poste_id', 'date', 'heure_debut', 'heure_fin'].some((k) => d[k] !== undefined && String(d[k]) !== String(old[k]));
    if (touches && !['annule', 'absent', 'remplace'].includes(d.statut || old.statut)) {
      const c = checkShift(merged, old.id);
      if (c.blocking) throw new HttpError(409, c.blocking);
      if (u.role === 'superviseur') d.valide = 0;
      return c.warnings;
    }
    if (u.role === 'superviseur' && d.valide !== undefined) delete d.valide;
  },
  afterCreate(req, row) {
    const p = db.get("SELECT p.nom, s.nom site FROM postes p JOIN sites s ON s.id = p.site_id WHERE p.id = ?", row.poste_id);
    notify(usersOfEmployee(row.employee_id), 'Nouvelle affectation', `${row.date} · ${row.heure_debut}-${row.heure_fin} · ${p ? p.nom + ' (' + p.site + ')' : ''}`, '#/mon-planning');
  },
  afterUpdate(req, row, old) {
    const changed = ['employee_id', 'poste_id', 'date', 'heure_debut', 'heure_fin', 'statut'].some((k) => String(row[k]) !== String(old[k]));
    if (changed) {
      if (row.employee_id !== old.employee_id) notify(usersOfEmployee(old.employee_id), 'Affectation retirée', `${old.date} · ${old.heure_debut}-${old.heure_fin}`, '#/mon-planning');
      notify(usersOfEmployee(row.employee_id), row.statut === 'annule' ? 'Affectation annulée' : 'Planning modifié', `${row.date} · ${row.heure_debut}-${row.heure_fin}`, '#/mon-planning');
    }
  },
  afterDelete(req, row) { notify(usersOfEmployee(row.employee_id), 'Affectation supprimée', `${row.date} · ${row.heure_debut}-${row.heure_fin}`, '#/mon-planning'); },
};

module.exports = hooks;
module.exports.checkShift = checkShift;

'use strict';
// Tableau de bord, alertes, couverture des postes, rentabilité, récapitulatif mensuel.
const db = require('./db');
const { resources, AG } = require('./schema');
const L = require('./lib');
const { can, scopeOf, todayStr, addDays, daysBetween, isoWeekday, shiftHours, mondayOf } = L;

// Fragment SQL de périmètre pour une ressource ; { ok:false } si lecture interdite
function sc(key, user) {
  const r = resources[key];
  const s = scopeOf(r, user);
  if (s === false) return { ok: false, cond: '1=0', params: [] };
  return { ok: true, cond: s ? `(${s.sql})` : '1=1', params: s ? s.params : [] };
}
const monthRange = (m) => {
  const [y, mo] = m.split('-').map(Number);
  const from = `${m}-01`; const last = new Date(y, mo, 0).getDate();
  return { from, to: `${m}-${String(last).padStart(2, '0')}` };
};
const COUNTED = "('annule','absent','remplace')";

// ------------------------------------------------------------- couverture des postes
function coverage(user, from, to, filt = {}) {
  const P = sc('postes', user), S = sc('shifts', user);
  if (!P.ok) return { postes: [], shifts: [], cells: [] };
  const where = ['t.actif = 1', P.cond]; const params = [...P.params];
  if (filt.activite) { where.push('t.activite = ?'); params.push(filt.activite); }
  if (filt.site_id) { where.push('t.site_id = ?'); params.push(Number(filt.site_id)); }
  const postes = db.all(`SELECT t.id, t.nom, t.site_id, t.activite, t.effectif_requis, t.heure_debut, t.heure_fin, t.jours, t.qualification_requise, t.pointage_mode,
      s.nom AS site, c.nom AS client FROM postes t JOIN sites s ON s.id = t.site_id JOIN clients c ON c.id = s.client_id WHERE ${where.join(' AND ')} ORDER BY c.nom, s.nom, t.nom`, ...params);
  if (!postes.length) return { postes, shifts: [], cells: [] };
  const ids = postes.map((p) => p.id);
  const shifts = S.ok ? db.all(`SELECT t.id, t.poste_id, t.employee_id, t.date, t.heure_debut, t.heure_fin, t.statut, t.valide, t.checkin_at, t.checkout_at,
      e.prenom || ' ' || e.nom AS employe FROM shifts t JOIN employees e ON e.id = t.employee_id
      WHERE ${S.cond} AND t.date BETWEEN ? AND ? AND t.poste_id IN (${ids.map(() => '?').join(',')}) ORDER BY t.date, t.heure_debut`, ...S.params, from, to, ...ids) : [];
  const cells = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const wd = isoWeekday(d);
    for (const p of postes) {
      if (!(p.jours || '1,2,3,4,5,6,7').split(',').map(Number).includes(wd)) continue;
      const n = shifts.filter((s) => s.poste_id === p.id && s.date === d && !['annule', 'absent', 'remplace'].includes(s.statut)).length;
      cells.push({ poste_id: p.id, date: d, requis: p.effectif_requis, affectes: n, couvert: n >= p.effectif_requis });
    }
  }
  return { postes, shifts, cells };
}

// ------------------------------------------------------------- rentabilité
function profitability(user, from, to) {
  const contrats = db.all(`SELECT c.id, c.reference, c.activite, c.client_id, c.site_id, c.statut, c.tarif_mensuel, cl.nom AS client, s.nom AS site
    FROM contrats c JOIN clients cl ON cl.id = c.client_id LEFT JOIN sites s ON s.id = c.site_id ORDER BY cl.nom, c.reference`);
  const byId = {};
  for (const c of contrats) byId[c.id] = { ...c, revenus: 0, cout_personnel: 0, cout_consommables: 0, cout_depenses: 0, heures: 0 };
  // revenus facturés (HT), avoirs déduits
  for (const f of db.all("SELECT contrat_id, type, montant_ht FROM factures WHERE statut IN ('emise','payee','impayee') AND type IN ('facture','avoir') AND date BETWEEN ? AND ?", from, to)) {
    if (byId[f.contrat_id]) byId[f.contrat_id].revenus += f.type === 'avoir' ? -f.montant_ht : f.montant_ht;
  }
  // coût du personnel : heures (réalisées si disponibles, sinon planifiées) x coût horaire de référence
  const today = todayStr();
  const sh = db.all(`SELECT s.date, s.heure_debut, s.heure_fin, s.checkin_at, s.checkout_at, e.cout_horaire, p.contrat_id
    FROM shifts s JOIN postes p ON p.id = s.poste_id JOIN employees e ON e.id = s.employee_id
    WHERE s.date BETWEEN ? AND ? AND s.date <= ? AND s.statut NOT IN ${COUNTED} AND p.contrat_id IS NOT NULL`, from, to, today);
  let sansTarif = 0;
  for (const s of sh) {
    const c = byId[s.contrat_id]; if (!c) continue;
    let h = shiftHours(s.date, s.heure_debut, s.heure_fin);
    if (s.checkin_at && s.checkout_at) { const a = new Date(s.checkin_at.replace(' ', 'T')), b = new Date(s.checkout_at.replace(' ', 'T')); const hh = (b - a) / 3600000; if (hh > 0 && hh < 24) h = hh; }
    c.heures += h;
    if (s.cout_horaire) c.cout_personnel += h * s.cout_horaire; else sansTarif += h;
  }
  for (const m of db.all(`SELECT m.contrat_id, -m.quantite * c.cout_unitaire AS cout FROM mouvements_stock m JOIN consommables c ON c.id = m.consommable_id
      WHERE m.contrat_id IS NOT NULL AND m.quantite < 0 AND m.date BETWEEN ? AND ?`, from, to)) if (byId[m.contrat_id]) byId[m.contrat_id].cout_consommables += m.cout || 0;
  for (const d of db.all('SELECT contrat_id, montant FROM depenses WHERE contrat_id IS NOT NULL AND date BETWEEN ? AND ?', from, to)) if (byId[d.contrat_id]) byId[d.contrat_id].cout_depenses += d.montant;
  const rows = Object.values(byId).map((c) => {
    const couts = c.cout_personnel + c.cout_consommables + c.cout_depenses;
    const r2 = (x) => Math.round(x * 100) / 100;
    return { ...c, revenus: r2(c.revenus), cout_personnel: r2(c.cout_personnel), cout_consommables: r2(c.cout_consommables), cout_depenses: r2(c.cout_depenses),
      heures: r2(c.heures), couts_directs: r2(couts), marge: r2(c.revenus - couts), taux_marge: c.revenus > 0 ? Math.round(((c.revenus - couts) / c.revenus) * 1000) / 10 : null };
  }).filter((c) => c.revenus || c.couts_directs || c.heures);
  const tot = rows.reduce((a, c) => ({ revenus: a.revenus + c.revenus, couts_directs: a.couts_directs + c.couts_directs, marge: a.marge + c.marge, heures: a.heures + c.heures }), { revenus: 0, couts_directs: 0, marge: 0, heures: 0 });
  return { from, to, rows, total: { ...tot, taux_marge: tot.revenus > 0 ? Math.round((tot.marge / tot.revenus) * 1000) / 10 : null }, heures_sans_cout_horaire: Math.round(sansTarif * 10) / 10 };
}

// ------------------------------------------------------------- récapitulatif mensuel (préparation paie)
function recap(month) {
  const { from, to } = monthRange(month);
  const maxH = Number(db.getSetting('seuil_heures_hebdo') || 44);
  const emps = db.all("SELECT id, matricule, nom, prenom, activite, statut FROM employees WHERE statut != 'sorti' OR id IN (SELECT employee_id FROM shifts WHERE date BETWEEN ? AND ?) ORDER BY nom, prenom", from, to);
  const shifts = db.all(`SELECT s.*, p.nom AS poste, si.nom AS site FROM shifts s JOIN postes p ON p.id = s.poste_id JOIN sites si ON si.id = p.site_id
    WHERE s.date BETWEEN ? AND ? AND s.statut NOT IN ${COUNTED}`, from, to);
  const abs = db.all("SELECT * FROM absences WHERE statut = 'validee' AND date_fin >= ? AND date_debut <= ?", from, to);
  const rows = [];
  for (const e of emps) {
    const mine = shifts.filter((s) => s.employee_id === e.id);
    let planif = 0, reel = 0; const sites = {}; const weeks = {};
    for (const s of mine) {
      const h = shiftHours(s.date, s.heure_debut, s.heure_fin); planif += h;
      let hr = 0;
      if (s.checkin_at && s.checkout_at) { const x = (new Date(s.checkout_at.replace(' ', 'T')) - new Date(s.checkin_at.replace(' ', 'T'))) / 3600000; hr = x > 0 && x < 24 ? x : h; } else if (s.statut === 'termine') hr = h;
      reel += hr; sites[s.site] = (sites[s.site] || 0) + h;
      const w = mondayOf(s.date); weeks[w] = (weeks[w] || 0) + h;
    }
    const days = { conge: 0, maladie: 0, absence: 0, autorisee: 0, formation: 0 };
    for (const a of abs.filter((x) => x.employee_id === e.id)) {
      const a0 = a.date_debut > from ? a.date_debut : from, a1 = a.date_fin < to ? a.date_fin : to;
      days[a.type] = (days[a.type] || 0) + daysBetween(a0, a1) + 1;
    }
    if (!mine.length && !Object.values(days).some(Boolean) && e.statut !== 'actif') continue;
    rows.push({ employee_id: e.id, matricule: e.matricule, nom: `${e.prenom} ${e.nom}`, activite: e.activite,
      h_planifiees: Math.round(planif * 10) / 10, h_realisees: Math.round(reel * 10) / 10,
      jours_conge: days.conge, jours_maladie: days.maladie, jours_absence: days.absence + days.autorisee, jours_formation: days.formation,
      semaines_a_verifier: Object.entries(weeks).filter(([, h]) => h > maxH).map(([w, h]) => `${w} (${Math.round(h * 10) / 10} h)`).join(' ; '),
      sites: Object.entries(sites).map(([k, v]) => `${k} : ${Math.round(v * 10) / 10} h`).join(' ; ') });
  }
  return { month, from, to, seuil: maxH, rows };
}

// ------------------------------------------------------------- tableau de bord
function dashboard(user, q) {
  const month = /^\d{4}-\d{2}$/.test(q.month || '') ? q.month : todayStr().slice(0, 7);
  const { from, to } = monthRange(month);
  const act = ['securite', 'nettoyage'].includes(q.activite) ? q.activite : null;
  const today = todayStr();
  const out = { month, activite: act, today };
  const E = sc('employees', user);
  if (E.ok) {
    const rows = db.all(`SELECT t.id, t.activite, t.statut, t.cin, t.tel, t.adresse, t.date_naissance, t.urgence_tel, t.date_embauche, t.type_contrat, t.cnss_numero FROM employees t WHERE ${E.cond} AND t.statut = 'actif' ${act ? 'AND t.activite = ?' : ''}`, ...E.params, ...(act ? [act] : []));
    const { decorate } = require('./crud');
    const dec = decorate('employees', rows);
    out.rh = { actifs: rows.length, securite: rows.filter((r) => r.activite === 'securite').length, nettoyage: rows.filter((r) => r.activite === 'nettoyage').length,
      administratif: rows.filter((r) => r.activite === 'administratif').length, dossiers_complets: dec.filter((r) => r.completude >= 100).length };
  }
  const D = sc('documents', user);
  if (D.ok) {
    out.documents = {
      expires: db.get(`SELECT COUNT(*) c FROM documents t WHERE ${D.cond} AND t.date_expiration < ?`, ...D.params, today).c,
      a_renouveler: db.get(`SELECT COUNT(*) c FROM documents t WHERE ${D.cond} AND t.date_expiration BETWEEN ? AND ?`, ...D.params, today, addDays(today, 30)).c,
    };
  }
  const A = sc('absences', user);
  if (A.ok) out.absences = { aujourdhui: db.get(`SELECT COUNT(*) c FROM absences t WHERE ${A.cond} AND t.statut = 'validee' AND ? BETWEEN t.date_debut AND t.date_fin`, ...A.params, today).c,
    en_attente: db.get(`SELECT COUNT(*) c FROM absences t WHERE ${A.cond} AND t.statut = 'demande'`, ...A.params).c };
  // couverture
  if (sc('postes', user).ok && sc('shifts', user).ok && !AG.includes(user.role)) {
    const cv = coverage(user, today, addDays(today, 6), { activite: act });
    const td = cv.cells.filter((c) => c.date === today);
    const sec = new Set(cv.postes.filter((p) => p.activite === 'securite').map((p) => p.id));
    out.couverture = {
      aujourdhui_requis: td.length, aujourdhui_couverts: td.filter((c) => c.couvert).length, aujourdhui_non_couverts: td.filter((c) => !c.couvert).length,
      securite_couverts: td.filter((c) => c.couvert && sec.has(c.poste_id)).length, securite_non_couverts: td.filter((c) => !c.couvert && sec.has(c.poste_id)).length,
      sept_jours_non_couverts: cv.cells.filter((c) => !c.couvert).length,
      a_risque: cv.cells.filter((c) => !c.couvert).slice(0, 8).map((c) => { const p = cv.postes.find((x) => x.id === c.poste_id); return { date: c.date, poste: p.nom, site: p.site, manque: c.requis - c.affectes }; }),
    };
    const S = sc('shifts', user);
    const ret = Number(db.getSetting('retard_pointage_minutes') || 15);
    const now = new Date(); const nowMin = now.getHours() * 60 + now.getMinutes();
    const tod = db.all(`SELECT t.heure_debut, t.checkin_at, t.statut FROM shifts t WHERE ${S.cond} AND t.date = ? AND t.statut NOT IN ${COUNTED}`, ...S.params, today);
    out.pointage = { total: tod.length, confirmes: tod.filter((s) => s.checkin_at).length,
      non_confirmes: tod.filter((s) => !s.checkin_at && L.toMin(s.heure_debut) + ret < nowMin).length };
  }
  const T = sc('taches', user);
  if (T.ok && !AG.includes(user.role)) {
    out.nettoyage = {
      planifiees: db.get(`SELECT COUNT(*) c FROM taches t WHERE ${T.cond} AND t.date = ?`, ...T.params, today).c,
      realisees: db.get(`SELECT COUNT(*) c FROM taches t WHERE ${T.cond} AND t.date = ? AND t.statut = 'fait'`, ...T.params, today).c,
      anomalies: db.get(`SELECT COUNT(*) c FROM taches t WHERE ${T.cond} AND t.date >= ? AND t.statut = 'anomalie'`, ...T.params, addDays(today, -7)).c,
      en_retard: db.get(`SELECT COUNT(*) c FROM taches t WHERE ${T.cond} AND t.date < ? AND t.date >= ? AND t.statut = 'a_faire'`, ...T.params, today, addDays(today, -14)).c,
      a_valider: db.get(`SELECT COUNT(*) c FROM taches t WHERE ${T.cond} AND t.statut = 'fait' AND t.valide = 0`, ...T.params).c,
    };
  }
  const I = sc('incidents', user);
  if (I.ok) {
    out.incidents = {
      ouverts: db.get(`SELECT COUNT(*) c FROM incidents t WHERE ${I.cond} AND t.statut IN ('ouvert','en_cours')`, ...I.params).c,
      critiques: db.get(`SELECT COUNT(*) c FROM incidents t WHERE ${I.cond} AND t.statut IN ('ouvert','en_cours') AND t.priorite IN ('elevee','critique')`, ...I.params).c,
      reclamations: db.get(`SELECT COUNT(*) c FROM incidents t WHERE ${I.cond} AND t.type = 'reclamation' AND t.statut IN ('ouvert','en_cours')`, ...I.params).c,
    };
  }
  const C = sc('contrats', user);
  if (C.ok) {
    out.contrats = {
      actifs: db.get(`SELECT COUNT(*) c FROM contrats t WHERE ${C.cond} AND t.statut IN ('actif','a_renouveler')`, ...C.params).c,
      a_renouveler: db.get(`SELECT COUNT(*) c FROM contrats t WHERE ${C.cond} AND t.statut IN ('actif','a_renouveler') AND t.date_fin IS NOT NULL AND t.date_fin <= date(?, '+' || COALESCE(t.preavis_jours, 90) || ' days')`, ...C.params, today).c,
    };
  }
  if (can(user, resources.factures, 'read') && can(user, resources.depenses, 'read')) {
    const rev = db.get("SELECT COALESCE(SUM(CASE WHEN type='avoir' THEN -montant_ht ELSE montant_ht END),0) s FROM factures WHERE statut IN ('emise','payee','impayee') AND type IN ('facture','avoir') AND date BETWEEN ? AND ?", from, to).s;
    const { decorate } = require('./crud');
    const open = decorate('factures', db.all("SELECT * FROM factures WHERE type='facture' AND statut IN ('emise','impayee')"));
    const dep = db.get('SELECT COALESCE(SUM(montant),0) s FROM depenses WHERE date BETWEEN ? AND ?', from, to).s;
    const pf = profitability(user, from, to);
    out.finance = { factures_mois: Math.round(rev * 100) / 100, impayes_montant: Math.round(open.filter((f) => f.etat === 'en_retard').reduce((a, f) => a + f.reste, 0) * 100) / 100,
      impayes_nb: open.filter((f) => f.etat === 'en_retard').length, a_encaisser: Math.round(open.reduce((a, f) => a + f.reste, 0) * 100) / 100,
      depenses_mois: Math.round(dep * 100) / 100, couts_directs: pf.total.couts_directs, marge_estimee: pf.total.marge, taux_marge: pf.total.taux_marge };
  }
  return out;
}

// ------------------------------------------------------------- alertes
const LEVEL = { critique: 0, alerte: 1, info: 2 };
function alerts(user) {
  const items = []; const today = todayStr();
  const lvl = (d) => (d < 0 || d <= 7 ? 'critique' : d <= 15 ? 'alerte' : 'info');
  const word = (d) => (d < 0 ? `expiré depuis ${-d} j` : d === 0 ? 'expire aujourd’hui' : `expire dans ${d} j`);
  const add = (niveau, type, titre, detail, lien, date) => items.push({ niveau, type, titre, detail, lien, date });
  const push = (key, sql, mapper, extraParams = []) => {
    const s = sc(key, user); if (!s.ok) return;
    for (const r of db.all(sql.replace('{SC}', s.cond), ...s.params, ...extraParams)) mapper(r);
  };
  const horizon = addDays(today, 30);
  push('documents', `SELECT t.id, t.titre, t.categorie, t.date_expiration, e.prenom || ' ' || e.nom AS emp, c.nom AS cli FROM documents t LEFT JOIN employees e ON e.id = t.employee_id LEFT JOIN clients c ON c.id = t.client_id
      WHERE {SC} AND t.date_expiration IS NOT NULL AND t.date_expiration <= ? ORDER BY t.date_expiration LIMIT 100`, (r) => {
    const d = daysBetween(today, r.date_expiration); add(lvl(d), 'Document', `${r.categorie} — ${r.titre}`, `${r.emp || r.cli || 'Entreprise'} · ${word(d)}`, '#/documents', r.date_expiration);
  }, [horizon]);
  push('formations', `SELECT t.id, t.intitule, t.date_expiration, e.prenom || ' ' || e.nom AS emp FROM formations t JOIN employees e ON e.id = t.employee_id WHERE {SC} AND t.date_expiration IS NOT NULL AND t.date_expiration <= ? LIMIT 100`, (r) => {
    const d = daysBetween(today, r.date_expiration); add(lvl(d), 'Formation', r.intitule, `${r.emp} · ${word(d)}`, '#/formations', r.date_expiration);
  }, [horizon]);
  push('assurances', `SELECT t.id, t.organisme, t.reference, t.date_fin FROM assurances t WHERE {SC} AND t.date_fin IS NOT NULL AND t.date_fin <= ? LIMIT 100`, (r) => {
    const d = daysBetween(today, r.date_fin); add(lvl(d), 'Assurance', `${r.organisme} ${r.reference || ''}`, word(d), '#/assurances', r.date_fin);
  }, [horizon]);
  push('cnss', `SELECT t.id, t.type, t.periode, t.statut, t.date_echeance, t.anomalie, e.prenom || ' ' || e.nom AS emp FROM cnss_demarches t LEFT JOIN employees e ON e.id = t.employee_id
      WHERE {SC} AND t.statut != 'terminee' AND ((t.date_echeance IS NOT NULL AND t.date_echeance <= ?) OR t.statut = 'anomalie') LIMIT 100`, (r) => {
    const d = r.date_echeance ? daysBetween(today, r.date_echeance) : 0;
    add(r.statut === 'anomalie' ? 'critique' : lvl(d), 'CNSS', `${r.type} ${r.periode || ''} ${r.emp ? '— ' + r.emp : ''}`, r.statut === 'anomalie' ? `Anomalie : ${r.anomalie || 'à résoudre'}` : `Échéance : ${word(d)}`, '#/cnss', r.date_echeance);
  }, [horizon]);
  push('contrats', `SELECT t.id, t.reference, t.date_fin, t.preavis_jours, c.nom AS cli FROM contrats t JOIN clients c ON c.id = t.client_id
      WHERE {SC} AND t.statut IN ('actif','a_renouveler') AND t.date_fin IS NOT NULL AND t.date_fin <= date(?, '+' || COALESCE(t.preavis_jours, 90) || ' days') LIMIT 100`, (r) => {
    const d = daysBetween(today, r.date_fin); add(d < 0 ? 'critique' : d <= 30 ? 'alerte' : 'info', 'Contrat client', `${r.reference} — ${r.cli}`, d < 0 ? `terminé depuis ${-d} j sans renouvellement` : `fin dans ${d} j (renouvellement à préparer)`, '#/contrats', r.date_fin);
  }, [today]);
  push('employees', `SELECT t.id, t.prenom, t.nom, t.date_fin FROM employees t WHERE {SC} AND t.statut = 'actif' AND t.date_fin IS NOT NULL AND t.date_fin <= ? LIMIT 100`, (r) => {
    if (!['dg', 'rh', 'adm'].includes(user.role)) return;
    const d = daysBetween(today, r.date_fin); add(lvl(d), 'Fin de contrat de travail', `${r.prenom} ${r.nom}`, word(d).replace('expire', 'se termine'), '#/employees', r.date_fin);
  }, [horizon]);
  push('consommables', 'SELECT t.id, t.libelle, t.stock, t.seuil_alerte, t.unite FROM consommables t WHERE {SC} AND t.stock <= t.seuil_alerte LIMIT 100', (r) => {
    add(r.stock <= 0 ? 'critique' : 'alerte', 'Stock bas', r.libelle, `${r.stock} ${r.unite || ''} (seuil ${r.seuil_alerte})`, '#/consommables', null);
  });
  push('equipements', 'SELECT t.id, t.libelle, t.prochaine_maintenance FROM equipements t WHERE {SC} AND t.prochaine_maintenance IS NOT NULL AND t.prochaine_maintenance <= ? LIMIT 50', (r) => {
    const d = daysBetween(today, r.prochaine_maintenance); add(d < 0 ? 'alerte' : 'info', 'Maintenance', r.libelle, d < 0 ? `en retard de ${-d} j` : `dans ${d} j`, '#/equipements', r.prochaine_maintenance);
  }, [addDays(today, 15)]);
  if (can(user, resources.factures, 'read')) {
    const { decorate } = require('./crud');
    const fac = decorate('factures', db.all("SELECT f.*, c.reference AS ref FROM factures f JOIN contrats c ON c.id = f.contrat_id WHERE f.type='facture' AND f.statut IN ('emise','impayee') AND f.echeance IS NOT NULL AND f.echeance < ?", today));
    for (const f of fac) if (f.etat === 'en_retard') { const d = daysBetween(f.echeance, today); add(d > 30 ? 'critique' : 'alerte', 'Facture impayée', `${f.numero} — ${f.ref}`, `reste ${f.reste.toFixed(2)} MAD · échue depuis ${d} j`, '#/factures', f.echeance); }
  }
  push('absences', "SELECT t.id, t.type, t.date_debut, t.date_fin, e.prenom || ' ' || e.nom AS emp FROM absences t JOIN employees e ON e.id = t.employee_id WHERE {SC} AND t.statut = 'demande' LIMIT 50", (r) => {
    if (!['dg', 'rh', 'adm'].includes(user.role)) return;
    add('info', 'Absence à valider', r.emp, `${r.type} du ${r.date_debut} au ${r.date_fin}`, '#/absences', r.date_debut);
  });
  push('incidents', "SELECT t.id, t.titre, t.priorite, t.created_at FROM incidents t WHERE {SC} AND t.statut IN ('ouvert','en_cours') AND t.priorite IN ('elevee','critique') LIMIT 50", (r) => {
    if (AG.includes(user.role)) return;
    add(r.priorite === 'critique' ? 'critique' : 'alerte', 'Incident à traiter', r.titre, `priorité ${r.priorite}`, '#/incidents', r.created_at.slice(0, 10));
  });
  push('taches', `SELECT t.id, t.libelle, t.date FROM taches t WHERE {SC} AND t.date < ? AND t.date >= ? AND t.statut = 'a_faire' LIMIT 50`, (r) => {
    if (AG.includes(user.role)) return; add('alerte', 'Tâche non terminée', r.libelle, `prévue le ${r.date}`, '#/taches', r.date);
  }, [today, addDays(today, -7)]);
  // couverture & pointage
  if (!AG.includes(user.role) && sc('postes', user).ok && sc('shifts', user).ok) {
    const cv = coverage(user, today, addDays(today, 3));
    for (const c of cv.cells.filter((x) => !x.couvert)) {
      const p = cv.postes.find((x) => x.id === c.poste_id); const d = daysBetween(today, c.date);
      add(d <= 1 ? 'critique' : 'alerte', 'Poste non couvert', `${p.nom} — ${p.site}`, `${c.date} : ${c.affectes}/${c.requis} affecté(s)`, '#/planning', c.date);
    }
    const ret = Number(db.getSetting('retard_pointage_minutes') || 15); const now = new Date(); const nowMin = now.getHours() * 60 + now.getMinutes();
    for (const s of cv.shifts.filter((x) => x.date === today && !x.checkin_at && !['annule', 'absent', 'remplace'].includes(x.statut) && L.toMin(x.heure_debut) + ret < nowMin && L.toMin(x.heure_debut) + 240 > nowMin)) {
      const p = cv.postes.find((x) => x.id === s.poste_id); add('alerte', 'Prise de poste non confirmée', `${s.employe} — ${p.nom}`, `prévue à ${s.heure_debut}`, '#/planning', today);
    }
    if (['dg', 'resp_sec', 'resp_net'].includes(user.role)) {
      const n = db.get(`SELECT COUNT(*) c FROM shifts t WHERE ${sc('shifts', user).cond} AND t.valide = 0 AND t.date >= ?`, ...sc('shifts', user).params, today).c;
      if (n) add('info', 'Planning à valider', `${n} affectation(s) proposée(s) par les superviseurs`, '', '#/shifts', null);
    }
  }
  items.sort((a, b) => LEVEL[a.niveau] - LEVEL[b.niveau] || String(a.date || '9').localeCompare(String(b.date || '9')));
  return items.slice(0, 300);
}

module.exports = { coverage, profitability, recap, dashboard, alerts, monthRange, sc };

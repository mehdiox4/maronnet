'use strict';
// Jeu de données DE DÉMONSTRATION (entièrement fictif). À n'utiliser que pour essayer l'application :
//   npm run demo      (ne s'exécute que sur une base vide)
process.env.TZ = process.env.TZ || 'Africa/Casablanca';
const db = require('./db');
const bcrypt = require('bcryptjs');
const L = require('./lib');
const { todayStr, addDays, mondayOf, nowStr } = L;

if (db.get('SELECT COUNT(*) c FROM employees').c > 0 || db.get('SELECT COUNT(*) c FROM clients').c > 0) {
  console.log('La base contient déjà des données : démonstration non chargée (pour éviter tout mélange).');
  process.exit(0);
}
const DEMO_PASSWORD = process.env.MARONET_DEMO_PASSWORD || 'Demo-Maronet-360';
const today = todayStr();
const ins = (t, o) => Number(db.run(`INSERT INTO ${t}(${Object.keys(o).join(',')}) VALUES(${Object.keys(o).map(() => '?').join(',')})`, ...Object.values(o)).lastInsertRowid);

db.tx(() => {
  // ------------------------------------------------ employés (noms fictifs)
  const mk = (i, prenom, activite, fonction, extra = {}) => ins('employees', {
    matricule: 'MAR-' + String(i).padStart(4, '0'), nom: 'Exemple ' + i, prenom, activite, fonction, statut: 'actif',
    cin: 'DEMO' + String(100000 + i), tel: '06 00 00 00 ' + String(10 + i), adresse: 'Adresse fictive ' + i, date_naissance: '1990-01-' + String(10 + (i % 18)),
    urgence_nom: 'Contact ' + i, urgence_tel: '06 11 11 11 ' + String(10 + i), date_embauche: addDays(today, -200 - i * 15), type_contrat: i % 4 === 0 ? 'CDD' : 'CDI',
    cnss_numero: i === 6 ? null : 'DEMO-CNSS-' + i, cnss_statut: i === 6 ? 'en_cours' : 'affilie', cout_horaire: activite === 'securite' ? 28 : activite === 'nettoyage' ? 24 : 40,
    qualifications: activite === 'securite' ? 'agent de sécurité' + (i % 2 ? ', secourisme' : '') : activite === 'nettoyage' ? 'hygiène' : '', notes: 'Données de démonstration', ...extra,
  });
  const sec = [mk(1, 'Karim', 'securite', 'Agent de sécurité'), mk(2, 'Youssef', 'securite', 'Agent de sécurité'), mk(3, 'Hamza', 'securite', 'Agent de sécurité'),
    mk(4, 'Omar', 'securite', 'Agent de sécurité', { type_contrat: 'CDD', date_fin: addDays(today, 20) }), mk(5, 'Anas', 'securite', 'Agent de sécurité'), mk(6, 'Mehdi', 'securite', 'Agent de sécurité')];
  const net = [mk(7, 'Salma', 'nettoyage', 'Agent de nettoyage'), mk(8, 'Khadija', 'nettoyage', 'Agent de nettoyage'), mk(9, 'Fatima', 'nettoyage', 'Agent de nettoyage')];
  const sup1 = mk(10, 'Rachid', 'securite', 'Superviseur de site', { qualifications: 'agent de sécurité, secourisme' });
  const sup2 = mk(11, 'Nadia', 'nettoyage', 'Superviseure de site');
  const rhEmp = mk(12, 'Imane', 'administratif', 'Responsable RH'), adm = mk(13, 'Sanae', 'administratif', 'Gestionnaire administratif'), cptEmp = mk(14, 'Driss', 'administratif', 'Comptable');
  const rsEmp = mk(15, 'Tarik', 'securite', 'Responsable exploitation sécurité'), rnEmp = mk(16, 'Latifa', 'nettoyage', 'Responsable exploitation nettoyage');
  const dgEmp = mk(17, 'Directeur', 'administratif', 'Directeur général'), comEmp = mk(18, 'Hind', 'administratif', 'Responsable commercial');

  // ------------------------------------------------ comptes de démonstration (un par profil)
  const pw = bcrypt.hashSync(DEMO_PASSWORD, 10);
  const U = (username, role, employee_id) => ins('users', { username, password_hash: pw, role, employee_id: employee_id || null, active: 1, must_change: 0 });
    U('admin', 'admin', null); U('dg', 'dg', dgEmp); U('rh', 'rh', rhEmp); U('adm', 'adm', adm); U('resp.securite', 'resp_sec', rsEmp); U('resp.nettoyage', 'resp_net', rnEmp);
  U('superviseur1', 'superviseur', sup1); U('superviseur2', 'superviseur', sup2); U('comptable', 'comptable', cptEmp); U('commercial', 'commercial', comEmp);
  U('agent.securite', 'agent_securite', sec[0]); U('agent.nettoyage', 'agent_nettoyage', net[0]); U('auditeur', 'auditeur', null);
  db.run("UPDATE users SET employee_id = NULL WHERE username = 'auditeur'");

  // ------------------------------------------------ clients / sites / contrats
  const c1 = ins('clients', { nom: 'Client Démo A (banque fictive)', ville: 'Casablanca', adresse: 'Adresse fictive A', tel: '05 22 00 00 01', contact_nom: 'Contact A', contact_tel: '06 22 00 00 01', email: 'a@exemple.invalid' });
  const c2 = ins('clients', { nom: 'Client Démo B (centre d’affaires fictif)', ville: 'Rabat', adresse: 'Adresse fictive B', tel: '05 37 00 00 02', contact_nom: 'Contact B', contact_tel: '06 37 00 00 02' });
  const c3 = ins('clients', { nom: 'Client Démo C (usine fictive)', ville: 'Tanger', adresse: 'Zone fictive C', tel: '05 39 00 00 03', contact_nom: 'Contact C' });
  const sA = ins('sites', { client_id: c1, nom: 'Siège A', ville: 'Casablanca', adresse: 'Adresse fictive A', consignes: 'Contrôle des badges à l’entrée. Appeler le responsable sécurité du client en cas d’alarme.', superviseur_id: sup1, contact_site: 'Contact A — 06 22 00 00 01' });
  const sB = ins('sites', { client_id: c2, nom: 'Immeuble B', ville: 'Rabat', adresse: 'Adresse fictive B', consignes: 'Nettoyage avant 08:00. Produits fournis par MARONET.', superviseur_id: sup2 });
  const sC = ins('sites', { client_id: c3, nom: 'Entrepôt C', ville: 'Tanger', adresse: 'Zone fictive C', consignes: 'Gardiennage 24 h/24. Ronde toutes les 2 heures.', superviseur_id: sup1 });
  const k1 = ins('contrats', { client_id: c1, site_id: sA, reference: 'CT-DEMO-001', activite: 'securite', date_debut: addDays(today, -300), date_fin: addDays(today, 65), statut: 'actif', tarif_mensuel: 52000, nb_agents: 2, horaires: '24 h/24, 7 j/7', preavis_jours: 90 });
  const k2 = ins('contrats', { client_id: c2, site_id: sB, reference: 'CT-DEMO-002', activite: 'nettoyage', date_debut: addDays(today, -200), date_fin: addDays(today, 165), statut: 'actif', tarif_mensuel: 18500, nb_agents: 2, horaires: 'Du lundi au vendredi, 06:00-09:00' });
  const k3 = ins('contrats', { client_id: c3, site_id: sC, reference: 'CT-DEMO-003', activite: 'securite', date_debut: addDays(today, -100), date_fin: addDays(today, 265), statut: 'actif', tarif_mensuel: 31000, nb_agents: 1, horaires: '08:00-16:00 tous les jours' });
  const k4 = ins('contrats', { client_id: c1, site_id: sA, reference: 'CT-DEMO-004', activite: 'nettoyage', date_debut: addDays(today, -120), date_fin: addDays(today, 245), statut: 'actif', tarif_mensuel: 12000, nb_agents: 1, horaires: 'Du lundi au vendredi, 17:00-20:00' });

  // ------------------------------------------------ postes et zones
  const P = (o) => ins('postes', { jours: '1,2,3,4,5,6,7', pointage_mode: 'manuel', actif: 1, qr_token: Math.random().toString(16).slice(2, 18).padEnd(16, '0'), ...o });
  const pJour = P({ site_id: sA, contrat_id: k1, nom: 'Accueil — jour', activite: 'securite', effectif_requis: 1, heure_debut: '07:00', heure_fin: '19:00', qualification_requise: 'agent de sécurité', pointage_mode: 'qr' });
  const pNuit = P({ site_id: sA, contrat_id: k1, nom: 'Accueil — nuit', activite: 'securite', effectif_requis: 1, heure_debut: '19:00', heure_fin: '07:00', qualification_requise: 'agent de sécurité' });
  const pEnt = P({ site_id: sC, contrat_id: k3, nom: 'Poste entrepôt', activite: 'securite', effectif_requis: 1, heure_debut: '08:00', heure_fin: '16:00', pointage_mode: 'superviseur' });
  const zBur = P({ site_id: sB, contrat_id: k2, nom: 'Zone — Bureaux', activite: 'nettoyage', effectif_requis: 1, heure_debut: '06:00', heure_fin: '09:00', jours: '1,2,3,4,5' });
  const zSan = P({ site_id: sB, contrat_id: k2, nom: 'Zone — Sanitaires', activite: 'nettoyage', effectif_requis: 1, heure_debut: '06:00', heure_fin: '09:00', jours: '1,2,3,4,5' });
  const zHall = P({ site_id: sA, contrat_id: k4, nom: 'Zone — Hall d’accueil', activite: 'nettoyage', effectif_requis: 1, heure_debut: '17:00', heure_fin: '20:00', jours: '1,2,3,4,5' });

  const M = (poste, libelle, jours = '1,2,3,4,5') => ins('modeles_taches', { poste_id: poste, libelle, jours });
  [['Nettoyage des sols'], ['Dépoussiérage des bureaux'], ['Vidage des corbeilles'], ['Nettoyage des vitres', '1,3,5']].forEach(([l, j]) => M(zBur, l, j));
  [['Nettoyage et désinfection (selon consignes)'], ['Réapprovisionnement des consommables'], ['Nettoyage des sols']].forEach(([l, j]) => M(zSan, l, j));
  [['Nettoyage des sols du hall'], ['Nettoyage des vitres', '2,4'], ['Entretien du mobilier d’accueil']].forEach(([l, j]) => M(zHall, l, j));

  // ------------------------------------------------ plannings : semaine précédente, courante et suivante
  const start = addDays(mondayOf(today), -7), end = addDays(mondayOf(today), 13);
  const S = (poste, emp, date, hd, hf, o = {}) => ins('shifts', { poste_id: poste, employee_id: emp, date, heure_debut: hd, heure_fin: hf, statut: 'planifie', valide: 1, ...o });
  const gap = addDays(today, 1); // un poste volontairement non couvert pour la démonstration
  for (let d = start, i = 0; d <= end; d = addDays(d, 1), i++) {
    const past = d < today;
    const real = (hd, hf, extra) => (past ? { statut: 'termine', checkin_at: `${d} ${hd}`, checkout_at: `${hf < hd ? addDays(d, 1) : d} ${hf}`, checkin_method: 'manuel' } : extra || {});
    S(pJour, sec[i % 2], d, '07:00', '19:00', real('07:02', '19:00', d === today ? { statut: 'confirme', checkin_at: `${d} 07:05`, checkin_method: 'qr' } : {}));
    if (d !== gap) S(pNuit, sec[2 + (i % 2)], d, '19:00', '07:00', real('19:01', '07:00'));
    S(pEnt, sec[4 + (i % 2)], d, '08:00', '16:00', real('08:00', '16:00', d === today ? { statut: 'confirme', checkin_at: `${d} 08:03`, checkin_method: 'superviseur' } : {}));
    const wd = L.isoWeekday(d);
    if (wd <= 5) { S(zBur, net[0], d, '06:00', '09:00', real('06:00', '09:00')); S(zSan, net[1], d, '06:00', '09:00', real('06:05', '09:00')); S(zHall, net[2], d, '17:00', '20:00', real('17:00', '20:00')); }
  }
  // un planning proposé par un superviseur, à valider
  S(pEnt, sec[5], addDays(today, 9), '08:00', '16:00', { valide: 0 });

  // ------------------------------------------------ absences
  ins('absences', { employee_id: sec[3], type: 'conge', date_debut: addDays(today, 6), date_fin: addDays(today, 8), statut: 'validee', motif: 'Congé annuel (démo)' });
  ins('absences', { employee_id: net[2], type: 'maladie', date_debut: addDays(today, 3), date_fin: addDays(today, 4), statut: 'demande', motif: 'Arrêt maladie (démo)' });

  // ------------------------------------------------ documents, formations, assurances, CNSS
  const all = [...sec, ...net, sup1, sup2];
  all.forEach((e, k) => {
    ins('documents', { categorie: 'Pièce d’identité', titre: 'CIN (copie fictive)', employee_id: e, date_creation: addDays(today, -150), date_expiration: k === 1 ? addDays(today, 12) : k === 2 ? addDays(today, -10) : addDays(today, 700 + k), statut_verif: 'verifie', valide_par: 'rh (démo)' });
    ins('documents', { categorie: 'Contrat de travail', titre: 'Contrat de travail (fictif)', employee_id: e, date_creation: addDays(today, -150), statut_verif: k === 5 ? 'depose' : 'verifie' });
    if (k !== 5) ins('documents', { categorie: 'CNSS', titre: 'Attestation d’affiliation (fictive)', employee_id: e, date_creation: addDays(today, -140), date_expiration: k === 0 ? addDays(today, 25) : null, statut_verif: 'verifie' });
  });
  ins('documents', { categorie: 'Contrat client', titre: 'Contrat CT-DEMO-001 signé (fictif)', client_id: c1, date_creation: addDays(today, -300), statut_verif: 'verifie' });
  ins('formations', { employee_id: sec[0], intitule: 'Secourisme', organisme: 'Organisme fictif', date_obtention: addDays(today, -300), date_expiration: addDays(today, 20) });
  ins('formations', { employee_id: sec[1], intitule: 'Agent de sécurité — habilitation', organisme: 'Organisme fictif', date_obtention: addDays(today, -500), date_expiration: addDays(today, 400) });
  ins('formations', { employee_id: sec[2], intitule: 'Secourisme', organisme: 'Organisme fictif', date_obtention: addDays(today, -800), date_expiration: addDays(today, -20) });
  ins('assurances', { organisme: 'Assureur fictif', reference: 'POL-DEMO-001', portee: 'entreprise', date_debut: addDays(today, -335), date_fin: addDays(today, 14), notes: 'Responsabilité civile (démo)' });
  ins('assurances', { organisme: 'Assureur fictif', reference: 'POL-DEMO-002', portee: 'entreprise', date_debut: addDays(today, -100), date_fin: addDays(today, 265), notes: 'Accidents du travail (démo)' });
  ins('cnss_demarches', { employee_id: sec[5], type: 'affiliation', periode: today.slice(0, 7), statut: 'en_cours', date_echeance: addDays(today, 6), notes: 'N° CNSS à obtenir (démo)' });
  ins('cnss_demarches', { employee_id: net[1], type: 'declaration', periode: addDays(today, -30).slice(0, 7), statut: 'anomalie', anomalie: 'Écart de jours déclarés (démo)', date_echeance: addDays(today, -2) });

  // ------------------------------------------------ incidents, contrôles qualité
  ins('incidents', { site_id: sA, poste_id: pNuit, employee_id: sec[2], type: 'incident', titre: 'Porte de service restée ouverte', description: 'Porte découverte ouverte lors de la ronde de 02:00 (donnée fictive).', priorite: 'elevee', statut: 'en_cours', created_at: nowStr(new Date(Date.now() - 36 * 3600000)) });
  ins('incidents', { site_id: sB, employee_id: net[1], type: 'reclamation', titre: 'Réclamation : sanitaires du 2e étage', description: 'Le client signale un manque de savon (donnée fictive).', priorite: 'normale', statut: 'ouvert', created_at: nowStr(new Date(Date.now() - 20 * 3600000)) });
  ins('incidents', { site_id: sC, employee_id: sec[4], type: 'anomalie', titre: 'Éclairage défaillant côté quai', priorite: 'faible', statut: 'resolu', resolution: 'Ampoule remplacée (démo)', created_at: nowStr(new Date(Date.now() - 96 * 3600000)), resolved_at: nowStr(new Date(Date.now() - 70 * 3600000)) });
  ins('controles', { site_id: sB, poste_id: zBur, date: addDays(today, -3), controleur_id: sup2, note: 4, statut: 'conforme', observations: 'Bon état général (démo).' });
  ins('controles', { site_id: sB, poste_id: zSan, date: addDays(today, -2), controleur_id: sup2, note: 3, statut: 'reserves', observations: 'Distributeurs à recharger.', action_corrective: 'Réapprovisionner chaque matin (démo).' });

  // ------------------------------------------------ équipements, consommables
  ins('equipements', { type: 'radio', libelle: 'Radio portative', reference: 'RAD-001', employee_id: sec[0], statut: 'attribue', date_attribution: addDays(today, -100) });
  ins('equipements', { type: 'uniforme', libelle: 'Uniforme complet', reference: 'UNI-001', employee_id: sec[1], statut: 'attribue', date_attribution: addDays(today, -100) });
  ins('equipements', { type: 'autolaveuse', libelle: 'Autolaveuse', reference: 'AUT-001', site_id: sB, statut: 'attribue', prochaine_maintenance: addDays(today, 9) });
  ins('equipements', { type: 'aspirateur', libelle: 'Aspirateur professionnel', reference: 'ASP-001', statut: 'disponible' });
  const q1 = ins('consommables', { libelle: 'Détergent sols (bidon 5 L)', unite: 'bidon', stock: 3, seuil_alerte: 4, cout_unitaire: 55 });
  const q2 = ins('consommables', { libelle: 'Savon liquide (flacon)', unite: 'flacon', stock: 24, seuil_alerte: 10, cout_unitaire: 12 });
  const q3 = ins('consommables', { libelle: 'Papier toilette (carton)', unite: 'carton', stock: 8, seuil_alerte: 5, cout_unitaire: 90 });
  ins('mouvements_stock', { consommable_id: q2, quantite: -6, motif: 'Réapprovisionnement site B', site_id: sB, contrat_id: k2, date: addDays(today, -4) });
  ins('mouvements_stock', { consommable_id: q3, quantite: -2, motif: 'Site B', site_id: sB, contrat_id: k2, date: addDays(today, -4) });

  // ------------------------------------------------ finance : factures, paiements, dépenses
  const month = (n) => addDays(today.slice(0, 7) + '-01', -30 * n);
  const F = (contrat, num, date, ech, ht, statut) => ins('factures', { contrat_id: contrat, numero: num, date, echeance: ech, montant_ht: ht, tva_taux: 20, statut, type: 'facture' });
  let n = 1;
  for (const k of [[k1, 52000], [k2, 18500], [k3, 31000], [k4, 12000]]) {
    for (const m of [2, 1, 0]) {
      const d = month(m).slice(0, 8) + '05';
      const paid = m >= 1 && !(k[0] === k2 && m === 1); // la facture du site B du mois dernier reste impayée
      const id = F(k[0], 'FA-DEMO-' + String(n++).padStart(3, '0'), d, addDays(d, 30), k[1], m === 0 && k[0] === k4 ? 'brouillon' : 'emise');
      if (paid) { ins('paiements', { facture_id: id, date: addDays(d, 20), montant: k[1] * 1.2, mode: 'virement', reference: 'VIR-DEMO' }); db.run("UPDATE factures SET statut = 'payee' WHERE id = ?", id); }
    }
  }
  ins('depenses', { date: addDays(today, -6), libelle: 'Produits d’entretien site B', categorie: 'produits', montant: 1850, contrat_id: k2, site_id: sB });
  ins('depenses', { date: addDays(today, -9), libelle: 'Transport des équipes', categorie: 'transport', montant: 1200, contrat_id: k1, site_id: sA });
  ins('depenses', { date: addDays(today, -12), libelle: 'Uniformes (lot)', categorie: 'equipement', montant: 3400 });
});

// tâches de nettoyage du jour (générées depuis les modèles)
const wd = L.isoWeekday(today);
for (const m of db.all('SELECT * FROM modeles_taches WHERE actif = 1')) {
  if (!m.jours.split(',').map(Number).includes(wd)) continue;
  const sh = db.get("SELECT employee_id FROM shifts WHERE poste_id = ? AND date = ? LIMIT 1", m.poste_id, today);
  db.run('INSERT INTO taches(poste_id, employee_id, libelle, date, statut, done_at) VALUES(?,?,?,?,?,?)', m.poste_id, sh ? sh.employee_id : null, m.libelle, today,
    Math.random() < 0.35 ? 'fait' : 'a_faire', null);
}
console.log('\nDonnées de démonstration chargées (entièrement fictives).');
console.log('Comptes (mot de passe commun : ' + DEMO_PASSWORD + ') :');
for (const u of db.all('SELECT username, role FROM users ORDER BY id')) console.log(`  ${u.username.padEnd(16)} ${u.role}`);
console.log('\n⚠️  Ne jamais utiliser ces comptes ni ces données en production.\n');

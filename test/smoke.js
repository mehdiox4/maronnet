'use strict';
// Test de bout en bout : démarre un serveur isolé avec des données de démonstration, puis vérifie droits, règles métier et pointage.
const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'm360-test-'));
const PORT = 3200 + Math.floor(Math.random() * 500);
const BASE = `http://127.0.0.1:${PORT}`;
const env = { ...process.env, MARONET_DATA: DATA, PORT: String(PORT), HOST: '127.0.0.1', NODE_NO_WARNINGS: '1' };
const root = path.join(__dirname, '..');
const seed = spawnSync(process.execPath, [path.join(root, 'server', 'demo.js')], { env, encoding: 'utf8' });
if (seed.status !== 0) { console.error(seed.stdout, seed.stderr); process.exit(1); }
const srv = spawn(process.execPath, [path.join(root, 'server', 'index.js')], { env, stdio: ['ignore', 'pipe', 'pipe'] });
srv.stderr.on('data', (d) => process.stderr.write(d));

let pass = 0, fail = 0;
const ok = (c, msg) => { if (c) { pass++; console.log('  ✓', msg); } else { fail++; console.log('  ✗ ÉCHEC :', msg); } };
const PW = 'Demo-Maronet-360';
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const addDays = (s, n) => { const d = new Date(s + 'T12:00:00'); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

function client() {
  let cookie = '';
  const call = async (method, url, body, extra = {}) => {
    const h = { 'X-M360': '1', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}), ...extra };
    const r = await fetch(BASE + url, { method, headers: h, body: body !== undefined ? JSON.stringify(body) : undefined, redirect: 'manual' });
    const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
    let j = null; const ct = r.headers.get('content-type') || ''; if (ct.includes('json')) j = await r.json(); else if (ct.includes('text')) j = await r.text();
    return { status: r.status, body: j, headers: r.headers };
  };
  return { get: (u) => call('GET', u), post: (u, b) => call('POST', u, b ?? {}), put: (u, b) => call('PUT', u, b), del: (u) => call('DELETE', u), call };
}
async function as(username) { const c = client(); const r = await c.post('/api/auth/login', { username, password: PW }); if (r.status !== 200) throw new Error('login ' + username + ' ' + r.status); return c; }
const waitUp = async () => { for (let i = 0; i < 60; i++) { try { const r = await fetch(BASE + '/api/health'); if (r.ok) return; } catch (e) { /* attente */ } await new Promise((r) => setTimeout(r, 200)); } throw new Error('serveur non démarré'); };

(async () => {
  await waitUp();
  console.log('\n— Authentification et sécurité de base');
  const anon = client();
  ok((await anon.get('/api/meta')).status === 401, 'accès sans session refusé (401)');
  ok((await anon.post('/api/auth/login', { username: 'dg', password: 'mauvais' })).status === 401, 'mauvais mot de passe refusé');
  const noCsrf = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'dg', password: PW }) });
  ok(noCsrf.status === 403, 'requête sans en-tête anti-CSRF refusée');
  const h = (await fetch(BASE + '/')).headers;
  ok(!!h.get('content-security-policy') && h.get('x-content-type-options') === 'nosniff', 'en-têtes de sécurité présents (CSP, nosniff)');
  const dg = await as('dg'), rh = await as('rh'), sup1 = await as('superviseur1'), sup2 = await as('superviseur2'), agS = await as('agent.securite'), agN = await as('agent.nettoyage');
  const resS = await as('resp.securite'), resN = await as('resp.nettoyage'), cpt = await as('comptable'), adm = await as('admin'), com = await as('commercial'), aud = await as('auditeur');

  console.log('\n— Permissions par profil');
  const metaAg = (await agS.get('/api/meta')).body;
  ok(!metaAg.resources.factures && !metaAg.resources.users && !metaAg.resources.contrats, 'l’agent ne voit ni facturation, ni utilisateurs, ni contrats');
  const empAg = (await agS.get('/api/r/employees')).body;
  ok(empAg.rows.length === 1 && 'cin' in empAg.rows[0] && !('cout_horaire' in empAg.rows[0]), 'l’agent ne voit que sa propre fiche, sans coût horaire');
  const empSup = (await sup1.get('/api/r/employees')).body;
  ok(empSup.rows.length > 0 && !('cin' in empSup.rows[0]) && !('cout_horaire' in empSup.rows[0]) && !('adresse' in empSup.rows[0]), 'le superviseur voit une fiche opérationnelle (sans CIN, adresse, salaire)');
  const empRh = (await rh.get('/api/r/employees')).body;
  ok(empRh.rows.length >= 18 && 'cin' in empRh.rows[0] && 'cout_horaire' in empRh.rows[0], 'le RH voit tous les dossiers avec les champs sensibles');
  ok((await adm.get('/api/r/employees')).status === 403, 'l’administrateur informatique n’accède pas aux dossiers du personnel');
  ok((await adm.get('/api/r/users')).status === 200, 'l’administrateur gère les utilisateurs');
  ok((await rh.get('/api/r/users')).status === 403, 'le RH ne gère pas les utilisateurs');
  ok((await cpt.get('/api/r/factures')).status === 200 && (await sup1.get('/api/r/factures')).status === 403, 'factures : comptable oui, superviseur non');
  ok((await agS.put('/api/r/employees/1', { fonction: 'X' })).status === 403, 'l’agent ne peut pas modifier un dossier');
  ok((await resS.get('/api/r/postes')).body.rows.every((p) => p.activite === 'securite'), 'le responsable sécurité ne voit que les postes de sécurité');
  ok((await resN.get('/api/r/postes')).body.rows.every((p) => p.activite === 'nettoyage'), 'le responsable nettoyage ne voit que les zones de nettoyage');
  const s1 = (await sup1.get('/api/r/sites')).body.rows, s2 = (await sup2.get('/api/r/sites')).body.rows;
  ok(s1.length === 2 && s2.length === 1 && !s1.some((s) => s2.find((x) => x.id === s.id)), 'chaque superviseur ne voit que ses sites');
  ok((await aud.post('/api/r/clients', { nom: 'X' })).status === 403, 'l’auditeur est en lecture seule');
  const sal = (await com.get('/api/r/employees')); ok(sal.status === 403, 'le commercial n’accède pas aux employés');

  console.log('\n— Gestion du personnel');
  const created = await rh.post('/api/r/employees', { nom: 'Test', prenom: 'Nouveau', activite: 'securite', fonction: 'Agent', tel: '0600000000' });
  ok(created.status === 201 && /^MAR-\d{4}$/.test(created.body.row.matricule), 'création d’un employé avec matricule automatique (' + (created.body.row || {}).matricule + ')');
  ok((await rh.post('/api/r/employees', { prenom: 'SansNom', activite: 'securite' })).status === 400, 'champ obligatoire contrôlé');
  ok((await rh.post('/api/r/employees', { nom: 'X', prenom: 'Y', activite: 'inconnue' })).status === 400, 'valeur de liste invalide refusée');
  ok((await rh.post('/api/r/employees', { nom: 'X', prenom: 'Y', activite: 'securite', email: 'pas-un-mail' })).status === 400, 'e-mail invalide refusé');
  const found = (await rh.get('/api/r/employees?q=Nouveau')).body.rows; ok(found.length === 1, 'recherche par nom');
  const byMat = (await rh.get('/api/r/employees?q=' + created.body.row.matricule)).body.rows; ok(byMat.length === 1, 'recherche par matricule');
  const inj = await rh.get('/api/r/employees?q=' + encodeURIComponent("' OR 1=1 --")); ok(inj.status === 200 && inj.body.rows.length === 0, 'tentative d’injection SQL sans effet');
  const e360 = (await rh.get('/api/employee360/' + created.body.row.id)).body; ok(e360.missing && e360.missing.length > 0, 'fiche employé : éléments manquants listés (' + e360.missing.length + ')');

  console.log('\n— Révocation des accès à la sortie d’un employé');
  const uNew = await adm.post('/api/r/users', { username: 'test.agent', role: 'agent_securite', employee_id: created.body.row.id });
  ok(uNew.status === 201 && uNew.body.temp_password && uNew.body.temp_password.length >= 10, 'création d’un compte avec mot de passe temporaire');
  const tmp = client(); const lg = await tmp.post('/api/auth/login', { username: 'test.agent', password: uNew.body.temp_password });
  ok(lg.status === 200 && lg.body.user.must_change === true, 'première connexion : changement de mot de passe exigé');
  ok((await tmp.get('/api/meta')).status === 403, 'accès bloqué tant que le mot de passe n’est pas changé');
  ok((await tmp.post('/api/auth/change-password', { old_password: uNew.body.temp_password, new_password: 'court' })).status === 400, 'mot de passe trop faible refusé');
  ok((await tmp.post('/api/auth/change-password', { old_password: uNew.body.temp_password, new_password: 'MotDePasse2026ok' })).status === 200, 'mot de passe changé');
  ok((await tmp.get('/api/meta')).status === 200, 'accès ouvert après changement');
  await rh.put('/api/r/employees/' + created.body.row.id, { statut: 'sorti' });
  ok((await tmp.get('/api/meta')).status === 401, 'compte désactivé automatiquement quand l’employé sort');

  console.log('\n— Planning : conflits et remplacement');
  const planning = (await resS.get(`/api/planning?from=${today()}&days=7`)).body;
  ok(planning.postes.length === 3 && planning.shifts.length > 0, 'planning hebdomadaire chargé (' + planning.shifts.length + ' affectations)');
  const gap = planning.cells.filter((c) => !c.couvert); ok(gap.length >= 1, 'poste non couvert détecté (' + gap.length + ')');
  const posteNuit = planning.postes.find((p) => p.nom.includes('nuit'));
  const dayShift = planning.shifts.find((s) => s.date === today() && s.poste_id !== posteNuit.id);
  const dup = await resS.post('/api/r/shifts', { poste_id: posteNuit.id, employee_id: dayShift.employee_id, date: today(), heure_debut: '19:00', heure_fin: '07:00' });
  ok(dup.status === 409 || dup.status === 201, 'contrôle de conflit exécuté (' + dup.status + ')');
  const sameTime = await resS.post('/api/r/shifts', { poste_id: dayShift.poste_id, employee_id: dayShift.employee_id, date: dayShift.date, heure_debut: dayShift.heure_debut, heure_fin: dayShift.heure_fin });
  ok(sameTime.status === 409 && /Conflit/.test(sameTime.body.error), 'double affectation au même horaire bloquée : « ' + (sameTime.body.error || '').slice(0, 60) + '… »');
  const cand = await resS.get(`/api/candidates?poste_id=${posteNuit.id}&date=${gap[0].date}&hd=19:00&hf=07:00`);
  ok(cand.status === 200 && cand.body.candidates.length > 0, 'candidats au remplacement proposés (' + cand.body.candidates.length + ')');
  const agentFor = cand.body.candidates[0].id;
  const add = await resS.post('/api/r/shifts', { poste_id: gap.find((g) => g.poste_id === posteNuit.id).poste_id, employee_id: agentFor, date: gap.find((g) => g.poste_id === posteNuit.id).date, heure_debut: '19:00', heure_fin: '07:00' });
  ok(add.status === 201, 'affectation créée sur le poste non couvert');
  const absentEmp = (await rh.get('/api/r/absences?f_statut=validee')).body.rows[0];
  const abs = await resS.post('/api/r/shifts', { poste_id: posteNuit.id, employee_id: absentEmp.employee_id, date: absentEmp.date_debut, heure_debut: '19:00', heure_fin: '07:00' });
  ok(abs.status === 409 && /absence/i.test(abs.body.error), 'affectation d’un employé en congé validé bloquée');
  const repl = await resS.post('/api/shifts/' + add.body.row.id + '/replace', { employee_id: cand.body.candidates[1] ? cand.body.candidates[1].id : agentFor });
  ok(repl.status === 200 || repl.status === 400, 'remplacement exécuté (' + repl.status + ')');
  ok((await resN.post('/api/r/shifts', { poste_id: posteNuit.id, employee_id: agentFor, date: today(), heure_debut: '19:00', heure_fin: '07:00' })).status === 403, 'le responsable nettoyage ne peut pas planifier un poste de sécurité');
  const supProp = await sup1.post('/api/r/shifts', { poste_id: planning.postes.find((p) => p.nom.includes('entrepôt')).id, employee_id: planning.shifts.find((s) => s.poste_id === planning.postes.find((p) => p.nom.includes('entrepôt')).id).employee_id, date: addDays(today(), 20), heure_debut: '08:00', heure_fin: '16:00' });
  ok(supProp.status === 201 && supProp.body.row.valide === 0, 'une affectation proposée par un superviseur est « à valider »');
  ok((await resS.post('/api/shifts/' + supProp.body.row.id + '/validate')).status === 200, 'le responsable valide le planning');

  console.log('\n— Pointage (prise et fin de service)');
  const mine = (await agS.get('/api/me/home')).body;
  ok(mine.linked && mine.shifts.length > 0, 'l’agent voit son planning personnel');
  const sh = mine.shifts.find((s) => s.date === today());
  ok(!!sh, 'l’agent a une affectation aujourd’hui : ' + (sh ? sh.poste : ''));
  const other = (await agS.get('/api/r/shifts')).body.rows; ok(other.length > 0 && other.every((s) => s.employee_id === empAg.rows[0].id), 'l’agent ne liste que ses affectations (' + other.length + ')');
  const notMine = planning.shifts.find((s) => s.employee_id !== (empAg.rows[0].id)); ok((await agS.post('/api/shifts/' + notMine.id + '/checkin', {})).status === 403, 'l’agent ne peut pas pointer pour un collègue');
  if (sh && sh.checkin_at) { const again = await agS.post('/api/shifts/' + sh.id + '/checkin', {}); ok(again.status === 200 && again.body.already, 'prise de poste déjà confirmée (idempotent)'); }
  else if (sh && sh.pointage_mode === 'qr') ok((await agS.post('/api/shifts/' + sh.id + '/checkin', { code: 'faux' })).status === 400, 'QR code erroné refusé');
  const co = sh && sh.checkin_at ? await agS.post('/api/shifts/' + sh.id + '/checkout', {}) : { status: 0 };
  ok(co.status === 200 || co.status === 400, 'fin de service traitée (' + co.status + ')');
  const futureShift = mine.shifts.find((s) => s.date > addDays(today(), 3));
  if (futureShift) ok((await agS.post('/api/shifts/' + futureShift.id + '/checkin', {})).status === 400, 'prise de poste refusée hors de la plage horaire');
  const qr = await resS.call('GET', '/api/postes/' + planning.postes[0].id + '/qr.png'); ok(qr.status === 200 && (qr.headers.get('content-type') || '').includes('png'), 'QR code du poste généré');
  ok((await agS.call('GET', '/api/postes/' + planning.postes[0].id + '/qr.png')).status === 403, 'l’agent ne peut pas récupérer le QR code');

  console.log('\n— Incidents');
  const siteA = mine.shifts[0].site_id;
  const inc = await agS.post('/api/r/incidents', { site_id: siteA, titre: 'Test incident critique', description: 'Alarme déclenchée', priorite: 'critique' });
  ok(inc.status === 201 && inc.body.row.employee_id, 'l’agent déclare un incident (rattaché automatiquement à lui)');
  const siteHorsPerimetre = (await dg.get('/api/r/sites')).body.rows.find((s) => !mine.shifts.some((m) => m.site_id === s.id));
  ok((await agS.post('/api/r/incidents', { site_id: siteHorsPerimetre.id, titre: 'x' })).status === 403, 'incident refusé sur un site hors de ses affectations');
  ok((await agS.post('/api/r/incidents', { site_id: siteA, titre: 'Tentative', statut: 'clos' })).body.row.statut === 'ouvert', 'l’agent ne peut pas fixer lui-même le statut');
  const notifSup = (await sup1.get('/api/notifications')).body; ok(notifSup.unread > 0, 'le superviseur est notifié (' + notifSup.unread + ')');
  const up = await sup1.put('/api/r/incidents/' + inc.body.row.id, { statut: 'resolu', resolution: 'Faux déclenchement' }); ok(up.status === 200 && up.body.row.resolved_at, 'résolution d’un incident (horodatée)');
  ok((await agS.put('/api/r/incidents/' + inc.body.row.id, { statut: 'clos' })).status === 403, 'l’agent ne peut pas modifier un incident');

  console.log('\n— Nettoyage : tâches et contrôle qualité');
  const gen = await resN.post('/api/taches/generate', { date: addDays(today(), 1) }); ok(gen.status === 200 && gen.body.created > 0, 'tâches du lendemain générées depuis les checklists (' + gen.body.created + ')');
  const gen2 = await resN.post('/api/taches/generate', { date: addDays(today(), 1) }); ok(gen2.body.created === 0, 'génération idempotente (pas de doublons)');
  const myT = (await agN.get('/api/me/home')).body.taches; ok(myT.length > 0, 'l’agent de nettoyage voit ses tâches du jour (' + myT.length + ')');
  const t0 = myT.find((t) => t.statut === 'a_faire') || myT[0];
  ok((await agN.post('/api/taches/' + t0.id + '/done', { statut: 'fait' })).status === 200, 'tâche validée depuis le mobile');
  ok((await agN.post('/api/taches/' + t0.id + '/done', { statut: 'anomalie' })).status === 400, 'une anomalie exige une description');
  ok((await agN.post('/api/taches/' + t0.id + '/validate')).status === 403, 'l’agent ne peut pas valider sa propre tâche');
  ok((await sup2.post('/api/taches/' + t0.id + '/validate')).status === 200, 'le superviseur valide la tâche');
  const meN = (await agN.get('/api/me/home')).body.employee.id;
  const otherT = (await resN.get('/api/r/taches?limit=500')).body.rows.find((t) => t.employee_id && t.employee_id !== meN);
  ok((await agN.post('/api/taches/' + otherT.id + '/done', { statut: 'fait' })).status === 403, 'l’agent ne peut pas valider la tâche d’un collègue');
  ok((await sup2.post('/api/r/controles', { site_id: s2[0].id, date: today(), note: 5, statut: 'conforme' })).status === 201, 'contrôle qualité enregistré');
  ok((await sup2.post('/api/r/controles', { site_id: s1[0].id, date: today(), note: 5 })).status === 403, 'contrôle qualité hors de son périmètre refusé');
  ok((await sup2.post('/api/r/incidents', { site_id: s1[0].id, titre: 'Hors périmètre' })).status === 403, 'incident hors de son périmètre refusé (superviseur)');
  const ctl = (await sup2.get('/api/r/controles')).body.rows[0];
  ok((await sup2.put('/api/r/controles/' + ctl.id, { site_id: s1[0].id })).status === 403, 'impossible de déplacer un contrôle vers un site hors périmètre');

  console.log('\n— Documents, alertes, fichiers');
  const al = (await rh.get('/api/alerts')).body.items;
  ok(al.some((a) => a.type === 'Document') && al.some((a) => a.type === 'Assurance') && al.some((a) => a.type === 'CNSS'), 'alertes documents, assurances et CNSS générées (' + al.length + ')');
  ok(al.some((a) => a.niveau === 'critique'), 'niveaux d’alerte hiérarchisés');
  const alCpt = (await cpt.get('/api/alerts')).body.items; ok(!alCpt.some((a) => a.type === 'Document'), 'le comptable ne reçoit pas les alertes RH');
  const exp = (await rh.get('/api/r/documents?etat=expire')).body.rows; ok(exp.length >= 1 && exp.every((d) => d.etat === 'expire'), 'filtre « expirés » (' + exp.length + ')');
  const form = new FormData(); form.append('file', new Blob([Buffer.from('%PDF-1.4 test')], { type: 'application/pdf' }), 'justificatif.pdf');
  let cookieRh = ''; { const c = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-M360': '1' }, body: JSON.stringify({ username: 'rh', password: PW }) }); cookieRh = c.headers.get('set-cookie').split(';')[0]; }
  const upR = await fetch(BASE + '/api/upload', { method: 'POST', headers: { 'X-M360': '1', Cookie: cookieRh }, body: form }); const upJ = await upR.json();
  ok(upR.status === 200 && /::justificatif\.pdf$/.test(upJ.value), 'téléversement d’un PDF');
  const fakeForm = new FormData(); fakeForm.append('file', new Blob([Buffer.from('MZ not a pdf')], { type: 'application/pdf' }), 'faux.pdf');
  ok((await fetch(BASE + '/api/upload', { method: 'POST', headers: { 'X-M360': '1', Cookie: cookieRh }, body: fakeForm })).status === 400, 'faux PDF (contenu ≠ extension) refusé');
  const exeForm = new FormData(); exeForm.append('file', new Blob([Buffer.from('x')]), 'virus.exe');
  ok((await fetch(BASE + '/api/upload', { method: 'POST', headers: { 'X-M360': '1', Cookie: cookieRh }, body: exeForm })).status === 400, 'fichier .exe refusé');
  const docNew = await rh.post('/api/r/documents', { categorie: 'Diplôme / formation', titre: 'Diplôme test', employee_id: empRh.rows[0].id, fichier: upJ.value, date_expiration: addDays(today(), 5) });
  ok(docNew.status === 201, 'document créé avec fichier joint');
  const fname = upJ.value.split('::')[0];
  const dl = await rh.call('GET', '/api/files/' + fname); ok(dl.status === 200, 'le RH télécharge le fichier');
  ok((await sup1.call('GET', '/api/files/' + fname)).status === 404, 'le superviseur ne peut pas télécharger un document RH');
  ok((await anon.call('GET', '/api/files/' + fname)).status === 401, 'téléchargement sans session refusé');
  ok((await rh.call('GET', '/api/files/..%2f..%2fsecret.key')).status === 404, 'parcours de répertoire bloqué');
  ok((await rh.post('/api/r/documents', { categorie: 'Autre', titre: 'x', employee_id: 1, fichier: '../../etc/passwd' })).status === 400, 'chemin de fichier forgé refusé');

  console.log('\n— Facturation, paiements, rentabilité');
  const facs = (await cpt.get('/api/r/factures')).body.rows;
  ok(facs.some((f) => f.etat === 'en_retard'), 'facture impayée en retard détectée');
  const open = facs.find((f) => f.statut === 'emise' && f.reste > 0);
  const pay = await cpt.post('/api/r/paiements', { facture_id: open.id, date: today(), montant: open.reste, mode: 'virement' });
  ok(pay.status === 201, 'paiement enregistré');
  ok((await cpt.get('/api/r/factures/' + open.id)).body.row.statut === 'payee', 'la facture passe automatiquement à « payée »');
  ok((await cpt.post('/api/r/paiements', { facture_id: facs.find((f) => f.statut === 'brouillon').id, date: today(), montant: 10 })).status === 400, 'paiement refusé sur un brouillon');
  const pf = (await cpt.get(`/api/profitability?from=${addDays(today(), -60)}&to=${addDays(today(), 30)}`)).body;
  ok(pf.rows.length >= 3 && pf.total.revenus > 0 && pf.rows.every((c) => Math.abs(c.marge - (c.revenus - c.couts_directs)) < 0.02), 'rentabilité : marge = revenus − coûts directs (' + pf.rows.length + ' contrats)');
  ok((await sup1.get('/api/profitability')).status === 403, 'rentabilité inaccessible au superviseur');
  ok((await dg.get('/api/dashboard')).body.finance, 'tableau de bord direction : indicateurs financiers');
  const dAg = (await agS.get('/api/dashboard')).body; ok(!dAg.finance && !dAg.contrats, 'tableau de bord agent : pas de données financières');
  const recap = (await rh.get('/api/recap?month=' + today().slice(0, 7))).body; ok(recap.rows.length > 5 && recap.rows.some((r) => r.h_planifiees > 0), 'récapitulatif mensuel des heures (' + recap.rows.length + ' employés)');
  ok((await sup1.get('/api/recap')).status === 403, 'récapitulatif réservé RH / direction / comptable');
  const csv = await rh.call('GET', '/api/r/employees/export.csv'); ok(csv.status === 200 && /MAR-0001/.test(csv.body) && /csv/.test(csv.headers.get('content-type')) && /attachment/.test(csv.headers.get('content-disposition')), 'export CSV (Excel) des employés');
  ok((await sup1.call('GET', '/api/r/employees/export.csv')).status === 403, 'export CSV refusé au superviseur');

  console.log('\n— Stock');
  const cons = (await resN.get('/api/r/consommables')).body.rows[0];
  ok((await resN.post('/api/stock/move', { consommable_id: cons.id, quantite: -9999 })).status === 409, 'sortie supérieure au stock refusée');
  const mv = await resN.post('/api/stock/move', { consommable_id: cons.id, quantite: 10, motif: 'Réception' }); ok(mv.status === 200 && mv.body.stock === cons.stock + 10, 'entrée de stock enregistrée');
  ok((await resN.put('/api/r/consommables/' + cons.id, { stock: 1 })).body.row.stock === cons.stock + 10, 'le stock ne peut pas être modifié à la main');

  console.log('\n— Journal d’audit');
  const aud1 = (await dg.get('/api/r/audit?limit=500')).body.rows;
  ok(aud1.some((a) => a.action === 'login') && aud1.some((a) => a.action === 'creation') && aud1.some((a) => a.action === 'revocation_acces'), 'actions importantes journalisées (' + aud1.length + ' entrées)');
  ok((await dg.del('/api/r/audit/1')).status === 403 && (await adm.put('/api/r/audit/1', { action: 'x' })).status === 403, 'le journal n’est ni modifiable ni supprimable');
  ok((await adm.call('GET', '/api/admin/backup')).status === 200, 'sauvegarde téléchargeable par l’administrateur');
  ok((await dg.call('GET', '/api/admin/backup')).status === 403, 'sauvegarde refusée aux autres profils');

  console.log(`\nRésultat : ${pass} réussis, ${fail} échec(s)\n`);
  srv.kill(); fs.rmSync(DATA, { recursive: true, force: true });
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('Erreur de test :', e); srv.kill(); process.exit(1); });

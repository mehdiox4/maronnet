'use strict';
// Définition déclarative des ressources, champs, rôles et périmètres.
// Le même schéma (filtré par rôle) est envoyé au navigateur pour construire les écrans.

const ROLES = {
  admin: 'Administrateur informatique',
  dg: 'Directeur général',
  rh: 'Responsable RH',
  adm: 'Gestionnaire administratif',
  resp_sec: 'Responsable exploitation sécurité',
  resp_net: 'Responsable exploitation nettoyage',
  superviseur: 'Superviseur de site',
  comptable: 'Comptable / responsable financier',
  commercial: 'Responsable commercial',
  agent_securite: 'Agent de sécurité',
  agent_nettoyage: 'Agent de nettoyage',
  auditeur: 'Auditeur autorisé',
};
const AG = ['agent_securite', 'agent_nettoyage'];
const RES = ['resp_sec', 'resp_net'];
const me = (u) => u.employee_id || -1;
const actOf = (role) => ({ resp_sec: 'securite', resp_net: 'nettoyage', agent_securite: 'securite', agent_nettoyage: 'nettoyage' }[role] || null);

const SUP_SITES = (u) => ({ sql: '(SELECT id FROM sites WHERE superviseur_id = ?)', params: [me(u)] });
const AGENT_SITES = (u) => ({ sql: '(SELECT DISTINCT p.site_id FROM shifts s JOIN postes p ON p.id = s.poste_id WHERE s.employee_id = ?)', params: [me(u)] });
const SUP_EMPLOYEES = (u) => ({
  sql: '(SELECT s.employee_id FROM shifts s JOIN postes p ON p.id = s.poste_id WHERE p.site_id IN (SELECT id FROM sites WHERE superviseur_id = ?))',
  params: [me(u)],
});

const OPT = {
  activite: [['securite', 'Sécurité et gardiennage'], ['nettoyage', 'Nettoyage et entretien'], ['administratif', 'Administratif']],
  activiteC: [['securite', 'Sécurité et gardiennage'], ['nettoyage', 'Nettoyage et entretien'], ['mixte', 'Mixte']],
  activiteP: [['securite', 'Poste de sécurité'], ['nettoyage', 'Zone de nettoyage']],
  statutEmp: [['actif', 'Actif'], ['suspendu', 'Suspendu'], ['sorti', 'Sorti']],
  typeContrat: [['CDI', 'CDI'], ['CDD', 'CDD'], ['ANAPEC', 'Contrat ANAPEC / insertion'], ['autre', 'Autre']],
  cnss: [['affilie', 'Affilié'], ['en_cours', 'Démarche en cours'], ['non_affilie', 'Non affilié'], ['anomalie', 'Anomalie']],
  docCat: ['Pièce d’identité', 'Contrat de travail', 'Avenant', 'Attestation de travail', 'Diplôme / formation', 'Justificatif administratif',
    'Assurance', 'CNSS', 'Fin de contrat', 'Contrat client', 'Document commercial', 'Document financier', 'Autre'].map((x) => [x, x]),
  verif: [['depose', 'Déposé'], ['verifie', 'Vérifié / validé'], ['refuse', 'Refusé']],
  absType: [['conge', 'Congé'], ['maladie', 'Maladie'], ['absence', 'Absence'], ['autorisee', 'Absence autorisée'], ['formation', 'Formation']],
  absStatut: [['demande', 'Demandée'], ['validee', 'Validée'], ['refusee', 'Refusée']],
  shiftStatut: [['planifie', 'Planifié'], ['confirme', 'Prise de poste confirmée'], ['termine', 'Terminé'], ['absent', 'Absent'], ['remplace', 'Remplacé'], ['annule', 'Annulé']],
  pointage: [['manuel', 'Manuel (agent)'], ['qr', 'QR code du poste'], ['superviseur', 'Validation du superviseur']],
  priorite: [['faible', 'Faible'], ['normale', 'Normale'], ['elevee', 'Élevée'], ['critique', 'Critique']],
  incStatut: [['ouvert', 'Ouvert'], ['en_cours', 'En cours'], ['resolu', 'Résolu'], ['clos', 'Clos']],
  incType: [['incident', 'Incident'], ['anomalie', 'Anomalie'], ['reclamation', 'Réclamation client'], ['rapport', 'Rapport / observation']],
  tacheStatut: [['a_faire', 'À faire'], ['fait', 'Fait'], ['anomalie', 'Anomalie signalée']],
  ctrlStatut: [['conforme', 'Conforme'], ['reserves', 'Avec réserves'], ['non_conforme', 'Non conforme']],
  eqType: [['uniforme', 'Uniforme'], ['badge', 'Badge'], ['radio', 'Radio'], ['telephone', 'Téléphone'], ['aspirateur', 'Aspirateur'], ['autolaveuse', 'Autolaveuse'],
    ['chariot', 'Chariot'], ['materiel', 'Matériel de nettoyage'], ['autre', 'Autre']],
  eqStatut: [['disponible', 'Disponible'], ['attribue', 'Attribué'], ['maintenance', 'En maintenance'], ['hors_service', 'Hors service']],
  factStatut: [['brouillon', 'Brouillon'], ['emise', 'Émise'], ['payee', 'Payée'], ['impayee', 'Impayée'], ['annulee', 'Annulée']],
  factType: [['facture', 'Facture'], ['avoir', 'Avoir'], ['devis', 'Devis']],
  modePaiement: [['virement', 'Virement'], ['cheque', 'Chèque'], ['especes', 'Espèces'], ['effet', 'Effet'], ['autre', 'Autre']],
  depCat: [['personnel', 'Personnel'], ['produits', 'Produits d’entretien'], ['equipement', 'Équipement'], ['transport', 'Transport'], ['sous_traitance', 'Sous-traitance'], ['autre', 'Autre']],
  contratStatut: [['brouillon', 'Brouillon'], ['actif', 'Actif'], ['a_renouveler', 'À renouveler'], ['termine', 'Terminé'], ['resilie', 'Résilié']],
  portee: [['entreprise', 'Entreprise'], ['employe', 'Employé']],
  cnssType: [['affiliation', 'Affiliation'], ['declaration', 'Déclaration de période'], ['attestation', 'Attestation'], ['autre', 'Autre démarche']],
  cnssStatut: [['a_faire', 'À faire'], ['en_cours', 'En cours'], ['terminee', 'Terminée'], ['anomalie', 'Anomalie à résoudre']],
  roles: Object.entries(ROLES),
};
const S = (opts) => opts; // lisibilité

// f(nom, libellé, type, options)
const f = (n, l, t = 'text', o = {}) => ({ n, l, t, ...o });

const SENS = ['dg', 'rh', 'adm', 'auditeur', ...AG];

const resources = {
  // ------------------------------------------------------------------ PERSONNEL
  employees: {
    table: 'employees', label: 'Employés', singular: 'Employé', group: 'Personnel', icon: '👥',
    labelSql: "t.prenom || ' ' || t.nom || ' (' || COALESCE(t.matricule,'—') || ')'",
    fields: [
      f('matricule', 'Matricule', 'text', { readonly: true, list: true }),
      f('nom', 'Nom', 'text', { req: true, list: true }), f('prenom', 'Prénom', 'text', { req: true, list: true }),
      f('fonction', 'Fonction', 'text', { list: true }),
      f('activite', 'Activité principale', 'select', { opts: OPT.activite, req: true, list: true, filter: true, def: 'securite' }),
      f('statut', 'Statut professionnel', 'select', { opts: OPT.statutEmp, list: true, filter: true, def: 'actif' }),
      f('tel', 'Téléphone', 'tel'), f('email', 'E-mail', 'email', { fr: SENS }),
      f('cin', 'N° pièce d’identité', 'text', { fr: SENS }), f('date_naissance', 'Date de naissance', 'date', { fr: SENS }),
      f('adresse', 'Adresse', 'text', { fr: SENS }),
      f('urgence_nom', 'Contact d’urgence (nom)', 'text', { fr: SENS }), f('urgence_tel', 'Contact d’urgence (tél.)', 'tel', { fr: SENS }),
      f('date_embauche', 'Date d’embauche', 'date', { fr: SENS }),
      f('type_contrat', 'Type de contrat', 'select', { opts: OPT.typeContrat, fr: SENS, filter: true }),
      f('date_fin', 'Date de fin de contrat', 'date', { fr: SENS }),
      f('cnss_numero', 'N° CNSS', 'text', { fr: SENS }), f('cnss_statut', 'Statut CNSS', 'select', { opts: OPT.cnss, fr: SENS }),
      f('responsable_id', 'Responsable', 'ref', { ref: 'employees' }),
      f('qualifications', 'Qualifications (séparées par des virgules)', 'text', { help: 'Ex. : SSIAP1, secourisme, habilitation électrique' }),
      f('cout_horaire', 'Coût horaire de référence (MAD)', 'number', { fr: ['dg', 'rh', 'comptable'], fw: ['dg', 'rh'], help: 'Sert à estimer la rentabilité. Méthode à valider avec le comptable.' }),
      f('notes', 'Notes internes', 'textarea', { fr: ['dg', 'rh', 'adm'] }),
    ],
    search: ['nom', 'prenom', 'matricule', 'fonction'], order: 't.nom, t.prenom',
    perms: {
      read: ['dg', 'rh', 'adm', 'resp_sec', 'resp_net', 'superviseur', 'comptable', 'auditeur', ...AG],
      create: ['rh', 'adm'], update: ['rh', 'adm'], delete: ['rh'], export: ['dg', 'rh', 'adm', 'auditeur'],
    },
    scope(u) {
      if (AG.includes(u.role)) return { sql: 't.id = ?', params: [me(u)] };
      if (RES.includes(u.role)) return { sql: 't.activite = ?', params: [actOf(u.role)] };
      if (u.role === 'superviseur') { const s = SUP_EMPLOYEES(u); return { sql: `(t.id IN ${s.sql} OR t.responsable_id = ? OR t.id = ?)`, params: [...s.params, me(u), me(u)] }; }
      return null;
    },
    optionScope(u) { if (RES.includes(u.role)) return { sql: 't.activite = ?', params: [actOf(u.role)] }; return null; },
    optionRoles: ['admin', 'dg', 'rh', 'adm', 'resp_sec', 'resp_net', 'superviseur', 'comptable'],
  },
  users: {
    table: 'users', label: 'Utilisateurs', singular: 'Utilisateur', group: 'Administration', icon: '🔑',
    labelSql: 't.username',
    fields: [
      f('username', 'Identifiant', 'text', { req: true, list: true }),
      f('role', 'Rôle', 'select', { opts: OPT.roles, req: true, list: true, filter: true }),
      f('employee_id', 'Employé lié', 'ref', { ref: 'employees', list: true, help: 'Obligatoire pour les agents et superviseurs (planning, pointage).' }),
      f('active', 'Compte actif', 'bool', { list: true, def: 1 }),
      f('last_login', 'Dernière connexion', 'text', { readonly: true, list: true }),
    ],
    search: ['username'], order: 't.username',
    perms: { read: ['admin'], create: ['admin'], update: ['admin'], delete: ['admin'], export: [] },
    scope: () => null,
    hidden: ['password_hash', 'failed_attempts', 'locked_until'],
  },
  documents: {
    table: 'documents', label: 'Documents', singular: 'Document', group: 'Personnel', icon: '📄',
    labelSql: 't.titre',
    fields: [
      f('categorie', 'Catégorie', 'select', { opts: OPT.docCat, req: true, list: true, filter: true }),
      f('titre', 'Titre', 'text', { req: true, list: true }),
      f('employee_id', 'Employé concerné', 'ref', { ref: 'employees', list: true }),
      f('client_id', 'Client concerné', 'ref', { ref: 'clients', list: true }),
      f('date_creation', 'Date de création', 'date'), f('date_expiration', 'Date d’expiration', 'date', { list: true }),
      f('statut_verif', 'Statut de vérification', 'select', { opts: OPT.verif, list: true, filter: true, def: 'depose' }),
      f('valide_par', 'Validé par', 'text', { readonly: true }),
      f('fichier', 'Fichier', 'file', { list: true }), f('notes', 'Notes', 'textarea'),
    ],
    search: ['titre', 'categorie'], order: 't.date_expiration IS NULL, t.date_expiration, t.id DESC',
    perms: { read: ['dg', 'rh', 'adm', 'auditeur', 'commercial', 'comptable', ...AG], create: ['rh', 'adm', 'commercial', 'dg'], update: ['rh', 'adm', 'commercial', 'dg'], delete: ['rh', 'adm'], export: ['dg', 'rh', 'adm', 'auditeur'] },
    scope(u) {
      if (AG.includes(u.role)) return { sql: 't.employee_id = ?', params: [me(u)] };
      if (['commercial', 'comptable'].includes(u.role)) return { sql: 't.client_id IS NOT NULL', params: [] };
      return null;
    },
    computed: ['etat'],
  },
  formations: {
    table: 'formations', label: 'Formations et qualifications', singular: 'Formation', group: 'Personnel', icon: '🎓',
    labelSql: 't.intitule',
    fields: [
      f('employee_id', 'Employé', 'ref', { ref: 'employees', req: true, list: true }),
      f('intitule', 'Intitulé', 'text', { req: true, list: true }), f('organisme', 'Organisme', 'text', { list: true }),
      f('date_obtention', 'Date d’obtention', 'date', { list: true }), f('date_expiration', 'Date d’expiration', 'date', { list: true }),
      f('notes', 'Notes', 'textarea'),
    ],
    search: ['intitule', 'organisme'], order: 't.date_expiration IS NULL, t.date_expiration',
    perms: { read: ['dg', 'rh', 'adm', 'resp_sec', 'resp_net', 'superviseur', 'auditeur', ...AG], create: ['rh', 'adm'], update: ['rh', 'adm'], delete: ['rh'], export: ['dg', 'rh'] },
    scope(u) {
      if (AG.includes(u.role)) return { sql: 't.employee_id = ?', params: [me(u)] };
      if (u.role === 'superviseur') { const s = SUP_EMPLOYEES(u); return { sql: `t.employee_id IN ${s.sql}`, params: s.params }; }
      if (RES.includes(u.role)) return { sql: 't.employee_id IN (SELECT id FROM employees WHERE activite = ?)', params: [actOf(u.role)] };
      return null;
    },
    computed: ['etat'],
  },
  absences: {
    table: 'absences', label: 'Absences et congés', singular: 'Absence', group: 'Personnel', icon: '🗓️',
    labelSql: "t.type || ' ' || t.date_debut",
    fields: [
      f('employee_id', 'Employé', 'ref', { ref: 'employees', req: true, list: true }),
      f('type', 'Type', 'select', { opts: OPT.absType, req: true, list: true, filter: true, def: 'conge' }),
      f('date_debut', 'Du', 'date', { req: true, list: true }), f('date_fin', 'Au', 'date', { req: true, list: true }),
      f('statut', 'Statut', 'select', { opts: OPT.absStatut, list: true, filter: true, def: 'demande', fw: ['rh', 'adm'] }),
      f('motif', 'Motif', 'textarea'), f('justificatif', 'Justificatif', 'file'),
    ],
    search: ['motif'], order: 't.date_debut DESC',
    perms: { read: ['dg', 'rh', 'adm', 'resp_sec', 'resp_net', 'superviseur', 'auditeur', ...AG], create: ['rh', 'adm', ...AG], update: ['rh', 'adm'], delete: ['rh'], export: ['dg', 'rh', 'comptable'] },
    scope(u) {
      if (AG.includes(u.role)) return { sql: 't.employee_id = ?', params: [me(u)] };
      if (u.role === 'superviseur') { const s = SUP_EMPLOYEES(u); return { sql: `t.employee_id IN ${s.sql}`, params: s.params }; }
      if (RES.includes(u.role)) return { sql: 't.employee_id IN (SELECT id FROM employees WHERE activite = ?)', params: [actOf(u.role)] };
      return null;
    },
  },
  assurances: {
    table: 'assurances', label: 'Assurances', singular: 'Assurance', group: 'Personnel', icon: '🛡️',
    labelSql: "t.organisme || ' ' || COALESCE(t.reference,'')",
    fields: [
      f('organisme', 'Organisme', 'text', { req: true, list: true }), f('reference', 'Référence contrat / police', 'text', { list: true }),
      f('portee', 'Portée', 'select', { opts: OPT.portee, list: true, def: 'entreprise' }),
      f('employee_id', 'Employé (si individuelle)', 'ref', { ref: 'employees', list: true }),
      f('date_debut', 'Début de couverture', 'date', { list: true }), f('date_fin', 'Échéance', 'date', { list: true }),
      f('notes', 'Notes / justificatifs', 'textarea'),
    ],
    search: ['organisme', 'reference'], order: 't.date_fin IS NULL, t.date_fin',
    perms: { read: ['dg', 'rh', 'adm', 'auditeur'], create: ['rh', 'adm'], update: ['rh', 'adm'], delete: ['rh', 'adm'], export: ['dg', 'rh', 'adm'] },
    scope: () => null, computed: ['etat'],
  },
  cnss: {
    table: 'cnss_demarches', label: 'Suivi CNSS', singular: 'Démarche CNSS', group: 'Personnel', icon: '🏛️',
    labelSql: "t.type || ' ' || COALESCE(t.periode,'')",
    note: 'Suivi administratif interne uniquement : la plateforme n’effectue aucune déclaration ni aucun paiement auprès de la CNSS.',
    fields: [
      f('employee_id', 'Employé', 'ref', { ref: 'employees', list: true }),
      f('type', 'Type', 'select', { opts: OPT.cnssType, req: true, list: true, filter: true, def: 'affiliation' }),
      f('periode', 'Période concernée', 'text', { list: true, help: 'Ex. : 2026-09' }),
      f('statut', 'Statut', 'select', { opts: OPT.cnssStatut, list: true, filter: true, def: 'a_faire' }),
      f('date_echeance', 'Échéance', 'date', { list: true }), f('justificatif_ok', 'Justificatif disponible', 'bool', { list: true }),
      f('anomalie', 'Anomalie à résoudre', 'textarea'), f('notes', 'Notes', 'textarea'),
    ],
    search: ['periode', 'anomalie'], order: 't.date_echeance IS NULL, t.date_echeance',
    perms: { read: ['dg', 'rh', 'adm', 'auditeur'], create: ['rh', 'adm'], update: ['rh', 'adm'], delete: ['rh', 'adm'], export: ['dg', 'rh', 'adm'] },
    scope: () => null, computed: ['etat'],
  },
  // ------------------------------------------------------------------ CLIENTS
  clients: {
    table: 'clients', label: 'Clients', singular: 'Client', group: 'Clients et contrats', icon: '🏢',
    labelSql: 't.nom',
    fields: [
      f('nom', 'Nom de l’entreprise / organisme', 'text', { req: true, list: true }),
      f('ville', 'Ville', 'text', { list: true }), f('adresse', 'Adresse', 'text'),
      f('tel', 'Téléphone', 'tel', { list: true }), f('email', 'E-mail', 'email'),
      f('contact_nom', 'Contact principal', 'text', { list: true }), f('contact_tel', 'Tél. du contact', 'tel'), f('contact_email', 'E-mail du contact', 'email'),
      f('notes', 'Notes', 'textarea'),
    ],
    search: ['nom', 'ville', 'contact_nom'], order: 't.nom',
    perms: { read: ['dg', 'commercial', 'adm', 'resp_sec', 'resp_net', 'superviseur', 'comptable', 'auditeur'], create: ['commercial', 'dg'], update: ['commercial', 'dg'], delete: ['dg'], export: ['dg', 'commercial', 'comptable', 'auditeur'] },
    scope(u) { if (u.role === 'superviseur') { const s = SUP_SITES(u); return { sql: `t.id IN (SELECT client_id FROM sites WHERE id IN ${s.sql})`, params: s.params }; } return null; },
    detail: 'client360',
  },
  sites: {
    table: 'sites', label: 'Sites d’intervention', singular: 'Site', group: 'Clients et contrats', icon: '📍',
    labelSql: "t.nom || COALESCE(' — ' || (SELECT nom FROM clients WHERE id = t.client_id), '')",
    fields: [
      f('client_id', 'Client', 'ref', { ref: 'clients', req: true, list: true, filter: true }),
      f('nom', 'Nom du site', 'text', { req: true, list: true }), f('ville', 'Ville', 'text', { list: true }), f('adresse', 'Adresse', 'text'),
      f('superviseur_id', 'Superviseur du site', 'ref', { ref: 'employees', list: true }),
      f('contact_site', 'Contact sur site', 'text'), f('consignes', 'Consignes particulières', 'textarea'),
      f('actif', 'Site actif', 'bool', { def: 1, list: true }),
    ],
    search: ['nom', 'ville', 'adresse'], order: 't.nom',
    perms: { read: ['dg', 'commercial', 'adm', 'resp_sec', 'resp_net', 'superviseur', 'comptable', 'auditeur', ...AG], create: ['commercial', 'dg', 'resp_sec', 'resp_net', 'adm'], update: ['commercial', 'dg', 'resp_sec', 'resp_net', 'adm'], delete: ['commercial', 'dg'], export: ['dg', 'commercial', 'auditeur'] },
    scope(u) {
      if (u.role === 'superviseur') { const s = SUP_SITES(u); return { sql: `t.id IN ${s.sql}`, params: s.params }; }
      if (AG.includes(u.role)) { const s = AGENT_SITES(u); return { sql: `t.id IN ${s.sql}`, params: s.params }; }
      return null;
    },
  },
  contrats: {
    table: 'contrats', label: 'Contrats clients', singular: 'Contrat', group: 'Clients et contrats', icon: '📑',
    labelSql: "t.reference || COALESCE(' — ' || (SELECT nom FROM clients WHERE id = t.client_id), '')",
    fields: [
      f('reference', 'Référence', 'text', { req: true, list: true }),
      f('client_id', 'Client', 'ref', { ref: 'clients', req: true, list: true, filter: true }),
      f('site_id', 'Site principal', 'ref', { ref: 'sites', list: true }),
      f('activite', 'Prestation', 'select', { opts: OPT.activiteC, req: true, list: true, filter: true, def: 'securite' }),
      f('statut', 'Statut', 'select', { opts: OPT.contratStatut, list: true, filter: true, def: 'actif' }),
      f('date_debut', 'Début', 'date', { list: true }), f('date_fin', 'Fin', 'date', { list: true }),
      f('preavis_jours', 'Alerte de renouvellement (jours avant la fin)', 'number', { def: 90 }),
      f('nb_agents', 'Agents / intervenants requis', 'number'), f('tarif_mensuel', 'Tarif mensuel HT (MAD)', 'number', { fr: ['dg', 'commercial', 'comptable', 'auditeur'] }),
      f('horaires', 'Horaires et fréquences', 'textarea'), f('conditions', 'Conditions contractuelles', 'textarea'),
    ],
    search: ['reference'], order: 't.date_fin IS NULL, t.date_fin',
    perms: { read: ['dg', 'commercial', 'adm', 'resp_sec', 'resp_net', 'comptable', 'auditeur'], create: ['commercial', 'dg'], update: ['commercial', 'dg'], delete: ['dg'], export: ['dg', 'commercial', 'comptable', 'auditeur'] },
    scope(u) { if (RES.includes(u.role)) return { sql: "t.activite IN (?, 'mixte')", params: [actOf(u.role)] }; return null; },
    computed: ['etat'],
  },
  // ------------------------------------------------------------------ EXPLOITATION
  postes: {
    table: 'postes', label: 'Postes et zones', singular: 'Poste / zone', group: 'Exploitation', icon: '🧭',
    labelSql: "t.nom || COALESCE(' — ' || (SELECT nom FROM sites WHERE id = t.site_id), '')",
    fields: [
      f('site_id', 'Site', 'ref', { ref: 'sites', req: true, list: true, filter: true }),
      f('nom', 'Nom du poste / de la zone', 'text', { req: true, list: true }),
      f('activite', 'Type', 'select', { opts: OPT.activiteP, req: true, list: true, filter: true, def: 'securite' }),
      f('contrat_id', 'Contrat', 'ref', { ref: 'contrats' }),
      f('effectif_requis', 'Effectif requis', 'number', { req: true, list: true, def: 1 }),
      f('heure_debut', 'Début habituel', 'time', { list: true, def: '08:00' }), f('heure_fin', 'Fin habituelle', 'time', { list: true, def: '16:00' }),
      f('jours', 'Jours d’activité (1=lundi … 7=dimanche)', 'text', { def: '1,2,3,4,5,6,7', help: 'Les jours non listés ne sont pas comptés comme « non couverts ».' }),
      f('qualification_requise', 'Qualification requise', 'text', { help: 'Doit figurer dans les qualifications de l’employé (avertissement à l’affectation).' }),
      f('pointage_mode', 'Mode de pointage', 'select', { opts: OPT.pointage, def: 'manuel' }),
      f('consignes', 'Consignes du poste / de la zone', 'textarea'), f('actif', 'Actif', 'bool', { def: 1 }),
    ],
    search: ['nom'], order: 't.site_id, t.nom',
    perms: { read: ['dg', 'resp_sec', 'resp_net', 'superviseur', 'commercial', 'adm', 'auditeur', ...AG], create: ['dg', 'resp_sec', 'resp_net'], update: ['dg', 'resp_sec', 'resp_net'], delete: ['dg', 'resp_sec', 'resp_net'], export: ['dg', 'resp_sec', 'resp_net'] },
    scope(u) {
      if (RES.includes(u.role)) return { sql: 't.activite = ?', params: [actOf(u.role)] };
      if (u.role === 'superviseur') { const s = SUP_SITES(u); return { sql: `t.site_id IN ${s.sql}`, params: s.params }; }
      if (AG.includes(u.role)) { const s = AGENT_SITES(u); return { sql: `t.site_id IN ${s.sql}`, params: s.params }; }
      return null;
    },
    createCheck(u, d) { if (RES.includes(u.role) && d.activite !== actOf(u.role)) return 'Vous ne pouvez gérer que les postes de votre activité.'; },
  },
  shifts: {
    table: 'shifts', label: 'Affectations et pointages', singular: 'Affectation', group: 'Exploitation', icon: '📌',
    labelSql: "t.date || ' ' || t.heure_debut",
    fields: [
      f('date', 'Date', 'date', { req: true, list: true }),
      f('poste_id', 'Poste / zone', 'ref', { ref: 'postes', req: true, list: true, filter: true }),
      f('employee_id', 'Employé', 'ref', { ref: 'employees', req: true, list: true }),
      f('heure_debut', 'Début', 'time', { req: true, list: true }), f('heure_fin', 'Fin', 'time', { req: true, list: true }),
      f('statut', 'Statut', 'select', { opts: OPT.shiftStatut, list: true, filter: true, def: 'planifie' }),
      f('valide', 'Planning validé', 'bool', { list: true, def: 1, fw: ['dg', 'resp_sec', 'resp_net'] }),
      f('checkin_at', 'Prise de poste', 'text', { readonly: true, list: true }), f('checkout_at', 'Fin de service', 'text', { readonly: true, list: true }),
      f('notes', 'Notes', 'textarea'),
    ],
    search: ['notes'], order: 't.date DESC, t.heure_debut',
    perms: { read: ['dg', 'resp_sec', 'resp_net', 'superviseur', 'rh', 'adm', 'auditeur', 'comptable', ...AG], create: ['dg', 'resp_sec', 'resp_net', 'superviseur'], update: ['dg', 'resp_sec', 'resp_net', 'superviseur'], delete: ['dg', 'resp_sec', 'resp_net', 'superviseur'], export: ['dg', 'rh', 'comptable', 'resp_sec', 'resp_net'] },
    scope(u) {
      if (AG.includes(u.role)) return { sql: 't.employee_id = ?', params: [me(u)] };
      if (u.role === 'superviseur') { const s = SUP_SITES(u); return { sql: `t.poste_id IN (SELECT id FROM postes WHERE site_id IN ${s.sql})`, params: s.params }; }
      if (RES.includes(u.role)) return { sql: 't.poste_id IN (SELECT id FROM postes WHERE activite = ?)', params: [actOf(u.role)] };
      return null;
    },
    custom: true,
  },
  incidents: {
    table: 'incidents', label: 'Incidents et réclamations', singular: 'Incident', group: 'Exploitation', icon: '🚨',
    labelSql: 't.titre',
    fields: [
      f('created_at', 'Date', 'text', { readonly: true, list: true }),
      f('type', 'Type', 'select', { opts: OPT.incType, list: true, filter: true, def: 'incident' }),
      f('priorite', 'Priorité', 'select', { opts: OPT.priorite, list: true, filter: true, def: 'normale' }),
      f('statut', 'Statut', 'select', { opts: OPT.incStatut, list: true, filter: true, def: 'ouvert', fw: ['dg', ...RES, 'superviseur'] }),
      f('titre', 'Titre', 'text', { req: true, list: true }),
      f('site_id', 'Site', 'ref', { ref: 'sites', list: true, filter: true }), f('poste_id', 'Poste / zone', 'ref', { ref: 'postes' }),
      f('employee_id', 'Déclaré par', 'ref', { ref: 'employees', readonly: true, list: true }),
      f('description', 'Description', 'textarea'), f('photo', 'Photo', 'file'),
      f('resolution', 'Résolution / actions', 'textarea', { fw: ['dg', ...RES, 'superviseur'] }), f('resolved_at', 'Résolu le', 'text', { readonly: true }),
    ],
    search: ['titre', 'description'], order: "CASE t.priorite WHEN 'critique' THEN 0 WHEN 'elevee' THEN 1 WHEN 'normale' THEN 2 ELSE 3 END, t.id DESC",
    perms: { read: ['dg', ...RES, 'superviseur', 'commercial', 'auditeur', ...AG], create: ['dg', ...RES, 'superviseur', ...AG], update: ['dg', ...RES, 'superviseur'], delete: ['dg'], export: ['dg', ...RES, 'auditeur'] },
    scope(u) {
      if (AG.includes(u.role)) return { sql: 't.employee_id = ?', params: [me(u)] };
      if (u.role === 'superviseur') { const s = SUP_SITES(u); return { sql: `t.site_id IN ${s.sql}`, params: s.params }; }
      if (RES.includes(u.role)) return { sql: 't.poste_id IS NULL OR t.poste_id IN (SELECT id FROM postes WHERE activite = ?)', params: [actOf(u.role)] };
      return null;
    },
  },
  modeles: {
    table: 'modeles_taches', label: 'Checklists (modèles)', singular: 'Tâche modèle', group: 'Nettoyage', icon: '✅',
    labelSql: 't.libelle',
    note: 'Les tâches modèles servent à générer chaque jour les tâches de nettoyage de chaque zone (bouton « Générer les tâches du jour » dans Tâches).',
    fields: [
      f('poste_id', 'Zone', 'ref', { ref: 'postes', req: true, list: true, filter: true, refFilter: { activite: 'nettoyage' } }),
      f('libelle', 'Tâche', 'text', { req: true, list: true }),
      f('jours', 'Jours (1=lundi … 7=dimanche)', 'text', { list: true, def: '1,2,3,4,5', help: 'Ex. : 1,2,3,4,5 pour du lundi au vendredi.' }),
      f('actif', 'Actif', 'bool', { def: 1, list: true }),
    ],
    search: ['libelle'], order: 't.poste_id, t.id',
    perms: { read: ['dg', 'resp_net', 'superviseur', 'agent_nettoyage'], create: ['dg', 'resp_net'], update: ['dg', 'resp_net'], delete: ['dg', 'resp_net'], export: [] },
    scope(u) {
      if (u.role === 'superviseur') { const s = SUP_SITES(u); return { sql: `t.poste_id IN (SELECT id FROM postes WHERE site_id IN ${s.sql})`, params: s.params }; }
      if (AG.includes(u.role)) { const s = AGENT_SITES(u); return { sql: `t.poste_id IN (SELECT id FROM postes WHERE site_id IN ${s.sql})`, params: s.params }; }
      return null;
    },
  },
  taches: {
    table: 'taches', label: 'Tâches de nettoyage', singular: 'Tâche', group: 'Nettoyage', icon: '🧹',
    labelSql: 't.libelle',
    fields: [
      f('date', 'Date', 'date', { req: true, list: true }),
      f('poste_id', 'Zone', 'ref', { ref: 'postes', req: true, list: true, filter: true, refFilter: { activite: 'nettoyage' } }),
      f('libelle', 'Tâche', 'text', { req: true, list: true }),
      f('employee_id', 'Attribuée à', 'ref', { ref: 'employees', list: true }),
      f('statut', 'Statut', 'select', { opts: OPT.tacheStatut, list: true, filter: true, def: 'a_faire' }),
      f('commentaire', 'Commentaire / anomalie', 'textarea'),
      f('valide', 'Validée par le superviseur', 'bool', { list: true, fw: ['dg', 'resp_net', 'superviseur'] }),
      f('done_at', 'Réalisée à', 'text', { readonly: true }),
    ],
    search: ['libelle'], order: 't.date DESC, t.poste_id',
    perms: { read: ['dg', 'resp_net', 'superviseur', 'auditeur', 'agent_nettoyage'], create: ['dg', 'resp_net', 'superviseur'], update: ['dg', 'resp_net', 'superviseur'], delete: ['dg', 'resp_net', 'superviseur'], export: ['dg', 'resp_net'] },
    scope(u) {
      if (u.role === 'agent_nettoyage') return { sql: 't.employee_id = ?', params: [me(u)] };
      if (u.role === 'superviseur') { const s = SUP_SITES(u); return { sql: `t.poste_id IN (SELECT id FROM postes WHERE site_id IN ${s.sql})`, params: s.params }; }
      return null;
    },
    custom: true,
  },
  controles: {
    table: 'controles', label: 'Contrôles qualité', singular: 'Contrôle qualité', group: 'Nettoyage', icon: '⭐',
    labelSql: "t.date || ' contrôle'",
    fields: [
      f('date', 'Date', 'date', { req: true, list: true }),
      f('site_id', 'Site', 'ref', { ref: 'sites', req: true, list: true, filter: true }), f('poste_id', 'Zone / poste', 'ref', { ref: 'postes', list: true }),
      f('controleur_id', 'Contrôleur', 'ref', { ref: 'employees', list: true }),
      f('note', 'Note (1 à 5)', 'number', { list: true }),
      f('statut', 'Résultat', 'select', { opts: OPT.ctrlStatut, list: true, filter: true, def: 'conforme' }),
      f('observations', 'Observations', 'textarea'), f('action_corrective', 'Action corrective', 'textarea'),
    ],
    search: ['observations'], order: 't.date DESC',
    perms: { read: ['dg', ...RES, 'superviseur', 'commercial', 'auditeur'], create: ['dg', ...RES, 'superviseur'], update: ['dg', ...RES, 'superviseur'], delete: ['dg', ...RES], export: ['dg', ...RES, 'auditeur'] },
    scope(u) { if (u.role === 'superviseur') { const s = SUP_SITES(u); return { sql: `t.site_id IN ${s.sql}`, params: s.params }; } return null; },
  },
  // ------------------------------------------------------------------ RESSOURCES
  equipements: {
    table: 'equipements', label: 'Équipements', singular: 'Équipement', group: 'Ressources', icon: '🧰',
    labelSql: "t.libelle || COALESCE(' ' || t.reference, '')",
    fields: [
      f('type', 'Type', 'select', { opts: OPT.eqType, req: true, list: true, filter: true }), f('libelle', 'Désignation', 'text', { req: true, list: true }),
      f('reference', 'Référence / n° de série', 'text', { list: true }),
      f('statut', 'Statut', 'select', { opts: OPT.eqStatut, list: true, filter: true, def: 'disponible' }),
      f('employee_id', 'Attribué à (employé)', 'ref', { ref: 'employees', list: true }), f('site_id', 'Affecté au site', 'ref', { ref: 'sites', list: true }),
      f('date_attribution', 'Date d’attribution', 'date'), f('prochaine_maintenance', 'Prochaine maintenance', 'date', { list: true }),
      f('notes', 'Notes', 'textarea'),
    ],
    search: ['libelle', 'reference'], order: 't.type, t.libelle',
    perms: { read: ['dg', 'rh', 'adm', ...RES, 'auditeur', ...AG], create: ['rh', 'adm', ...RES, 'dg'], update: ['rh', 'adm', ...RES, 'dg'], delete: ['rh', 'adm', ...RES, 'dg'], export: ['dg', 'rh', 'adm'] },
    scope(u) { if (AG.includes(u.role)) return { sql: 't.employee_id = ?', params: [me(u)] }; return null; },
  },
  consommables: {
    table: 'consommables', label: 'Consommables et stocks', singular: 'Consommable', group: 'Ressources', icon: '📦',
    labelSql: 't.libelle',
    fields: [
      f('libelle', 'Désignation', 'text', { req: true, list: true }), f('unite', 'Unité', 'text', { list: true, def: 'unité' }),
      f('stock', 'Stock actuel', 'number', { readonly: true, list: true, help: 'Modifié uniquement par les entrées / sorties.' }),
      f('seuil_alerte', 'Seuil d’alerte', 'number', { list: true }), f('cout_unitaire', 'Coût unitaire (MAD)', 'number', { list: true }),
      f('notes', 'Notes', 'textarea'),
    ],
    search: ['libelle'], order: 't.libelle',
    perms: { read: ['dg', 'adm', ...RES, 'superviseur', 'comptable', 'auditeur'], create: ['dg', 'adm', 'resp_net'], update: ['dg', 'adm', 'resp_net'], delete: ['dg', 'adm', 'resp_net'], export: ['dg', 'adm', 'resp_net', 'comptable'] },
    scope: () => null, custom: true,
  },
  // ------------------------------------------------------------------ FINANCE
  factures: {
    table: 'factures', label: 'Factures, avoirs, devis', singular: 'Facture', group: 'Finance', icon: '🧾',
    labelSql: 't.numero',
    note: 'Outil de suivi de gestion. La conformité de la numérotation et des mentions légales est à valider avec le comptable ; il ne remplace pas un logiciel comptable réglementaire.',
    fields: [
      f('numero', 'Numéro', 'text', { req: true, list: true }), f('type', 'Type', 'select', { opts: OPT.factType, list: true, filter: true, def: 'facture' }),
      f('contrat_id', 'Contrat', 'ref', { ref: 'contrats', req: true, list: true, filter: true }),
      f('date', 'Date', 'date', { req: true, list: true }), f('echeance', 'Échéance de paiement', 'date', { list: true }),
      f('montant_ht', 'Montant HT (MAD)', 'number', { req: true, list: true }), f('tva_taux', 'TVA (%)', 'number', { def: 20 }),
      f('statut', 'Statut', 'select', { opts: OPT.factStatut, list: true, filter: true, def: 'brouillon' }), f('notes', 'Notes', 'textarea'),
    ],
    search: ['numero'], order: 't.date DESC, t.id DESC',
    perms: { read: ['dg', 'comptable', 'commercial', 'auditeur'], create: ['comptable', 'dg'], update: ['comptable', 'dg'], delete: ['comptable', 'dg'], export: ['dg', 'comptable', 'auditeur'] },
    scope: () => null, computed: ['paye', 'reste', 'ttc', 'etat'],
  },
  paiements: {
    table: 'paiements', label: 'Paiements reçus', singular: 'Paiement', group: 'Finance', icon: '💳',
    labelSql: "t.date || ' ' || t.montant",
    fields: [
      f('facture_id', 'Facture', 'ref', { ref: 'factures', req: true, list: true, filter: true }),
      f('date', 'Date', 'date', { req: true, list: true }), f('montant', 'Montant (MAD)', 'number', { req: true, list: true }),
      f('mode', 'Mode', 'select', { opts: OPT.modePaiement, list: true, def: 'virement' }), f('reference', 'Référence', 'text', { list: true }),
    ],
    search: ['reference'], order: 't.date DESC',
    perms: { read: ['dg', 'comptable', 'auditeur'], create: ['comptable', 'dg'], update: ['comptable', 'dg'], delete: ['comptable', 'dg'], export: ['dg', 'comptable', 'auditeur'] },
    scope: () => null,
  },
  depenses: {
    table: 'depenses', label: 'Dépenses', singular: 'Dépense', group: 'Finance', icon: '💸',
    labelSql: "t.libelle",
    fields: [
      f('date', 'Date', 'date', { req: true, list: true }), f('libelle', 'Libellé', 'text', { req: true, list: true }),
      f('categorie', 'Catégorie', 'select', { opts: OPT.depCat, list: true, filter: true, def: 'autre' }),
      f('montant', 'Montant (MAD)', 'number', { req: true, list: true }),
      f('contrat_id', 'Imputée au contrat', 'ref', { ref: 'contrats', list: true }), f('site_id', 'Site', 'ref', { ref: 'sites' }),
      f('justificatif', 'Justificatif', 'file'), f('notes', 'Notes', 'textarea'),
    ],
    search: ['libelle'], order: 't.date DESC',
    perms: { read: ['dg', 'comptable', 'auditeur'], create: ['comptable', 'dg'], update: ['comptable', 'dg'], delete: ['comptable', 'dg'], export: ['dg', 'comptable', 'auditeur'] },
    scope: () => null,
  },
  audit: {
    table: 'audit', label: 'Journal d’audit', singular: 'Entrée', group: 'Administration', icon: '📜', readonlyAll: true,
    labelSql: 't.action',
    fields: [
      f('at', 'Date', 'text', { list: true }), f('username', 'Utilisateur', 'text', { list: true, filter: false }), f('action', 'Action', 'text', { list: true, filter: true }),
      f('resource', 'Ressource', 'text', { list: true, filter: true }), f('rec_id', 'N°', 'text', { list: true }), f('detail', 'Détail', 'text', { list: true }), f('ip', 'IP', 'text'),
    ],
    search: ['username', 'action', 'resource', 'detail'], order: 't.id DESC',
    perms: { read: ['admin', 'dg', 'auditeur'], create: [], update: [], delete: [], export: ['admin', 'dg', 'auditeur'] },
    scope: () => null,
  },
};

// Les clés des filtres "select" dépendent des options ; on normalise ici
for (const [key, r] of Object.entries(resources)) {
  r.key = key;
  for (const fld of r.fields) { if (fld.t === 'bool' && fld.def === undefined) fld.def = 0; }
}

module.exports = { ROLES, AG, RES, OPT, resources, actOf, me, SUP_SITES, AGENT_SITES, SUP_EMPLOYEES };

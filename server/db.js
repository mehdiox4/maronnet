'use strict';
// Couche base de données : SQLite intégré à Node (node:sqlite), aucune compilation native requise.
const path = require('path');
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');

const DATA_DIR = process.env.MARONET_DATA || path.join(__dirname, '..', 'data');
fs.mkdirSync(path.join(DATA_DIR, 'uploads'), { recursive: true });
const DB_FILE = process.env.MARONET_DB || path.join(DATA_DIR, 'maronet360.db');

const raw = new DatabaseSync(DB_FILE);
raw.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');

const db = {
  raw,
  DATA_DIR,
  all: (sql, ...p) => raw.prepare(sql).all(...p),
  get: (sql, ...p) => raw.prepare(sql).get(...p),
  run: (sql, ...p) => raw.prepare(sql).run(...p),
  exec: (sql) => raw.exec(sql),
  tx(fn) {
    raw.exec('BEGIN');
    try { const r = fn(); raw.exec('COMMIT'); return r; } catch (e) { raw.exec('ROLLBACK'); throw e; }
  },
};

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL,
  role TEXT NOT NULL, employee_id INTEGER REFERENCES employees(id) ON DELETE SET NULL,
  active INTEGER NOT NULL DEFAULT 1, must_change INTEGER NOT NULL DEFAULT 1, last_login TEXT,
  failed_attempts INTEGER NOT NULL DEFAULT 0, locked_until TEXT, created_at TEXT DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS employees (
  id INTEGER PRIMARY KEY AUTOINCREMENT, matricule TEXT UNIQUE, nom TEXT NOT NULL, prenom TEXT NOT NULL,
  cin TEXT, date_naissance TEXT, tel TEXT, email TEXT, adresse TEXT,
  urgence_nom TEXT, urgence_tel TEXT, fonction TEXT, activite TEXT NOT NULL DEFAULT 'securite',
  date_embauche TEXT, type_contrat TEXT, statut TEXT NOT NULL DEFAULT 'actif', date_fin TEXT,
  cnss_numero TEXT, cnss_statut TEXT, cout_horaire REAL, responsable_id INTEGER REFERENCES employees(id) ON DELETE SET NULL,
  qualifications TEXT, notes TEXT, created_at TEXT DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS clients (
  id INTEGER PRIMARY KEY AUTOINCREMENT, nom TEXT NOT NULL, adresse TEXT, ville TEXT, tel TEXT, email TEXT,
  contact_nom TEXT, contact_tel TEXT, contact_email TEXT, notes TEXT, created_at TEXT DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS sites (
  id INTEGER PRIMARY KEY AUTOINCREMENT, client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
  nom TEXT NOT NULL, adresse TEXT, ville TEXT, consignes TEXT, contact_site TEXT,
  superviseur_id INTEGER REFERENCES employees(id) ON DELETE SET NULL, actif INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS contrats (
  id INTEGER PRIMARY KEY AUTOINCREMENT, client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
  site_id INTEGER REFERENCES sites(id) ON DELETE SET NULL, reference TEXT NOT NULL, activite TEXT NOT NULL DEFAULT 'securite',
  date_debut TEXT, date_fin TEXT, statut TEXT NOT NULL DEFAULT 'actif', tarif_mensuel REAL, nb_agents INTEGER,
  horaires TEXT, conditions TEXT, preavis_jours INTEGER DEFAULT 90);
CREATE TABLE IF NOT EXISTS postes (
  id INTEGER PRIMARY KEY AUTOINCREMENT, site_id INTEGER NOT NULL REFERENCES sites(id) ON DELETE RESTRICT,
  contrat_id INTEGER REFERENCES contrats(id) ON DELETE SET NULL, nom TEXT NOT NULL,
  activite TEXT NOT NULL DEFAULT 'securite', effectif_requis INTEGER NOT NULL DEFAULT 1,
  heure_debut TEXT DEFAULT '08:00', heure_fin TEXT DEFAULT '16:00', qualification_requise TEXT,
  pointage_mode TEXT NOT NULL DEFAULT 'manuel', jours TEXT NOT NULL DEFAULT '1,2,3,4,5,6,7', qr_token TEXT, consignes TEXT, actif INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS shifts (
  id INTEGER PRIMARY KEY AUTOINCREMENT, poste_id INTEGER NOT NULL REFERENCES postes(id) ON DELETE RESTRICT,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE RESTRICT, date TEXT NOT NULL,
  heure_debut TEXT NOT NULL, heure_fin TEXT NOT NULL, statut TEXT NOT NULL DEFAULT 'planifie',
  valide INTEGER NOT NULL DEFAULT 1, checkin_at TEXT, checkin_method TEXT, checkout_at TEXT,
  remplace_shift_id INTEGER, notes TEXT, created_by INTEGER, created_at TEXT DEFAULT (datetime('now')));
CREATE INDEX IF NOT EXISTS idx_shifts_date ON shifts(date);
CREATE INDEX IF NOT EXISTS idx_shifts_emp ON shifts(employee_id, date);
CREATE TABLE IF NOT EXISTS absences (
  id INTEGER PRIMARY KEY AUTOINCREMENT, employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  type TEXT NOT NULL DEFAULT 'conge', date_debut TEXT NOT NULL, date_fin TEXT NOT NULL,
  statut TEXT NOT NULL DEFAULT 'demande', motif TEXT, justificatif TEXT);
CREATE TABLE IF NOT EXISTS documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT, categorie TEXT NOT NULL, titre TEXT NOT NULL,
  employee_id INTEGER REFERENCES employees(id) ON DELETE CASCADE, client_id INTEGER REFERENCES clients(id) ON DELETE CASCADE,
  date_creation TEXT, date_validite TEXT, date_expiration TEXT, statut_verif TEXT NOT NULL DEFAULT 'depose',
  valide_par TEXT, fichier TEXT, fichier_nom TEXT, notes TEXT, created_at TEXT DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS formations (
  id INTEGER PRIMARY KEY AUTOINCREMENT, employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  intitule TEXT NOT NULL, organisme TEXT, date_obtention TEXT, date_expiration TEXT, notes TEXT);
CREATE TABLE IF NOT EXISTS assurances (
  id INTEGER PRIMARY KEY AUTOINCREMENT, organisme TEXT NOT NULL, reference TEXT, portee TEXT DEFAULT 'entreprise',
  employee_id INTEGER REFERENCES employees(id) ON DELETE CASCADE, date_debut TEXT, date_fin TEXT, notes TEXT);
CREATE TABLE IF NOT EXISTS cnss_demarches (
  id INTEGER PRIMARY KEY AUTOINCREMENT, employee_id INTEGER REFERENCES employees(id) ON DELETE CASCADE,
  type TEXT NOT NULL DEFAULT 'affiliation', periode TEXT, statut TEXT NOT NULL DEFAULT 'a_faire', anomalie TEXT,
  date_echeance TEXT, justificatif_ok INTEGER DEFAULT 0, notes TEXT);
CREATE TABLE IF NOT EXISTS incidents (
  id INTEGER PRIMARY KEY AUTOINCREMENT, site_id INTEGER REFERENCES sites(id) ON DELETE SET NULL,
  poste_id INTEGER REFERENCES postes(id) ON DELETE SET NULL, employee_id INTEGER REFERENCES employees(id) ON DELETE SET NULL,
  type TEXT DEFAULT 'incident', titre TEXT NOT NULL, description TEXT, priorite TEXT NOT NULL DEFAULT 'normale',
  statut TEXT NOT NULL DEFAULT 'ouvert', resolution TEXT, photo TEXT, created_at TEXT DEFAULT (datetime('now')), resolved_at TEXT);
CREATE TABLE IF NOT EXISTS modeles_taches (
  id INTEGER PRIMARY KEY AUTOINCREMENT, poste_id INTEGER NOT NULL REFERENCES postes(id) ON DELETE CASCADE,
  libelle TEXT NOT NULL, jours TEXT NOT NULL DEFAULT '1,2,3,4,5', actif INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS taches (
  id INTEGER PRIMARY KEY AUTOINCREMENT, poste_id INTEGER REFERENCES postes(id) ON DELETE CASCADE,
  employee_id INTEGER REFERENCES employees(id) ON DELETE SET NULL, libelle TEXT NOT NULL, date TEXT NOT NULL,
  statut TEXT NOT NULL DEFAULT 'a_faire', done_at TEXT, commentaire TEXT, valide INTEGER NOT NULL DEFAULT 0, valide_par TEXT);
CREATE INDEX IF NOT EXISTS idx_taches_date ON taches(date);
CREATE TABLE IF NOT EXISTS controles (
  id INTEGER PRIMARY KEY AUTOINCREMENT, site_id INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  poste_id INTEGER REFERENCES postes(id) ON DELETE SET NULL, date TEXT NOT NULL, controleur_id INTEGER REFERENCES employees(id) ON DELETE SET NULL,
  note INTEGER, observations TEXT, action_corrective TEXT, statut TEXT NOT NULL DEFAULT 'conforme');
CREATE TABLE IF NOT EXISTS equipements (
  id INTEGER PRIMARY KEY AUTOINCREMENT, type TEXT NOT NULL DEFAULT 'autre', libelle TEXT NOT NULL, reference TEXT,
  employee_id INTEGER REFERENCES employees(id) ON DELETE SET NULL, site_id INTEGER REFERENCES sites(id) ON DELETE SET NULL,
  statut TEXT NOT NULL DEFAULT 'disponible', date_attribution TEXT, prochaine_maintenance TEXT, notes TEXT);
CREATE TABLE IF NOT EXISTS consommables (
  id INTEGER PRIMARY KEY AUTOINCREMENT, libelle TEXT NOT NULL, unite TEXT DEFAULT 'unité', stock REAL NOT NULL DEFAULT 0,
  seuil_alerte REAL NOT NULL DEFAULT 0, cout_unitaire REAL DEFAULT 0, notes TEXT);
CREATE TABLE IF NOT EXISTS mouvements_stock (
  id INTEGER PRIMARY KEY AUTOINCREMENT, consommable_id INTEGER NOT NULL REFERENCES consommables(id) ON DELETE CASCADE,
  quantite REAL NOT NULL, motif TEXT, site_id INTEGER REFERENCES sites(id) ON DELETE SET NULL,
  contrat_id INTEGER REFERENCES contrats(id) ON DELETE SET NULL, date TEXT NOT NULL, user_id INTEGER);
CREATE TABLE IF NOT EXISTS factures (
  id INTEGER PRIMARY KEY AUTOINCREMENT, contrat_id INTEGER NOT NULL REFERENCES contrats(id) ON DELETE RESTRICT,
  numero TEXT NOT NULL, date TEXT NOT NULL, echeance TEXT, montant_ht REAL NOT NULL DEFAULT 0, tva_taux REAL NOT NULL DEFAULT 20,
  statut TEXT NOT NULL DEFAULT 'brouillon', type TEXT NOT NULL DEFAULT 'facture', notes TEXT);
CREATE TABLE IF NOT EXISTS paiements (
  id INTEGER PRIMARY KEY AUTOINCREMENT, facture_id INTEGER NOT NULL REFERENCES factures(id) ON DELETE CASCADE,
  date TEXT NOT NULL, montant REAL NOT NULL, mode TEXT DEFAULT 'virement', reference TEXT);
CREATE TABLE IF NOT EXISTS depenses (
  id INTEGER PRIMARY KEY AUTOINCREMENT, date TEXT NOT NULL, libelle TEXT NOT NULL, categorie TEXT DEFAULT 'autre',
  montant REAL NOT NULL, contrat_id INTEGER REFERENCES contrats(id) ON DELETE SET NULL, site_id INTEGER REFERENCES sites(id) ON DELETE SET NULL,
  justificatif TEXT, justificatif_nom TEXT, notes TEXT);
CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  titre TEXT NOT NULL, corps TEXT, lien TEXT, lu INTEGER NOT NULL DEFAULT 0, created_at TEXT DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT DEFAULT (datetime('now')), user_id INTEGER, username TEXT,
  action TEXT NOT NULL, resource TEXT, rec_id TEXT, detail TEXT, ip TEXT);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
`;
db.exec(SCHEMA);

// Paramètres par défaut (tous modifiables dans l'application)
const DEFAULTS = {
  societe: 'MARONET',
  seuil_heures_hebdo: '44',      // À VALIDER selon la réglementation applicable et les accords internes
  repos_min_heures: '11',        // À VALIDER : avertissement uniquement
  alerte_jours: '30,15,7',
  alerte_contrat_client_jours: '90,60,30',
  retard_pointage_minutes: '15',
  tva_defaut: '20',
};
for (const [k, v] of Object.entries(DEFAULTS)) db.run('INSERT OR IGNORE INTO settings(key,value) VALUES(?,?)', k, v);
db.getSetting = (k) => (db.get('SELECT value FROM settings WHERE key=?', k) || {}).value;

module.exports = db;

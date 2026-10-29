'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('./db');
const { HttpError, audit } = require('./lib');

const SECRET_FILE = path.join(db.DATA_DIR, 'secret.key');
let SECRET = process.env.MARONET_SECRET;
if (!SECRET) {
  if (!fs.existsSync(SECRET_FILE)) fs.writeFileSync(SECRET_FILE, crypto.randomBytes(48).toString('hex'), { mode: 0o600 });
  SECRET = fs.readFileSync(SECRET_FILE, 'utf8').trim();
}
const COOKIE = 'm360';
const DUMMY_HASH = bcrypt.hashSync('dummy-password-timing', 10);
const SESSION_HOURS = Number(process.env.MARONET_SESSION_HOURS || 10);
const MAX_FAILS = 5;
const LOCK_MIN = 10;

function randomPassword(len = 12) {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  let s = '';
  for (let i = 0; i < len; i++) s += chars[crypto.randomInt(chars.length)];
  return s + '7a'; // garantit lettres + chiffres
}
function checkPasswordPolicy(p) {
  if (typeof p !== 'string' || p.length < 10) throw new HttpError(400, 'Le mot de passe doit contenir au moins 10 caractères.');
  if (!/[a-zA-Z]/.test(p) || !/\d/.test(p)) throw new HttpError(400, 'Le mot de passe doit contenir des lettres et des chiffres.');
  if (p.length > 100) throw new HttpError(400, 'Mot de passe trop long.');
}

// Limitation de débit des tentatives de connexion (mémoire)
const attempts = new Map();
function rateLimited(ip) {
  const now = Date.now();
  const a = (attempts.get(ip) || []).filter((t) => now - t < 10 * 60000);
  attempts.set(ip, a);
  return a.length >= 30;
}
function noteAttempt(ip) { const a = attempts.get(ip) || []; a.push(Date.now()); attempts.set(ip, a); }

function setSession(req, res, user) {
  const token = jwt.sign({ uid: user.id }, SECRET, { expiresIn: `${SESSION_HOURS}h` });
  res.cookie(COOKIE, token, {
    httpOnly: true, sameSite: 'strict', secure: req.secure || process.env.MARONET_COOKIE_SECURE === '1',
    maxAge: SESSION_HOURS * 3600 * 1000, path: '/',
  });
}

// Middleware : charge l'utilisateur depuis le cookie de session
function loadUser(req, res, next) {
  const token = req.cookies && req.cookies[COOKIE];
  if (token) {
    try {
      const { uid } = jwt.verify(token, SECRET);
      const u = db.get('SELECT id, username, role, employee_id, active, must_change FROM users WHERE id = ?', uid);
      if (u && u.active) req.user = u;
    } catch (e) { /* session invalide ou expirée */ }
  }
  next();
}
function requireAuth(req, res, next) {
  if (!req.user) return next(new HttpError(401, 'Session expirée. Veuillez vous reconnecter.'));
  if (req.user.must_change && !req.path.startsWith('/auth/')) return next(new HttpError(403, 'Vous devez d’abord changer votre mot de passe.', { must_change: true }));
  next();
}
// Protection CSRF : les requêtes qui modifient des données doivent porter un en-tête propre à l'application
function csrfGuard(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.get('X-M360') !== '1') return next(new HttpError(403, 'Requête refusée.'));
  next();
}

function login(req, res) {
  const username = String((req.body && req.body.username) || '').trim().toLowerCase();
  const password = String((req.body && req.body.password) || '');
  if (rateLimited(req.ip)) throw new HttpError(429, 'Trop de tentatives. Réessayez dans quelques minutes.');
  noteAttempt(req.ip);
  const u = db.get('SELECT * FROM users WHERE username = ?', username);
  const generic = new HttpError(401, 'Identifiant ou mot de passe incorrect.');
  if (!u || !u.active) { bcrypt.compareSync(password, DUMMY_HASH); audit(req, 'login_echec', 'users', null, username); throw generic; }
  if (u.locked_until && u.locked_until > new Date().toISOString()) throw new HttpError(423, `Compte verrouillé temporairement après trop d’échecs. Réessayez plus tard.`);
  if (!bcrypt.compareSync(password, u.password_hash)) {
    const fails = u.failed_attempts + 1;
    if (fails >= MAX_FAILS) db.run('UPDATE users SET failed_attempts = 0, locked_until = ? WHERE id = ?', new Date(Date.now() + LOCK_MIN * 60000).toISOString(), u.id);
    else db.run('UPDATE users SET failed_attempts = ? WHERE id = ?', fails, u.id);
    audit({ ip: req.ip, user: { id: u.id, username } }, 'login_echec', 'users', u.id);
    throw generic;
  }
  db.run("UPDATE users SET failed_attempts = 0, locked_until = NULL, last_login = datetime('now','localtime') WHERE id = ?", u.id);
  setSession(req, res, u);
  audit({ ip: req.ip, user: u }, 'login', 'users', u.id);
  return publicUser(db.get('SELECT * FROM users WHERE id = ?', u.id));
}
const publicUser = (u) => ({ id: u.id, username: u.username, role: u.role, employee_id: u.employee_id, must_change: !!u.must_change });

function changePassword(req) {
  const { old_password, new_password } = req.body || {};
  const u = db.get('SELECT * FROM users WHERE id = ?', req.user.id);
  if (!bcrypt.compareSync(String(old_password || ''), u.password_hash)) throw new HttpError(400, 'Ancien mot de passe incorrect.');
  checkPasswordPolicy(new_password);
  if (new_password === old_password) throw new HttpError(400, 'Le nouveau mot de passe doit être différent.');
  db.run('UPDATE users SET password_hash = ?, must_change = 0 WHERE id = ?', bcrypt.hashSync(new_password, 11), u.id);
  audit(req, 'mot_de_passe_change', 'users', u.id);
}

// Premier lancement : crée le compte administrateur avec un mot de passe aléatoire
function ensureAdmin() {
  const n = db.get('SELECT COUNT(*) c FROM users').c;
  if (n > 0) return null;
  const pwd = process.env.MARONET_ADMIN_PASSWORD || randomPassword();
  db.run('INSERT INTO users(username, password_hash, role, must_change) VALUES(?,?,?,1)', 'admin', bcrypt.hashSync(pwd, 11), 'admin');
  const f = path.join(db.DATA_DIR, 'PREMIER_LANCEMENT.txt');
  fs.writeFileSync(f, `MARONET 360 — premier lancement\nIdentifiant : admin\nMot de passe temporaire : ${pwd}\n\nChangez ce mot de passe dès la première connexion, puis SUPPRIMEZ ce fichier.\n`, { mode: 0o600 });
  return { username: 'admin', password: pwd, file: f };
}

module.exports = { loadUser, requireAuth, csrfGuard, login, changePassword, ensureAdmin, randomPassword, checkPasswordPolicy, publicUser, bcrypt, setSession, COOKIE };

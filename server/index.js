'use strict';
process.env.TZ = process.env.TZ || 'Africa/Casablanca';
const express = require('express');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const fs = require('fs');
const os = require('os');
const path = require('path');
const db = require('./db');
const auth = require('./auth');
const { HttpError, todayStr } = require('./lib');
const crud = require('./crud');
const custom = require('./custom');

const app = express();
if (process.env.MARONET_TRUST_PROXY) app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(helmet({
  hsts: process.env.MARONET_HTTPS === '1',
  contentSecurityPolicy: { useDefaults: false, directives: {
    defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'", "'unsafe-inline'"], imgSrc: ["'self'", 'data:', 'blob:'],
    connectSrc: ["'self'"], fontSrc: ["'self'"], objectSrc: ["'none'"], frameAncestors: ["'none'"], baseUri: ["'self'"], formAction: ["'self'"],
    manifestSrc: ["'self'"], workerSrc: ["'self'"], mediaSrc: ["'self'", 'blob:'],
  } },
  crossOriginEmbedderPolicy: false,
}));
app.use(cookieParser());
app.use(express.json({ limit: '1mb' }));

const api = express.Router();
api.use(auth.loadUser);
api.use(auth.csrfGuard);
api.use((req, rsp, next) => { rsp.set('Cache-Control', 'no-store'); next(); });
api.use(custom.router.stack.length ? custom.router : (q, s, n) => n()); // routes de session + spécifiques (users, planning, ...)
api.use(crud.router);
api.use((req, rsp, next) => next(new HttpError(404, 'Route inconnue.')));
app.use('/api', api);

app.use(express.static(path.join(__dirname, '..', 'public'), {
  etag: true, maxAge: 0, setHeaders: (res, p) => { if (/\.(html|js|webmanifest)$/.test(p)) res.set('Cache-Control', 'no-cache'); },
}));
app.get('*', (req, rsp, next) => (req.path.startsWith('/api/') ? next() : rsp.sendFile(path.join(__dirname, '..', 'public', 'index.html'))));

// eslint-disable-next-line no-unused-vars
app.use((err, req, rsp, next) => {
  if (err instanceof HttpError) return rsp.status(err.status).json({ error: err.message, ...(err.extra || {}) });
  if (err.type === 'entity.parse.failed') return rsp.status(400).json({ error: 'Requête invalide.' });
  if (err.type === 'entity.too.large') return rsp.status(413).json({ error: 'Requête trop volumineuse.' });
  console.error('[erreur]', req.method, req.originalUrl, err.stack || err);
  rsp.status(500).json({ error: 'Erreur interne du serveur.' });
});

// Sauvegarde automatique quotidienne (14 dernières conservées)
function autoBackup() {
  try {
    const dir = path.join(db.DATA_DIR, 'backups'); fs.mkdirSync(dir, { recursive: true });
    const f = path.join(dir, `auto_${todayStr()}.db`);
    if (!fs.existsSync(f)) {
      custom.backupTo(f);
      const old = fs.readdirSync(dir).filter((x) => x.startsWith('auto_')).sort().slice(0, -14);
      old.forEach((x) => fs.unlinkSync(path.join(dir, x)));
      console.log('[sauvegarde] ' + f);
    }
  } catch (e) { console.error('[sauvegarde] échec :', e.message); }
}

function start() {
  const first = auth.ensureAdmin();
  const PORT = Number(process.env.PORT || 3000), HOST = process.env.HOST || '0.0.0.0';
  const server = app.listen(PORT, HOST, () => {
    console.log('\n  MARONET 360 — serveur démarré');
    console.log(`  Ouvrir : http://localhost:${PORT}`);
    if (HOST === '0.0.0.0') for (const list of Object.values(os.networkInterfaces())) for (const n of list || []) if (n.family === 'IPv4' && !n.internal) console.log(`  Réseau local (téléphones, autres PC) : http://${n.address}:${PORT}`);
    console.log(`  Données : ${db.DATA_DIR}`);
    if (first) {
      console.log('\n  ┌─ PREMIÈRE CONNEXION ───────────────────────────────');
      console.log(`  │ Identifiant   : ${first.username}`);
      console.log(`  │ Mot de passe  : ${first.password}   (à changer dès la connexion)`);
      console.log(`  │ Aussi écrit dans : ${first.file}`);
      console.log('  └────────────────────────────────────────────────────\n');
    }
    autoBackup();
  });
  setInterval(autoBackup, 6 * 3600 * 1000).unref();
  const stop = () => { server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 3000).unref(); };
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
  return server;
}
if (require.main === module) start();
module.exports = { app, start };

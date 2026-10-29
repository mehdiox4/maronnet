'use strict';
const db = require('./db');
const { resources } = require('./schema');

class HttpError extends Error {
  constructor(status, message, extra) { super(message); this.status = status; this.extra = extra; }
}
const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const todayStr = () => ymd(new Date());
const nowStr = (d = new Date()) => `${ymd(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
const addDays = (s, n) => { const d = new Date(s + 'T12:00:00'); d.setDate(d.getDate() + n); return ymd(d); };
const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(new Date(s + 'T12:00:00'));
const isTime = (s) => typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
const toMin = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
const isoWeekday = (s) => { const d = new Date(s + 'T12:00:00').getDay(); return d === 0 ? 7 : d; };
const mondayOf = (s) => addDays(s, -(isoWeekday(s) - 1));
const daysBetween = (a, b) => Math.round((new Date(b + 'T12:00:00') - new Date(a + 'T12:00:00')) / 86400000);

// Plage absolue d'un poste en minutes depuis l'époque locale (gère les nuits)
function shiftRange(date, hd, hf) {
  const base = Math.floor(new Date(date + 'T00:00:00').getTime() / 60000);
  const start = base + toMin(hd);
  let end = base + toMin(hf);
  if (toMin(hf) <= toMin(hd)) end += 1440;
  return [start, end];
}
const shiftHours = (date, hd, hf) => { const [a, b] = shiftRange(date, hd, hf); return (b - a) / 60; };

function audit(req, action, resource, recId, detail) {
  try {
    const u = req && req.user;
    db.run('INSERT INTO audit(user_id, username, action, resource, rec_id, detail, ip) VALUES(?,?,?,?,?,?,?)',
      u ? u.id : null, u ? u.username : (req && req.body && req.body.username) || null, action, resource || null, recId == null ? null : String(recId),
      detail ? String(detail).slice(0, 500) : null, req && req.ip ? req.ip : null);
  } catch (e) { console.error('audit', e.message); }
}

function notify(userIds, titre, corps, lien) {
  const ids = [...new Set(userIds.filter(Boolean))];
  for (const id of ids) db.run('INSERT INTO notifications(user_id, titre, corps, lien) VALUES(?,?,?,?)', id, titre, corps || null, lien || null);
}
const usersOfEmployee = (employeeId) => db.all('SELECT id FROM users WHERE employee_id = ? AND active = 1', employeeId).map((r) => r.id);
const usersOfRoles = (roles) => db.all(`SELECT id FROM users WHERE active = 1 AND role IN (${roles.map(() => '?').join(',')})`, ...roles).map((r) => r.id);

const can = (user, res, action) => !!(res.perms[action] && res.perms[action].includes(user.role));

// Fragment WHERE du périmètre de l'utilisateur pour une ressource ; null = tout ; false = rien
function scopeOf(res, user) {
  if (!can(user, res, 'read')) return false;
  const s = res.scope ? res.scope(user) : null;
  return s || null;
}
// Lignes lisibles d'une ressource, en respectant périmètre ET champs autorisés (usage interne)
function fieldReadable(f, user) { return !f.fr || f.fr.includes(user.role); }

module.exports = { HttpError, pad, ymd, todayStr, nowStr, addDays, isDate, isTime, toMin, isoWeekday, mondayOf, daysBetween, shiftRange, shiftHours,
  audit, notify, usersOfEmployee, usersOfRoles, can, scopeOf, fieldReadable, resources };

'use strict';
// Pages spécifiques : tableau de bord, alertes, planning, accueil agent, fiches 360, finance, notifications, paramètres
(function () {
  const h = M.h; const P = M.pages = {};
  const LV = { critique: ['Critique', 'bad'], alerte: ['Alerte', 'warn'], info: ['Info', 'info'] };
  const monthNow = () => M.today().slice(0, 7);
  const section = (title, ...kids) => h('div', { class: 'card' }, h('h2', null, title), ...kids);
  const table = (heads, rows) => h('div', { class: 'tbl-wrap' }, h('table', null, h('thead', null, h('tr', null, heads.map((x) => h('th', null, x)))), h('tbody', null, rows)));

  // ---------------------------------------------------------------- tableau de bord
  P.dashboard = async (root) => {
    root.append(h('h1', null, 'Tableau de bord'));
    const act = h('select', { 'aria-label': 'Activité' }, h('option', { value: '' }, 'Toutes activités'), h('option', { value: 'securite' }, 'Sécurité'), h('option', { value: 'nettoyage' }, 'Nettoyage'));
    const box = h('div');
    root.append(h('div', { class: 'tools' }, act), box);
    const load = async () => {
      M.clear(box).append(M.spinner());
      try {
        const [d, a] = await Promise.all([M.get('/dashboard', { activite: act.value }), M.get('/alerts')]); M.clear(box);
        const k = h('div', { class: 'grid g4' });
        if (d.couverture) k.append(
          M.kpi('Postes couverts aujourd’hui', `${d.couverture.aujourdhui_couverts} / ${d.couverture.aujourdhui_requis}`, d.couverture.aujourdhui_non_couverts ? `${d.couverture.aujourdhui_non_couverts} non couvert(s)` : 'Tout est couvert', d.couverture.aujourdhui_non_couverts ? 'bad' : 'ok', '#/planning'),
          M.kpi('Postes non couverts (7 jours)', d.couverture.sept_jours_non_couverts, 'Voir le planning', d.couverture.sept_jours_non_couverts ? 'warn' : 'ok', '#/planning'));
        if (d.pointage) k.append(M.kpi('Prises de poste du jour', `${d.pointage.confirmes} / ${d.pointage.total}`, d.pointage.non_confirmes ? `${d.pointage.non_confirmes} en retard de confirmation` : 'Aucun retard', d.pointage.non_confirmes ? 'warn' : 'ok', '#/shifts'));
        if (d.rh) k.append(M.kpi('Employés actifs', d.rh.actifs, `Sécurité ${d.rh.securite} · Nettoyage ${d.rh.nettoyage} · Admin ${d.rh.administratif}`, '', '#/employees'), M.kpi('Dossiers complets', `${d.rh.dossiers_complets} / ${d.rh.actifs}`, 'Voir les employés', d.rh.dossiers_complets < d.rh.actifs ? 'warn' : 'ok', '#/employees'));
        if (d.documents) k.append(M.kpi('Documents expirés', d.documents.expires, `${d.documents.a_renouveler} à renouveler sous 30 j`, d.documents.expires ? 'bad' : 'ok', '#/documents'));
        if (d.absences) k.append(M.kpi('Absents aujourd’hui', d.absences.aujourdhui, `${d.absences.en_attente} demande(s) en attente`, d.absences.en_attente ? 'warn' : '', '#/absences'));
        if (d.nettoyage) k.append(M.kpi('Tâches de nettoyage du jour', `${d.nettoyage.realisees} / ${d.nettoyage.planifiees}`, `${d.nettoyage.anomalies} anomalie(s) · ${d.nettoyage.a_valider} à valider`, d.nettoyage.anomalies ? 'warn' : '', '#/taches'));
        if (d.incidents) k.append(M.kpi('Incidents ouverts', d.incidents.ouverts, `${d.incidents.critiques} prioritaire(s) · ${d.incidents.reclamations} réclamation(s)`, d.incidents.critiques ? 'bad' : '', '#/incidents'));
        if (d.contrats) k.append(M.kpi('Contrats clients actifs', d.contrats.actifs, `${d.contrats.a_renouveler} à renouveler`, d.contrats.a_renouveler ? 'warn' : '', '#/contrats'));
        if (d.finance) k.append(M.kpi('Facturé ce mois (HT)', M.money(d.finance.factures_mois), `À encaisser : ${M.money(d.finance.a_encaisser)}`, '', '#/factures'),
          M.kpi('Impayés en retard', M.money(d.finance.impayes_montant), `${d.finance.impayes_nb} facture(s)`, d.finance.impayes_nb ? 'bad' : 'ok', '#/factures'),
          M.kpi('Marge estimée du mois', M.money(d.finance.marge_estimee), d.finance.taux_marge == null ? 'Taux non calculable' : `Taux : ${d.finance.taux_marge} %`, '', M.has('factures') && M.role() !== 'dg' ? '#/rentabilite' : '#/rentabilite'));
        box.append(k);
        if (d.couverture && d.couverture.a_risque.length) box.append(section('⚠ Postes à risque (7 prochains jours)', table(['Date', 'Site', 'Poste', 'Manque'], d.couverture.a_risque.map((x) => h('tr', null, h('td', null, M.dow(x.date) + ' ' + M.fmtDate(x.date)), h('td', null, x.site), h('td', null, x.poste), h('td', null, h('strong', { style: 'color:var(--bad)' }, x.manque)))))));
        box.append(section(`Alertes (${a.items.length})`, alertList(a.items.slice(0, 12)), a.items.length > 12 ? h('a', { href: '#/alertes' }, `Voir les ${a.items.length} alertes →`) : null));
        box.append(h('p', { class: 'notice' }, 'Les chiffres sont calculés à partir des données saisies. Marge et heures sont des estimations de gestion, pas des données comptables ou de paie.'));
      } catch (e) { M.clear(box).append(h('div', { class: 'alert bad' }, e.message)); }
    };
    act.addEventListener('change', load); M.refresh = load; load();
  };
  function alertList(items) {
    if (!items.length) return M.empty('Aucune alerte. 👍');
    return h('ul', { class: 'list' }, items.map((i) => h('li', null, M.badge(i.niveau === 'critique' ? 'critique' : i.niveau === 'alerte' ? 'elevee' : 'en_cours', (LV[i.niveau] || [i.niveau])[0]),
      h('div', { class: 'grow' }, h('a', { href: i.lien || '#/alertes' }, h('strong', null, i.titre)), h('div', { class: 'small muted' }, i.detail || '')), i.date ? h('span', { class: 'small muted nowrap' }, M.fmtDate(i.date)) : null)));
  }
  P.alertes = async (root) => {
    root.append(h('h1', null, '🔔 Alertes et échéances')); const box = h('div', null, M.spinner()); root.append(box);
    try { const a = await M.get('/alerts'); M.clear(box).append(h('div', { class: 'card' }, alertList(a.items)), h('p', { class: 'notice' }, 'Délais d’alerte paramétrables (par défaut 30/15/7 jours avant échéance). Ils servent de rappels de gestion et ne remplacent pas votre suivi réglementaire.')); } catch (e) { M.clear(box).append(h('div', { class: 'alert bad' }, e.message)); }
  };

  // ---------------------------------------------------------------- planning
  P.planning = async (root, params) => {
    root.append(h('h1', null, '📅 Planning et couverture'));
    let from = params.from || ''; let days = Number(params.days) || 7; const box = h('div'); let activite = '';
    const date = h('input', { type: 'date', 'aria-label': 'Début' });
    const dsel = h('select', { 'aria-label': 'Durée' }, [[7, '7 jours'], [14, '14 jours'], [31, '31 jours']].map(([v, l]) => h('option', { value: v }, l))); dsel.value = days;
    const asel = h('select', { 'aria-label': 'Activité' }, h('option', { value: '' }, 'Toutes activités'), h('option', { value: 'securite' }, 'Sécurité'), h('option', { value: 'nettoyage' }, 'Nettoyage'));
    const shift = (n) => { const base = date.value || M.today(); date.value = M.addDays(base, n); load(); };
    root.append(h('div', { class: 'tools' }, h('button', { class: 'btn', onclick: () => shift(-days) }, '‹'), date, h('button', { class: 'btn', onclick: () => shift(days) }, '›'), h('button', { class: 'btn', onclick: () => { date.value = ''; load(); } }, 'Cette semaine'), dsel, asel, h('span', { class: 'sp' }), h('span', { class: 'small muted' }, 'Cliquez une case pour affecter, un nom pour le modifier.')), box);
    const load = async () => {
      M.clear(box).append(M.spinner()); days = Number(dsel.value);
      try {
        const d = await M.get('/planning', { from: date.value || undefined, days, activite: asel.value || undefined }); date.value = d.from; M.clear(box);
        const dates = []; for (let x = d.from; x <= d.to; x = M.addDays(x, 1)) dates.push(x);
        if (!d.postes.length) return box.append(M.empty('Aucun poste dans votre périmètre.'));
        const today = M.today(); const gaps = d.cells.filter((c) => !c.couvert).length;
        box.append(h('div', { class: gaps ? 'alert bad' : 'alert ok' }, gaps ? `⚠ ${gaps} poste(s)/jour non couvert(s) sur la période.` : '✔ Tous les postes sont couverts sur la période.'));
        const head = h('tr', null, h('th', { class: 'pn' }, 'Poste'), dates.map((x) => h('th', { class: x === today ? 'today' : '' }, M.dow(x) + ' ' + x.slice(8) + '/' + x.slice(5, 7))));
        const rows = d.postes.map((p) => h('tr', null, h('td', { class: 'pn' }, h('strong', null, p.nom), h('div', { class: 'small muted' }, `${p.site} · ${p.heure_debut}–${p.heure_fin} · ×${p.effectif_requis}`)),
          dates.map((x) => {
            const cell = d.cells.find((c) => c.poste_id === p.id && c.date === x);
            const sh = d.shifts.filter((s) => s.poste_id === p.id && s.date === x);
            const ab = (id) => d.absences.some((a) => a.employee_id === id && a.date_debut <= x && a.date_fin >= x);
            const td = h('td', { class: 'cell' + (x === today ? ' today' : '') + (cell ? (cell.couvert ? ' okc' : ' ko') : ''), onclick: (e) => { if (e.target.closest('.chip') || !d.canEdit || !cell) return; M.openForm('shifts', null, { defaults: { poste_id: p.id, date: x, heure_debut: p.heure_debut, heure_fin: p.heure_fin }, onSaved: load }); } },
              cell ? null : h('span', { class: 'muted small' }, '—'),
              sh.map((s) => h('span', { class: 'chip ' + (p.activite === 'securite' ? 'sec' : 'net') + (!s.valide ? ' nv' : '') + (s.checkin_at ? ' chk' : '') + (['annule', 'absent', 'remplace'].includes(s.statut) ? ' abs' : ''), title: `${s.employe} ${s.heure_debut}–${s.heure_fin} (${M.optLabel([['planifie', 'Planifié'], ['confirme', 'Confirmé'], ['termine', 'Terminé'], ['absent', 'Absent'], ['remplace', 'Remplacé'], ['annule', 'Annulé']], s.statut)})${s.valide ? '' : ' — à valider'}${ab(s.employee_id) ? ' — ABSENCE VALIDÉE' : ''}`, onclick: () => M.openForm('shifts', s.id, { onSaved: load }) },
                (s.checkin_at ? '✔ ' : '') + s.employe + (!s.valide ? ' ⏳' : '') + (ab(s.employee_id) ? ' ⚠' : ''))),
              cell && !cell.couvert ? h('div', { class: 'gap' }, `Manque ${cell.requis - cell.affectes}`) : null);
            return td;
          })));
        box.append(h('div', { class: 'tbl-wrap' }, h('table', { class: 'plan' }, h('thead', null, head), h('tbody', null, rows))),
          h('p', { class: 'small muted' }, '⏳ = proposé par un superviseur, à valider par le responsable · ✔ = prise de poste confirmée · jaune = non validé · vert = confirmé.'));
      } catch (e) { M.clear(box).append(h('div', { class: 'alert bad' }, e.message)); }
    };
    date.value = from; [date, dsel, asel].forEach((el) => el.addEventListener('change', load)); M.refresh = load; load();
  };

  // ---------------------------------------------------------------- accueil agent (mobile d'abord)
  const HOME_KEY = 'm360home';
  P.home = async (root) => {
    const box = h('div', { class: 'agent' }); root.append(box);
    const render = (d, stale) => {
      M.clear(box);
      box.append(h('h1', null, `Bonjour ${d.employee ? d.employee.prenom : ''} 👋`), stale ? h('div', { class: 'alert warn' }, 'Hors ligne : données enregistrées lors de la dernière connexion. Vos actions seront envoyées au retour du réseau.') : null);
      if (M.queueSize()) box.append(h('div', { class: 'alert warn' }, `${M.queueSize()} action(s) en attente d’envoi.`, ' ', h('button', { class: 'btn sm', onclick: () => M.flushQueue() }, 'Envoyer maintenant')));
      const todays = d.shifts.filter((s) => s.date === d.today), later = d.shifts.filter((s) => s.date > d.today);
      box.append(h('h2', null, 'Mon service du jour'));
      if (!todays.length) box.append(h('div', { class: 'card muted' }, 'Aucun service planifié aujourd’hui.'));
      for (const s of todays) box.append(shiftCard(s, d));
      if (d.taches.length) box.append(h('h2', null, `Mes tâches du jour (${d.taches.filter((t) => t.statut === 'fait').length}/${d.taches.length})`), h('div', { class: 'card' }, d.taches.map((t) => taskRow(t))));
      box.append(h('div', { class: 'tools' }, h('button', { class: 'btn pri', onclick: () => incidentForm(todays[0]) }, '🚨 Déclarer un incident')));
      if (later.length) box.append(h('h2', null, 'À venir'), h('div', { class: 'card' }, h('ul', { class: 'list' }, later.map((s) => h('li', null, h('strong', { class: 'nowrap' }, M.dow(s.date) + ' ' + M.fmtDate(s.date).slice(0, 5)), h('div', { class: 'grow' }, `${s.heure_debut}–${s.heure_fin} · ${s.poste}`, h('div', { class: 'small muted' }, `${s.site} (${s.client})`)), s.valide ? null : h('span', { class: 'badge warn' }, 'À valider'))))));
    };
    function shiftCard(s, d) {
      const done = !!s.checkout_at, started = !!s.checkin_at;
      const c = h('div', { class: 'card shiftcard ' + (done ? 'done' : started ? 'now' : '') },
        h('div', { class: 'hh' }, `${s.heure_debut} – ${s.heure_fin}`), h('div', null, h('strong', null, s.poste), ' · ', s.site), h('div', { class: 'small muted' }, s.client + (s.site_adresse ? ' · ' + s.site_adresse : '')),
        s.poste_consignes || s.site_consignes ? h('div', { class: 'alert', style: 'white-space:pre-wrap' }, [s.site_consignes, s.poste_consignes].filter(Boolean).join('\n')) : null,
        s.contact_site ? h('div', { class: 'small' }, '☎ Contact sur site : ', s.contact_site) : null);
      if (!s.valide) c.append(h('div', { class: 'alert warn' }, 'Service en attente de validation par votre responsable.'));
      if (done) c.append(h('div', { class: 'alert ok' }, `Service terminé. Début ${M.fmtDT(s.checkin_at)} · Fin ${M.fmtDT(s.checkout_at)}`));
      else if (!started) {
        if (s.pointage_mode === 'superviseur') c.append(h('div', { class: 'alert' }, 'Sur ce poste, votre superviseur confirme votre prise de poste.'));
        else c.append(h('button', { class: 'btn pri big', onclick: () => checkin(s) }, s.pointage_mode === 'qr' ? '▦ Scanner le QR et prendre mon poste' : '▶ Je prends mon poste'));
      } else c.append(h('div', { class: 'alert ok' }, `Poste pris à ${M.fmtDT(s.checkin_at).slice(11)}`), h('button', { class: 'btn dark big', onclick: () => checkout(s) }, '■ Fin de service'));
      return c;
    }
    async function checkin(s) {
      let code;
      if (s.pointage_mode === 'qr') { code = await scanDialog(); if (!code) return; }
      try { const r = await M.post(`/shifts/${s.id}/checkin`, code ? { code } : {}, { queue: 'Prise de poste' }); M.toast(r.queued ? 'Hors ligne : prise de poste mémorisée.' : 'Prise de poste enregistrée.', 'ok'); P.homeReload(); } catch (e) { M.fail(e); }
    }
    async function checkout(s) {
      if (!(await M.confirm('Confirmer la fin de votre service ?', 'Terminer'))) return;
      try { const r = await M.post(`/shifts/${s.id}/checkout`, {}, { queue: 'Fin de service' }); M.toast(r.queued ? 'Hors ligne : fin de service mémorisée.' : 'Fin de service enregistrée.', 'ok'); P.homeReload(); } catch (e) { M.fail(e); }
    }
    function scanDialog() {
      return new Promise((res) => {
        let stream, stopped = false, got = false; const inp = h('input', { type: 'text', placeholder: 'Code du poste (ex. M360:ab12…)', autocapitalize: 'off', autocomplete: 'off' });
        const video = h('video', { class: 'cam', playsinline: true, muted: true }); const info = h('p', { class: 'small muted' }, 'Pointez la caméra vers le QR code du poste, ou saisissez le code ci-dessous.');
        const stop = () => { stopped = true; if (stream) stream.getTracks().forEach((t) => t.stop()); };
        const mm = M.modal({ title: 'QR code du poste', body: [video, info, h('label', { class: 'f' }, h('span', null, 'Saisie manuelle'), inp)], onClose: () => { stop(); if (!got) res(null); },
          footer: [h('button', { class: 'btn', onclick: () => mm.close() }, 'Annuler'), h('button', { class: 'btn pri', onclick: () => { if (inp.value.trim()) { got = true; res(inp.value.trim()); mm.close(); } else inp.focus(); } }, 'Valider')] });
        if ('BarcodeDetector' in window && navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
          const det = new BarcodeDetector({ formats: ['qr_code'] });
          navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } }).then((s) => { if (stopped) { s.getTracks().forEach((t) => t.stop()); return; } stream = s; video.srcObject = s; video.play();
            const tick = async () => { if (stopped) return; try { const r = await det.detect(video); if (r.length && /^M360:/.test(r[0].rawValue)) { got = true; res(r[0].rawValue); mm.close(); return; } } catch {} setTimeout(tick, 350); }; tick();
          }).catch(() => { video.remove(); info.textContent = 'Caméra indisponible : saisissez le code affiché sous le QR.'; });
        } else { video.remove(); info.textContent = 'Lecture automatique non disponible sur cet appareil : saisissez le code du poste, ou scannez avec l’appareil photo et copiez le contenu.'; }
      });
    }
    function taskRow(t) {
      return h('div', { class: 'task ' + t.statut }, h('input', { type: 'checkbox', style: 'width:1.6rem;height:1.6rem;min-height:0', checked: t.statut === 'fait', 'aria-label': t.libelle, onchange: async (e) => {
        try { const r = await M.post(`/taches/${t.id}/done`, { statut: e.target.checked ? 'fait' : 'a_faire' }, { queue: 'Tâche' }); if (r.queued) M.toast('Hors ligne : mémorisé.'); P.homeReload(); } catch (er) { M.fail(er); e.target.checked = !e.target.checked; } } }),
        h('div', { class: 'grow' }, h('div', { class: 'lbl' }, t.libelle), h('div', { class: 'small muted' }, t.zone + (t.commentaire ? ' · ' + t.commentaire : '')), t.statut === 'anomalie' ? M.badge('anomalie', 'Anomalie signalée') : null),
        t.statut !== 'anomalie' ? h('button', { class: 'btn sm', onclick: async () => { const c = await M.prompt('Signaler une anomalie', 'Décrivez le problème', { multiline: true, required: true }); if (!c) return; try { await M.post(`/taches/${t.id}/done`, { statut: 'anomalie', commentaire: c }, { queue: 'Anomalie' }); P.homeReload(); } catch (er) { M.fail(er); } } }, '⚠') : null);
    }
    function incidentForm(s) { M.openForm('incidents', null, { defaults: s ? { site_id: s.site_id } : {}, onSaved: () => {} }); }
    P.homeReload = async () => {
      try { const d = await M.get('/me/home'); if (!d.linked) { M.clear(box).append(h('div', { class: 'alert warn' }, 'Votre compte n’est lié à aucune fiche employé. Contactez l’administrateur.')); return; } try { localStorage.setItem(HOME_KEY + M.user.id, JSON.stringify(d)); } catch {} render(d, false); }
      catch (e) { let c = null; try { c = JSON.parse(localStorage.getItem(HOME_KEY + M.user.id)); } catch {} if (c && e.status === 0) render(c, true); else M.clear(box).append(h('div', { class: 'alert bad' }, e.message)); }
    };
    M.refresh = P.homeReload; await P.homeReload();
  };
  P['mon-planning'] = async (root) => {
    root.append(h('h1', null, '📅 Mon planning')); const box = h('div', null, M.spinner()); root.append(box);
    try { const d = await M.get('/me/home'); M.clear(box); if (!d.linked) return box.append(M.empty('Compte non lié à un employé.'));
      box.append(d.shifts.length ? h('div', { class: 'card' }, h('ul', { class: 'list' }, d.shifts.map((s) => h('li', null, h('strong', { class: 'nowrap' }, M.dow(s.date) + ' ' + M.fmtDate(s.date).slice(0, 5)), h('div', { class: 'grow' }, `${s.heure_debut}–${s.heure_fin} · ${s.poste}`, h('div', { class: 'small muted' }, `${s.site} (${s.client})`)), M.badge(s.statut, M.optLabel([['planifie', 'Planifié'], ['confirme', 'Confirmé'], ['termine', 'Terminé'], ['absent', 'Absent']], s.statut)))))) : M.empty('Aucune affectation à venir.'));
    } catch (e) { M.clear(box).append(h('div', { class: 'alert bad' }, e.message)); }
  };

  // ---------------------------------------------------------------- fiches 360
  const kv = (pairs) => h('dl', { style: 'display:grid;grid-template-columns:minmax(120px,200px) 1fr;gap:.3rem .8rem;margin:0' }, pairs.filter((p) => p[1] !== null && p[1] !== undefined && p[1] !== '').flatMap(([k, v]) => [h('dt', { class: 'muted' }, k), h('dd', { style: 'margin:0;white-space:pre-wrap' }, v)]));
  function fieldPairs(res, row, refs) { return res.fields.filter((f) => row[f.n] !== undefined && row[f.n] !== null && row[f.n] !== '').map((f) => [f.l, M.cellValue(res, f, row, refs || {})]); }
  function miniTable(key, data, cols, onClick) {
    if (!data) return h('p', { class: 'muted' }, 'Non accessible avec votre profil.');
    if (!data.rows.length) return h('p', { class: 'muted' }, 'Aucun élément.');
    const res = M.meta.resources[key]; const cs = cols.map((n) => res.fields.find((f) => f.n === n) || (res.computed || []).find((c) => c.n === n)).filter(Boolean);
    return table(cs.map((c) => c.l), data.rows.map((r) => h('tr', { class: onClick === false ? '' : 'click', onclick: () => onClick === false || M.openForm(key, r.id, { onSaved: () => P._reload && P._reload() }) }, cs.map((c) => h('td', null, M.cellValue(res, c, r, data.refs || {}))))));
  }
  P.employee = async (root, params) => {
    const id = params.id; const box = h('div', null, M.spinner()); root.append(h('p', null, h('a', { href: '#/employees' }, '‹ Employés')), box);
    const load = async () => {
      try {
        const d = await M.get('/employee360/' + id); M.clear(box); const res = M.meta.resources.employees; const e = d.employee;
        box.append(h('div', { class: 'tools' }, h('h1', { style: 'margin:0' }, `${e.prenom} ${e.nom}`), M.badge(e.statut, M.optLabel(res.fields.find((f) => f.n === 'statut').opts, e.statut)), h('span', { class: 'sp' }), res.perms.update ? h('button', { class: 'btn', onclick: () => M.openForm('employees', e.id, { onSaved: load }) }, '✎ Modifier') : null));
        if (d.missing && d.missing.length) box.append(h('div', { class: 'alert warn' }, h('strong', null, 'Dossier incomplet : '), d.missing.join(', ')));
        box.append(h('div', { class: 'grid g2' }, section('Identité et emploi', kv(fieldPairs(res, e, d.refs))), h('div', null,
          section('Documents', miniTable('documents', d.documents, ['categorie', 'libelle', 'date_expiration', 'etat'])), section('Formations et qualifications', miniTable('formations', d.formations, ['intitule', 'date_obtention', 'date_expiration', 'etat'])))));
        box.append(h('div', { class: 'grid g2' }, section('Absences et congés', miniTable('absences', d.absences, ['type', 'date_debut', 'date_fin', 'statut'])), section('Équipements attribués', miniTable('equipements', d.equipements, ['type', 'libelle', 'statut']))));
        box.append(section('Affectations récentes (30 jours)', miniTable('shifts', d.shifts, ['date', 'poste_id', 'heure_debut', 'heure_fin', 'statut'])));
      } catch (er) { M.clear(box).append(h('div', { class: 'alert bad' }, er.message)); }
    }; P._reload = load; load();
  };
  P.client = async (root, params) => {
    const id = params.id; const box = h('div', null, M.spinner()); root.append(h('p', null, h('a', { href: '#/clients' }, '‹ Clients')), box);
    const load = async () => {
      try {
        const d = await M.get('/client360/' + id); M.clear(box); const res = M.meta.resources.clients; const c = d.client;
        box.append(h('div', { class: 'tools' }, h('h1', { style: 'margin:0' }, c.nom), h('span', { class: 'sp' }), res.perms.update ? h('button', { class: 'btn', onclick: () => M.openForm('clients', c.id, { onSaved: load }) }, '✎ Modifier') : null));
        if (d.impayes) box.append(h('div', { class: 'alert bad' }, `Impayés en retard : ${M.money(d.impayes)}`));
        box.append(h('div', { class: 'grid g2' }, section('Informations', kv(fieldPairs(res, c, {}))), section('Sites', miniTable('sites', d.sites, ['nom', 'adresse', 'ville', 'actif']))));
        box.append(section('Contrats', miniTable('contrats', d.contrats, ['reference', 'activite', 'date_debut', 'date_fin', 'statut', 'etat'])),
          h('div', { class: 'grid g2' }, section('Incidents ouverts', miniTable('incidents', d.incidents, ['created_at', 'type', 'priorite', 'titre'])), section('Derniers contrôles qualité', miniTable('controles', d.controles, ['date', 'site_id', 'statut', 'note']))));
        if (d.factures) box.append(section('Factures', miniTable('factures', d.factures, ['numero', 'date', 'type', 'statut', 'ttc', 'reste', 'etat'])));
        box.append(section('Documents', miniTable('documents', d.documents, ['categorie', 'libelle', 'date_expiration', 'etat'])));
      } catch (er) { M.clear(box).append(h('div', { class: 'alert bad' }, er.message)); }
    }; P._reload = load; load();
  };

  // ---------------------------------------------------------------- finance
  P.rentabilite = async (root) => {
    root.append(h('h1', null, '📈 Rentabilité par contrat'));
    const month = h('input', { type: 'month', value: monthNow(), 'aria-label': 'Mois' }); const box = h('div');
    root.append(h('div', { class: 'tools' }, month, h('span', { class: 'sp' }), h('a', { class: 'btn', id: 'csvp', href: '#', download: '' }, '⬇ CSV')), box);
    const load = async () => {
      document.getElementById('csvp').href = '/api/profitability' + M.qs({ month: month.value, format: 'csv' });
      M.clear(box).append(M.spinner());
      try {
        const d = await M.get('/profitability', { month: month.value }); M.clear(box);
        box.append(h('div', { class: 'notice' }, 'Estimation de gestion : revenus facturés (HT) − coût du personnel affecté (heures réalisées/planifiées × coût horaire saisi) − consommables − dépenses rattachées. Ce n’est ni une comptabilité ni un calcul de paie.'));
        if (d.heures_sans_cout_horaire > 0) box.append(h('div', { class: 'alert warn' }, `${d.heures_sans_cout_horaire} h affectées à des employés sans coût horaire renseigné : la marge est surestimée.`));
        box.append(h('div', { class: 'grid g4' }, M.kpi('Revenus HT', M.money(d.total.revenus)), M.kpi('Coûts directs', M.money(d.total.couts_directs)), M.kpi('Marge estimée', M.money(d.total.marge), '', d.total.marge < 0 ? 'bad' : 'ok'), M.kpi('Taux de marge', d.total.taux_marge == null ? '—' : d.total.taux_marge + ' %')));
        box.append(d.rows.length ? table(['Contrat', 'Client', 'Prestation', 'Revenus', 'Personnel', 'Consommables', 'Dépenses', 'Marge', 'Taux', 'Heures'], d.rows.map((c) => h('tr', null, h('td', null, c.reference), h('td', null, c.client + (c.site ? ' · ' + c.site : '')), h('td', null, c.activite), h('td', { class: 'right' }, M.num(c.revenus)), h('td', { class: 'right' }, M.num(c.cout_personnel)), h('td', { class: 'right' }, M.num(c.cout_consommables)), h('td', { class: 'right' }, M.num(c.cout_depenses)), h('td', { class: 'right' }, h('strong', { style: c.marge < 0 ? 'color:var(--bad)' : '' }, M.num(c.marge))), h('td', { class: 'right' }, c.taux_marge == null ? '—' : c.taux_marge + ' %'), h('td', { class: 'right' }, M.num(c.heures))))) : M.empty('Aucun contrat actif sur la période.'));
      } catch (e) { M.clear(box).append(h('div', { class: 'alert bad' }, e.message)); }
    };
    month.addEventListener('change', load); load();
  };
  P.recap = async (root) => {
    root.append(h('h1', null, '🧮 Éléments variables pour la paie'));
    const month = h('input', { type: 'month', value: monthNow(), 'aria-label': 'Mois' }); const box = h('div');
    root.append(h('div', { class: 'tools' }, month, h('span', { class: 'sp' }), h('a', { class: 'btn', id: 'csvr', href: '#', download: '' }, '⬇ CSV')), box);
    const load = async () => {
      document.getElementById('csvr').href = '/api/recap' + M.qs({ month: month.value, format: 'csv' });
      M.clear(box).append(M.spinner());
      try {
        const d = await M.get('/recap', { month: month.value }); M.clear(box);
        box.append(h('div', { class: 'notice' }, `Préparation uniquement : heures et absences par employé, à transmettre à votre prestataire ou service de paie. MARONET 360 ne calcule ni salaires, ni cotisations, ni retenues. Seuil hebdomadaire de vérification : ${d.seuil} h (paramètre à valider).`));
        box.append(d.rows.length ? table(['Matricule', 'Employé', 'Heures planifiées', 'Heures réalisées', 'Congé (j)', 'Maladie (j)', 'Absence (j)', 'Formation (j)', 'Semaines à vérifier'], d.rows.map((x) => h('tr', null, h('td', null, x.matricule), h('td', null, x.nom), h('td', { class: 'right' }, M.num(x.h_planifiees)), h('td', { class: 'right' }, M.num(x.h_realisees)), h('td', { class: 'right' }, x.jours_conge), h('td', { class: 'right' }, x.jours_maladie), h('td', { class: 'right' }, x.jours_absence), h('td', { class: 'right' }, x.jours_formation), h('td', { class: 'right' }, x.semaines_a_verifier ? h('span', { class: 'badge warn' }, x.semaines_a_verifier) : 0)))) : M.empty('Aucune donnée.'));
      } catch (e) { M.clear(box).append(h('div', { class: 'alert bad' }, e.message)); }
    };
    month.addEventListener('change', load); load();
  };

  // ---------------------------------------------------------------- notifications, paramètres
  P.notifications = async (root) => {
    root.append(h('h1', null, '🔔 Notifications')); const box = h('div', null, M.spinner()); root.append(box);
    try { const d = await M.get('/notifications'); M.clear(box);
      box.append(h('div', { class: 'tools' }, h('span', { class: 'sp' }), h('button', { class: 'btn', onclick: async () => { await M.post('/notifications/read', {}); M.updateBell(); P.notifications(M.clear(root)); } }, 'Tout marquer comme lu')),
        h('div', { class: 'card' }, d.rows.length ? h('ul', { class: 'list' }, d.rows.map((n) => h('li', { style: n.lu ? 'opacity:.6' : '' }, h('div', { class: 'grow' }, h('a', { href: n.lien || '#/notifications', onclick: () => M.post('/notifications/read', { id: n.id }).then(M.updateBell) }, h('strong', null, n.titre)), h('div', { class: 'small muted' }, n.corps || '')), h('span', { class: 'small muted nowrap' }, M.fmtDT(n.created_at))))) : M.empty('Aucune notification.')));
    } catch (e) { M.clear(box).append(h('div', { class: 'alert bad' }, e.message)); }
  };
  P.parametres = async (root) => {
    root.append(h('h1', null, '⚙ Paramètres')); const box = h('div', null, M.spinner()); root.append(box);
    try {
      const s = await M.get('/settings'); M.clear(box);
      const defs = [['societe', 'Nom de la société', 'text', ''], ['seuil_heures_hebdo', 'Seuil d’heures hebdomadaires avant avertissement', 'number', 'Valeur indicative, à valider avec votre conseil juridique / RH.'], ['repos_min_heures', 'Repos minimal entre deux services (heures)', 'number', 'Valeur indicative, à valider.'], ['retard_pointage_minutes', 'Délai avant alerte « prise de poste non confirmée » (minutes)', 'number', ''], ['tva_defaut', 'TVA par défaut (%)', 'number', '']];
      const inputs = {}; const form = h('form', { class: 'card', onsubmit: async (e) => { e.preventDefault(); const b = {}; for (const [k] of defs) b[k] = inputs[k].value; try { await M.put('/settings', b); M.toast('Paramètres enregistrés.', 'ok'); } catch (er) { M.fail(er); } } },
        h('h2', null, 'Règles de gestion'), h('div', { class: 'notice' }, 'Ces seuils déclenchent des avertissements de planning ; ils ne constituent pas une conformité légale. Faites-les valider avant usage.'),
        defs.map(([k, l, t, help]) => h('label', { class: 'f' }, h('span', null, l), inputs[k] = h('input', { type: t, step: 'any', value: s[k] ?? '' }), help ? h('span', { class: 'help' }, help) : null)), h('button', { class: 'btn pri' }, 'Enregistrer'));
      box.append(form);
      if (M.role() === 'admin') box.append(h('div', { class: 'card' }, h('h2', null, 'Sauvegarde'), h('p', { class: 'muted' }, 'Une sauvegarde automatique est faite chaque jour (14 conservées dans le dossier « data/backups »). Téléchargez aussi une copie et conservez-la hors du serveur.'), h('a', { class: 'btn', href: '/api/admin/backup', download: '' }, '⬇ Télécharger une sauvegarde')));
    } catch (e) { M.clear(box).append(h('div', { class: 'alert bad' }, e.message)); }
  };
  P.compte = (root) => {
    root.append(h('h1', null, '👤 Mon compte'), h('div', { class: 'card' }, kv([['Identifiant', M.user.username], ['Profil', M.user.role_label], ['Société', M.meta.settings.societe]])), passwordForm(false));
  };
  function passwordForm(forced) {
    const o = h('input', { type: 'password', autocomplete: 'current-password', required: true }), n = h('input', { type: 'password', autocomplete: 'new-password', required: true, minlength: 10 }), n2 = h('input', { type: 'password', autocomplete: 'new-password', required: true });
    return h('form', { class: 'card', onsubmit: async (e) => { e.preventDefault(); if (n.value !== n2.value) return M.toast('Les deux mots de passe ne correspondent pas.', 'bad');
      try { await M.post('/auth/change-password', { old_password: o.value, new_password: n.value }); M.toast('Mot de passe modifié.', 'ok'); if (forced) location.hash = '#/'; M.boot(); } catch (er) { M.fail(er); } } },
      h('h2', null, forced ? 'Choisissez votre mot de passe' : 'Changer mon mot de passe'), forced ? h('div', { class: 'alert warn' }, 'Mot de passe temporaire : vous devez le remplacer avant de continuer.') : null,
      h('label', { class: 'f' }, h('span', null, 'Mot de passe actuel'), o), h('label', { class: 'f' }, h('span', null, 'Nouveau mot de passe'), n, h('span', { class: 'help' }, '10 caractères minimum, avec lettres et chiffres.')), h('label', { class: 'f' }, h('span', null, 'Confirmer'), n2), h('button', { class: 'btn pri' }, 'Enregistrer'));
  }
  M.passwordForm = passwordForm;
})();

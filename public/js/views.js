'use strict';
// Liste générique + actions spécifiques par ressource
(function () {
  const h = M.h;
  const PAGE = 50;

  function cellValue(res, f, row, refs) {
    const v = row[f.n];
    if (f.t === 'etat') return v ? M.badge(v, (M.ETAT[v] || [v])[0]) : '—';
    if (f.t === 'percent') return v === null || v === undefined ? '—' : h('div', { style: 'display:flex;gap:.4rem;align-items:center' }, h('div', { class: 'bar' }, h('i', { style: `width:${Math.min(100, v)}%;${v < 100 ? 'background:var(--warn)' : ''}` })), v + '%');
    if (v === null || v === undefined || v === '') return '—';
    switch (f.t) {
      case 'select': return M.badge(v, M.optLabel(f.opts, v));
      case 'ref': return (refs[f.n] && refs[f.n][v]) || '#' + v;
      case 'date': return M.fmtDate(v);
      case 'bool': return v ? 'Oui' : 'Non';
      case 'money': return M.money(v);
      case 'file': return M.fileLink(v);
      case 'number': return M.num(v);
      case 'text': if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(v)) return M.fmtDT(v); return String(v).length > 70 ? String(v).slice(0, 70) + '…' : String(v);
      default: return String(v).length > 70 ? String(v).slice(0, 70) + '…' : String(v);
    }
  }
  M.cellValue = cellValue;

  M.listView = async function (key, root, init = {}) {
    const res = M.meta.resources[key];
    if (!res) { root.append(h('div', { class: 'alert bad' }, 'Cet écran n’est pas accessible avec votre profil.')); return; }
    const st = { q: '', offset: 0, filters: {}, etat: '', from: '', to: '', ...init };
    const cols = [...res.fields.filter((f) => f.list), ...(res.computed || []).filter((c) => c.list)];
    const bar = h('div', { class: 'tools' }); const tbl = h('div'); const pager = h('div', { class: 'pager' });
    const reload = async () => {
      M.clear(tbl).append(M.spinner());
      try {
        const q = { q: st.q, limit: PAGE, offset: st.offset, etat: st.etat, from: st.from, to: st.to };
        for (const [k, v] of Object.entries(st.filters)) q['f_' + k] = v;
        const r = await M.get('/r/' + key, q); M.clear(tbl);
        if (!r.rows.length) tbl.append(M.empty('Aucun élément.'));
        else {
          const t = h('table', { class: 'resp' }, h('thead', null, h('tr', null, cols.map((c) => h('th', null, c.l)))),
            h('tbody', null, r.rows.map((row) => h('tr', { class: 'click', tabindex: 0, onclick: () => open(row.id), onkeydown: (e) => { if (e.key === 'Enter') open(row.id); } },
              cols.map((c) => h('td', { 'data-l': c.l }, cellValue(res, c, row, r.refs || {})))))));
          tbl.append(h('div', { class: 'tbl-wrap' }, t));
        }
        M.clear(pager);
        const from = r.total ? st.offset + 1 : 0, to = Math.min(st.offset + PAGE, r.total);
        pager.append(h('span', { class: 'muted small' }, `${from}–${to} sur ${r.total}`),
          h('button', { class: 'btn sm', disabled: st.offset === 0, onclick: () => { st.offset = Math.max(0, st.offset - PAGE); reload(); } }, '‹ Précédent'),
          h('button', { class: 'btn sm', disabled: st.offset + PAGE >= r.total, onclick: () => { st.offset += PAGE; reload(); } }, 'Suivant ›'));
      } catch (e) { M.clear(tbl).append(h('div', { class: 'alert bad' }, e.message)); }
    };
    const open = (id) => {
      if (key === 'employees') return (location.hash = '#/employee/' + id);
      if (key === 'clients') return (location.hash = '#/client/' + id);
      M.openForm(key, id, { onSaved: reload });
    };
    M.refresh = reload;
    const search = h('input', { type: 'search', placeholder: 'Rechercher…', value: st.q, 'aria-label': 'Rechercher', style: 'min-width:180px' });
    let tm; search.addEventListener('input', () => { clearTimeout(tm); tm = setTimeout(() => { st.q = search.value; st.offset = 0; reload(); }, 300); });
    bar.append(search);
    for (const f of res.fields.filter((x) => x.filter && ['select', 'ref', 'bool'].includes(x.t))) {
      const s = h('select', { 'aria-label': f.l }, h('option', { value: '' }, 'Tous : ' + f.l.toLowerCase()));
      if (f.t === 'select') f.opts.forEach((o) => { const [v, l] = Array.isArray(o) ? o : [o, o]; s.append(h('option', { value: v }, l)); });
      else if (f.t === 'bool') { s.append(h('option', { value: '1' }, 'Oui'), h('option', { value: '0' }, 'Non')); }
      else M.options(f.ref, f.refFilter || {}).then((l) => l.forEach((o) => s.append(h('option', { value: o.id }, o.label)))).catch(() => {});
      if (st.filters[f.n] !== undefined) s.value = st.filters[f.n];
      s.addEventListener('change', () => { st.filters[f.n] = s.value; st.offset = 0; reload(); }); bar.append(s);
    }
    if (res.etatFilter) {
      const s = h('select', { 'aria-label': 'Échéance' }, h('option', { value: '' }, 'Toutes échéances'), h('option', { value: 'expire' }, 'Expirés'), h('option', { value: 'a_renouveler' }, 'À renouveler'), h('option', { value: 'sans_echeance' }, 'Sans échéance'));
      s.value = st.etat; s.addEventListener('change', () => { st.etat = s.value; st.offset = 0; reload(); }); bar.append(s);
    }
    if (res.dateFilter) {
      const a = h('input', { type: 'date', 'aria-label': 'Du', value: st.from }), b = h('input', { type: 'date', 'aria-label': 'Au', value: st.to });
      for (const [el, k] of [[a, 'from'], [b, 'to']]) el.addEventListener('change', () => { st[k] = el.value; st.offset = 0; reload(); });
      bar.append(h('span', { class: 'small muted' }, 'Du'), a, h('span', { class: 'small muted' }, 'au'), b);
    }
    bar.append(h('span', { class: 'sp' }));
    if (key === 'taches' && M.can('taches', 'create')) bar.append(h('button', { class: 'btn', onclick: async () => { try { const r = await M.post('/taches/generate', {}); M.toast(`${r.created} tâche(s) générée(s) pour aujourd’hui.`, 'ok'); reload(); } catch (e) { M.fail(e); } } }, '⚙ Générer les tâches du jour'));
    if (res.perms.export) bar.append(h('a', { class: 'btn', href: '/api/r/' + key + '/export.csv' + M.qs({ q: st.q, etat: st.etat, from: st.from, to: st.to }), download: '' }, '⬇ CSV'));
    if (res.perms.create) bar.append(h('button', { class: 'btn pri', onclick: () => M.openForm(key, null, { onSaved: reload }) }, '＋ Nouveau'));
    root.append(h('h1', null, `${res.icon || ''} ${res.label}`), res.note ? h('div', { class: 'notice' }, res.note) : null, bar, tbl, pager);
    if (init.openId) open(init.openId);
    reload();
  };

  // ---------------- actions spécifiques (pied de la fiche)
  const RA = M.rowActions = {};
  const run = (fn, ctx, okMsg) => async () => { try { await fn(); if (okMsg) M.toast(okMsg, 'ok'); ctx.reload(); } catch (e) { M.fail(e); } };

  RA.shifts = (row, ctx) => {
    const b = [];
    if (!M.isAgent() && ['planifie', 'confirme'].includes(row.statut)) {
      if (M.can('shifts', 'create')) b.push(h('button', { class: 'btn', type: 'button', onclick: () => { ctx.close(); M.replaceDialog(row, ctx.reload); } }, '🔁 Remplacer'));
      if (!row.valide && ['dg', 'resp_sec', 'resp_net'].includes(M.role())) b.push(h('button', { class: 'btn', type: 'button', onclick: run(() => M.post(`/shifts/${row.id}/validate`), ctx, 'Planning validé.') }, '✔ Valider'));
      if (M.can('shifts', 'update') && !row.checkin_at) b.push(h('button', { class: 'btn', type: 'button', onclick: run(() => M.post(`/shifts/${row.id}/checkin`), ctx, 'Prise de poste confirmée.') }, '▶ Confirmer la prise de poste'));
      if (M.can('shifts', 'update') && row.checkin_at && !row.checkout_at) b.push(h('button', { class: 'btn', type: 'button', onclick: run(() => M.post(`/shifts/${row.id}/checkout`), ctx, 'Fin de service enregistrée.') }, '■ Fin de service'));
    }
    return b;
  };
  RA.taches = (row, ctx) => {
    const b = [];
    if (M.can('taches', 'update')) {
      if (row.statut !== 'fait') b.push(h('button', { class: 'btn', type: 'button', onclick: run(() => M.post(`/taches/${row.id}/done`, { statut: 'fait' }), ctx, 'Tâche faite.') }, '✔ Marquer fait'));
      if (row.statut === 'fait' && !row.valide && ['dg', 'resp_net', 'superviseur'].includes(M.role())) b.push(h('button', { class: 'btn', type: 'button', onclick: run(() => M.post(`/taches/${row.id}/validate`), ctx, 'Tâche validée.') }, '✔ Valider'));
      b.push(h('button', { class: 'btn dng', type: 'button', onclick: async () => { const c = await M.prompt('Signaler une anomalie', 'Décrivez l’anomalie', { multiline: true, required: true }); if (c) run(() => M.post(`/taches/${row.id}/done`, { statut: 'anomalie', commentaire: c }), ctx, 'Anomalie signalée.')(); } }, '⚠ Anomalie'));
    }
    return b;
  };
  RA.consommables = (row, ctx) => !M.can('consommables', 'update') ? [] : [
    h('button', { class: 'btn', type: 'button', onclick: () => { ctx.close(); M.stockDialog(row, ctx.reload); } }, '± Mouvement de stock')];
  RA.postes = (row, ctx) => !['dg', 'resp_sec', 'resp_net', 'superviseur'].includes(M.role()) ? [] : [
    h('button', { class: 'btn', type: 'button', onclick: () => { ctx.close(); M.qrDialog(row); } }, '▦ QR code du poste')];
  RA.users = (row, ctx) => M.role() !== 'admin' ? [] : [
    h('button', { class: 'btn', type: 'button', onclick: async () => {
      if (!(await M.confirm(`Réinitialiser le mot de passe de « ${row.username} » ? L’ancien ne fonctionnera plus.`, 'Réinitialiser'))) return;
      try { const r = await M.put('/r/users/' + row.id, { reset_password: true }); ctx.close(); M.tempPasswordDialog(row.username, r.temp_password); } catch (e) { M.fail(e); } } }, '🔑 Réinitialiser le mot de passe')];

  M.replaceDialog = async function (row, done) {
    const body = h('div', null, M.spinner());
    const mm = M.modal({ title: 'Remplacer l’agent', body });
    try {
      const r = await M.get('/candidates', { poste_id: row.poste_id, date: row.date, hd: row.heure_debut, hf: row.heure_fin, exclude: row.id });
      M.clear(body).append(h('p', { class: 'muted' }, `${M.fmtDate(row.date)} · ${row.heure_debut}–${row.heure_fin}. Candidats disponibles (aucun conflit bloquant) ; les points d’attention sont indiqués.`));
      if (!r.candidates.length) body.append(M.empty('Aucun candidat disponible.'));
      body.append(h('ul', { class: 'list' }, r.candidates.map((c) => h('li', null, h('div', { class: 'grow' }, h('strong', null, c.label), c.warnings.map((w) => h('div', { class: 'small', style: 'color:var(--warn)' }, '⚠ ' + w))),
        h('button', { class: 'btn pri sm', onclick: async () => { try { const x = await M.post(`/shifts/${row.id}/replace`, { employee_id: c.id }); mm.close(); if (x.warnings && x.warnings.length) M.warnDialog(x.warnings); else M.toast('Remplacement enregistré.', 'ok'); done && done(); } catch (e) { M.fail(e); } } }, 'Choisir')))));
    } catch (e) { M.clear(body).append(h('div', { class: 'alert bad' }, e.message)); }
  };
  M.stockDialog = async function (row, done) {
    const q = h('input', { type: 'number', step: 'any', required: true }), motif = h('input', { type: 'text', maxlength: 200 }), hist = h('div');
    const site = h('select', null, h('option', { value: '' }, '— Site (facultatif) —'));
    M.options('sites').then((l) => l.forEach((o) => site.append(h('option', { value: o.id }, o.label)))).catch(() => {});
    const mm = M.modal({ title: `Stock : ${row.libelle || row.id}`, body: [h('p', null, 'Stock actuel : ', h('strong', null, M.num(row.stock)), ' ', row.unite || ''),
      h('label', { class: 'f' }, h('span', null, 'Quantité (positive = entrée, négative = sortie)'), q), h('label', { class: 'f' }, h('span', null, 'Motif'), motif), h('label', { class: 'f' }, h('span', null, 'Site'), site), h('h3', null, 'Derniers mouvements'), hist],
      footer: [h('button', { class: 'btn', onclick: () => mm.close() }, 'Fermer'), h('button', { class: 'btn pri', onclick: async () => { if (!q.value) return q.focus(); try { const r = await M.post('/stock/move', { consommable_id: row.id, quantite: Number(q.value), motif: motif.value, site_id: site.value || undefined }); M.toast('Stock mis à jour : ' + r.stock, 'ok'); mm.close(); done && done(); } catch (e) { M.fail(e); } } }, 'Enregistrer')] });
    try { const r = await M.get('/stock/movements/' + row.id); hist.append(r.rows.length ? h('ul', { class: 'list' }, r.rows.slice(0, 10).map((m) => h('li', null, h('span', { class: 'nowrap' }, M.fmtDate(m.date)), h('span', { class: 'grow' }, (m.motif || '—') + (m.site ? ' · ' + m.site : '')), h('strong', null, (m.quantite > 0 ? '+' : '') + m.quantite)))) : h('p', { class: 'muted' }, 'Aucun mouvement.')); } catch {}
  };
  M.qrDialog = function (p) {
    const mm = M.modal({ title: `QR code : ${p.nom}`, body: h('div', { class: 'qrbox' }, h('img', { src: `/api/postes/${p.id}/qr.png?` + Date.now(), alt: 'QR code du poste' }), h('p', { class: 'muted small' }, 'À imprimer et afficher sur le poste. L’agent le scanne (ou saisit le code) pour confirmer sa prise de poste. Si le QR est compromis, renouvelez-le : l’ancien cesse de fonctionner.')),
      footer: [['dg', 'resp_sec', 'resp_net'].includes(M.role()) ? h('button', { class: 'btn dng', style: 'margin-right:auto', onclick: async () => { if (await M.confirm('Renouveler le QR code ? L’ancien sera invalide, il faudra réimprimer.', 'Renouveler', true)) { try { await M.post(`/postes/${p.id}/qr-reset`); mm.close(); M.qrDialog(p); } catch (e) { M.fail(e); } } } }, 'Renouveler') : null,
        h('button', { class: 'btn', onclick: () => window.print() }, '🖨 Imprimer'), h('button', { class: 'btn pri', onclick: () => mm.close() }, 'Fermer')] });
  };
})();

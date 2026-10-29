'use strict';
// Formulaires générés depuis le schéma /api/meta
(function () {
  const h = M.h;
  const optsCache = {};
  M.options = async function (ref, params) {
    const k = ref + M.qs(params);
    if (!optsCache[k] || Date.now() - optsCache[k].t > 20000) optsCache[k] = { t: Date.now(), v: (await M.get('/options/' + ref, params)).options };
    return optsCache[k].v;
  };
  M.dropOptionsCache = () => { for (const k of Object.keys(optsCache)) delete optsCache[k]; };

  M.fileLink = (v, label) => {
    if (!v) return '—'; const [name, orig] = String(v).split('::');
    return h('a', { href: '/api/files/' + name, target: '_blank', rel: 'noopener' }, orig || label || 'Ouvrir le fichier');
  };

  // Construit le contrôle d'un champ. Retourne { el, get(), set(v) }
  function control(f, value, editable, ctx) {
    const wrap = h('label', { class: 'f' + (f.t === 'textarea' ? ' full' : '') });
    wrap.append(h('span', { class: f.req && editable ? 'req' : '' }, f.l));
    let get = () => value;
    if (!editable) {
      let disp;
      if (f.t === 'select') disp = M.optLabel(f.opts, value);
      else if (f.t === 'ref') disp = (ctx.refs && ctx.refs[f.n] && ctx.refs[f.n][value]) || (value ? '#' + value : '—');
      else if (f.t === 'bool') disp = value ? 'Oui' : 'Non';
      else if (f.t === 'date') disp = M.fmtDate(value);
      else if (f.t === 'file') disp = M.fileLink(value);
      else disp = value === null || value === undefined || value === '' ? '—' : String(value);
      wrap.append(h('div', { style: 'padding:.4rem 0;white-space:pre-wrap' }, disp));
      return { el: wrap, get: () => undefined, readonly: true };
    }
    const attrs = { name: f.n };
    let inp;
    switch (f.t) {
      case 'textarea': inp = h('textarea', { ...attrs, rows: 3, maxlength: 5000 }); inp.value = value ?? ''; get = () => inp.value; break;
      case 'date': inp = h('input', { ...attrs, type: 'date' }); inp.value = value || ''; get = () => inp.value; break;
      case 'time': inp = h('input', { ...attrs, type: 'time' }); inp.value = value || ''; get = () => inp.value; break;
      case 'number': inp = h('input', { ...attrs, type: 'number', step: 'any', inputmode: 'decimal' }); inp.value = value ?? ''; get = () => inp.value; break;
      case 'email': inp = h('input', { ...attrs, type: 'email', autocomplete: 'off' }); inp.value = value ?? ''; get = () => inp.value; break;
      case 'tel': inp = h('input', { ...attrs, type: 'tel', autocomplete: 'off' }); inp.value = value ?? ''; get = () => inp.value; break;
      case 'bool': inp = h('input', { ...attrs, type: 'checkbox', style: 'width:1.3rem;height:1.3rem;min-height:0' }); inp.checked = !!value; get = () => (inp.checked ? 1 : 0); break;
      case 'select': {
        inp = h('select', attrs); if (!f.req || value == null) inp.append(h('option', { value: '' }, '— Choisir —'));
        for (const o of f.opts) { const [v, l] = Array.isArray(o) ? o : [o, o]; inp.append(h('option', { value: v }, l)); }
        inp.value = value ?? (f.req ? (Array.isArray(f.opts[0]) ? f.opts[0][0] : f.opts[0]) : ''); get = () => inp.value; break;
      }
      case 'ref': {
        inp = h('select', attrs); inp.append(h('option', { value: '' }, '— Choisir —'));
        const load = async () => {
          const params = {}; if (f.refFilter) for (const [k, v] of Object.entries(f.refFilter)) params[k] = v;
          if (ctx.refParams && ctx.refParams[f.n]) Object.assign(params, ctx.refParams[f.n]());
          if (value) params.all = 1;
          try {
            const list = await M.options(f.ref, params); const cur = inp.value || (value ?? '');
            M.clear(inp); inp.append(h('option', { value: '' }, '— Choisir —'));
            for (const o of list) inp.append(h('option', { value: o.id }, o.label));
            if (cur && !list.some((o) => String(o.id) === String(cur))) inp.append(h('option', { value: cur }, (ctx.refs && ctx.refs[f.n] && ctx.refs[f.n][cur]) || '#' + cur));
            inp.value = cur || '';
          } catch (e) { /* ignoré : champ resté vide */ }
        };
        load(); inp.reload = load; get = () => inp.value; break;
      }
      case 'file': {
        let cur = value || ''; const out = h('div', { class: 'small muted' }, cur ? M.fileLink(cur) : 'Aucun fichier');
        const fi = h('input', { type: 'file', accept: '.pdf,.png,.jpg,.jpeg,.webp,.doc,.docx,.xls,.xlsx,.txt', capture: f.n === 'photo' ? 'environment' : null });
        fi.addEventListener('change', async () => {
          const file = fi.files[0]; if (!file) return;
          if (file.size > 10 * 1024 * 1024) { M.toast('Fichier trop volumineux (10 Mo maximum).', 'bad'); fi.value = ''; return; }
          const fd = new FormData(); fd.append('file', file); out.textContent = 'Envoi…';
          try { const r = await M.api('POST', '/upload', fd); cur = r.value; M.clear(out); out.append('✔ ', r.name); } catch (e) { M.fail(e); out.textContent = cur ? 'Fichier actuel conservé.' : 'Aucun fichier'; }
        });
        wrap.append(fi, out); if (f.help) wrap.append(h('span', { class: 'help' }, f.help));
        return { el: wrap, get: () => cur || undefined };
      }
      default: inp = h('input', { ...attrs, type: 'text', maxlength: 500, autocomplete: 'off' }); inp.value = value ?? ''; get = () => inp.value;
    }
    if (f.req) inp.required = true;
    wrap.append(inp); if (f.help) wrap.append(h('span', { class: 'help' }, f.help));
    return { el: wrap, get, input: inp };
  }

  // Ouvre le formulaire de création / consultation / modification d'une ressource.
  M.openForm = async function (key, id, opts = {}) {
    const res = M.meta.resources[key]; if (!res) return;
    const body = h('div', null, M.spinner()); let row = {}, refs = {};
    const title = id ? `${res.singular} n°${id}` : `Nouveau : ${res.singular.toLowerCase()}`;
    const mm = M.modal({ title: `${res.icon || ''} ${title}`, body, wide: !!opts.wide });
    try { if (id) { const r = await M.get(`/r/${key}/${id}`); row = r.row; refs = r.refs || {}; } } catch (e) { mm.close(); return M.fail(e); }
    for (const [k, v] of Object.entries(opts.defaults || {})) if (!id && row[k] === undefined) row[k] = v;
    const action = id ? 'update' : 'create';
    const canEdit = id ? res.perms.update : res.perms.create;
    const ctrls = [];
    const ctx = { refs, refParams: {} };
    // dépendance : poste filtré par site
    const form = h('form', { class: 'fgrid', novalidate: false, autocomplete: 'off' });
    const sitesel = () => (ctrls.find((c) => c.f.n === 'site_id') || {}).input;
    if (res.fields.some((f) => f.n === 'poste_id' && f.ref === 'postes') && res.fields.some((f) => f.n === 'site_id')) {
      ctx.refParams.poste_id = () => { const s = sitesel(); return s && s.value ? { site_id: s.value } : {}; };
    }
    for (const f of res.fields) {
      const editable = canEdit && f.w[action];
      if (!editable && !id) continue;                      // champ non saisissable à la création : masqué
      if (!editable && (row[f.n] === null || row[f.n] === undefined || row[f.n] === '')) continue;
      const c = control(f, row[f.n] !== undefined ? row[f.n] : (f.def ?? null), editable, ctx); c.f = f; ctrls.push(c);
      if (f.t === 'textarea') c.el.classList.add('full'); form.append(c.el);
    }
    if (!ctrls.length) form.append(h('p', { class: 'muted full' }, 'Aucune information à afficher.'));
    const s = sitesel(); if (s) s.addEventListener('change', () => { const p = ctrls.find((c) => c.f.n === 'poste_id'); if (p && p.input && p.input.reload) p.input.reload(); });
    M.clear(body);
    if (res.note) body.append(h('div', { class: 'notice' }, res.note));
    const computed = (res.computed || []).filter((c) => row[c.n] !== undefined && row[c.n] !== null);
    if (id && computed.length) body.append(h('div', { class: 'card', style: 'padding:.6rem .8rem' }, computed.map((c) => h('div', null, h('strong', null, c.l + ' : '),
      c.t === 'etat' ? M.badge(row[c.n], (M.ETAT[row[c.n]] || [row[c.n]])[0]) : c.t === 'percent' ? row[c.n] + ' %' : c.t === 'money' ? M.money(row[c.n]) : row[c.n]))));
    body.append(form);
    const msg = h('div'); body.append(msg);
    const save = h('button', { class: 'btn pri', type: 'submit' }, id ? 'Enregistrer' : 'Créer');
    const foot = mm.el.querySelector('.modal > footer') || (() => { const f = h('footer'); mm.el.append(f); return f; })();
    if (id && res.perms.delete) foot.append(h('button', { class: 'btn dng', type: 'button', style: 'margin-right:auto', onclick: async () => {
      if (!(await M.confirm(`Supprimer définitivement cet élément (${res.singular.toLowerCase()}) ?`, 'Supprimer', true))) return;
      try { await M.del(`/r/${key}/${id}`); M.toast('Supprimé.', 'ok'); mm.close(); M.dropOptionsCache(); opts.onSaved && opts.onSaved(); } catch (e) { M.fail(e); } } }, 'Supprimer'));
    if (id && M.rowActions && M.rowActions[key]) for (const b of M.rowActions[key](row, { close: mm.close, reload: () => { mm.close(); opts.onSaved && opts.onSaved(); }, refs })) foot.append(b);
    foot.append(h('button', { class: 'btn', type: 'button', onclick: () => mm.close() }, canEdit ? 'Annuler' : 'Fermer'));
    if (canEdit && ctrls.some((c) => !c.readonly)) foot.append(save);
    const submit = async (e) => {
      e && e.preventDefault(); if (!form.reportValidity()) return;
      const data = {};
      for (const c of ctrls) { if (c.readonly) continue; const v = c.get(); if (v !== undefined) data[c.f.n] = v; }
      save.disabled = true; M.clear(msg);
      try {
        const r = id ? await M.put(`/r/${key}/${id}`, data) : await M.post(`/r/${key}`, data, key === 'incidents' ? { queue: 'Déclaration d’incident' } : undefined);
        if (r && r.queued) { M.toast('Hors ligne : sera envoyé dès que le réseau revient.'); mm.close(); return; }
        M.dropOptionsCache(); mm.close();
        if (r && r.temp_password) tempPasswordDialog(data.username || row.username || '', r.temp_password);
        else if (r && r.warnings && r.warnings.length) { warnDialog(r.warnings); }
        else M.toast(id ? 'Modifications enregistrées.' : 'Créé.', 'ok');
        opts.onSaved && opts.onSaved(r);
      } catch (err) { save.disabled = false; msg.append(h('div', { class: 'alert bad' }, err.message)); msg.scrollIntoView({ block: 'nearest' }); }
    };
    form.addEventListener('submit', submit); save.addEventListener('click', submit);
  };

  function warnDialog(w) {
    const mm = M.modal({ title: 'Enregistré — points d’attention', body: [h('p', null, 'L’enregistrement a été effectué. Vérifiez les points suivants (règles « à valider » par votre direction) :'), ...w.map((x) => h('div', { class: 'alert warn' }, x))],
      footer: h('button', { class: 'btn pri', onclick: () => mm.close() }, 'Compris') });
  }
  M.warnDialog = warnDialog;
  function tempPasswordDialog(user, pwd) {
    const mm = M.modal({ title: 'Mot de passe temporaire', body: [h('p', null, `Compte « ${user} ». Communiquez ce mot de passe à la personne par un canal sûr. Il ne sera plus affiché ; elle devra le changer à sa première connexion.`),
      h('div', { class: 'alert ok', style: 'font:600 1.3rem ui-monospace,Menlo,Consolas,monospace;text-align:center;user-select:all' }, pwd)],
      footer: [h('button', { class: 'btn', onclick: () => { navigator.clipboard && navigator.clipboard.writeText(pwd).then(() => M.toast('Copié.', 'ok')); } }, 'Copier'), h('button', { class: 'btn pri', onclick: () => mm.close() }, 'Fermer')] });
  }
  M.tempPasswordDialog = tempPasswordDialog;
})();

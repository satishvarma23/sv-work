/* SV Workspace — shared core: server calls, sign-in, shell, dialogs, notifications, profile. */
window.SV = (function () {
  'use strict';

  const CFG = window.SV_CONFIG || {};
  const LOCAL = ['localhost', '127.0.0.1'].includes(location.hostname);
  const API = CFG.API_URL || (LOCAL ? '/api' : '');
  const TOKEN_KEY = 'sv_workspace_token';

  const SV = { S: null, F: {}, VIEWS: {}, ACT: {}, FORMS: {}, NAV: {}, BADGES: {}, OPEN_REF: {}, SEARCH: {}, route: { section: 'overview', id: '' } };
  let token = '';
  try { token = localStorage.getItem(TOKEN_KEY) || ''; } catch (e) { /* private mode: stay signed in for this page only */ }
  const AUTH = { modal: '', hasAdmin: null, contact: {}, notice: '' };

  // ───────── small helpers ─────────
  const $ = (s, r) => (r || document).querySelector(s);
  const esc = v => String(v === null || v === undefined ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const inr = n => '₹' + Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });
  const asDate = v => new Date(String(v).length === 10 ? v + 'T00:00:00' : v);
  const fmtDate = v => (v ? asDate(v).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');
  const fmtDateTime = v => (v ? asDate(v).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');
  const pad = n => String(n).padStart(2, '0');
  const ymd = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  const ym = v => { const d = v instanceof Date ? v : asDate(v); return d.getFullYear() + '-' + pad(d.getMonth() + 1); };
  const today = () => ymd(new Date());
  const sum = (list, key) => Math.round(list.reduce((a, r) => a + Number(r[key] || 0), 0) * 100) / 100;
  const byNewest = key => (a, b) => (a[key] < b[key] ? 1 : a[key] > b[key] ? -1 : 0);
  const safeUrl = u => (/^https?:\/\//i.test(u || '') ? u : '');
  const ext = (u, label) => (safeUrl(u) ? '<a href="' + esc(u) + '" target="_blank" rel="noopener noreferrer">' + esc(label || u) + '</a>' : '—');

  const LABELS = {
    NOT_STARTED: 'Not Started', IN_PROGRESS: 'In Progress', IN_REVIEW: 'In Review', REVISION: 'Revision Requested', CLIENT_REVIEW: 'Awaiting Client Approval', COMPLETED: 'Completed',
    PENDING: 'Pending', ACTIVE: 'Active', REJECTED: 'Rejected', SUSPENDED: 'Suspended', ARCHIVED: 'Archived',
    PENDING_VERIFICATION: 'Pending Verification', VERIFIED: 'Verified', APPROVED: 'Approved', PAID: 'Paid', CLOSED: 'Closed',
    UNPAID: 'Unpaid', PARTLY_PAID: 'Partly Paid', OVERDUE: 'Overdue',
    FULL_TIME: 'Full-Time', FREELANCE: 'Freelance', SUPER_ADMIN: 'Super Admin', CLIENT: 'Client', EDITOR: 'Editor',
    UPI: 'UPI', BANK: 'Bank transfer', CASH: 'Cash', CHEQUE: 'Cheque', OTHER: 'Other', ONLINE: 'Online', YOUTUBE: 'YouTube', INSTAGRAM: 'Instagram',
    VIDEO: 'Video', SALARY: 'Salary', BONUS: 'Bonus'
  };
  const label = (code, overrides) => (overrides && overrides[code]) || LABELS[code] || code || '—';
  const badge = (code, overrides) => '<span class="badge b-' + esc(String(code || '').toLowerCase()) + '">' + esc(label(code, overrides)) + '</span>';
  const OPEN = ['NOT_STARTED', 'IN_PROGRESS', 'IN_REVIEW', 'REVISION', 'CLIENT_REVIEW'];
  const UNDERWAY = ['IN_PROGRESS', 'IN_REVIEW', 'REVISION', 'CLIENT_REVIEW'];

  function avatar(u, size) {
    const s = size || 36, style = 'width:' + s + 'px;height:' + s + 'px;font-size:' + Math.round(s * 0.4) + 'px';
    if (u && /^data:image\/(jpeg|png|webp);base64,/.test(u.photo || '')) return '<img class="avatar" style="' + style + '" src="' + esc(u.photo) + '" alt="">';
    const initials = String((u && u.fullName) || '?').trim().split(/\s+/).slice(0, 2).map(w => w[0] || '').join('').toUpperCase();
    return '<span class="avatar" style="' + style + '" aria-hidden="true">' + esc(initials) + '</span>';
  }
  function table(heads, rows, empty) {
    if (!rows.length) return '<div class="empty">' + esc(empty) + '</div>';
    const cls = h => (/^#/.test(h) ? ' class="num"' : '');
    return '<div class="table-wrap"><table><thead><tr>' + heads.map(h => '<th' + cls(h) + '>' + esc(h.replace(/^#/, '')) + '</th>').join('') + '</tr></thead><tbody>' +
      rows.map(r => '<tr>' + r.map((c, i) => '<td' + cls(heads[i] || '') + '>' + c + '</td>').join('') + '</tr>').join('') + '</tbody></table></div>';
  }
  // Each summary card gets an icon and a colour from what it measures.
  const STAT_LOOK = [[/approval/i, 'usercheck', 'rose'], [/pending|outstanding|owed|awaiting|left/i, 'clock', 'amber'], [/revenue|income|received|paid|earn|net/i, 'trending', 'green'], [/completed/i, 'check', 'green'], [/review/i, 'play', 'violet'], [/progress|open/i, 'play', 'blue'], [/editor|payout/i, 'scissors', 'amber'], [/client/i, 'users', 'blue'], [/project|video/i, 'film', 'violet'], [/billed|amount|expense/i, 'receipt', 'teal']];
  const stat = (name, value, section, hint) => {
    const look = STAT_LOOK.find(l => l[0].test(name)) || [0, 'chart', 'teal'];
    return (section ? '<a class="stat t-' + look[2] + '" href="#/' + section + '">' : '<div class="stat t-' + look[2] + '">') + '<span class="stat-ico">' + icon(look[1]) + '</span>' +
      '<div class="label">' + esc(name) + '</div><div class="value">' + esc(value) + '</div>' + (hint ? '<div class="hint">' + esc(hint) + '</div>' : '') + (section ? '</a>' : '</div>');
  };
  const panel = (title, body, tools) => '<section class="panel"><div class="panel-head"><h3>' + esc(title) + '</h3><div class="actions">' + (tools || '') + '</div></div>' + body + '</section>';
  const kv = pairs => '<dl class="kv">' + pairs.filter(Boolean).map(p => '<dt>' + esc(p[0]) + '</dt><dd>' + p[1] + '</dd>').join('') + '</dl>';
  const btn = (text, act, data, cls) => '<button type="button" class="btn ' + (cls || 'ghost small') + '" data-act="' + act + '"' +
    Object.keys(data || {}).map(k => ' data-' + k + '="' + esc(data[k]) + '"').join('') + '>' + esc(text) + '</button>';
  const filterInput = (key, placeholder) => '<input class="grow" type="search" data-f="' + key + '" placeholder="' + esc(placeholder) + '" value="' + esc(SV.F[key] || '') + '" aria-label="' + esc(placeholder) + '">';
  const filterSelect = (key, options, aria) => '<select data-f="' + key + '" aria-label="' + esc(aria) + '">' + options.map(o => '<option value="' + esc(o[0]) + '"' + (String(SV.F[key] || '') === String(o[0]) ? ' selected' : '') + '>' + esc(o[1]) + '</option>').join('') + '</select>';
  const subtabs = (key, tabs) => '<div class="subtabs" role="tablist">' + tabs.map(t => '<button type="button" role="tab" data-act="tab" data-key="' + key + '" data-value="' + t[0] + '" class="' + ((SV.F[key] || tabs[0][0]) === t[0] ? 'on' : '') + '">' + esc(t[1]) + '</button>').join('') + '</div>';

  // ───────── icons, chips, steps, charts ─────────
  const ICONS = {
    home: 'M3 11l9-8 9 8M5 10v10h14V10', users: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8',
    film: 'M4 4h16v16H4zM8 4v16M16 4v16M4 9h4M4 15h4M16 9h4M16 15h4', scissors: 'M6 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6M6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6M20 4L8.1 15.9M14.5 14.5L20 20M8.1 8.1L12 12',
    calendar: 'M4 5h16v16H4zM16 3v4M8 3v4M4 11h16', wallet: 'M3 7h18v12H3zM3 7l2-3h12l2 3M16 13h2', trending: 'M3 17l6-6 4 4 8-8M15 7h6v6', receipt: 'M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6',
    play: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20M10 8l6 4-6 4z', bell: 'M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.9 1.9 0 0 0 3.4 0',
    usercheck: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M16 11l2 2 4-4', tag: 'M20.6 13.4l-7.2 7.2a2 2 0 0 1-2.8 0L2 12V2h10l8.6 8.6a2 2 0 0 1 0 2.8M7 7h.01',
    card: 'M2 5h20v14H2zM2 10h20', chart: 'M4 20V10M10 20V4M16 20v-7M22 20H2', user: 'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8',
    gear: 'M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6', logout: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9',
    search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16M21 21l-4.3-4.3', sun: 'M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10M12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4',
    moon: 'M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z', check: 'M20 6L9 17l-5-5', clock: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20M12 6v6l4 2', menu: 'M3 6h18M3 12h18M3 18h18'
  };
  const icon = n => '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="' + (ICONS[n] || '') + '"/></svg>';
  function dueChip(deadline, status) {
    if (!deadline || status === 'COMPLETED') return '';
    const days = Math.round((asDate(deadline) - asDate(today())) / 86400000), n = Math.abs(days), unit = n === 1 ? ' day' : ' days';
    const text = days < 0 ? 'Overdue by ' + n + unit : days === 0 ? 'Due today' : 'Due in ' + n + unit;
    return '<span class="due' + (days < 0 ? ' late' : days <= 2 ? ' soon' : '') + '">' + icon('clock') + text + '</span>';
  }
  const STEP_AT = { NOT_STARTED: 0, IN_PROGRESS: 1, REVISION: 1, IN_REVIEW: 2, CLIENT_REVIEW: 3, COMPLETED: 5 };
  function stepper(status, names) {
    const at = STEP_AT[status] === undefined ? 0 : STEP_AT[status];
    return '<ol class="steps" aria-label="Progress">' + (names || ['Submitted', 'Editing', 'Studio review', 'Final approval', 'Completed']).map((s, i) => '<li class="' + (i < at ? 'done' : i === at ? 'current' : '') + '"' + (i === at ? ' aria-current="step"' : '') + '>' + esc(s) + '</li>').join('') + '</ol>';
  }
  /** items: [{ label, value, text }] */
  function barChart(items) {
    const max = Math.max.apply(null, items.map(i => i.value).concat([1]));
    return '<div class="bars" role="img" aria-label="' + esc(items.map(i => i.label + ' ' + i.text).join(', ')) + '">' + items.map(i => '<div class="bar"><b>' + esc(i.text) + '</b><div class="fill" style="height:calc((100% - 46px) * ' + (i.value / max).toFixed(3) + ')"></div><span>' + esc(i.label) + '</span></div>').join('') + '</div>';
  }
  /** items: [{ label (HTML), value }] */
  function hbars(items) {
    const max = Math.max.apply(null, items.map(i => i.value).concat([1]));
    return '<div class="hbars">' + items.map(i => '<div class="hbar"><span>' + i.label + '</span><span class="track"><i style="width:' + Math.round(i.value / max * 100) + '%"></i></span><b>' + i.value + '</b></div>').join('') + '</div>';
  }
  // A link we know how to play inside the page (Google Drive, YouTube, Vimeo); anything else opens in a new tab.
  function embedUrl(u) {
    if (!safeUrl(u)) return '';
    let m = /drive\.google\.com\/file\/d\/([\w-]+)/.exec(u) || /drive\.google\.com\/open\?id=([\w-]+)/.exec(u);
    if (m) return 'https://drive.google.com/file/d/' + m[1] + '/preview';
    m = /(?:youtube\.com\/(?:watch\?v=|shorts\/)|youtu\.be\/)([\w-]{6,})/.exec(u);
    if (m) return 'https://www.youtube.com/embed/' + m[1];
    m = /vimeo\.com\/(\d+)/.exec(u);
    return m ? 'https://player.vimeo.com/video/' + m[1] : '';
  }
  const previewBtn = (u, title) => (embedUrl(u) ? ' ' + btn('Preview', 'preview', { url: u, title: title || 'Preview' }) : '');

  function toast(message, kind) {
    const el = document.createElement('div');
    el.className = 'toast' + (kind === 'error' ? ' error' : '');
    el.setAttribute('role', kind === 'error' ? 'alert' : 'status');
    el.textContent = message;
    $('#toasts').appendChild(el);
    setTimeout(() => el.remove(), kind === 'error' ? 7000 : 4000);
  }

  // ───────── server ─────────
  async function api(action, payload) {
    if (!API) throw new Error('The backend address is not set. Put your Apps Script Web App URL in assets/config.js.');
    let res, json;
    try {
      // text/plain keeps this a "simple" request: Apps Script web apps cannot answer a CORS preflight.
      res = await fetch(API, { method: 'POST', redirect: 'follow', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ action: action, payload: payload || {}, token: token }) });
    } catch (e) { throw new Error('Could not reach the server. Check your connection and try again.'); }
    try { json = await res.json(); } catch (e) { throw new Error('The server sent an unexpected reply. Check the Web App deployment.'); }
    if (!json.ok) {
      const err = new Error(json.error || 'Something went wrong.');
      err.code = json.code;
      if (json.code === 'AUTH' && SV.S) signedOut(json.error);
      throw err;
    }
    return json.data;
  }
  function setToken(t) { token = t || ''; try { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY); } catch (e) { /* ignore */ } }
  function signedOut(message) {
    setToken(''); SV.S = null; SV.F = {};
    closeModal();
    AUTH.modal = message ? 'login' : ''; AUTH.notice = message || '';
    if (location.hash) history.replaceState(null, '', location.pathname + location.search);
    render();
  }
  async function reload() { SV.S = await api('state'); render(); }
  /** Save, refresh every list from the server, then say so. The message is shown only after the server confirmed. */
  async function mutate(action, payload, message) { const out = await api(action, payload); await reload(); if (message) toast(message); return out; }

  // ───────── dialogs ─────────
  let modalDone = null;
  function closeModal(result) { $('#modal-root').innerHTML = ''; if (modalDone) { const d = modalDone; modalDone = null; d(result || false); } }
  const MONEY = /^\d+(\.\d{1,2})?$/;
  function fieldHtml(f) {
    const id = 'f_' + f.name;
    const common = 'id="' + id + '" name="' + f.name + '"' + (f.readonly ? ' readonly' : '');
    let control;
    if (f.type === 'select') control = '<select ' + common + '>' + f.options.map(o => '<option value="' + esc(o[0]) + '"' + (String(o[0]) === String(f.value === undefined ? '' : f.value) ? ' selected' : '') + '>' + esc(o[1]) + '</option>').join('') + '</select>';
    else if (f.type === 'textarea') control = '<textarea ' + common + ' rows="4" maxlength="' + (f.max || 2000) + '">' + esc(f.value) + '</textarea>';
    else if (f.type === 'static') control = '<div class="static">' + f.html + '</div>';
    else control = '<input ' + common + ' type="' + (f.type === 'money' ? 'text' : f.type || 'text') + '"' + (f.type === 'money' ? ' inputmode="decimal"' : '') + ' value="' + esc(f.value) + '"' + (f.max ? ' maxlength="' + f.max + '"' : '') + (f.min ? ' min="' + esc(f.min) + '"' : '') + (f.autocomplete ? ' autocomplete="' + f.autocomplete + '"' : '') + '>';
    return '<label class="field" data-field="' + f.name + '" for="' + id + '"><span>' + esc(f.label) + (f.required ? ' *' : '') + '</span>' + control + (f.help ? '<small>' + esc(f.help) + '</small>' : '') + '</label>';
  }
  function checkFields(fields, vals, shown) {
    for (const f of fields) {
      if (f.type === 'static' || !shown(f)) continue;
      const v = String(vals[f.name] === undefined ? '' : vals[f.name]).trim();
      if (f.required && !v) return f.label + ' is required.';
      if (!v) continue;
      if (f.type === 'money' && (!MONEY.test(v) || (Number(v) <= 0 && !f.allowZero))) return f.label + ' must be an amount ' + (f.allowZero ? 'of zero or more' : 'greater than zero') + ' (up to 2 decimals).';
      if (f.type === 'url' && !/^https?:\/\/\S+\.\S+$/i.test(v)) return f.label + ' must be a link starting with http:// or https://';
      if (f.type === 'email' && !/^\S+@\S+\.\S{2,}$/.test(v)) return 'Enter a valid email address.';
      if (f.type === 'password' && f.minLength && v.length < f.minLength) return f.label + ' must be at least ' + f.minLength + ' characters.';
    }
    return '';
  }
  /** o: { title, intro (HTML), fields, submit, danger, onSubmit(vals) } → resolves true when saved. */
  function openForm(o) {
    closeModal();
    const fields = o.fields || [];
    $('#modal-root').innerHTML = '<div class="backdrop"><form class="modal" novalidate role="dialog" aria-modal="true" aria-label="' + esc(o.title) + '">' +
      '<header><h3>' + esc(o.title) + '</h3><button type="button" class="x" data-close aria-label="Close">×</button></header>' +
      '<div class="modal-body">' + (o.intro ? '<p class="muted">' + o.intro + '</p>' : '') + fields.map(fieldHtml).join('') + '<div class="form-error" role="alert" hidden></div></div>' +
      '<footer><button type="button" class="btn ghost" data-close>Cancel</button><button type="submit" class="btn ' + (o.danger ? 'danger' : 'primary') + '">' + esc(o.submit || 'Save') + '</button></footer></form></div>';
    const form = $('#modal-root form'), error = $('.form-error', form), submit = $('[type=submit]', form);
    const values = () => { const v = {}; fields.forEach(f => { if (f.type !== 'static') v[f.name] = form.elements[f.name].value; }); return v; };
    const shown = f => !f.showIf || f.showIf(values());
    const sync = () => fields.forEach(f => {
      $('[data-field="' + f.name + '"]', form).hidden = !shown(f);
      if (f.compute) form.elements[f.name].value = f.compute(values());
    });
    form.addEventListener('input', sync); form.addEventListener('change', sync); sync();
    form.addEventListener('click', e => { if (e.target.closest('[data-close]') && !submit.classList.contains('busy')) closeModal(); });
    $('.backdrop').addEventListener('mousedown', e => { if (e.target.classList.contains('backdrop') && !submit.classList.contains('busy')) closeModal(); });
    form.addEventListener('submit', async e => {
      e.preventDefault();
      if (submit.disabled) return;
      const vals = values();
      Object.keys(vals).forEach(k => { vals[k] = String(vals[k]).trim(); });
      const problem = checkFields(fields, vals, shown) || (o.validate ? o.validate(vals) : '');
      error.hidden = !problem; error.textContent = problem;
      if (problem) return;
      submit.disabled = true; submit.classList.add('busy');
      try { await o.onSubmit(vals); closeModal(true); }
      catch (err) { if (form.isConnected) { error.hidden = false; error.textContent = err.message; submit.disabled = false; submit.classList.remove('busy'); } }
    });
    const first = form.querySelector('.field:not([hidden]) input:not([readonly]), .field:not([hidden]) select, .field:not([hidden]) textarea') || submit;
    first.focus();
    return new Promise(resolve => { modalDone = resolve; });
  }
  function openDialog(title, html, wide, footer) {
    closeModal();
    $('#modal-root').innerHTML = '<div class="backdrop"><div class="modal' + (wide ? ' wide' : '') + '" role="dialog" aria-modal="true" aria-label="' + esc(title) + '"><header><h3>' + esc(title) + '</h3><button type="button" class="x" data-act="dialog-close" aria-label="Close">×</button></header>' +
      '<div class="modal-body">' + html + '</div><footer>' + (footer || '') + '<button type="button" class="btn ghost" data-act="dialog-close">Close</button></footer></div></div>';
    $('.backdrop').addEventListener('mousedown', e => { if (e.target.classList.contains('backdrop')) closeModal(); });
    $('#modal-root .x').focus();
  }
  SV.ACT['dialog-close'] = () => closeModal();
  SV.ACT.preview = d => openDialog(d.title, '<iframe class="player" src="' + esc(embedUrl(d.url)) + '" title="' + esc(d.title) + '" allow="autoplay; fullscreen" allowfullscreen referrerpolicy="no-referrer"></iframe>' +
    '<p class="muted" style="margin:10px 0 0">If it does not play, the file must be shared as “Anyone with the link”. ' + ext(d.url, 'Open in a new tab') + '</p>', true);
  SV.ACT.print = () => { document.body.classList.add('printing'); window.print(); setTimeout(() => document.body.classList.remove('printing'), 600); };
  /** o: { inv: {id, issuedAt, description, amount, paid, pending}, clientName, clientEmail, pay: payment details } */
  function invoiceDialog(o) {
    const i = o.inv, p = o.pay || {};
    const how = [p.upiId ? 'UPI: ' + p.upiId + (p.upiName ? ' (' + p.upiName + ')' : '') : '', p.accountNumber ? 'Bank: ' + [p.accountName, p.bankName, 'A/c ' + p.accountNumber, p.ifsc ? 'IFSC ' + p.ifsc : ''].filter(Boolean).join(' · ') : ''].filter(Boolean);
    openDialog('Invoice ' + i.id, '<div class="invoice"><div class="inv-top"><div><h2>SV Workspace</h2><small>Video editing studio</small></div><div style="text-align:right"><h2>INVOICE</h2><small>' + esc(i.id) + ' · ' + fmtDate(i.issuedAt) + '</small></div></div>' +
      '<div class="inv-parties"><div><small>Billed to</small><br><strong>' + esc(o.clientName) + '</strong><br>' + esc(o.clientEmail || '') + '</div><div style="text-align:right"><small>Status</small><br><strong>' + (i.pending <= 0 ? 'Paid' : i.paid > 0 ? 'Partly paid' : 'Unpaid') + '</strong></div></div>' +
      '<table><thead><tr><th>Description</th><th class="num">Amount</th></tr></thead><tbody><tr><td>' + esc(i.description) + '</td><td class="num">' + inr(i.amount) + '</td></tr></tbody></table>' +
      '<div class="inv-total"><div><span>Total</span><span>' + inr(i.amount) + '</span></div><div><span>Paid</span><span>' + inr(i.paid) + '</span></div><div class="grand"><span>Balance due</span><span>' + inr(i.pending) + '</span></div></div>' +
      (how.length && i.pending > 0 ? '<p style="margin:18px 0 0"><small>How to pay</small><br>' + how.map(esc).join('<br>') + '</p>' : '') + '</div>', true,
      '<button type="button" class="btn primary" data-act="print">Print / Save as PDF</button>');
  }
  const confirmBox = (title, text, action, danger) => openForm({ title: title, intro: esc(text), submit: action, danger: danger, onSubmit: async () => {} });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && $('#modal-root').firstChild && !$('#modal-root .busy')) closeModal();
    else if (e.key === 'Escape' && !SV.S && AUTH.modal && !$('#authModal .busy')) { AUTH.modal = ''; render(); }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k' && SV.S) { e.preventDefault(); openPalette(); }
  });

  // ───────── search palette (Ctrl K) ─────────
  function openPalette() {
    closeModal();
    const role = SV.S.user.role;
    const items = SV.NAV[role].map(n => ({ label: n[1], sub: 'Go to section', section: n[0], id: '' })).concat(SV.SEARCH[role] ? SV.SEARCH[role](SV.S) : []);
    $('#modal-root').innerHTML = '<div class="backdrop top"><div class="palette" role="dialog" aria-modal="true" aria-label="Search"><div class="palette-input">' + icon('search') + '<input id="palette-q" placeholder="Search sections, videos, people…" autocomplete="off" aria-label="Search"><kbd>Esc</kbd></div><div class="palette-list" id="palette-list"></div></div></div>';
    const input = $('#palette-q'), list = $('#palette-list');
    let sel = 0, shown = [];
    const draw = () => {
      const q = input.value.trim().toLowerCase();
      // a match in the name ranks above a match in the details
      const inLabel = i => i.label.toLowerCase().includes(q);
      shown = items.filter(i => !q || (i.label + ' ' + i.sub + ' ' + (i.keys || '')).toLowerCase().includes(q)).sort((x, y) => (q ? inLabel(y) - inLabel(x) : 0)).slice(0, 12);
      sel = Math.max(0, Math.min(sel, shown.length - 1));
      list.innerHTML = shown.length ? shown.map((i, n) => '<button type="button" class="palette-item' + (n === sel ? ' sel' : '') + '" data-act="palette-go" data-section="' + esc(i.section) + '" data-id="' + esc(i.id || '') + '"><span>' + esc(i.label) + '</span><small>' + esc(i.sub) + '</small></button>').join('') : '<div class="empty" style="border:0;background:none">Nothing matches “' + esc(input.value) + '”.</div>';
    };
    input.addEventListener('input', () => { sel = 0; draw(); });
    input.addEventListener('keydown', e => {
      if (e.key === 'ArrowDown') { sel++; draw(); e.preventDefault(); }
      else if (e.key === 'ArrowUp') { sel--; draw(); e.preventDefault(); }
      else if (e.key === 'Enter' && shown[sel]) { const i = shown[sel]; closeModal(); go(i.section, i.id); }
    });
    $('.backdrop').addEventListener('mousedown', e => { if (e.target.classList.contains('backdrop')) closeModal(); });
    draw(); input.focus();
  }
  SV.ACT.palette = () => openPalette();
  SV.ACT['palette-go'] = d => { closeModal(); go(d.section, d.id); };

  // ───────── theme ─────────
  let theme = 'light';
  try { theme = localStorage.getItem('sv_workspace_theme') || (window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'); } catch (e) { /* default */ }
  document.documentElement.dataset.theme = theme;
  SV.ACT.theme = () => { theme = theme === 'dark' ? 'light' : 'dark'; document.documentElement.dataset.theme = theme; try { localStorage.setItem('sv_workspace_theme', theme); } catch (e) { /* ignore */ } if (SV.S) render(); };

  // ───────── public website, sign-in, first-time set-up ─────────
  // There is no self-registration. People contact the studio; a Super Admin creates their account.
  function contactBox() {
    const c = AUTH.contact || {}, rows = [];
    if (/^\S+@\S+\.\S{2,}$/.test(c.contactEmail || '')) rows.push('<a href="mailto:' + esc(c.contactEmail) + '?subject=' + encodeURIComponent('New video project') + '"><span>Email<br><small>' + esc(c.contactEmail) + '</small></span><span>↗</span></a>');
    const wa = String(c.contactWhatsapp || '').replace(/\D/g, '');
    if (wa.length >= 7) rows.push('<a href="https://wa.me/' + wa + '?text=' + encodeURIComponent('Hi SV Workspace, I would like to start a video project.') + '" target="_blank" rel="noopener noreferrer"><span>WhatsApp<br><small>' + esc(c.contactWhatsapp) + '</small></span><span>↗</span></a>');
    const tel = String(c.contactPhone || '').replace(/[^\d+]/g, '');
    if (tel.length >= 7) rows.push('<a href="tel:' + tel + '"><span>Call<br><small>' + esc(c.contactPhone) + '</small></span><span>↗</span></a>');
    return '<h2 id="authTitle" style="margin-top:20px">Start your project</h2><p>Tell us about your video. We set up your SV Workspace account and send you the login details — then you can send footage, follow every edit and pay from your dashboard.</p>' +
      (rows.length ? '<div class="lp-contact">' + rows.join('') + '</div>' : '<div class="lp-form-note">Our contact details will appear here shortly.</div>') +
      '<div class="lp-form-note">Already have an account? <a href="#home" data-auth="login"><strong>Sign in</strong></a></div>';
  }
  function signInBox() {
    const note = AUTH.notice ? '<div class="lp-form-note" role="status" style="margin:0 0 4px">' + esc(AUTH.notice) + '</div>' : '';
    if (AUTH.hasAdmin === false) return '<h2 id="authTitle" style="margin-top:20px">Set up your studio</h2><p>No Super Admin exists yet. Create the first one — this can be done only once.</p>' + note +
      '<form data-form="register" novalidate><input type="hidden" name="role" value="SUPER_ADMIN"><label for="fullName">Full name</label><input id="fullName" name="fullName" autocomplete="name" maxlength="80" required>' +
      '<label for="email">Email address</label><input type="email" id="email" name="email" autocomplete="username" required placeholder="you@example.com">' +
      '<div class="lp-row"><div><label for="password">Password</label><input type="password" id="password" name="password" autocomplete="new-password" required placeholder="At least 8 characters"></div>' +
      '<div><label for="confirm">Confirm password</label><input type="password" id="confirm" name="confirm" autocomplete="new-password" required></div></div>' +
      '<button type="submit" class="lp-btn lp-primary">Create Super Admin →</button></form>';
    return '<h2 id="authTitle" style="margin-top:20px">Welcome back</h2><p>Access your SV Workspace account.</p>' + note +
      '<form data-form="login" novalidate><label for="email">Email address</label><input type="email" id="email" name="email" autocomplete="username" required placeholder="you@example.com">' +
      '<label for="password">Password</label><input type="password" id="password" name="password" autocomplete="current-password" required placeholder="Your password">' +
      '<button type="submit" class="lp-btn lp-primary">Sign In →</button></form>' +
      '<div class="lp-form-note">Accounts are created by SV Workspace. New here? <a href="#contact" data-auth="register"><strong>Contact us to start a project</strong></a>.</div>';
  }
  function landingView() {
    const setup = API ? '' : '<div class="lp-form-note" style="border-radius:0;margin:0;text-align:center">The backend address is not set. Put your Apps Script Web App URL in assets/config.js (see README).</div>';
    const box = !AUTH.modal ? '' : '<div class="lp-modal-backdrop lp-open" id="authModal" role="presentation"><div class="lp-modal" role="dialog" aria-modal="true" aria-labelledby="authTitle"><button type="button" class="lp-close" data-act="lp-close" aria-label="Close">×</button><div class="lp-brand"><span class="lp-logo">▶</span> SV Workspace</div>' + (AUTH.modal === 'login' ? signInBox() : contactBox()) + '</div></div>';
    return '<div class="lp">' + setup + (SV.LANDING_HTML || '') + box + '</div>';
  }
  SV.ACT['lp-close'] = () => { AUTH.modal = ''; AUTH.notice = ''; render(); };
  SV.FORMS.login = async v => {
    if (!v.email || !v.password) throw new Error('Enter your email address and password.');
    const out = await api('login', { email: v.email, password: v.password });
    setToken(out.token); AUTH.modal = ''; AUTH.notice = '';
    location.hash = '#/overview';
    window.scrollTo(0, 0);
    await reload();
  };
  SV.FORMS.register = async v => {
    if (!v.fullName.trim()) throw new Error('Full name is required.');
    if (!/^\S+@\S+\.\S{2,}$/.test(v.email.trim())) throw new Error('Enter a valid email address.');
    if (v.password.length < 8) throw new Error('Password must be at least 8 characters.');
    if (v.password !== v.confirm) throw new Error('The two passwords do not match.');
    await api('register', { role: 'SUPER_ADMIN', fullName: v.fullName, email: v.email, password: v.password });
    AUTH.hasAdmin = true; AUTH.modal = 'login'; AUTH.notice = 'Super Admin account created. You can sign in now.';
    render();
  };

  // ───────── shell ─────────
  function parseHash() {
    const parts = location.hash.replace(/^#\/?/, '').split('/');
    const role = SV.S.user.role;
    const known = SV.NAV[role].some(n => n[0] === parts[0]);
    SV.route = { section: known ? parts[0] : 'overview', id: known && parts[1] ? decodeURIComponent(parts[1]) : '' };
  }
  function go(section, id) {
    const hash = '#/' + section + (id ? '/' + encodeURIComponent(id) : '');
    if (location.hash === hash) render(); else location.hash = hash;
  }
  const unread = () => SV.S.notifications.filter(n => !n.read).length;
  function shell(role, body) {
    const badges = Object.assign({ notifications: unread() }, SV.BADGES[role] ? SV.BADGES[role](SV.S) : {});
    const nav = SV.NAV[role].map(n => '<a class="nav-item' + (SV.route.section === n[0] ? ' active' : '') + '" href="#/' + n[0] + '"' + (SV.route.section === n[0] ? ' aria-current="page"' : '') + '><span class="nav-ico">' + icon(n[2]) + '</span><span class="nav-text">' + esc(n[1]) + '</span>' + (badges[n[0]] ? '<span class="count">' + badges[n[0]] + '</span>' : '') + '</a>').join('');
    const title = (SV.NAV[role].find(n => n[0] === SV.route.section) || ['', ''])[1];
    const u = SV.S.user, latest = SV.S.notifications.slice(0, 6);
    const pop = '<div class="popover" id="bell-pop" hidden><h4>Notifications</h4>' + (latest.length ? latest.map(n => '<button type="button" class="pnt' + (n.read ? '' : ' unread') + '" data-act="ntf-open" data-id="' + esc(n.id) + '"><span class="dot"></span><span><strong>' + esc(n.title) + '</strong><br><small>' + esc(n.body) + '</small></span></button>').join('') : '<p class="muted" style="padding:0 8px 8px;margin:0">You are all caught up.</p>') + '<a class="all" href="#/notifications">View all notifications</a></div>';
    return '<div class="layout"><aside class="sidebar" id="sidebar" aria-label="Main navigation"><div class="brand"><span class="logo">▶</span><div><strong>SV Workspace</strong><small>' + esc(label(role)) + '</small></div></div>' +
      '<nav>' + nav + '<button type="button" class="nav-item logout" data-act="logout"><span class="nav-ico">' + icon('logout') + '</span><span class="nav-text">Logout</span></button></nav>' +
      '<div class="me">' + avatar(u, 34) + '<div><span>' + esc(u.fullName) + '</span><small>' + esc(u.email) + '</small></div></div></aside>' +
      '<div class="scrim" data-act="menu"></div>' +
      '<div class="main"><header class="topbar"><button type="button" class="icon-btn menu-btn" data-act="menu" aria-label="Open menu">' + icon('menu') + '</button><h2>' + esc(title) + '</h2>' +
      '<button type="button" class="search-btn" data-act="palette" aria-label="Search">' + icon('search') + '<span>Search…</span><kbd>Ctrl K</kbd></button>' +
      '<button type="button" class="icon-btn" data-act="theme" aria-label="Switch between light and dark">' + icon(theme === 'dark' ? 'sun' : 'moon') + '</button>' +
      '<a class="top-me" href="#/' + (role === 'SUPER_ADMIN' ? 'settings' : 'profile') + '" aria-label="My profile">' + avatar(u, 34) + '</a>' +
      '<div class="bell-wrap"><button type="button" class="icon-btn" data-act="bell" aria-label="Notifications' + (badges.notifications ? ', ' + badges.notifications + ' unread' : '') + '">' + icon('bell') + (badges.notifications ? '<span class="pip">' + badges.notifications + '</span>' : '') + '</button>' + pop + '</div></header>' +
      '<main id="main">' + body + '</main></div></div>';
  }
  function render() {
    const app = $('#app');
    document.body.classList.remove('nav-open');
    document.body.style.overflow = !SV.S && AUTH.modal ? 'hidden' : '';
    if (!SV.S) { app.innerHTML = landingView(); const y = $('#year'); if (y) y.textContent = new Date().getFullYear(); return; }
    parseHash();
    const role = SV.S.user.role;
    app.innerHTML = shell(role, SV.VIEWS[role][SV.route.section]());
    tick();
    const focus = $('.item.focus');
    if (focus && SV.F._scroll !== location.hash) { SV.F._scroll = location.hash; focus.scrollIntoView({ block: 'center' }); }
  }
  /** One pill in the greeting banner; nothing when the count is zero. */
  const chip = (count, text, section) => (count ? '<a href="#/' + section + '"><b>' + count + '</b>' + esc(text) + '</a>' : '');
  function greeting(chips) {
    const h = new Date().getHours();
    const g = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
    return '<div class="hero"><h1>' + g + ', ' + esc(SV.S.user.fullName.split(/\s+/)[0]) + '</h1><p><span id="clock-date"></span> · <span id="clock-time"></span></p>' + (chips === undefined ? '' : '<div class="hero-chips">' + (chips || '<span>' + icon('check') + 'You are all caught up</span>') + '</div>') + '</div>';
  }
  function tick() {
    const d = $('#clock-date'), t = $('#clock-time');
    if (!d || !t) return;
    const now = new Date();
    d.textContent = now.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    t.textContent = now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }

  // ───────── events ─────────
  async function runBusy(el, fn) {
    if (el.disabled) return;
    const isBtn = el.tagName === 'BUTTON';
    if (isBtn) { el.disabled = true; el.classList.add('busy'); }
    try { await fn(); }
    catch (e) { if (e.code !== 'AUTH') toast(e.message || 'Something went wrong.', 'error'); }
    finally { if (isBtn && el.isConnected) { el.disabled = false; el.classList.remove('busy'); } }
  }
  document.addEventListener('click', e => {
    if (!SV.S) {
      // The public website: Sign In opens the sign-in box, every "Start a project" button opens the contact box.
      const opener = e.target.closest('[data-auth]');
      if (opener) { e.preventDefault(); AUTH.modal = opener.dataset.auth === 'login' ? 'login' : 'contact'; AUTH.notice = ''; render(); const first = $('#authModal input'); if (first) first.focus();
        // A page left open may not know yet that the studio has been set up, or the latest contact details.
        if (API && (AUTH.hasAdmin !== true || AUTH.modal === 'contact')) api('bootstrap').then(b => { const changed = b.hasAdmin !== AUTH.hasAdmin || JSON.stringify(b.contact) !== JSON.stringify(AUTH.contact); AUTH.hasAdmin = b.hasAdmin; AUTH.contact = b.contact || {}; if (changed && !SV.S && !$('#authModal .busy')) render(); }).catch(() => {});
        return; }
      if (e.target.id === 'authModal' && !$('#authModal .busy')) { AUTH.modal = ''; render(); return; }
      const menu = e.target.closest('#menuBtn');
      if (menu) { menu.setAttribute('aria-expanded', String($('#navlinks').classList.toggle('lp-show'))); return; }
      if (e.target.closest('#navlinks a')) $('#navlinks').classList.remove('lp-show');
    }
    const pop = $('#bell-pop');
    if (pop && !pop.hidden && !e.target.closest('.bell-wrap')) pop.hidden = true;
    const el = e.target.closest('[data-act]');
    if (!el) return;
    const fn = SV.ACT[el.dataset.act];
    if (fn) runBusy(el, () => fn(el.dataset, el));
  });
  document.addEventListener('submit', e => {
    const form = e.target.closest('form[data-form]');
    if (!form) return;
    e.preventDefault();
    const vals = {};
    Array.from(form.elements).forEach(el => { if (el.name && (el.type !== 'radio' || el.checked) && el.type !== 'file') vals[el.name] = el.value; });
    const submit = form.querySelector('[type=submit]');
    runBusy(submit, () => SV.FORMS[form.dataset.form](vals, form));
  });
  document.addEventListener('input', e => {
    const el = e.target;
    if (el.dataset && el.dataset.f) {
      SV.F[el.dataset.f] = el.value;
      const pos = el.selectionStart;
      render();
      const again = $('[data-f="' + el.dataset.f + '"]');
      if (again) { again.focus(); if (again.tagName === 'INPUT' && again.type !== 'month') { try { again.setSelectionRange(pos, pos); } catch (x) { /* not a text field */ } } }
    }
  });
  document.addEventListener('change', e => {
    const el = e.target;
    if (el.matches && el.matches('input[data-photo]')) pickPhoto(el);
  });
  window.addEventListener('hashchange', () => { if (SV.S) render(); });
  setInterval(tick, 1000);
  // Quiet refresh, so new notifications and other people's changes show up without a reload.
  setInterval(async () => {
    if (!SV.S || document.hidden || $('#modal-root').firstChild || $('.busy') || ($('#bell-pop') && !$('#bell-pop').hidden)) return;
    const a = document.activeElement;
    if (a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) return;
    try { SV.S = await api('state'); if (!$('#modal-root').firstChild) render(); } catch (e) { /* next round */ }
  }, 60000);

  SV.ACT.bell = () => { const pop = $('#bell-pop'); pop.hidden = !pop.hidden; };

  // ───────── comments on a video (all roles) ─────────
  function commentsBlock(videoId) {
    const list = (SV.S.comments || []).filter(c => c.videoId === videoId).sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
    const admin = SV.S.user.role === 'SUPER_ADMIN', editor = SV.S.user.role === 'EDITOR';
    return '<div class="comments"><h4>Comments' + (list.length ? ' (' + list.length + ')' : '') + '</h4>' +
      (list.length ? list.map(c => '<div class="comment' + (c.mine ? ' mine' : '') + '"><div class="comment-head"><strong>' + esc(c.author) + '</strong>' + (c.timecode ? '<span class="tc">' + esc(c.timecode) + '</span>' : '') + (c.audience === 'INTERNAL' ? '<span class="badge">Team only</span>' : '') + '<small>' + fmtDateTime(c.createdAt) + '</small></div><div class="pre">' + esc(c.text) + '</div></div>').join('') : '<p class="muted" style="margin:0 0 4px">No comments yet. Add a timecode to point at an exact moment.</p>') +
      '<form data-form="comment" class="comment-form" novalidate><input type="hidden" name="videoId" value="' + esc(videoId) + '"><input class="tc-input" name="timecode" placeholder="0:42" maxlength="8" aria-label="Timecode (optional)"><input class="grow" name="text" placeholder="Add a comment…" maxlength="1000" aria-label="Comment">' +
      (admin ? '<select name="audience" aria-label="Who can see it"><option value="ALL">Everyone</option><option value="INTERNAL">Team only</option></select>' : '') + '<button class="btn primary small" type="submit">Send</button></form>' +
      (editor ? '<small class="muted">Your comments go to the studio team.</small>' : '') + '</div>';
  }
  SV.FORMS.comment = async v => {
    if (!v.text.trim()) throw new Error('Write a comment first.');
    if (v.timecode.trim() && !/^\d{1,3}:[0-5]\d(:[0-5]\d)?$/.test(v.timecode.trim())) throw new Error('Timecode must look like 0:42 or 1:02:15.');
    await mutate('video.comment', v, 'Comment added.');
  };

  SV.ACT.menu = () => { document.body.classList.toggle('nav-open'); };
  SV.ACT.tab = d => { SV.F[d.key] = d.value; render(); };
  SV.ACT.go = d => go(d.section, d.id);
  SV.ACT.logout = async () => {
    try { await api('logout'); } catch (e) { /* the local sign-out below still happens */ }
    signedOut('');
    toast('You have been signed out.');
  };

  // ───────── notifications (all roles) ─────────
  function notificationsView() {
    const all = SV.S.notifications, mode = SV.F.ntf || 'all';
    const list = mode === 'unread' ? all.filter(n => !n.read) : all;
    return '<div class="toolbar">' + subtabs('ntf', [['all', 'All (' + all.length + ')'], ['unread', 'Unread (' + unread() + ')']]).replace('class="subtabs"', 'class="subtabs" style="margin:0;flex:1"') +
      '<button type="button" class="btn ghost" data-act="ntf-all"' + (unread() ? '' : ' disabled') + '>Mark all as read</button></div>' +
      (list.length ? '<div class="list">' + list.map(n => '<button type="button" class="ntf' + (n.read ? '' : ' unread') + '" data-act="ntf-open" data-id="' + esc(n.id) + '"><span class="dot"></span><span><strong>' + esc(n.title) + '</strong><br>' + esc(n.body) + '<br><small>' + esc(n.refId ? n.refId + ' · ' : '') + fmtDateTime(n.createdAt) + '</small></span></button>').join('') + '</div>'
        : '<div class="empty">' + (mode === 'unread' ? 'No unread notifications.' : 'No notifications yet.') + '</div>');
  }
  SV.ACT['ntf-all'] = () => mutate('notifications.readAll', {}, 'All notifications marked as read.');
  SV.ACT['ntf-open'] = async d => {
    const n = SV.S.notifications.find(x => x.id === d.id);
    if (!n) return;
    if (!n.read) { await api('notifications.read', { id: n.id }); n.read = true; }
    const target = SV.OPEN_REF[SV.S.user.role](n);
    if (target) go(target[0], target[1]); else render();
  };

  // ───────── profile + password (all roles) ─────────
  function pickPhoto(input) {
    const file = input.files && input.files[0];
    if (!file) return;
    if (!/^image\//.test(file.type)) { toast('Choose an image file.', 'error'); return; }
    const img = new Image(), url = URL.createObjectURL(file);
    img.onerror = () => { URL.revokeObjectURL(url); toast('That image could not be read.', 'error'); };
    img.onload = () => {
      URL.revokeObjectURL(url);
      const size = 160, c = document.createElement('canvas'); c.width = c.height = size;
      const side = Math.min(img.width, img.height);
      c.getContext('2d').drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, size, size);
      let q = 0.85, data = c.toDataURL('image/jpeg', q);
      while (data.length > 40000 && q > 0.3) { q -= 0.15; data = c.toDataURL('image/jpeg', q); }
      SV.F.photoDraft = data;
      const holder = $('#photo-preview');
      if (holder) holder.innerHTML = avatar({ photo: data, fullName: SV.S.user.fullName }, 84);
      const note = $('#photo-note'); if (note) note.textContent = 'New photo selected — press Save profile to keep it.';
    };
    img.src = url;
  }
  /** extra: HTML of role-specific fields placed after the email field. */
  function profileForm(extra) {
    const u = SV.S.user, draft = SV.F.photoDraft;
    return '<form data-form="profile" novalidate><div class="photo-row"><span id="photo-preview">' + avatar(draft ? { photo: draft, fullName: u.fullName } : u, 84) + '</span>' +
      '<div><label class="btn ghost" style="cursor:pointer">Change photo<input type="file" data-photo accept="image/png,image/jpeg,image/webp" hidden></label> ' +
      (u.photo || draft ? btn('Remove photo', 'photo-remove') : '') + '<br><small class="muted" id="photo-note">' + (draft === '' ? 'Photo will be removed when you save.' : draft ? 'New photo selected — press Save profile to keep it.' : 'JPG, PNG or WebP. It is resized before upload.') + '</small></div></div>' +
      '<div class="grid2"><label class="field"><span>Full name *</span><input name="fullName" maxlength="80" value="' + esc(u.fullName) + '" required></label>' +
      '<label class="field"><span>Email address *</span><input name="email" type="email" maxlength="150" value="' + esc(u.email) + '" required></label></div>' +
      (extra || '') + '<button class="btn primary" type="submit">Save profile</button></form>';
  }
  SV.ACT['photo-remove'] = () => { SV.F.photoDraft = ''; render(); };
  SV.FORMS.profile = async v => {
    if (!v.fullName.trim()) throw new Error('Full name is required.');
    if (!/^\S+@\S+\.\S{2,}$/.test(v.email.trim())) throw new Error('Enter a valid email address.');
    const payload = { fullName: v.fullName, email: v.email, socialName: v.socialName || '' };
    if (SV.F.photoDraft !== undefined) payload.photo = SV.F.photoDraft;
    await api('updateProfile', payload);
    delete SV.F.photoDraft;
    await reload();
    toast('Profile saved.');
  };
  const passwordPanel = () => panel('Change password', '<form data-form="password" novalidate><div class="grid2">' +
    '<label class="field"><span>Current password *</span><input name="current" type="password" autocomplete="current-password" required></label><span></span>' +
    '<label class="field"><span>New password *</span><input name="next" type="password" autocomplete="new-password" required><small>At least 8 characters.</small></label>' +
    '<label class="field"><span>Confirm new password *</span><input name="confirm" type="password" autocomplete="new-password" required></label></div>' +
    '<button class="btn primary" type="submit">Change password</button></form>');
  SV.FORMS.password = async (v, form) => {
    if (!v.current) throw new Error('Enter your current password.');
    if (v.next.length < 8) throw new Error('New password must be at least 8 characters.');
    if (v.next !== v.confirm) throw new Error('The two new passwords do not match.');
    await api('changePassword', { current: v.current, next: v.next });
    form.reset();
    toast('Password changed. Other devices were signed out.');
  };

  function downloadCsv(name, heads, rows) {
    const cell = v => { let s = String(v === null || v === undefined ? '' : v); if (/^[=+\-@]/.test(s)) s = "'" + s; return '"' + s.replace(/"/g, '""') + '"'; };
    const blob = new Blob(['﻿' + [heads].concat(rows).map(r => r.map(cell).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  SV.boot = async function () {
    if (token && API) { try { SV.S = await api('state'); } catch (e) { setToken(''); if (e.code !== 'AUTH') { AUTH.notice = e.message; } } }
    else if (token) setToken('');
    render();
    // Who to contact, and whether the studio still needs its first Super Admin.
    if (!SV.S && API) { try { const b = await api('bootstrap'); AUTH.hasAdmin = b.hasAdmin; AUTH.contact = b.contact || {}; if (!SV.S && !AUTH.modal) render(); } catch (e) { /* the page still works; sign-in will report the problem */ } }
  };

  return Object.assign(SV, { $, esc, inr, fmtDate, fmtDateTime, ymd, ym, today, sum, byNewest, ext, label, badge, avatar, table, stat, panel, kv, btn, filterInput, filterSelect, subtabs, chip, toast, api, reload, mutate, openForm, openDialog, invoiceDialog, confirmBox, icon, dueChip, stepper, barChart, hbars, previewBtn, commentsBlock, go, render, greeting, notificationsView, profileForm, passwordPanel, downloadCsv, OPEN, UNDERWAY });
})();

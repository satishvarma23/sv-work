/**
 * SV Workspace — Google Apps Script backend (database: Google Sheets).
 *
 * Deploy as a Web App (Execute as: Me, Who has access: Anyone). The frontend
 * sends POST requests with a JSON body { action, token, payload }.
 * Every action is authorised here, on the server; the frontend only hides things.
 *
 * First-time setup: run setup() once from the Apps Script editor.
 */

// ───────────────────────────── Schema ─────────────────────────────

const SCHEMA = {
  Users: ['id', 'role', 'email', 'passwordHash', 'salt', 'iter', 'fullName', 'photo', 'status', 'createdAt', 'approvedAt', 'approvedBy', 'updatedAt', 'failedCount', 'lockedUntil'],
  Clients: ['userId', 'socialName', 'updatedAt'],
  Editors: ['userId', 'employmentType', 'monthlySalary', 'perVideoRate', 'updatedAt'],
  Channels: ['id', 'clientId', 'platform', 'name', 'link', 'createdAt', 'updatedAt'],
  Videos: ['id', 'clientId', 'type', 'typeLabel', 'price', 'rawLink', 'remarks', 'status', 'editorId', 'deadline', 'editorRate', 'editedLink', 'revisionNote', 'invoiceId', 'createdAt', 'updatedAt', 'startedAt', 'submittedAt', 'adminApprovedAt', 'completedAt'],
  Assignments: ['id', 'videoId', 'editorId', 'rate', 'deadline', 'status', 'assignedBy', 'assignedAt', 'endedAt'],
  Comments: ['id', 'videoId', 'byUserId', 'byRole', 'audience', 'timecode', 'text', 'createdAt'],
  Reviews: ['id', 'videoId', 'byUserId', 'byRole', 'decision', 'note', 'link', 'createdAt'],
  Pricings: ['type', 'label', 'price', 'updatedAt', 'updatedBy'],
  Notifications: ['id', 'userId', 'kind', 'title', 'body', 'refType', 'refId', 'read', 'createdAt'],
  Invoices: ['id', 'clientId', 'videoId', 'description', 'amount', 'status', 'issuedAt', 'updatedAt'],
  ManualPayments: ['id', 'clientId', 'amount', 'method', 'reference', 'note', 'status', 'submittedAt', 'decidedAt', 'decidedBy', 'decisionNote', 'paymentId'],
  ClientPayments: ['id', 'clientId', 'amount', 'method', 'reference', 'sourceId', 'receivedAt', 'recordedBy', 'note'],
  OnlineOrders: ['id', 'clientId', 'orderId', 'amount', 'status', 'gatewayPaymentId', 'createdAt', 'paidAt'],
  EditorEarnings: ['id', 'editorId', 'kind', 'videoId', 'periodId', 'amount', 'note', 'createdAt', 'createdBy'],
  SalaryPeriods: ['id', 'editorId', 'month', 'amount', 'createdAt', 'createdBy'],
  PaymentRequests: ['id', 'editorId', 'amount', 'paidAmount', 'status', 'createdAt', 'decidedAt', 'decidedBy', 'decisionNote'],
  EditorPayouts: ['id', 'editorId', 'requestId', 'amount', 'reference', 'note', 'paidAt', 'paidBy'],
  Expenses: ['id', 'date', 'category', 'description', 'amount', 'createdAt', 'createdBy'],
  Sessions: ['tokenHash', 'userId', 'createdAt', 'expiresAt', 'revoked'],
  AuditLogs: ['id', 'at', 'userId', 'action', 'refType', 'refId', 'detail'],
  Settings: ['key', 'value', 'updatedAt', 'updatedBy'],
  Counters: ['name', 'value']
};

const VIDEO_TYPES = { REEL: 'Reel / Short', LONG: 'Long Length / YouTube', BRAND: 'Brand Promotion' };
const ROLES = ['SUPER_ADMIN', 'CLIENT', 'EDITOR'];
const OPEN_STATUSES = ['NOT_STARTED', 'IN_PROGRESS', 'IN_REVIEW', 'REVISION', 'CLIENT_REVIEW'];
const STATUS_LABEL = { NOT_STARTED: 'Not Started', IN_PROGRESS: 'In Progress', IN_REVIEW: 'In Review', REVISION: 'Revision Requested', CLIENT_REVIEW: 'Awaiting Client Approval', COMPLETED: 'Completed' };
const SETTING_KEYS = ['upiId', 'upiName', 'bankName', 'accountName', 'accountNumber', 'ifsc', 'paymentNote', 'contactEmail', 'contactPhone', 'contactWhatsapp'];
const CONTACT_KEYS = ['contactEmail', 'contactPhone', 'contactWhatsapp'];
const PASSWORD_ITERATIONS = 2000;
const SESSION_DAYS = 7;
const MAX_FAILED_LOGINS = 5;
const LOCK_MINUTES = 15;

let REQ = { tables: {}, ss: null };

// ───────────────────────────── Setup ─────────────────────────────

/** Run once from the Apps Script editor. Safe to run again: it only adds what is missing. */
function setup() {
  REQ = { tables: {}, ss: null };
  const ss = ss_();
  Object.keys(SCHEMA).forEach(function (name) {
    let sh = ss.getSheetByName(name);
    if (!sh) sh = ss.insertSheet(name);
    // Plain text everywhere: Sheets must never turn "2026-11" or an id into a date or a number.
    sh.getRange(1, 1, sh.getMaxRows(), sh.getMaxColumns()).setNumberFormat('@');
    const head = SCHEMA[name];
    const last = sh.getLastColumn();
    const current = last ? sh.getRange(1, 1, 1, last).getValues()[0].map(String) : [];
    const missing = head.filter(function (h) { return current.indexOf(h) < 0; });
    if (missing.length) sh.getRange(1, current.length + 1, 1, missing.length).setValues([missing]);
    sh.setFrozenRows(1);
  });
  REQ = { tables: {}, ss: null };
  Object.keys(VIDEO_TYPES).forEach(function (type) {
    if (!byKey_('Pricings', 'type', type)) insert_('Pricings', { type: type, label: VIDEO_TYPES[type], price: 0, updatedAt: now_(), updatedBy: 'setup' });
  });
  return 'SV Workspace sheets are ready.';
}

// ───────────────────────────── Entry points ─────────────────────────────

function doGet() {
  return json_({ ok: true, data: { service: 'SV Workspace API', time: now_() } });
}

function doPost(e) {
  REQ = { tables: {}, ss: null };
  let out;
  try {
    let body = null;
    try { body = JSON.parse(e.postData.contents); } catch (x) { /* handled below */ }
    if (!body || typeof body !== 'object') fail_('Invalid request.');
    const def = Object.prototype.hasOwnProperty.call(ACTIONS, String(body.action)) ? ACTIONS[String(body.action)] : null;
    if (!def) fail_('Unknown action.');
    const lock = LockService.getScriptLock();
    try { lock.waitLock(25000); } catch (x) { fail_('The server is busy. Please try again in a moment.', 'BUSY'); }
    try {
      let user = null;
      if (def.roles) {
        user = auth_(body.token);
        if (def.roles !== 'ANY' && def.roles.indexOf(user.role) < 0) fail_('You are not allowed to do this.', 'FORBIDDEN');
      }
      const payload = body.payload && typeof body.payload === 'object' ? body.payload : {};
      out = { ok: true, data: def.fn(payload, user, body) };
    } finally {
      lock.releaseLock();
    }
  } catch (err) {
    if (err && err.userError) out = { ok: false, error: err.message, code: err.code || 'ERROR' };
    else {
      console.error(err && err.stack ? err.stack : err);
      out = { ok: false, error: 'Unexpected server error. Please try again.', code: 'SERVER' };
    }
  }
  return json_(out);
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// ───────────────────────────── Sheet access ─────────────────────────────

function ss_() {
  if (!REQ.ss) {
    const id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
    REQ.ss = id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActiveSpreadsheet();
    if (!REQ.ss) throw new Error('No spreadsheet. Bind the script to a Sheet or set SPREADSHEET_ID.');
  }
  return REQ.ss;
}

// A leading space keeps Sheets from reading user text as a formula; it is removed on read.
function enc_(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /^[=+\-@]/.test(s) ? ' ' + s : s;
}
function dec_(v) {
  const s = v instanceof Date ? v.toISOString() : String(v === null || v === undefined ? '' : v);
  return /^ [=+\-@]/.test(s) ? s.slice(1) : s;
}

function table_(name) {
  if (REQ.tables[name]) return REQ.tables[name];
  const sh = ss_().getSheetByName(name);
  if (!sh) throw new Error('Sheet "' + name + '" is missing. Run setup().');
  const vals = sh.getDataRange().getValues();
  const head = (vals[0] || []).map(String);
  SCHEMA[name].forEach(function (h) { if (head.indexOf(h) < 0) throw new Error('Column "' + h + '" is missing in "' + name + '". Run setup().'); });
  const rows = [];
  for (let i = 1; i < vals.length; i++) {
    const r = vals[i];
    if (r.every(function (c) { return c === '' || c === null; })) continue;
    const o = { _row: i + 1 };
    for (let c = 0; c < head.length; c++) if (head[c]) o[head[c]] = dec_(r[c]);
    rows.push(o);
  }
  REQ.tables[name] = { sh: sh, head: head, rows: rows };
  return REQ.tables[name];
}
function rows_(name) { return table_(name).rows; }
function byKey_(name, key, value) {
  const v = String(value === undefined || value === null ? '' : value);
  if (!v) return null;
  const rows = rows_(name);
  for (let i = 0; i < rows.length; i++) if (rows[i][key] === v) return rows[i];
  return null;
}
function where_(name, fn) { return rows_(name).filter(fn); }

function insert_(name, obj) {
  const t = table_(name);
  const row = {};
  t.head.forEach(function (h) { if (h) row[h] = obj[h] === undefined || obj[h] === null ? '' : String(obj[h]); });
  // Written as plain text into a row formatted as text first: Sheets must not turn a date, a month
  // or an account number into something else. Safe without appendRow because of the script lock.
  const r = t.sh.getLastRow() + 1;
  if (r > t.sh.getMaxRows()) t.sh.insertRowsAfter(t.sh.getMaxRows(), 500);
  t.sh.getRange(r, 1, 1, t.head.length).setNumberFormat('@').setValues([t.head.map(function (h) { return enc_(row[h]); })]);
  row._row = r;
  t.rows.push(row);
  return row;
}
function update_(name, row, patch) {
  const t = table_(name);
  Object.keys(patch).forEach(function (k) { row[k] = patch[k] === undefined || patch[k] === null ? '' : String(patch[k]); });
  t.sh.getRange(row._row, 1, 1, t.head.length).setValues([t.head.map(function (h) { return enc_(row[h]); })]);
  return row;
}
function remove_(name, row) {
  table_(name).sh.deleteRow(row._row);
  delete REQ.tables[name]; // row numbers moved
}

function nextId_(prefix) {
  let c = byKey_('Counters', 'name', prefix);
  if (!c) c = insert_('Counters', { name: prefix, value: 0 });
  const n = num_(c.value) + 1;
  update_('Counters', c, { value: n });
  return prefix + '-' + ('0000' + n).slice(-Math.max(4, String(n).length));
}

// ───────────────────────────── Helpers ─────────────────────────────

function now_() { return new Date().toISOString(); }
function num_(v) { const n = Number(String(v === undefined || v === null ? '' : v).trim()); return isFinite(n) ? n : 0; }
function round2_(n) { return Math.round(n * 100) / 100; }
function sum_(list, key) { return round2_(list.reduce(function (a, r) { return a + num_(r[key]); }, 0)); }

function fail_(message, code) {
  const e = new Error(message);
  e.userError = true;
  e.code = code || 'ERROR';
  throw e;
}

function text_(v, label, max, required) {
  const s = String(v === undefined || v === null ? '' : v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim();
  if (required && !s) fail_(label + ' is required.');
  if (s.length > max) fail_(label + ' is too long (maximum ' + max + ' characters).');
  return s;
}
function emailOf_(v) {
  const s = text_(v, 'Email address', 150, true).toLowerCase();
  if (!/^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']{2,}$/.test(s)) fail_('Enter a valid email address.');
  return s;
}
function passwordOf_(v, label) {
  const s = String(v === undefined || v === null ? '' : v);
  if (s.length < 8) fail_((label || 'Password') + ' must be at least 8 characters.');
  if (s.length > 200) fail_((label || 'Password') + ' is too long.');
  return s;
}
function money_(v, label, allowZero) {
  const raw = String(v === undefined || v === null ? '' : v).trim();
  if (!/^\d+(\.\d{1,2})?$/.test(raw)) fail_(label + ' must be a number in INR (up to 2 decimals).');
  const n = Number(raw);
  if (n > 100000000) fail_(label + ' is too large.');
  if (n <= 0 && !(allowZero && n === 0)) fail_(label + ' must be greater than zero.');
  return round2_(n);
}
function urlOf_(v, label) {
  const s = text_(v, label, 1000, true);
  if (!/^https?:\/\/[^\s<>"'`\\]+\.[^\s<>"'`\\]+$/i.test(s)) fail_(label + ' must be a valid link starting with http:// or https://');
  return s;
}
function dateOf_(v, label, required) {
  const s = String(v === undefined || v === null ? '' : v).trim();
  if (!s) { if (required) fail_(label + ' is required.'); return ''; }
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  const d = m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])) : null;
  if (!d || d.getUTCMonth() !== +m[2] - 1 || d.getUTCDate() !== +m[3]) fail_(label + ' must be a valid date.');
  return s;
}
function photoOf_(v) {
  const s = String(v || '');
  if (!s) return '';
  if (s.length > 45000 || !/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+\/=]+$/.test(s)) fail_('The profile photo could not be accepted. Choose a JPG, PNG or WebP image.');
  return s;
}

function hex_(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += ('0' + ((bytes[i] + 256) % 256).toString(16)).slice(-2);
  return s;
}
function sha256_(s) { return hex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s, Utilities.Charset.UTF_8)); }
function hashPassword_(password, salt, iter) {
  const key = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, salt + ':' + password, Utilities.Charset.UTF_8);
  let h = key;
  for (let i = 0; i < iter; i++) h = Utilities.computeHmacSha256Signature(h, key);
  return hex_(h);
}
function sameText_(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
function setPassword_(user, password) {
  const salt = Utilities.getUuid();
  update_('Users', user, { salt: salt, iter: PASSWORD_ITERATIONS, passwordHash: hashPassword_(password, salt, PASSWORD_ITERATIONS), updatedAt: now_() });
}

function audit_(user, action, refType, refId, detail) {
  insert_('AuditLogs', { id: nextId_('LOG'), at: now_(), userId: user ? user.id : '', action: action, refType: refType || '', refId: refId || '', detail: String(detail || '').slice(0, 500) });
}
function notify_(userId, kind, title, body, refType, refId) {
  if (!userId) return;
  insert_('Notifications', { id: nextId_('NTF'), userId: userId, kind: kind, title: title, body: body || '', refType: refType || '', refId: refId || '', read: '', createdAt: now_() });
}
function activeAdmins_() { return where_('Users', function (u) { return u.role === 'SUPER_ADMIN' && u.status === 'ACTIVE'; }); }
function notifyAdmins_(kind, title, body, refType, refId) {
  activeAdmins_().forEach(function (a) { notify_(a.id, kind, title, body, refType, refId); });
}
function inr_(n) { return '₹' + num_(n).toLocaleString('en-IN', { maximumFractionDigits: 2 }); }

// ───────────────────────────── Sessions ─────────────────────────────

function auth_(token) {
  const t = String(token || '');
  if (t.length < 40) fail_('Please sign in.', 'AUTH');
  const s = byKey_('Sessions', 'tokenHash', sha256_(t));
  if (!s || s.revoked || s.expiresAt < now_()) fail_('Your session has ended. Please sign in again.', 'AUTH');
  const u = byKey_('Users', 'id', s.userId);
  if (!u || u.status !== 'ACTIVE') fail_('This account cannot sign in.', 'AUTH');
  REQ.session = s;
  return u;
}
function newSession_(user) {
  const token = (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
  insert_('Sessions', { tokenHash: sha256_(token), userId: user.id, createdAt: now_(), expiresAt: new Date(Date.now() + SESSION_DAYS * 86400000).toISOString(), revoked: '' });
  return token;
}
function revokeSessions_(userId, exceptHash) {
  where_('Sessions', function (s) { return s.userId === userId && !s.revoked && s.tokenHash !== exceptHash; })
    .forEach(function (s) { update_('Sessions', s, { revoked: '1' }); });
}

// ───────────────────────────── Views (what each role may see) ─────────────────────────────

function userView_(u) {
  return { id: u.id, role: u.role, email: u.email, fullName: u.fullName, photo: u.photo, status: u.status, createdAt: u.createdAt, approvedAt: u.approvedAt };
}
function pricingView_() {
  return Object.keys(VIDEO_TYPES).map(function (type) {
    const p = byKey_('Pricings', 'type', type);
    return { type: type, label: VIDEO_TYPES[type], price: p ? num_(p.price) : 0, updatedAt: p ? p.updatedAt : '' };
  });
}
function notificationsOf_(userId) {
  return where_('Notifications', function (n) { return n.userId === userId; })
    .sort(function (a, b) { return a.createdAt < b.createdAt ? 1 : -1; }).slice(0, 100)
    .map(function (n) { return { id: n.id, kind: n.kind, title: n.title, body: n.body, refType: n.refType, refId: n.refId, read: !!n.read, createdAt: n.createdAt }; });
}
function settingsView_() {
  const o = {};
  SETTING_KEYS.forEach(function (k) { const r = byKey_('Settings', 'key', k); o[k] = r ? r.value : ''; });
  return o;
}
function gateway_() {
  const p = PropertiesService.getScriptProperties();
  const keyId = p.getProperty('RAZORPAY_KEY_ID') || '';
  const secret = p.getProperty('RAZORPAY_KEY_SECRET') || '';
  return { enabled: !!(keyId && secret), keyId: keyId, secret: secret };
}

/** Invoices of a client with payments applied oldest invoice first. */
function clientLedger_(clientId) {
  const invoices = where_('Invoices', function (i) { return i.clientId === clientId && i.status === 'ISSUED'; })
    .sort(function (a, b) { return a.issuedAt < b.issuedAt ? -1 : a.issuedAt > b.issuedAt ? 1 : 0; });
  const paid = sum_(where_('ClientPayments', function (p) { return p.clientId === clientId; }), 'amount');
  const total = sum_(invoices, 'amount');
  let left = paid;
  const lines = invoices.map(function (i) {
    const amount = num_(i.amount);
    const applied = Math.min(amount, left);
    left = round2_(left - applied);
    return { id: i.id, clientId: i.clientId, videoId: i.videoId, description: i.description, amount: amount, paid: round2_(applied), pending: round2_(amount - applied), issuedAt: i.issuedAt };
  });
  const awaiting = sum_(where_('ManualPayments', function (m) { return m.clientId === clientId && m.status === 'PENDING_VERIFICATION'; }), 'amount');
  return { invoices: lines, total: total, paid: paid, pending: round2_(total - paid), awaitingVerification: awaiting };
}
function editorLedger_(editorId) {
  const earned = sum_(where_('EditorEarnings', function (e) { return e.editorId === editorId; }), 'amount');
  const received = sum_(where_('EditorPayouts', function (p) { return p.editorId === editorId; }), 'amount');
  const active = where_('PaymentRequests', function (r) { return r.editorId === editorId && (r.status === 'PENDING' || r.status === 'APPROVED'); })[0] || null;
  return { earned: earned, received: received, pending: round2_(earned - received), activeRequestId: active ? active.id : '' };
}

function versions_(videoId) {
  return where_('Reviews', function (r) { return r.videoId === videoId && r.decision === 'SUBMITTED'; })
    .map(function (r, i) { return { n: i + 1, link: r.link, at: r.createdAt }; });
}
/** Comments as one role may read them. Editors and clients get role words, never each other's names. */
function commentsFor_(user) {
  const admin = user.role === 'SUPER_ADMIN';
  return rows_('Comments').filter(function (c) {
    if (admin) return true;
    const v = byKey_('Videos', 'id', c.videoId);
    if (!v) return false;
    if (user.role === 'CLIENT') return v.clientId === user.id && c.audience === 'ALL';
    return v.editorId === user.id;
  }).map(function (c) {
    const mine = c.byUserId === user.id;
    let author = mine ? 'You' : c.byRole === 'SUPER_ADMIN' ? 'SV Workspace' : c.byRole === 'CLIENT' ? 'Client' : 'Editor';
    if (admin && !mine) { const u = byKey_('Users', 'id', c.byUserId); author = (u ? u.fullName : 'Removed user') + ' (' + roleLabel_(c.byRole) + ')'; }
    return { id: c.id, videoId: c.videoId, author: author, mine: mine, audience: c.audience, timecode: c.timecode, text: c.text, createdAt: c.createdAt };
  });
}
function videoComment_(p, user) {
  const v = byKey_('Videos', 'id', p.videoId);
  const allowed = v && (user.role === 'SUPER_ADMIN' || (user.role === 'CLIENT' && v.clientId === user.id) || (user.role === 'EDITOR' && v.editorId === user.id));
  if (!allowed) fail_('Video not found.');
  const text = text_(p.text, 'Comment', 1000, true);
  const timecode = String(p.timecode || '').trim();
  if (timecode && !/^\d{1,3}:[0-5]\d(:[0-5]\d)?$/.test(timecode)) fail_('Timecode must look like 0:42 or 1:02:15.');
  // A client's comment goes to everyone. An editor's stays with the studio team; the Super Admin chooses.
  const audience = user.role === 'CLIENT' ? 'ALL' : user.role === 'EDITOR' ? 'INTERNAL' : (p.audience === 'INTERNAL' ? 'INTERNAL' : 'ALL');
  const c = insert_('Comments', { id: nextId_('CMT'), videoId: v.id, byUserId: user.id, byRole: user.role, audience: audience, timecode: timecode, text: text, createdAt: now_() });
  const at = timecode ? ' at ' + timecode : '';
  activeAdmins_().forEach(function (a) { if (a.id !== user.id) notify_(a.id, 'COMMENT', 'New comment on ' + v.id, user.fullName + at + ': ' + text.slice(0, 140), 'video', v.id); });
  if (v.editorId && v.editorId !== user.id) notify_(v.editorId, 'COMMENT', 'New comment on ' + v.id, 'A comment was added' + at + '. Open the video to read it.', 'video', v.id);
  if (audience === 'ALL' && v.clientId !== user.id) notify_(v.clientId, 'COMMENT', 'New comment on ' + v.id, 'SV Workspace commented' + at + '. Open the video to read it.', 'video', v.id);
  return commentsFor_(user).filter(function (x) { return x.id === c.id; })[0];
}

function clientVideo_(v) {
  const show = v.status === 'CLIENT_REVIEW' || v.status === 'COMPLETED';
  return { id: v.id, deadline: v.deadline, type: v.type, typeLabel: v.typeLabel, price: num_(v.price), rawLink: v.rawLink, remarks: v.remarks, status: v.status, editedLink: show ? v.editedLink : '', invoiceId: v.invoiceId, createdAt: v.createdAt, updatedAt: v.updatedAt, completedAt: v.completedAt };
}
/** Nothing here identifies the client — that is the Editor privacy rule. */
function editorVideo_(v) {
  return { id: v.id, type: v.type, typeLabel: v.typeLabel, rawLink: v.rawLink, remarks: v.remarks, deadline: v.deadline, status: v.status, editedLink: v.editedLink, revisionNote: v.status === 'REVISION' ? v.revisionNote : '', rate: v.editorRate === '' ? null : num_(v.editorRate), versions: versions_(v.id), updatedAt: v.updatedAt, startedAt: v.startedAt, submittedAt: v.submittedAt, completedAt: v.completedAt };
}
function strip_(row) { const o = {}; Object.keys(row).forEach(function (k) { if (k !== '_row') o[k] = row[k]; }); return o; }

function state_(p, user) {
  const base = { user: userView_(user), notifications: notificationsOf_(user.id), comments: commentsFor_(user), serverTime: now_(), videoTypes: VIDEO_TYPES };
  if (user.role === 'CLIENT') {
    const c = byKey_('Clients', 'userId', user.id) || {};
    const g = gateway_();
    base.profile = { socialName: c.socialName || '' };
    base.channels = where_('Channels', function (x) { return x.clientId === user.id; }).map(strip_);
    base.pricings = pricingView_();
    base.videos = where_('Videos', function (v) { return v.clientId === user.id; }).map(clientVideo_);
    base.ledger = clientLedger_(user.id);
    base.payments = where_('ClientPayments', function (x) { return x.clientId === user.id; }).map(strip_);
    base.submissions = where_('ManualPayments', function (x) { return x.clientId === user.id; }).map(strip_);
    base.paymentDetails = settingsView_();
    base.online = { enabled: g.enabled, keyId: g.enabled ? g.keyId : '' };
    return base;
  }
  if (user.role === 'EDITOR') {
    const ed = byKey_('Editors', 'userId', user.id) || {};
    base.editor = { employmentType: ed.employmentType || '', monthlySalary: num_(ed.monthlySalary), perVideoRate: num_(ed.perVideoRate) };
    base.videos = where_('Videos', function (v) { return v.editorId === user.id; }).map(editorVideo_);
    base.earnings = where_('EditorEarnings', function (x) { return x.editorId === user.id; }).map(function (x) { return { id: x.id, kind: x.kind, videoId: x.videoId, amount: num_(x.amount), note: x.note, createdAt: x.createdAt }; });
    base.payouts = where_('EditorPayouts', function (x) { return x.editorId === user.id; }).map(function (x) { return { id: x.id, requestId: x.requestId, amount: num_(x.amount), reference: x.reference, note: x.note, paidAt: x.paidAt }; });
    base.requests = where_('PaymentRequests', function (x) { return x.editorId === user.id; }).map(function (x) { return { id: x.id, amount: num_(x.amount), paidAmount: num_(x.paidAmount), status: x.status, createdAt: x.createdAt, decidedAt: x.decidedAt, decisionNote: x.decisionNote }; });
    base.ledger = editorLedger_(user.id);
    return base;
  }
  // Super Admin: everything except credentials.
  const clientsById = {}, editorsById = {};
  rows_('Clients').forEach(function (c) { clientsById[c.userId] = c; });
  rows_('Editors').forEach(function (e) { editorsById[e.userId] = e; });
  base.users = rows_('Users').map(function (u) {
    const o = userView_(u);
    if (u.role === 'CLIENT') { o.socialName = (clientsById[u.id] || {}).socialName || ''; o.ledger = clientLedger_(u.id); delete o.ledger.invoices; }
    if (u.role === 'EDITOR') {
      const e = editorsById[u.id] || {};
      o.employmentType = e.employmentType || ''; o.monthlySalary = num_(e.monthlySalary); o.perVideoRate = num_(e.perVideoRate); o.ledger = editorLedger_(u.id);
    }
    return o;
  });
  base.channels = rows_('Channels').map(strip_);
  base.videos = rows_('Videos').map(strip_);
  base.reviews = rows_('Reviews').map(strip_);
  base.pricings = pricingView_();
  base.invoices = [];
  rows_('Users').forEach(function (u) { if (u.role === 'CLIENT') base.invoices = base.invoices.concat(clientLedger_(u.id).invoices); });
  base.clientPayments = rows_('ClientPayments').map(strip_);
  base.manualPayments = rows_('ManualPayments').map(strip_);
  base.earnings = rows_('EditorEarnings').map(strip_);
  base.salaryPeriods = rows_('SalaryPeriods').map(strip_);
  base.paymentRequests = rows_('PaymentRequests').map(strip_);
  base.payouts = rows_('EditorPayouts').map(strip_);
  base.expenses = rows_('Expenses').map(strip_);
  base.settings = settingsView_();
  base.online = { enabled: gateway_().enabled };
  base.activity = rows_('AuditLogs').slice(-40).reverse().map(strip_);
  return base;
}

// ───────────────────────────── Registration and sign-in ─────────────────────────────

function findUserByEmail_(email) { return byKey_('Users', 'email', email); }
function adminExists_() { return rows_('Users').some(function (u) { return u.role === 'SUPER_ADMIN' && (u.status === 'ACTIVE' || u.status === 'SUSPENDED'); }); }

function createUser_(p, role, status, approver) {
  const fullName = text_(p.fullName, 'Full name', 80, true);
  const email = emailOf_(p.email);
  const password = passwordOf_(p.password);
  const socialName = role === 'CLIENT' ? text_(p.socialName, 'Social media name', 80, false) : '';
  if (findUserByEmail_(email)) fail_('An account with this email address already exists.');
  const t = now_();
  const u = insert_('Users', { id: nextId_('USR'), role: role, email: email, fullName: fullName, photo: '', status: status, createdAt: t, approvedAt: status === 'ACTIVE' ? t : '', approvedBy: status === 'ACTIVE' ? approver : '', updatedAt: t, failedCount: 0, lockedUntil: '' });
  setPassword_(u, password);
  if (role === 'CLIENT') insert_('Clients', { userId: u.id, socialName: socialName, updatedAt: t });
  if (role === 'EDITOR') insert_('Editors', { userId: u.id, employmentType: '', monthlySalary: 0, perVideoRate: 0, updatedAt: t });
  return u;
}

/** Only the very first account can be created from outside: the first Super Admin. Everyone else is created by a Super Admin. */
function register_(p) {
  // The whole request runs under the script lock, so two first-time set-ups cannot both win.
  if (adminExists_()) fail_('Accounts are created by SV Workspace. Please contact us to get one.', 'CLOSED');
  if (p.role !== 'SUPER_ADMIN') fail_('Set up the Super Admin account first.', 'CLOSED');
  const u = createUser_(p, 'SUPER_ADMIN', 'ACTIVE', 'first-admin');
  audit_(u, 'user.registered.first-admin', 'user', u.id, 'SUPER_ADMIN');
  return { status: u.status };
}
function roleLabel_(r) { return r === 'SUPER_ADMIN' ? 'Super Admin' : r === 'CLIENT' ? 'Client' : 'Editor'; }

function login_(p) {
  const email = String(p.email || '').trim().toLowerCase();
  const password = String(p.password || '');
  const bad = 'Incorrect email or password.';
  const u = email ? findUserByEmail_(email) : null;
  if (!u || !password) fail_(bad);
  if (u.lockedUntil && u.lockedUntil > now_()) fail_('Too many failed attempts. Try again in ' + LOCK_MINUTES + ' minutes.');
  if (!sameText_(hashPassword_(password, u.salt, num_(u.iter) || PASSWORD_ITERATIONS), u.passwordHash)) {
    const n = num_(u.failedCount) + 1;
    update_('Users', u, n >= MAX_FAILED_LOGINS ? { failedCount: 0, lockedUntil: new Date(Date.now() + LOCK_MINUTES * 60000).toISOString() } : { failedCount: n });
    fail_(bad);
  }
  if (u.status === 'PENDING') fail_('Your account is waiting for Super Admin approval.', 'PENDING');
  if (u.status === 'REJECTED') fail_('Your registration was not approved.', 'REJECTED');
  if (u.status !== 'ACTIVE') fail_('This account is suspended. Contact the Super Admin.', 'SUSPENDED');
  update_('Users', u, { failedCount: 0, lockedUntil: '' });
  return { token: newSession_(u), user: userView_(u) };
}

function logout_(p, user) { update_('Sessions', REQ.session, { revoked: '1' }); return true; }

function changePassword_(p, user) {
  if (!sameText_(hashPassword_(String(p.current || ''), user.salt, num_(user.iter) || PASSWORD_ITERATIONS), user.passwordHash)) fail_('Your current password is not correct.');
  const next = passwordOf_(p.next, 'New password');
  if (next === String(p.current)) fail_('Choose a new password that is different from the current one.');
  setPassword_(user, next);
  revokeSessions_(user.id, REQ.session.tokenHash);
  audit_(user, 'user.password-changed', 'user', user.id);
  return true;
}

function updateProfile_(p, user) {
  const patch = { fullName: text_(p.fullName, 'Full name', 80, true), updatedAt: now_() };
  const email = emailOf_(p.email);
  if (email !== user.email) {
    const other = findUserByEmail_(email);
    if (other && other.id !== user.id) fail_('Another account already uses this email address.');
    patch.email = email;
  }
  if (p.photo !== undefined && p.photo !== null) patch.photo = photoOf_(p.photo);
  update_('Users', user, patch);
  if (user.role === 'CLIENT') {
    const c = byKey_('Clients', 'userId', user.id);
    update_('Clients', c, { socialName: text_(p.socialName, 'Social media name', 80, false), updatedAt: now_() });
  }
  audit_(user, 'user.profile-updated', 'user', user.id, patch.email ? 'email changed' : '');
  return userView_(user);
}

function readNotification_(p, user) {
  const n = byKey_('Notifications', 'id', p.id);
  if (!n || n.userId !== user.id) fail_('Notification not found.');
  if (!n.read) update_('Notifications', n, { read: '1' });
  return true;
}
function readAllNotifications_(p, user) {
  where_('Notifications', function (n) { return n.userId === user.id && !n.read; }).forEach(function (n) { update_('Notifications', n, { read: '1' }); });
  return true;
}

// ───────────────────────────── Client actions ─────────────────────────────

function clientAddVideo_(p, user) {
  const type = Object.prototype.hasOwnProperty.call(VIDEO_TYPES, String(p.type)) ? String(p.type) : fail_('Choose a video type.');
  const rawLink = urlOf_(p.rawLink, 'Raw footage link');
  const remarks = text_(p.remarks, 'Remarks', 2000, true);
  const pr = byKey_('Pricings', 'type', type);
  const price = pr ? num_(pr.price) : 0;
  if (price <= 0) fail_('The price for ' + VIDEO_TYPES[type] + ' has not been set yet. Please contact SV Workspace.');
  const t = now_();
  const id = nextId_('VID');
  const inv = insert_('Invoices', { id: nextId_('INV'), clientId: user.id, videoId: id, description: VIDEO_TYPES[type] + ' — ' + id, amount: price, status: 'ISSUED', issuedAt: t, updatedAt: t });
  const v = insert_('Videos', { id: id, clientId: user.id, type: type, typeLabel: VIDEO_TYPES[type], price: price, rawLink: rawLink, remarks: remarks, status: 'NOT_STARTED', invoiceId: inv.id, createdAt: t, updatedAt: t });
  notify_(user.id, 'VIDEO_SUBMITTED', 'Video submitted', id + ' (' + VIDEO_TYPES[type] + ') was submitted. Price: ' + inr_(price) + '.', 'video', id);
  notifyAdmins_('VIDEO_NEW', 'New video request', user.fullName + ' submitted ' + id + ' (' + VIDEO_TYPES[type] + ').', 'video', id);
  audit_(user, 'video.submitted', 'video', id, VIDEO_TYPES[type] + ' ' + price);
  return clientVideo_(v);
}

function clientVideoDecision_(p, user) {
  const v = byKey_('Videos', 'id', p.videoId);
  if (!v || v.clientId !== user.id) fail_('Video not found.');
  if (v.status !== 'CLIENT_REVIEW') fail_('This video is not waiting for your approval.');
  if (p.decision === 'APPROVE') {
    completeVideo_(v, user, 'Approved by client');
  } else if (p.decision === 'REVISION') {
    const note = text_(p.note, 'What should be changed', 2000, true);
    setVideoStatus_(v, 'REVISION', { revisionNote: note });
    insert_('Reviews', { id: nextId_('REV'), videoId: v.id, byUserId: user.id, byRole: 'CLIENT', decision: 'REVISION', note: note, link: v.editedLink, createdAt: now_() });
    notify_(v.editorId, 'VIDEO_REVISION', 'Revision requested', v.id + ' needs changes. Open the video to read the notes.', 'video', v.id);
    notifyAdmins_('VIDEO_CLIENT_REVISION', 'Client requested changes', user.fullName + ' asked for changes on ' + v.id + '.', 'video', v.id);
    audit_(user, 'video.client-revision', 'video', v.id);
  } else fail_('Choose approve or request changes.');
  return clientVideo_(v);
}

function clientSaveChannel_(p, user) {
  const platform = p.platform === 'YOUTUBE' || p.platform === 'INSTAGRAM' ? p.platform : fail_('Choose YouTube or Instagram.');
  const name = text_(p.name, 'Channel / page name', 100, true);
  const link = urlOf_(p.link, 'Channel / page link');
  const t = now_();
  if (p.id) {
    const ch = byKey_('Channels', 'id', p.id);
    if (!ch || ch.clientId !== user.id) fail_('Channel not found.');
    update_('Channels', ch, { platform: platform, name: name, link: link, updatedAt: t });
    return strip_(ch);
  }
  if (where_('Channels', function (c) { return c.clientId === user.id; }).length >= 20) fail_('You can add up to 20 channels.');
  return strip_(insert_('Channels', { id: nextId_('CHN'), clientId: user.id, platform: platform, name: name, link: link, createdAt: t, updatedAt: t }));
}
function clientDeleteChannel_(p, user) {
  const ch = byKey_('Channels', 'id', p.id);
  if (!ch || ch.clientId !== user.id) fail_('Channel not found.');
  remove_('Channels', ch);
  return true;
}

/** What a client may still pay: outstanding balance less what is already waiting for verification. */
function payable_(clientId) {
  const l = clientLedger_(clientId);
  return round2_(l.pending - l.awaitingVerification);
}

function clientSubmitManualPayment_(p, user) {
  const amount = money_(p.amount, 'Amount');
  const method = p.method === 'UPI' || p.method === 'BANK' ? p.method : fail_('Choose UPI or bank transfer.');
  const reference = text_(p.reference, 'Transaction reference', 60, true);
  if (reference.length < 4) fail_('Enter the transaction reference from your UPI or bank app.');
  const note = text_(p.note, 'Note', 300, false);
  const max = payable_(user.id);
  if (max <= 0) fail_('There is nothing left to pay right now.');
  if (amount > max) fail_('The amount cannot be more than ' + inr_(max) + ' (your outstanding balance less payments awaiting verification).');
  const ref = reference.toLowerCase();
  if (rows_('ManualPayments').some(function (m) { return m.reference.toLowerCase() === ref && m.status !== 'REJECTED'; })) fail_('This transaction reference has already been submitted.');
  const m = insert_('ManualPayments', { id: nextId_('MPS'), clientId: user.id, amount: amount, method: method, reference: reference, note: note, status: 'PENDING_VERIFICATION', submittedAt: now_() });
  notify_(user.id, 'PAYMENT_SUBMITTED', 'Payment submitted', inr_(amount) + ' (ref ' + reference + ') is pending verification.', 'payment', m.id);
  notifyAdmins_('PAYMENT_TO_VERIFY', 'Manual payment to verify', user.fullName + ' submitted ' + inr_(amount) + ' (ref ' + reference + ').', 'manualPayment', m.id);
  audit_(user, 'payment.manual-submitted', 'manualPayment', m.id, amount + ' ' + reference);
  return strip_(m);
}

function recordClientPayment_(clientId, amount, method, reference, sourceId, by) {
  return insert_('ClientPayments', { id: nextId_('PAY'), clientId: clientId, amount: amount, method: method, reference: reference, sourceId: sourceId, receivedAt: now_(), recordedBy: by });
}

function razorpay_(g, method, path, body) {
  const res = UrlFetchApp.fetch('https://api.razorpay.com/v1/' + path, {
    method: method, muteHttpExceptions: true, contentType: 'application/json',
    headers: { Authorization: 'Basic ' + Utilities.base64Encode(g.keyId + ':' + g.secret) },
    payload: body ? JSON.stringify(body) : undefined
  });
  const code = res.getResponseCode();
  let data = null;
  try { data = JSON.parse(res.getContentText()); } catch (x) { /* below */ }
  if (code < 200 || code >= 300 || !data) { console.error('Razorpay ' + path + ' → ' + code); fail_('The payment gateway did not respond correctly. No money was recorded.'); }
  return data;
}
function clientCreateOnlineOrder_(p, user) {
  const g = gateway_();
  if (!g.enabled) fail_('Online payment is not set up yet. Please use manual payment.');
  const amount = money_(p.amount, 'Amount');
  const max = payable_(user.id);
  if (amount > max) fail_('The amount cannot be more than ' + inr_(max) + '.');
  const id = nextId_('ORD');
  const order = razorpay_(g, 'post', 'orders', { amount: Math.round(amount * 100), currency: 'INR', receipt: id });
  if (!order.id) fail_('The payment gateway did not create an order.');
  insert_('OnlineOrders', { id: id, clientId: user.id, orderId: order.id, amount: amount, status: 'CREATED', createdAt: now_() });
  return { orderId: order.id, amount: amount, keyId: g.keyId };
}
function clientVerifyOnlinePayment_(p, user) {
  const g = gateway_();
  if (!g.enabled) fail_('Online payment is not set up yet.');
  const o = byKey_('OnlineOrders', 'orderId', p.orderId);
  if (!o || o.clientId !== user.id) fail_('Order not found.');
  if (o.status === 'PAID') return { already: true };
  const paymentId = text_(p.paymentId, 'Payment id', 80, true);
  const expected = hex_(Utilities.computeHmacSha256Signature(o.orderId + '|' + paymentId, g.secret, Utilities.Charset.UTF_8));
  if (!sameText_(expected, String(p.signature || ''))) fail_('The payment could not be verified. Nothing was recorded.');
  const pay = razorpay_(g, 'get', 'payments/' + encodeURIComponent(paymentId));
  if (pay.order_id !== o.orderId || pay.status !== 'captured' || Number(pay.amount) !== Math.round(num_(o.amount) * 100)) fail_('The gateway has not confirmed this payment yet. Nothing was recorded.');
  update_('OnlineOrders', o, { status: 'PAID', gatewayPaymentId: paymentId, paidAt: now_() });
  recordClientPayment_(user.id, num_(o.amount), 'ONLINE', paymentId, o.id, 'gateway');
  notify_(user.id, 'PAYMENT_VERIFIED', 'Payment received', inr_(o.amount) + ' was paid online.', 'payment', o.id);
  notifyAdmins_('PAYMENT_RECEIVED', 'Online payment received', user.fullName + ' paid ' + inr_(o.amount) + ' online.', 'client', user.id);
  audit_(user, 'payment.online-verified', 'order', o.id, o.amount);
  return { paid: true };
}

// ───────────────────────────── Video workflow ─────────────────────────────

function setVideoStatus_(v, status, patch) {
  const p = patch || {};
  p.status = status;
  p.updatedAt = now_();
  update_('Videos', v, p);
}
function tellClient_(v, title, body) { notify_(v.clientId, 'VIDEO_STATUS', title, body, 'video', v.id); }

function completeVideo_(v, by, note) {
  setVideoStatus_(v, 'COMPLETED', { completedAt: now_(), revisionNote: '' });
  insert_('Reviews', { id: nextId_('REV'), videoId: v.id, byUserId: by.id, byRole: by.role, decision: 'COMPLETED', note: note || '', link: v.editedLink, createdAt: now_() });
  tellClient_(v, 'Video completed', v.id + ' is completed.');
  notify_(v.editorId, 'VIDEO_COMPLETED', 'Video completed', v.id + ' received final approval.', 'video', v.id);
  if (by.role === 'CLIENT') notifyAdmins_('VIDEO_COMPLETED', 'Client approved the video', v.id + ' is completed.', 'video', v.id);
  audit_(by, 'video.completed', 'video', v.id, note);
}

function editorOwnVideo_(p, user) {
  const v = byKey_('Videos', 'id', p.videoId);
  if (!v || v.editorId !== user.id) fail_('Video not found.'); // same message whether it exists or not
  return v;
}
function editorStartVideo_(p, user) {
  const v = editorOwnVideo_(p, user);
  if (v.status !== 'NOT_STARTED' && v.status !== 'REVISION') fail_('This video cannot be started from its current status.');
  const first = !v.startedAt;
  setVideoStatus_(v, 'IN_PROGRESS', first ? { startedAt: now_() } : {});
  tellClient_(v, first ? 'Editing started' : 'Video status changed', v.id + (first ? ' is now being edited.' : ' is In Progress again.'));
  audit_(user, 'video.started', 'video', v.id);
  return editorVideo_(v);
}
function editorSubmitVideo_(p, user) {
  const v = editorOwnVideo_(p, user);
  if (v.status !== 'IN_PROGRESS' && v.status !== 'REVISION') fail_(v.status === 'NOT_STARTED' ? 'Start the video before submitting it.' : 'This video cannot be submitted from its current status.');
  const link = urlOf_(p.link, 'Edited video link');
  setVideoStatus_(v, 'IN_REVIEW', { editedLink: link, submittedAt: now_() });
  insert_('Reviews', { id: nextId_('REV'), videoId: v.id, byUserId: user.id, byRole: 'EDITOR', decision: 'SUBMITTED', note: '', link: link, createdAt: now_() });
  notifyAdmins_('VIDEO_REVIEW', 'Edited video ready for review', user.fullName + ' submitted ' + v.id + ' for review.', 'video', v.id);
  tellClient_(v, 'Video status changed', v.id + ' is now In Review.');
  audit_(user, 'video.submitted-for-review', 'video', v.id);
  return editorVideo_(v);
}

function activeEditor_(id) {
  const u = byKey_('Users', 'id', id);
  const e = u ? byKey_('Editors', 'userId', u.id) : null;
  if (!u || u.role !== 'EDITOR' || !e) fail_('Editor not found.');
  return { user: u, editor: e };
}

function adminAssignVideo_(p, user) {
  const v = byKey_('Videos', 'id', p.videoId) || fail_('Video not found.');
  if (['NOT_STARTED', 'IN_PROGRESS', 'REVISION'].indexOf(v.status) < 0) fail_('A video that is in review or completed cannot be reassigned.');
  const ed = activeEditor_(p.editorId);
  if (ed.user.status !== 'ACTIVE') fail_('Only an approved, active Editor can be assigned.');
  const deadline = dateOf_(p.deadline, 'Deadline', true);
  const rate = String(p.rate === undefined || p.rate === null ? '' : p.rate).trim() === '' ? '' : money_(p.rate, 'Per-video rate', true);
  const t = now_();
  const previous = v.editorId;
  where_('Assignments', function (a) { return a.videoId === v.id && a.status === 'ACTIVE'; }).forEach(function (a) { update_('Assignments', a, { status: 'ENDED', endedAt: t }); });
  insert_('Assignments', { id: nextId_('ASG'), videoId: v.id, editorId: ed.user.id, rate: rate, deadline: deadline, status: 'ACTIVE', assignedBy: user.id, assignedAt: t });
  const patch = { editorId: ed.user.id, deadline: deadline, editorRate: rate, updatedAt: t };
  if (previous && previous !== ed.user.id && v.status === 'IN_PROGRESS') patch.status = 'NOT_STARTED';
  update_('Videos', v, patch);
  if (previous && previous !== ed.user.id) notify_(previous, 'VIDEO_UNASSIGNED', 'Video reassigned', v.id + ' is no longer assigned to you.', 'video', v.id);
  if (previous !== ed.user.id) notify_(ed.user.id, 'VIDEO_ASSIGNED', 'New video assigned', v.id + ' (' + v.typeLabel + ') — deadline ' + deadline + '.', 'video', v.id);
  else notify_(ed.user.id, 'VIDEO_DEADLINE', 'Assignment updated', v.id + ' — deadline ' + deadline + '.', 'video', v.id);
  audit_(user, 'video.assigned', 'video', v.id, ed.user.fullName + ' due ' + deadline);
  return strip_(v);
}

function adminSetDeadline_(p, user) {
  const v = byKey_('Videos', 'id', p.videoId) || fail_('Video not found.');
  if (v.status === 'COMPLETED') fail_('A completed video has no deadline to change.');
  const deadline = dateOf_(p.deadline, 'Deadline', true);
  if (deadline === v.deadline) return strip_(v);
  update_('Videos', v, { deadline: deadline, updatedAt: now_() });
  where_('Assignments', function (a) { return a.videoId === v.id && a.status === 'ACTIVE'; }).forEach(function (a) { update_('Assignments', a, { deadline: deadline }); });
  notify_(v.editorId, 'VIDEO_DEADLINE', 'Deadline changed', v.id + ' is now due ' + deadline + '.', 'video', v.id);
  audit_(user, 'video.deadline', 'video', v.id, deadline);
  return strip_(v);
}

function adminReviewVideo_(p, user) {
  const v = byKey_('Videos', 'id', p.videoId) || fail_('Video not found.');
  if (v.status !== 'IN_REVIEW') fail_('This video is not waiting for review.');
  const t = now_();
  if (p.decision === 'APPROVE') {
    const note = text_(p.note, 'Note', 2000, false);
    setVideoStatus_(v, 'CLIENT_REVIEW', { adminApprovedAt: t, revisionNote: '' });
    insert_('Reviews', { id: nextId_('REV'), videoId: v.id, byUserId: user.id, byRole: 'SUPER_ADMIN', decision: 'APPROVED', note: note, link: v.editedLink, createdAt: t });
    // The edit becomes payable once, however many revision rounds follow.
    const ed = byKey_('Editors', 'userId', v.editorId);
    const rate = v.editorRate !== '' ? num_(v.editorRate) : (ed && ed.employmentType === 'FREELANCE' ? num_(ed.perVideoRate) : 0);
    const already = rows_('EditorEarnings').some(function (e) { return e.kind === 'VIDEO' && e.videoId === v.id; });
    if (rate > 0 && !already) insert_('EditorEarnings', { id: nextId_('ERN'), editorId: v.editorId, kind: 'VIDEO', videoId: v.id, amount: rate, note: v.typeLabel, createdAt: t, createdBy: user.id });
    notify_(v.editorId, 'VIDEO_APPROVED', 'Video approved', v.id + ' was approved.' + (rate > 0 && !already ? ' ' + inr_(rate) + ' was added to your earnings.' : ''), 'video', v.id);
    tellClient_(v, 'Video ready for your approval', v.id + ' is ready. Please review it and give your final approval.');
    audit_(user, 'video.approved', 'video', v.id);
  } else if (p.decision === 'REVISION') {
    const note = text_(p.note, 'Revision notes', 2000, true);
    setVideoStatus_(v, 'REVISION', { revisionNote: note });
    insert_('Reviews', { id: nextId_('REV'), videoId: v.id, byUserId: user.id, byRole: 'SUPER_ADMIN', decision: 'REVISION', note: note, link: v.editedLink, createdAt: t });
    notify_(v.editorId, 'VIDEO_REVISION', 'Revision requested', v.id + ' needs changes. Open the video to read the notes.', 'video', v.id);
    tellClient_(v, 'Video status changed', v.id + ' is being revised.');
    audit_(user, 'video.revision', 'video', v.id);
  } else fail_('Choose approve or request revision.');
  return strip_(v);
}

function adminCompleteVideo_(p, user) {
  const v = byKey_('Videos', 'id', p.videoId) || fail_('Video not found.');
  if (v.status !== 'CLIENT_REVIEW') fail_('Only a video waiting for client approval can be completed on the client\'s behalf.');
  completeVideo_(v, user, 'Completed by Super Admin on the client\'s behalf: ' + text_(p.reason, 'Reason', 300, true));
  return strip_(v);
}

function adminAdjustVideoPrice_(p, user) {
  const v = byKey_('Videos', 'id', p.videoId) || fail_('Video not found.');
  const price = money_(p.price, 'Price');
  const reason = text_(p.reason, 'Reason', 300, true);
  const inv = byKey_('Invoices', 'id', v.invoiceId) || fail_('The invoice of this video is missing.');
  const l = clientLedger_(v.clientId);
  if (round2_(l.total - num_(inv.amount) + price) < round2_(l.paid + l.awaitingVerification)) fail_('The new price would bring the client\'s total below what they have already paid or submitted.');
  const old = v.price;
  update_('Videos', v, { price: price, updatedAt: now_() });
  update_('Invoices', inv, { amount: price, updatedAt: now_() });
  notify_(v.clientId, 'VIDEO_PRICE', 'Price updated', 'The price of ' + v.id + ' changed from ' + inr_(old) + ' to ' + inr_(price) + '.', 'video', v.id);
  audit_(user, 'video.price-adjusted', 'video', v.id, old + ' → ' + price + ': ' + reason);
  return strip_(v);
}

// ───────────────────────────── Super Admin: people ─────────────────────────────

function editorPay_(p) {
  const type = p.employmentType === 'FULL_TIME' || p.employmentType === 'FREELANCE' ? p.employmentType : fail_('Choose Full-Time or Freelance.');
  return type === 'FULL_TIME'
    ? { employmentType: type, monthlySalary: money_(p.monthlySalary, 'Monthly salary'), perVideoRate: 0, updatedAt: now_() }
    : { employmentType: type, monthlySalary: 0, perVideoRate: money_(p.perVideoRate, 'Per-video rate'), updatedAt: now_() };
}

function adminDecideUser_(p, user) {
  const u = byKey_('Users', 'id', p.userId) || fail_('User not found.');
  if (u.status !== 'PENDING') fail_('This registration has already been decided.');
  if (p.decision === 'APPROVE') {
    if (u.role === 'EDITOR') update_('Editors', byKey_('Editors', 'userId', u.id), editorPay_(p));
    update_('Users', u, { status: 'ACTIVE', approvedAt: now_(), approvedBy: user.id, updatedAt: now_() });
    notify_(u.id, 'ACCOUNT', 'Account approved', 'Welcome to SV Workspace. Your account is active.', 'user', u.id);
    audit_(user, 'user.approved', 'user', u.id, u.role);
  } else if (p.decision === 'REJECT') {
    update_('Users', u, { status: 'REJECTED', updatedAt: now_() });
    audit_(user, 'user.rejected', 'user', u.id, text_(p.note, 'Note', 300, false));
  } else fail_('Choose approve or reject.');
  return userView_(u);
}

function adminSetUserStatus_(p, user) {
  const u = byKey_('Users', 'id', p.userId) || fail_('User not found.');
  const status = ['ACTIVE', 'SUSPENDED', 'ARCHIVED'].indexOf(p.status) >= 0 ? p.status : fail_('Unknown status.');
  if (u.id === user.id) fail_('You cannot change your own account status.');
  if (['ACTIVE', 'SUSPENDED', 'ARCHIVED'].indexOf(u.status) < 0) fail_('Decide this registration under User Approvals first.');
  if (u.status === status) return userView_(u);
  update_('Users', u, { status: status, updatedAt: now_() });
  if (status !== 'ACTIVE') revokeSessions_(u.id, '');
  audit_(user, 'user.status', 'user', u.id, status);
  return userView_(u);
}

function adminResetPassword_(p, user) {
  const u = byKey_('Users', 'id', p.userId) || fail_('User not found.');
  if (u.id === user.id) fail_('Use Change password for your own account.');
  setPassword_(u, passwordOf_(p.password, 'Temporary password'));
  update_('Users', u, { failedCount: 0, lockedUntil: '' });
  revokeSessions_(u.id, '');
  notify_(u.id, 'ACCOUNT', 'Password reset', 'Your password was reset by the Super Admin. Please change it under Profile.', 'user', u.id);
  audit_(user, 'user.password-reset', 'user', u.id);
  return true;
}

/** The Super Admin creates every Client and Editor (and any further Super Admin) and passes on the login details. */
function adminCreateUser_(p, user) {
  const role = ROLES.indexOf(p.role) >= 0 ? p.role : fail_('Choose the account type: Client, Editor or Super Admin.');
  const pay = role === 'EDITOR' ? editorPay_(p) : null; // checked before anything is written
  const u = createUser_(p, role, 'ACTIVE', user.id);
  if (pay) update_('Editors', byKey_('Editors', 'userId', u.id), pay);
  notify_(u.id, 'ACCOUNT', 'Welcome to SV Workspace', 'Your account is ready. Please change your password under ' + (role === 'SUPER_ADMIN' ? 'Settings / Profile' : 'Profile') + '.', 'user', u.id);
  audit_(user, 'user.created', 'user', u.id, role);
  return userView_(u);
}
function adminCreateClient_(p, user) { return adminCreateUser_(Object.assign({}, p, { role: 'CLIENT' }), user); }

/** Money that reached the studio outside the website (cash, a direct transfer, a cheque). */
function adminRecordClientPayment_(p, user) {
  const c = byKey_('Users', 'id', p.clientId);
  if (!c || c.role !== 'CLIENT') fail_('Client not found.');
  const amount = money_(p.amount, 'Amount');
  const method = ['CASH', 'UPI', 'BANK', 'CHEQUE', 'OTHER'].indexOf(p.method) >= 0 ? p.method : fail_('Choose how the payment was received.');
  const reference = text_(p.reference, 'Reference', 60, true);
  const note = text_(p.note, 'Note', 300, false);
  const day = dateOf_(p.date, 'Received on', false);
  if (day && day > new Date(Date.now() + 86400000).toISOString().slice(0, 10)) fail_('The date received cannot be in the future.');
  const outstanding = clientLedger_(c.id).pending;
  if (outstanding <= 0) fail_('This client has no outstanding balance.');
  if (amount > outstanding) fail_('The amount cannot be more than the client\'s outstanding balance (' + inr_(outstanding) + ').');
  const ref = reference.toLowerCase();
  if (rows_('ClientPayments').some(function (x) { return x.clientId === c.id && x.reference.toLowerCase() === ref; })) fail_('A payment with this reference has already been recorded for this client.');
  const pay = insert_('ClientPayments', { id: nextId_('PAY'), clientId: c.id, amount: amount, method: method, reference: reference, sourceId: 'ADMIN', receivedAt: day ? day + 'T12:00:00.000Z' : now_(), recordedBy: user.id, note: note });
  notify_(c.id, 'PAYMENT_RECORDED', 'Payment recorded', inr_(amount) + ' was recorded by SV Workspace (ref ' + reference + '). Your balance was updated.', 'payment', pay.id);
  audit_(user, 'payment.recorded', 'payment', pay.id, amount + ' ' + method + ' ' + reference);
  return strip_(pay);
}

function adminUpdateEditorPay_(p, user) {
  const ed = activeEditor_(p.userId);
  if (ed.user.status === 'PENDING' || ed.user.status === 'REJECTED') fail_('Approve this Editor first.');
  const pay = editorPay_(p);
  update_('Editors', ed.editor, pay);
  notify_(ed.user.id, 'ACCOUNT', 'Pay details updated', pay.employmentType === 'FULL_TIME' ? 'Your monthly salary is now ' + inr_(pay.monthlySalary) + '.' : 'Your default per-video rate is now ' + inr_(pay.perVideoRate) + '.', 'user', ed.user.id);
  audit_(user, 'editor.pay', 'user', ed.user.id, pay.employmentType + ' ' + (pay.monthlySalary || pay.perVideoRate));
  return true;
}

// ───────────────────────────── Super Admin: money ─────────────────────────────

function adminSavePricing_(p, user) {
  const prices = p.prices && typeof p.prices === 'object' ? p.prices : fail_('No prices sent.');
  const next = {};
  Object.keys(VIDEO_TYPES).forEach(function (type) { next[type] = money_(prices[type], VIDEO_TYPES[type] + ' price'); });
  Object.keys(next).forEach(function (type) {
    const row = byKey_('Pricings', 'type', type);
    if (row) { if (num_(row.price) !== next[type]) update_('Pricings', row, { price: next[type], label: VIDEO_TYPES[type], updatedAt: now_(), updatedBy: user.id }); }
    else insert_('Pricings', { type: type, label: VIDEO_TYPES[type], price: next[type], updatedAt: now_(), updatedBy: user.id });
  });
  audit_(user, 'pricing.saved', 'pricing', '', JSON.stringify(next));
  return pricingView_();
}

function adminDecideManualPayment_(p, user) {
  const m = byKey_('ManualPayments', 'id', p.id) || fail_('Payment submission not found.');
  if (m.status !== 'PENDING_VERIFICATION') fail_('This payment has already been decided.');
  const t = now_();
  if (p.decision === 'VERIFY') {
    const outstanding = clientLedger_(m.clientId).pending;
    if (num_(m.amount) > outstanding) fail_('This payment (' + inr_(m.amount) + ') is more than the client\'s outstanding balance (' + inr_(outstanding) + '). Reject it or adjust the invoices first.');
    const pay = recordClientPayment_(m.clientId, num_(m.amount), m.method, m.reference, m.id, user.id);
    update_('ManualPayments', m, { status: 'VERIFIED', decidedAt: t, decidedBy: user.id, decisionNote: text_(p.note, 'Note', 300, false), paymentId: pay.id });
    notify_(m.clientId, 'PAYMENT_VERIFIED', 'Payment verified', inr_(m.amount) + ' (ref ' + m.reference + ') was verified.', 'payment', m.id);
    audit_(user, 'payment.verified', 'manualPayment', m.id, m.amount);
  } else if (p.decision === 'REJECT') {
    const note = text_(p.note, 'Reason', 300, true);
    update_('ManualPayments', m, { status: 'REJECTED', decidedAt: t, decidedBy: user.id, decisionNote: note });
    notify_(m.clientId, 'PAYMENT_REJECTED', 'Payment not verified', inr_(m.amount) + ' (ref ' + m.reference + ') could not be verified: ' + note, 'payment', m.id);
    audit_(user, 'payment.rejected', 'manualPayment', m.id, note);
  } else fail_('Choose verify or reject.');
  return strip_(m);
}

function editorRequestPayment_(p, user) {
  const l = editorLedger_(user.id);
  if (l.activeRequestId) fail_('You already have an open payment request (' + l.activeRequestId + ').');
  if (l.pending <= 0) fail_('You have no pending earnings to request.');
  const r = insert_('PaymentRequests', { id: nextId_('REQ'), editorId: user.id, amount: l.pending, paidAmount: 0, status: 'PENDING', createdAt: now_() });
  notifyAdmins_('PAYOUT_REQUEST', 'Editor payment request', user.fullName + ' requested ' + inr_(l.pending) + ' (' + r.id + ').', 'paymentRequest', r.id);
  audit_(user, 'payout.requested', 'paymentRequest', r.id, l.pending);
  return { id: r.id, amount: l.pending };
}

function adminDecidePaymentRequest_(p, user) {
  const r = byKey_('PaymentRequests', 'id', p.id) || fail_('Payment request not found.');
  if (r.status !== 'PENDING') fail_('This request has already been decided.');
  if (p.decision === 'APPROVE') {
    update_('PaymentRequests', r, { status: 'APPROVED', decidedAt: now_(), decidedBy: user.id, decisionNote: text_(p.note, 'Note', 300, false) });
    notify_(r.editorId, 'PAYOUT_APPROVED', 'Payment request approved', r.id + ' for ' + inr_(r.amount) + ' was approved.', 'paymentRequest', r.id);
  } else if (p.decision === 'REJECT') {
    const note = text_(p.note, 'Reason', 300, true);
    update_('PaymentRequests', r, { status: 'REJECTED', decidedAt: now_(), decidedBy: user.id, decisionNote: note });
    notify_(r.editorId, 'PAYOUT_REJECTED', 'Payment request rejected', r.id + ' was rejected: ' + note, 'paymentRequest', r.id);
  } else fail_('Choose approve or reject.');
  audit_(user, 'payout.request-' + r.status.toLowerCase(), 'paymentRequest', r.id);
  return strip_(r);
}

function adminRecordPayout_(p, user) {
  const r = byKey_('PaymentRequests', 'id', p.requestId) || fail_('Payment request not found.');
  if (r.status !== 'APPROVED') fail_('Approve the request before recording a payout.');
  const amount = money_(p.amount, 'Payout amount');
  const reference = text_(p.reference, 'Payment reference', 60, true);
  const left = round2_(num_(r.amount) - num_(r.paidAmount));
  if (amount > left) fail_('The payout cannot be more than what is left on this request (' + inr_(left) + ').');
  const owed = editorLedger_(r.editorId).pending;
  if (amount > owed) fail_('The payout cannot be more than what the Editor is owed (' + inr_(owed) + ').');
  const pay = insert_('EditorPayouts', { id: nextId_('OUT'), editorId: r.editorId, requestId: r.id, amount: amount, reference: reference, note: text_(p.note, 'Note', 300, false), paidAt: now_(), paidBy: user.id });
  const paid = round2_(num_(r.paidAmount) + amount);
  update_('PaymentRequests', r, { paidAmount: paid, status: paid >= num_(r.amount) ? 'PAID' : 'APPROVED' });
  notify_(r.editorId, 'PAYOUT_PAID', 'Payout recorded', inr_(amount) + ' was paid (ref ' + reference + ', ' + pay.id + ').', 'payout', pay.id);
  audit_(user, 'payout.recorded', 'payout', pay.id, amount + ' on ' + r.id);
  return strip_(pay);
}

function adminClosePaymentRequest_(p, user) {
  const r = byKey_('PaymentRequests', 'id', p.id) || fail_('Payment request not found.');
  if (r.status !== 'APPROVED') fail_('Only an approved request with a balance left can be closed.');
  update_('PaymentRequests', r, { status: 'CLOSED', decisionNote: text_(p.note, 'Reason', 300, true) });
  notify_(r.editorId, 'PAYOUT_CLOSED', 'Payment request closed', r.id + ' was closed after ' + inr_(r.paidAmount) + ' was paid. You can request the rest again.', 'paymentRequest', r.id);
  audit_(user, 'payout.request-closed', 'paymentRequest', r.id);
  return strip_(r);
}

function adminGenerateSalary_(p, user) {
  const ed = activeEditor_(p.editorId);
  if (ed.editor.employmentType !== 'FULL_TIME') fail_('Salary applies to Full-Time Editors only.');
  const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(String(p.month)) ? String(p.month) : fail_('Choose a month.');
  if (rows_('SalaryPeriods').some(function (s) { return s.editorId === ed.user.id && s.month === month; })) fail_('Salary for ' + month + ' has already been added for this Editor.');
  const amount = num_(ed.editor.monthlySalary);
  if (amount <= 0) fail_('Set this Editor\'s monthly salary first.');
  const sp = insert_('SalaryPeriods', { id: nextId_('SAL'), editorId: ed.user.id, month: month, amount: amount, createdAt: now_(), createdBy: user.id });
  insert_('EditorEarnings', { id: nextId_('ERN'), editorId: ed.user.id, kind: 'SALARY', periodId: sp.id, amount: amount, note: 'Salary ' + month, createdAt: now_(), createdBy: user.id });
  notify_(ed.user.id, 'EARNING', 'Salary added', 'Salary for ' + month + ' (' + inr_(amount) + ') was added to your earnings.', 'earning', sp.id);
  audit_(user, 'editor.salary', 'user', ed.user.id, month + ' ' + amount);
  return true;
}

function adminAddBonus_(p, user) {
  const ed = activeEditor_(p.editorId);
  if (!ed.editor.employmentType) fail_('Approve this Editor first.');
  const amount = money_(p.amount, 'Amount');
  const note = text_(p.note, 'Reason', 200, true);
  const e = insert_('EditorEarnings', { id: nextId_('ERN'), editorId: ed.user.id, kind: 'BONUS', amount: amount, note: note, createdAt: now_(), createdBy: user.id });
  notify_(ed.user.id, 'EARNING', 'Bonus added', inr_(amount) + ' was added to your earnings: ' + note, 'earning', e.id);
  audit_(user, 'editor.bonus', 'user', ed.user.id, amount + ' ' + note);
  return true;
}

function contactView_() { const s = settingsView_(), o = {}; CONTACT_KEYS.forEach(function (k) { o[k] = s[k]; }); return o; }
function adminSaveSettings_(p, user) {
  if (String(p.contactEmail || '').trim()) emailOf_(p.contactEmail);
  ['contactPhone', 'contactWhatsapp'].forEach(function (k) { const v = String(p[k] || '').trim(); if (v && !/^\+?\d[\d\s-]{6,18}$/.test(v)) fail_('Enter the ' + (k === 'contactPhone' ? 'phone' : 'WhatsApp') + ' number with digits only, for example +91 98765 43210.'); });
  SETTING_KEYS.forEach(function (k) {
    const value = text_(p[k], k, 300, false);
    const row = byKey_('Settings', 'key', k);
    if (row) { if (row.value !== value) update_('Settings', row, { value: value, updatedAt: now_(), updatedBy: user.id }); }
    else insert_('Settings', { key: k, value: value, updatedAt: now_(), updatedBy: user.id });
  });
  audit_(user, 'settings.saved', 'settings', '');
  return settingsView_();
}

function adminSaveExpense_(p, user) {
  const e = insert_('Expenses', { id: nextId_('EXP'), date: dateOf_(p.date, 'Date', true), category: text_(p.category, 'Category', 60, true), description: text_(p.description, 'Description', 200, false), amount: money_(p.amount, 'Amount'), createdAt: now_(), createdBy: user.id });
  audit_(user, 'expense.added', 'expense', e.id, e.amount);
  return strip_(e);
}
function adminDeleteExpense_(p, user) {
  const e = byKey_('Expenses', 'id', p.id) || fail_('Expense not found.');
  audit_(user, 'expense.deleted', 'expense', e.id, e.category + ' ' + e.amount);
  remove_('Expenses', e);
  return true;
}

// ───────────────────────────── Action table ─────────────────────────────

const ADMIN = ['SUPER_ADMIN'], CLIENT = ['CLIENT'], EDITOR = ['EDITOR'];
const ACTIONS = {
  'bootstrap': { fn: function () { return { hasAdmin: adminExists_(), contact: contactView_() }; } },
  'register': { fn: register_ },
  'login': { fn: login_ },
  'logout': { roles: 'ANY', fn: logout_ },
  'state': { roles: 'ANY', fn: state_ },
  'changePassword': { roles: 'ANY', fn: changePassword_ },
  'updateProfile': { roles: 'ANY', fn: updateProfile_ },
  'video.comment': { roles: 'ANY', fn: videoComment_ },
  'notifications.read': { roles: 'ANY', fn: readNotification_ },
  'notifications.readAll': { roles: 'ANY', fn: readAllNotifications_ },

  'client.addVideo': { roles: CLIENT, fn: clientAddVideo_ },
  'client.videoDecision': { roles: CLIENT, fn: clientVideoDecision_ },
  'client.saveChannel': { roles: CLIENT, fn: clientSaveChannel_ },
  'client.deleteChannel': { roles: CLIENT, fn: clientDeleteChannel_ },
  'client.submitManualPayment': { roles: CLIENT, fn: clientSubmitManualPayment_ },
  'client.createOnlineOrder': { roles: CLIENT, fn: clientCreateOnlineOrder_ },
  'client.verifyOnlinePayment': { roles: CLIENT, fn: clientVerifyOnlinePayment_ },

  'editor.startVideo': { roles: EDITOR, fn: editorStartVideo_ },
  'editor.submitVideo': { roles: EDITOR, fn: editorSubmitVideo_ },
  'editor.requestPayment': { roles: EDITOR, fn: editorRequestPayment_ },

  'admin.decideUser': { roles: ADMIN, fn: adminDecideUser_ },
  'admin.setUserStatus': { roles: ADMIN, fn: adminSetUserStatus_ },
  'admin.createClient': { roles: ADMIN, fn: adminCreateClient_ },
  'admin.createUser': { roles: ADMIN, fn: adminCreateUser_ },
  'admin.recordClientPayment': { roles: ADMIN, fn: adminRecordClientPayment_ },
  'admin.resetPassword': { roles: ADMIN, fn: adminResetPassword_ },
  'admin.updateEditorPay': { roles: ADMIN, fn: adminUpdateEditorPay_ },
  'admin.assignVideo': { roles: ADMIN, fn: adminAssignVideo_ },
  'admin.setDeadline': { roles: ADMIN, fn: adminSetDeadline_ },
  'admin.reviewVideo': { roles: ADMIN, fn: adminReviewVideo_ },
  'admin.completeVideo': { roles: ADMIN, fn: adminCompleteVideo_ },
  'admin.adjustVideoPrice': { roles: ADMIN, fn: adminAdjustVideoPrice_ },
  'admin.savePricing': { roles: ADMIN, fn: adminSavePricing_ },
  'admin.decideManualPayment': { roles: ADMIN, fn: adminDecideManualPayment_ },
  'admin.decidePaymentRequest': { roles: ADMIN, fn: adminDecidePaymentRequest_ },
  'admin.recordPayout': { roles: ADMIN, fn: adminRecordPayout_ },
  'admin.closePaymentRequest': { roles: ADMIN, fn: adminClosePaymentRequest_ },
  'admin.generateSalary': { roles: ADMIN, fn: adminGenerateSalary_ },
  'admin.addBonus': { roles: ADMIN, fn: adminAddBonus_ },
  'admin.saveSettings': { roles: ADMIN, fn: adminSaveSettings_ },
  'admin.saveExpense': { roles: ADMIN, fn: adminSaveExpense_ },
  'admin.deleteExpense': { roles: ADMIN, fn: adminDeleteExpense_ }
};

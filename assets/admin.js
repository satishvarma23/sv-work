/* SV Workspace — Super Admin dashboard. Every section is reached from the left sidebar. */
(function (SV) {
  'use strict';
  const { icon, dueChip, stepper, barChart, hbars, previewBtn, commentsBlock, invoiceDialog } = SV;
  const { esc, inr, fmtDate, fmtDateTime, ymd, ym, today, sum, byNewest, ext, label, badge, avatar, table, stat, panel, kv, btn, filterInput, filterSelect, subtabs, toast, mutate, openForm, confirmBox, go, greeting, OPEN } = SV;

  SV.NAV.SUPER_ADMIN = [
    ['overview', 'Overview', 'home'], ['clients', 'Clients', 'users'], ['videos', 'Videos / Projects', 'film'], ['editors', 'Editors & Assignments', 'scissors'],
    ['calendar', 'Calendar', 'calendar'], ['budget', 'Budget Tracker', 'wallet'], ['revenue', 'Revenue', 'trending'], ['invoices', 'Billing / Invoices', 'receipt'],
    ['reviews', 'Video Reviews', 'play'], ['notifications', 'Notifications', 'bell'], ['accounts', 'User Accounts', 'usercheck'], ['pricings', 'Pricings', 'tag'],
    ['payments', 'Payment Requests', 'card'], ['reports', 'Reports', 'chart'], ['settings', 'Settings / Profile', 'gear']
  ];

  // ───────── data ─────────
  const S = () => SV.S;
  const user = id => S().users.find(u => u.id === id) || { id: '', fullName: id ? '(removed user)' : '—', email: '' };
  const clients = () => S().users.filter(u => u.role === 'CLIENT' && u.approvedAt);
  const editors = () => S().users.filter(u => u.role === 'EDITOR' && u.approvedAt);
  const pendingUsers = () => S().users.filter(u => u.status === 'PENDING');
  const assignable = () => editors().filter(e => e.status === 'ACTIVE' && e.employmentType);
  const video = id => S().videos.find(v => v.id === id);
  const openVideosOf = editorId => S().videos.filter(v => v.editorId === editorId && OPEN.includes(v.status));
  const pendingManual = () => S().manualPayments.filter(m => m.status === 'PENDING_VERIFICATION');
  const openRequests = () => S().paymentRequests.filter(r => r.status === 'PENDING' || r.status === 'APPROVED');
  const invoiceStatus = i => (i.pending <= 0 ? 'PAID' : i.paid > 0 ? 'PARTLY_PAID' : 'UNPAID');
  const payText = e => (e.employmentType === 'FULL_TIME' ? inr(e.monthlySalary) + ' / month' : e.employmentType === 'FREELANCE' ? inr(e.perVideoRate) + ' / video' : '—');
  const who = (u, sub) => '<span class="who">' + avatar(u, 32) + '<span>' + esc(u.fullName) + (sub ? '<small>' + esc(sub) + '</small>' : '') + '</span></span>';
  const videoLink = id => (id ? '<a href="#/videos/' + encodeURIComponent(id) + '">' + esc(id) + '</a>' : '—');
  const isLate = v => v.deadline && v.deadline < today() && OPEN.includes(v.status);

  SV.BADGES.SUPER_ADMIN = s => ({
    approvals: s.users.filter(u => u.status === 'PENDING').length,
    reviews: s.videos.filter(v => v.status === 'IN_REVIEW').length,
    payments: s.manualPayments.filter(m => m.status === 'PENDING_VERIFICATION').length + s.paymentRequests.filter(r => r.status === 'PENDING').length
  });
  SV.OPEN_REF.SUPER_ADMIN = n => {
    if (n.refType === 'video') return ['videos', n.refId];
    if (n.refType === 'user') { const u = user(n.refId); return u.status === 'PENDING' ? ['accounts'] : u.role === 'EDITOR' ? ['editors', u.id] : u.role === 'CLIENT' ? ['clients', u.id] : ['accounts']; }
    if (n.refType === 'client') return ['clients', n.refId];
    if (n.refType === 'manualPayment') { SV.F.payTab = 'client'; return ['payments']; }
    if (n.refType === 'paymentRequest') { SV.F.payTab = 'editor'; return ['payments']; }
    return null;
  };

  const V = (SV.VIEWS.SUPER_ADMIN = {});
  V.notifications = SV.notificationsView;

  // ───────── Overview ─────────
  V.overview = () => {
    const s = S(), month = ym(new Date());
    const revenue = sum(s.clientPayments.filter(p => ym(p.receivedAt) === month), 'amount');
    const months = [5, 4, 3, 2, 1, 0].map(i => new Date(new Date().getFullYear(), new Date().getMonth() - i, 1));
    const revenueChart = barChart(months.map(m => { const v = sum(s.clientPayments.filter(p => ym(p.receivedAt) === ym(m)), 'amount'); return { label: m.toLocaleDateString('en-IN', { month: 'short' }), value: v, text: v ? inr(v) : '—' }; }));
    const pipeline = hbars(OPEN.concat(['COMPLETED']).map(x => ({ label: badge(x), value: s.videos.filter(v => v.status === x).length })));
    const activity = s.activity.slice(0, 12).map(a => '<div class="activity"><span class="dot"></span><div><strong>' + esc(user(a.userId).fullName) + '</strong> · ' + esc(a.action.replace(/[.-]/g, ' ')) + (a.refId ? ' · ' + esc(a.refId) : '') + (a.detail ? '<br><span class="muted">' + esc(a.detail) + '</span>' : '') + '<br><small class="muted">' + fmtDateTime(a.at) + '</small></div></div>').join('');
    return greeting(SV.chip(s.videos.filter(v => v.status === 'IN_REVIEW').length, 'edits to review', 'reviews') + SV.chip(pendingManual().length, 'payments to verify', 'payments') + SV.chip(pendingUsers().length, 'registrations to approve', 'accounts') + SV.chip(s.videos.filter(v => !v.editorId && v.status !== 'COMPLETED').length, 'videos to assign', 'editors') + SV.chip(s.paymentRequests.filter(r => r.status === 'PENDING').length, 'payout requests', 'payments')) + '<div class="cards">' +
      stat('Total Clients', clients().filter(c => c.status === 'ACTIVE' || c.status === 'SUSPENDED').length, 'clients', 'Approved, including suspended') +
      stat('Active Projects', s.videos.filter(v => OPEN.includes(v.status)).length, 'videos', 'Not yet completed') +
      stat('Total Editors', editors().filter(e => e.status === 'ACTIVE').length, 'editors', 'Approved and active') +
      stat('Edits To Review', s.videos.filter(v => v.status === 'IN_REVIEW').length, 'reviews', 'Waiting for your review') +
      stat('Monthly Revenue', inr(revenue), 'revenue', 'Received this month') +
      stat('Pending Client Payments', inr(sum(s.invoices, 'pending')), 'invoices', 'Outstanding on issued invoices') + '</div>' +
      '<div class="cols">' + panel('Revenue — last 6 months', revenueChart, '<a class="btn ghost small" href="#/revenue">Open Revenue</a>') + panel('Project pipeline', pipeline, '<a class="btn ghost small" href="#/videos">Open projects</a>') + '</div>' +
      '<div class="cols">' + panel('Recent Activity', activity ? '<div>' + activity + '</div>' : '<div class="empty">Nothing has happened yet.</div>') +
      panel('Quick Actions', '<div class="list">' +
        btn('Add a client', 'a-client-add', {}, 'btn ghost') +
        btn('Assign videos (' + s.videos.filter(v => !v.editorId && v.status !== 'COMPLETED').length + ' unassigned)', 'go', { section: 'editors' }, 'btn ghost') +
        btn('Review edited videos (' + s.videos.filter(v => v.status === 'IN_REVIEW').length + ')', 'go', { section: 'reviews' }, 'btn ghost') +
        btn('Verify client payments (' + pendingManual().length + ')', 'a-pay-tab', { tab: 'client' }, 'btn ghost') +
        btn('Editor payment requests (' + s.paymentRequests.filter(r => r.status === 'PENDING').length + ')', 'a-pay-tab', { tab: 'editor' }, 'btn ghost') +
        btn('Update pricings', 'go', { section: 'pricings' }, 'btn ghost') + '</div>') + '</div>';
  };
  SV.ACT['a-pay-tab'] = d => { SV.F.payTab = d.tab; go('payments'); };

  // ───────── Clients ─────────
  V.clients = () => {
    if (SV.route.id) return clientDetail(SV.route.id);
    const q = (SV.F.clientQ || '').toLowerCase(), st = SV.F.clientStatus || '';
    const list = clients().filter(c => (!st || c.status === st) && (!q || (c.fullName + ' ' + c.socialName + ' ' + c.email).toLowerCase().includes(q)));
    const waiting = pendingUsers().filter(u => u.role === 'CLIENT').length;
    return (waiting ? '<div class="notice warn">' + waiting + ' client registration' + (waiting > 1 ? 's are' : ' is') + ' waiting. <a href="#/accounts">Open User Accounts</a></div>' : '') +
      '<div class="toolbar">' + filterInput('clientQ', 'Search by name, social media name or email') +
      filterSelect('clientStatus', [['', 'All statuses'], ['ACTIVE', 'Active'], ['SUSPENDED', 'Suspended'], ['ARCHIVED', 'Archived']], 'Status') +
      btn('Add client', 'a-client-add', {}, 'btn primary') + '</div>' +
      panel('Clients (' + list.length + ')', table(['Client', 'Social media name', 'Status', '#Videos', '#Billed', '#Pending', ''], list.map(c => [
        who(c, c.email), esc(c.socialName || '—'), badge(c.status), S().videos.filter(v => v.clientId === c.id).length, inr(c.ledger.total), inr(c.ledger.pending),
        '<a class="btn ghost small" href="#/clients/' + esc(c.id) + '">View</a>'
      ]), clients().length ? 'No clients match these filters.' : 'No clients yet. Press Add client to create the first one.'));
  };
  function clientDetail(id) {
    const c = clients().find(x => x.id === id);
    if (!c) return '<a class="back" href="#/clients">← All clients</a><div class="empty">Client not found.</div>';
    const s = S(), tab = SV.F.clientTab || 'profile';
    const vids = s.videos.filter(v => v.clientId === id).sort(byNewest('createdAt'));
    const channels = s.channels.filter(ch => ch.clientId === id);
    const invoices = s.invoices.filter(i => i.clientId === id);
    let body;
    if (tab === 'profile') body = kv([['Full name', esc(c.fullName)], ['Social media name', esc(c.socialName || '—')], ['Email address', esc(c.email)], ['Status', badge(c.status)], ['Client since', fmtDate(c.approvedAt)]]) +
      '<h4 style="margin:18px 0 8px">Channels</h4>' + table(['Platform', 'Channel / page name', 'Link'], channels.map(ch => [esc(label(ch.platform)), esc(ch.name), ext(ch.link)]), 'This client has not added any channels yet.');
    else if (tab === 'projects') body = table(['Video', 'Type', '#Price', 'Status', 'Editor', 'Submitted'], vids.map(v => [videoLink(v.id), esc(v.typeLabel), inr(v.price), badge(v.status), esc(v.editorId ? user(v.editorId).fullName : 'Unassigned'), fmtDate(v.createdAt)]), 'No videos yet.');
    else if (tab === 'payments') body = '<div class="cards">' + stat('Total Amount', inr(c.ledger.total)) + stat('Amount Paid', inr(c.ledger.paid)) + stat('Pending Amount', inr(c.ledger.pending)) + stat('Awaiting Verification', inr(c.ledger.awaitingVerification)) + '</div>' +
      table(['Received', 'Method', 'Reference', '#Amount'], s.clientPayments.filter(p => p.clientId === id).sort(byNewest('receivedAt')).map(p => [fmtDateTime(p.receivedAt), esc(label(p.method)), esc(p.reference), inr(p.amount)]), 'No payments received yet.');
    else body = table(['Invoice', 'Video', 'Issued', '#Amount', '#Paid', '#Pending', 'Status'], invoices.map(i => [esc(i.id), videoLink(i.videoId), fmtDate(i.issuedAt), inr(i.amount), inr(i.paid), inr(i.pending), badge(invoiceStatus(i))]), 'No invoices yet.');
    const tools = btn('Record payment', 'a-record-pay', { id: c.id }, 'btn primary small') + btn('Reset password', 'a-reset-pw', { id: c.id }) + (c.status === 'ACTIVE' ? btn('Suspend', 'a-user-status', { id: c.id, status: 'SUSPENDED' }) : btn('Reactivate', 'a-user-status', { id: c.id, status: 'ACTIVE' })) +
      (c.status !== 'ARCHIVED' ? btn('Archive', 'a-user-status', { id: c.id, status: 'ARCHIVED' }) : '');
    return '<a class="back" href="#/clients">← All clients</a>' +
      '<section class="panel"><div class="panel-head"><div class="who">' + avatar(c, 64) + '<div><h3>' + esc(c.fullName) + '</h3><span class="muted">' + esc(c.socialName || c.email) + '</span> ' + badge(c.status) + '</div></div><div class="actions">' + tools + '</div></div>' +
      subtabs('clientTab', [['profile', 'Profile'], ['projects', 'Projects (' + vids.length + ')'], ['payments', 'Payments'], ['invoices', 'Invoices (' + invoices.length + ')']]) + body + '</section>';
  }
  // ───────── creating accounts (there is no self-registration) ─────────
  const newPassword = () => { const set = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'; return Array.from(crypto.getRandomValues(new Uint8Array(10)), b => set[b % set.length]).join(''); };
  function createAccount(role) {
    let made = null;
    return openForm({
      title: 'Create an account', submit: 'Create account', intro: 'The person can sign in straight away. You send them the login details yourself — SV Workspace does not send email.',
      fields: [{ name: 'role', label: 'Account type', type: 'select', required: true, value: role || 'CLIENT', options: [['CLIENT', 'Client'], ['EDITOR', 'Editor'], ['SUPER_ADMIN', 'Super Admin — full control']] },
        { name: 'fullName', label: 'Full name', required: true, max: 80 }, { name: 'email', label: 'Email address', type: 'email', required: true },
        { name: 'socialName', label: 'Social media name', max: 80, showIf: v => v.role === 'CLIENT' }]
        .concat(payFields({}).map(f => Object.assign({}, f, { showIf: v => v.role === 'EDITOR' && (!f.showIf || f.showIf(v)) })))
        .concat([{ name: 'password', label: 'Temporary password', required: true, max: 100, value: newPassword(), help: 'At least 8 characters. They should change it under Profile after signing in.' }]),
      validate: f => (f.password.length < 8 ? 'The temporary password must be at least 8 characters.' : ''),
      onSubmit: async f => { await SV.api('admin.createUser', f); made = { name: f.fullName, email: f.email.toLowerCase(), password: f.password, role: f.role }; await SV.reload(); }
    }).then(ok => { if (ok && made) credentials(made); });
  }
  function credentials(m) {
    const text = 'Hello ' + m.name + ',\n\nYour SV Workspace ' + label(m.role) + ' account is ready.\n\nWebsite: ' + location.href.split('#')[0] + '\nEmail: ' + m.email + '\nPassword: ' + m.password + '\n\nPlease change your password under Profile after you sign in.';
    SV.F._creds = text;
    SV.openDialog('Account created — send these login details', '<p class="muted" style="margin-top:0">Copy this and send it to ' + esc(m.name) + ' yourself (WhatsApp, email…). The password is not shown again; you can reset it later from their page.</p><pre class="creds">' + esc(text) + '</pre>', false, btn('Copy', 'a-copy-creds', {}, 'btn primary'));
  }
  SV.ACT['a-copy-creds'] = async () => {
    try { await navigator.clipboard.writeText(SV.F._creds); toast('Login details copied.'); }
    catch (e) { toast('Copying is blocked in this browser. Select the text and copy it yourself.', 'error'); }
  };
  SV.ACT['a-client-add'] = () => createAccount('CLIENT');
  SV.ACT['a-editor-add'] = () => createAccount('EDITOR');
  SV.ACT['a-account-add'] = () => createAccount('CLIENT');

  // ───────── a payment that reached the studio outside the website ─────────
  SV.ACT['a-record-pay'] = d => {
    const list = clients().filter(c => c.status !== 'ARCHIVED');
    if (!list.length) { toast('Create a client account first.', 'error'); return; }
    const owed = id => { const c = list.find(x => x.id === id); return c ? c.ledger.pending : 0; };
    return openForm({
      title: 'Record a payment received', submit: 'Record payment',
      intro: 'For money received outside the website — cash, a direct transfer, a cheque. The client\'s balance drops at once and they are notified. If the client already submitted this payment on the website, verify that submission instead, so it is not counted twice.',
      fields: [{ name: 'clientId', label: 'Client', type: 'select', required: true, value: d.id || '', options: [['', 'Choose a client…']].concat(list.map(c => [c.id, c.fullName + ' — owes ' + inr(c.ledger.pending)])) },
        { name: 'amount', label: 'Amount received (INR)', type: 'money', required: true, value: d.id && owed(d.id) > 0 ? owed(d.id) : '', help: 'The full balance or any part of it.' },
        { name: 'method', label: 'Received by', type: 'select', required: true, options: [['CASH', 'Cash'], ['UPI', 'UPI'], ['BANK', 'Bank transfer'], ['CHEQUE', 'Cheque'], ['OTHER', 'Other']] },
        { name: 'reference', label: 'Reference', required: true, max: 60, help: 'Receipt number, transaction reference or cheque number.' },
        { name: 'date', label: 'Received on', type: 'date', required: true, value: today() }, { name: 'note', label: 'Note', max: 300 }],
      validate: f => (owed(f.clientId) <= 0 ? 'This client has no outstanding balance.' : Number(f.amount) > owed(f.clientId) ? 'The amount cannot be more than what this client owes (' + inr(owed(f.clientId)) + ').' : f.date > today() ? 'The date received cannot be in the future.' : ''),
      onSubmit: f => mutate('admin.recordClientPayment', f, 'Payment recorded. The client\'s balance was updated.')
    });
  };
  SV.ACT['a-reset-pw'] = d => { const u = user(d.id); return openForm({ title: 'Reset password of ' + u.fullName, submit: 'Reset password', intro: 'They are signed out everywhere and must use this password next time. Tell them the password yourself — SV Workspace does not send email.',
    fields: [{ name: 'password', label: 'Temporary password', type: 'password', required: true, minLength: 8, autocomplete: 'new-password', help: 'At least 8 characters.' }], onSubmit: f => mutate('admin.resetPassword', { userId: u.id, password: f.password }, 'Password reset.') }); };
  SV.ACT['a-user-status'] = async d => {
    const u = user(d.id);
    const text = { SUSPENDED: 'They will be signed out and cannot sign in until reactivated. Their projects, payments and invoices are kept.', ARCHIVED: 'They will be signed out and hidden from active lists. Their projects, payments and invoices are kept. You can reactivate them later.', ACTIVE: 'They will be able to sign in again.' }[d.status];
    const word = { SUSPENDED: 'Suspend', ARCHIVED: 'Archive', ACTIVE: 'Reactivate' }[d.status];
    if (await confirmBox(word + ' ' + u.fullName + '?', text, word, d.status !== 'ACTIVE')) await mutate('admin.setUserStatus', { userId: d.id, status: d.status }, u.fullName + ' is now ' + label(d.status).toLowerCase() + '.');
  };

  // ───────── Videos / Projects ─────────
  V.videos = () => {
    if (SV.route.id) return videoDetail(SV.route.id);
    const q = (SV.F.videoQ || '').toLowerCase(), st = SV.F.videoStatus || '', ty = SV.F.videoType || '', ed = SV.F.videoEditor || '';
    const list = S().videos.filter(v => (!st || v.status === st) && (!ty || v.type === ty) && (!ed || (ed === 'NONE' ? !v.editorId : v.editorId === ed)) &&
      (!q || (v.id + ' ' + user(v.clientId).fullName + ' ' + v.remarks).toLowerCase().includes(q))).sort(byNewest('createdAt'));
    return '<div class="toolbar">' + filterInput('videoQ', 'Search by video ID, client or remarks') +
      filterSelect('videoStatus', [['', 'All statuses']].concat(OPEN.concat(['COMPLETED']).map(x => [x, label(x)])), 'Status') +
      filterSelect('videoType', [['', 'All types']].concat(Object.keys(S().videoTypes).map(k => [k, S().videoTypes[k]])), 'Type') +
      filterSelect('videoEditor', [['', 'All editors'], ['NONE', 'Unassigned']].concat(editors().map(e => [e.id, e.fullName])), 'Editor') + '</div>' +
      subtabs('videoView', [['list', 'List'], ['board', 'Board']]) +
      (SV.F.videoView === 'board' ? board(list) : '') +
      (SV.F.videoView === 'board' ? '' : panel('Videos / Projects (' + list.length + ')', table(['Video', 'Client', 'Type', '#Price', 'Status', 'Editor', 'Deadline', ''], list.map(v => [
        videoLink(v.id), esc(user(v.clientId).fullName), esc(v.typeLabel), inr(v.price), badge(v.status), esc(v.editorId ? user(v.editorId).fullName : 'Unassigned'),
        v.deadline ? fmtDate(v.deadline) + '<br>' + dueChip(v.deadline, v.status) : '—', videoActions(v, true)
      ]), S().videos.length ? 'No videos match these filters.' : 'No video requests yet. They appear here as soon as a client submits one.')));
  };
  function board(list) {
    return '<div class="board">' + OPEN.concat(['COMPLETED']).map(st => {
      const cards = list.filter(v => v.status === st);
      return '<section class="kcol" aria-label="' + esc(label(st)) + '"><h4>' + badge(st) + '<span class="muted">' + cards.length + '</span></h4>' +
        (cards.map(v => '<a class="kcard" href="#/videos/' + esc(v.id) + '"><strong>' + esc(v.id) + '</strong><small>' + esc(v.typeLabel) + ' · ' + esc(user(v.clientId).fullName) + '</small><div class="row"><span class="who">' + (v.editorId ? avatar(user(v.editorId), 22) + '<small>' + esc(user(v.editorId).fullName) + '</small>' : '<small>Unassigned</small>') + '</span>' + dueChip(v.deadline, v.status) + '</div></a>').join('') || '<p class="muted" style="text-align:center;font-size:12.5px">Nothing here</p>') + '</section>';
    }).join('') + '</div><p class="muted">A video moves between columns through its workflow: assign, start, submit, review, approve.</p>';
  }
  function videoActions(v, compact) {
    const a = [];
    if (compact) a.push('<a class="btn ghost small" href="#/videos/' + esc(v.id) + '">Open</a>');
    if (['NOT_STARTED', 'IN_PROGRESS', 'REVISION'].includes(v.status)) a.push(btn(v.editorId ? 'Reassign' : 'Assign', 'a-assign', { id: v.id }, v.editorId ? 'btn ghost small' : 'btn primary small'));
    if (!compact && v.editorId && v.status !== 'COMPLETED') a.push(btn('Change deadline', 'a-deadline', { id: v.id }));
    if (v.status === 'IN_REVIEW') a.push(btn('Approve', 'a-review', { id: v.id, decision: 'APPROVE' }, 'btn primary small'), btn('Request revision', 'a-review', { id: v.id, decision: 'REVISION' }));
    if (!compact && v.status === 'CLIENT_REVIEW') a.push(btn("Complete on client's behalf", 'a-complete', { id: v.id }));
    if (!compact) a.push(btn('Adjust price', 'a-price', { id: v.id }));
    return '<div class="actions">' + a.join('') + '</div>';
  }
  function videoDetail(id) {
    const v = video(id);
    if (!v) return '<a class="back" href="#/videos">← All videos</a><div class="empty">Video not found.</div>';
    const c = user(v.clientId), history = S().reviews.filter(r => r.videoId === id).sort(byNewest('createdAt'));
    const versions = S().reviews.filter(r => r.videoId === id && r.decision === 'SUBMITTED' && /^https?:\/\//i.test(r.link));
    const steps = [['Submitted by client', v.createdAt], ['Editing started', v.startedAt], ['Edited video submitted', v.submittedAt], ['Approved by Super Admin', v.adminApprovedAt], ['Completed', v.completedAt]].filter(x => x[1]);
    return '<a class="back" href="#/videos">← All videos</a>' +
      '<section class="panel"><div class="panel-head"><div><h3>' + esc(v.id) + ' — ' + esc(v.typeLabel) + '</h3>' + badge(v.status) + (isLate(v) ? ' ' + badge('OVERDUE') : '') + '</div>' + videoActions(v, false) + '</div>' + stepper(v.status, ['Submitted', 'Editing', 'Your review', 'Client approval', 'Completed']) +
      kv([['Client', '<a href="#/clients/' + esc(c.id) + '">' + esc(c.fullName) + '</a>' + (c.socialName ? ' · ' + esc(c.socialName) : '')], ['Price', inr(v.price) + ' <span class="muted">(invoice ' + esc(v.invoiceId) + ')</span>'],
        ['Raw footage', ext(v.rawLink) + previewBtn(v.rawLink, 'Raw footage — ' + v.id)], ['Remarks', '<span class="pre">' + esc(v.remarks) + '</span>'],
        ['Editor', v.editorId ? '<a href="#/editors/' + esc(v.editorId) + '">' + esc(user(v.editorId).fullName) + '</a>' : 'Unassigned'],
        ['Editor rate', v.editorRate !== '' ? inr(v.editorRate) + ' (set on this assignment)' : v.editorId ? 'Editor default (' + payText(user(v.editorId)) + ')' : '—'],
        ['Deadline', v.deadline ? fmtDate(v.deadline) + ' ' + dueChip(v.deadline, v.status) : '—'], ['Edited video', ext(v.editedLink) + previewBtn(v.editedLink, 'Edited video — ' + v.id)],
        versions.length > 1 ? ['Versions', '<span class="versions">' + versions.map((r, i) => '<a href="' + esc(r.link) + '" target="_blank" rel="noopener noreferrer">v' + (i + 1) + ' · ' + fmtDate(r.createdAt) + '</a>').join('') + '</span>'] : null,
        v.revisionNote ? ['Revision notes', '<span class="pre">' + esc(v.revisionNote) + '</span>'] : null]) + commentsBlock(v.id) + '</section>' +
      '<div class="cols">' + panel('Progress', table(['Step', 'When'], steps.map(x => [esc(x[0]), fmtDateTime(x[1])]), 'Nothing yet.')) +
      panel('Review history', table(['When', 'By', 'Decision', 'Note'], history.map(r => [fmtDateTime(r.createdAt), esc(user(r.byUserId).fullName) + ' <span class="muted">(' + esc(label(r.byRole)) + ')</span>', esc(label(r.decision, { SUBMITTED: 'Submitted', APPROVED: 'Approved', REVISION: 'Revision requested', COMPLETED: 'Completed' })), '<span class="pre">' + esc(r.note || '—') + '</span>']), 'No submissions or reviews yet.')) + '</div>';
  }
  SV.ACT['a-assign'] = d => {
    const v = video(d.id), list = assignable();
    if (!list.length) { toast('There is no active Editor to assign. Create one under Editors & Assignments.', 'error'); return; }
    return openForm({
      title: (v.editorId ? 'Reassign ' : 'Assign ') + v.id, submit: v.editorId ? 'Reassign' : 'Assign',
      intro: esc(v.typeLabel) + ' for ' + esc(user(v.clientId).fullName) + '. The Editor sees the footage link and remarks, never the client.',
      fields: [
        { name: 'editorId', label: 'Editor', type: 'select', required: true, value: v.editorId, options: [['', 'Choose an Editor…']].concat(list.map(e => [e.id, e.fullName + ' — ' + label(e.employmentType) + ', ' + payText(e) + ' · ' + openVideosOf(e.id).length + ' open'])) },
        { name: 'deadline', label: 'Deadline', type: 'date', required: true, value: v.deadline, min: today() },
        { name: 'rate', label: 'Per-video rate for this video (INR)', type: 'money', allowZero: true, value: v.editorRate, help: "Leave empty to use the Editor's default: Freelance = their per-video rate, Full-Time = salary only." }
      ],
      onSubmit: f => mutate('admin.assignVideo', { videoId: v.id, editorId: f.editorId, deadline: f.deadline, rate: f.rate }, v.id + ' assigned to ' + user(f.editorId).fullName + '.')
    });
  };
  SV.ACT['a-deadline'] = d => {
    const v = video(d.id);
    return openForm({ title: 'Change deadline of ' + v.id, submit: 'Save deadline', fields: [{ name: 'deadline', label: 'Deadline', type: 'date', required: true, value: v.deadline }],
      onSubmit: f => mutate('admin.setDeadline', { videoId: v.id, deadline: f.deadline }, 'Deadline updated. The Editor was notified.') });
  };
  SV.ACT['a-review'] = d => {
    const v = video(d.id), approve = d.decision === 'APPROVE';
    return openForm({
      title: (approve ? 'Approve ' : 'Request revision on ') + v.id, submit: approve ? 'Approve' : 'Request revision',
      intro: 'Edited video: ' + ext(v.editedLink) + (approve ? '<br>The client is then asked for final approval, and the Editor\'s per-video pay (if any) becomes payable.' : ''),
      fields: [{ name: 'note', label: approve ? 'Note (optional)' : 'What should be changed', type: 'textarea', required: !approve }],
      onSubmit: f => mutate('admin.reviewVideo', { videoId: v.id, decision: d.decision, note: f.note }, approve ? v.id + ' approved. The client was asked for final approval.' : 'Revision requested. The Editor was notified.')
    });
  };
  SV.ACT['a-complete'] = d => openForm({
    title: 'Complete ' + d.id + " on the client's behalf", submit: 'Mark completed', intro: 'Use this only when the client approved outside the website. The reason is kept in the audit log.',
    fields: [{ name: 'reason', label: 'Reason', required: true, max: 300 }], onSubmit: f => mutate('admin.completeVideo', { videoId: d.id, reason: f.reason }, d.id + ' is completed.')
  });
  SV.ACT['a-price'] = d => {
    const v = video(d.id);
    return openForm({ title: 'Adjust price of ' + v.id, submit: 'Save price', intro: 'This changes this video and its invoice only. Pricings for new videos are set under Pricings.',
      fields: [{ name: 'price', label: 'Price (INR)', type: 'money', required: true, value: v.price }, { name: 'reason', label: 'Reason', required: true, max: 300 }],
      onSubmit: f => mutate('admin.adjustVideoPrice', { videoId: v.id, price: f.price, reason: f.reason }, 'Price updated. The client was notified.') });
  };

  // ───────── Editors & Assignments ─────────
  V.editors = () => {
    if (SV.route.id) return editorDetail(SV.route.id);
    const q = (SV.F.editorQ || '').toLowerCase(), ty = SV.F.editorType || '';
    const list = editors().filter(e => (!ty || e.employmentType === ty) && (!q || (e.fullName + ' ' + e.email).toLowerCase().includes(q)));
    const unassigned = S().videos.filter(v => !v.editorId && v.status !== 'COMPLETED').sort(byNewest('createdAt'));
    return '<div class="toolbar">' + filterInput('editorQ', 'Search editors by name or email') + filterSelect('editorType', [['', 'All employment types'], ['FULL_TIME', 'Full-Time'], ['FREELANCE', 'Freelance']], 'Employment type') + btn('Add editor', 'a-editor-add', {}, 'btn primary') + '</div>' +
      panel('Editors (' + list.length + ')', table(['Editor', 'Employment', 'Pay', 'Status', '#Open videos', '#Completed', '#Owed', ''], list.map(e => [
        who(e, e.email), esc(label(e.employmentType)), esc(payText(e)), badge(e.status), openVideosOf(e.id).length, S().videos.filter(v => v.editorId === e.id && v.status === 'COMPLETED').length, inr(e.ledger.pending),
        '<a class="btn ghost small" href="#/editors/' + esc(e.id) + '">View</a>'
      ]), editors().length ? 'No editors match these filters.' : 'No editors yet. Press Add editor to create the first one.')) +
      panel('Waiting for assignment (' + unassigned.length + ')', table(['Video', 'Client', 'Type', 'Submitted', ''], unassigned.map(v => [videoLink(v.id), esc(user(v.clientId).fullName), esc(v.typeLabel), fmtDate(v.createdAt), btn('Assign', 'a-assign', { id: v.id }, 'btn primary small')]), 'Every video has an Editor.'));
  };
  function editorDetail(id) {
    const e = editors().find(x => x.id === id);
    if (!e) return '<a class="back" href="#/editors">← All editors</a><div class="empty">Editor not found.</div>';
    const s = S(), vids = s.videos.filter(v => v.editorId === id).sort(byNewest('updatedAt'));
    const earnings = s.earnings.filter(x => x.editorId === id).sort(byNewest('createdAt'));
    const tools = btn('Edit pay', 'a-editor-pay', { id: id }) + (e.employmentType === 'FULL_TIME' ? btn('Add monthly salary', 'a-salary', { id: id }) : '') + btn('Add bonus', 'a-bonus', { id: id }) + btn('Reset password', 'a-reset-pw', { id: id }) +
      (e.status === 'ACTIVE' ? btn('Suspend', 'a-user-status', { id: id, status: 'SUSPENDED' }) : btn('Reactivate', 'a-user-status', { id: id, status: 'ACTIVE' }));
    return '<a class="back" href="#/editors">← All editors</a>' +
      '<section class="panel"><div class="panel-head"><div class="who">' + avatar(e, 64) + '<div><h3>' + esc(e.fullName) + '</h3><span class="muted">' + esc(e.email) + '</span> ' + badge(e.status) + '</div></div><div class="actions">' + tools + '</div></div>' +
      kv([['Employment type', esc(label(e.employmentType))], [e.employmentType === 'FULL_TIME' ? 'Monthly salary' : 'Default per-video rate', esc(payText(e))], ['Editor since', fmtDate(e.approvedAt)]]) + '</section>' +
      '<div class="cards">' + stat('Open videos', openVideosOf(id).length) + stat('Completed', vids.filter(v => v.status === 'COMPLETED').length) + stat('Total earnings', inr(e.ledger.earned)) + stat('Paid', inr(e.ledger.received)) + stat('Owed', inr(e.ledger.pending)) + '</div>' +
      panel('Assigned videos', table(['Video', 'Type', 'Status', 'Deadline', '#Rate', ''], vids.map(v => [videoLink(v.id), esc(v.typeLabel), badge(v.status), v.deadline ? fmtDate(v.deadline) + (isLate(v) ? ' ' + badge('OVERDUE') : '') : '—', v.editorRate !== '' ? inr(v.editorRate) : 'Default', videoActions(v, true)]), 'No videos assigned yet.')) +
      panel('Earnings', table(['Added', 'Kind', 'For', '#Amount'], earnings.map(x => [fmtDateTime(x.createdAt), esc(label(x.kind)), x.videoId ? videoLink(x.videoId) : esc(x.note), inr(x.amount)]), 'No earnings yet.'));
  }
  const payFields = e => [
    { name: 'employmentType', label: 'Employment type', type: 'select', required: true, value: e.employmentType, options: [['', 'Choose…'], ['FULL_TIME', 'Full-Time Editor'], ['FREELANCE', 'Freelance Editor']] },
    { name: 'monthlySalary', label: 'Monthly salary (INR)', type: 'money', required: true, value: e.monthlySalary || '', showIf: v => v.employmentType === 'FULL_TIME' },
    { name: 'perVideoRate', label: 'Default per-video editing rate (INR)', type: 'money', required: true, value: e.perVideoRate || '', showIf: v => v.employmentType === 'FREELANCE' }
  ];
  SV.ACT['a-editor-pay'] = d => { const e = user(d.id); return openForm({ title: 'Pay details of ' + e.fullName, fields: payFields(e), onSubmit: f => mutate('admin.updateEditorPay', Object.assign({ userId: e.id }, f), 'Pay details saved. The Editor was notified.') }); };
  SV.ACT['a-salary'] = d => { const e = user(d.id); return openForm({ title: 'Add monthly salary for ' + e.fullName, submit: 'Add salary', intro: inr(e.monthlySalary) + ' is added to their earnings. A month can be added only once.', fields: [{ name: 'month', label: 'Month', type: 'month', required: true, value: ym(new Date()) }], onSubmit: f => mutate('admin.generateSalary', { editorId: e.id, month: f.month }, 'Salary for ' + f.month + ' added.') }); };
  SV.ACT['a-bonus'] = d => { const e = user(d.id); return openForm({ title: 'Add bonus for ' + e.fullName, submit: 'Add bonus', fields: [{ name: 'amount', label: 'Amount (INR)', type: 'money', required: true }, { name: 'note', label: 'Reason', required: true, max: 200 }], onSubmit: f => mutate('admin.addBonus', { editorId: e.id, amount: f.amount, note: f.note }, 'Bonus added.') }); };

  // ───────── Calendar ─────────
  V.calendar = () => {
    const month = SV.F.calMonth || ym(new Date()), parts = month.split('-').map(Number);
    const first = new Date(parts[0], parts[1] - 1, 1), days = new Date(parts[0], parts[1], 0).getDate();
    const byDay = {};
    S().videos.filter(v => v.deadline && v.deadline.slice(0, 7) === month).forEach(v => { (byDay[v.deadline] = byDay[v.deadline] || []).push(v); });
    let cells = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(x => '<div class="dow">' + x + '</div>').join('');
    for (let i = 0; i < first.getDay(); i++) cells += '<div class="day out"></div>';
    for (let n = 1; n <= days; n++) {
      const key = ymd(new Date(parts[0], parts[1] - 1, n));
      cells += '<div class="day' + (key === today() ? ' today' : '') + '"><strong>' + n + '</strong>' + (byDay[key] || []).map(v => '<a class="chip' + (isLate(v) ? ' late' : v.status === 'COMPLETED' ? ' done' : '') + '" href="#/videos/' + esc(v.id) + '" title="' + esc(v.id + ' · ' + user(v.editorId).fullName + ' · ' + label(v.status)) + '">' + esc(v.id) + '</a>').join('') + '</div>';
    }
    const shift = n => ym(new Date(parts[0], parts[1] - 1 + n, 1));
    const count = Object.keys(byDay).reduce((a, k) => a + byDay[k].length, 0);
    return panel(first.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' }) + ' — ' + count + ' deadline' + (count === 1 ? '' : 's'), '<div class="cal">' + cells + '</div><p class="muted">Deadlines of assigned videos. Red = overdue. Select a video to open it.</p>',
      btn('← Previous', 'a-cal', { month: shift(-1) }) + btn('This month', 'a-cal', { month: ym(new Date()) }) + btn('Next →', 'a-cal', { month: shift(1) }));
  };
  SV.ACT['a-cal'] = d => { SV.F.calMonth = d.month; SV.render(); };

  // ───────── Budget Tracker ─────────
  V.budget = () => {
    const s = S(), month = SV.F.budMonth === undefined ? ym(new Date()) : SV.F.budMonth;
    const inMonth = (v, isDay) => !month || (isDay ? String(v).slice(0, 7) : ym(v)) === month;
    const income = sum(s.clientPayments.filter(p => inMonth(p.receivedAt)), 'amount');
    const payouts = sum(s.payouts.filter(p => inMonth(p.paidAt)), 'amount');
    const expenses = s.expenses.filter(e => inMonth(e.date, true)).sort(byNewest('date'));
    const other = sum(expenses, 'amount');
    return '<div class="toolbar"><label class="muted" for="bud-month">Month</label><input id="bud-month" type="month" data-f="budMonth" value="' + esc(month) + '">' + btn('All time', 'a-bud-all') + '<span class="grow"></span>' + btn('Add expense', 'a-expense', {}, 'btn primary') + '</div>' +
      '<div class="cards">' + stat('Income received', inr(income), 'revenue') + stat('Editor payouts', inr(payouts), 'payments') + stat('Other expenses', inr(other)) + stat('Net', inr(income - payouts - other), '', month ? 'For ' + month : 'All time') + '</div>' +
      panel('Other expenses (' + expenses.length + ')', table(['Date', 'Category', 'Description', '#Amount', ''], expenses.map(e => [fmtDate(e.date), esc(e.category), esc(e.description || '—'), inr(e.amount), btn('Delete', 'a-expense-del', { id: e.id })]), 'No expenses recorded for this period.'));
  };
  SV.ACT['a-bud-all'] = () => { SV.F.budMonth = ''; SV.render(); };
  SV.ACT['a-expense'] = () => openForm({ title: 'Add expense', submit: 'Add expense', fields: [{ name: 'date', label: 'Date', type: 'date', required: true, value: today() }, { name: 'category', label: 'Category', required: true, max: 60, help: 'For example: Software, Equipment, Rent.' }, { name: 'description', label: 'Description', max: 200 }, { name: 'amount', label: 'Amount (INR)', type: 'money', required: true }], onSubmit: f => mutate('admin.saveExpense', f, 'Expense added.') });
  SV.ACT['a-expense-del'] = async d => { if (await confirmBox('Delete this expense?', 'It is removed from the Budget Tracker. The deletion is kept in the audit log.', 'Delete', true)) await mutate('admin.deleteExpense', { id: d.id }, 'Expense deleted.'); };

  // ───────── Revenue ─────────
  V.revenue = () => {
    const s = S(), now = new Date(), months = [];
    for (let i = 0; i < 12; i++) months.push(ym(new Date(now.getFullYear(), now.getMonth() - i, 1)));
    const of = m => sum(s.clientPayments.filter(p => ym(p.receivedAt) === m), 'amount');
    const byClient = clients().map(c => [c, c.ledger]).filter(x => x[1].total > 0).sort((a, b) => b[1].paid - a[1].paid);
    return '<div class="cards">' + stat('This month', inr(of(months[0]))) + stat('Last month', inr(of(months[1]))) + stat('Total received', inr(sum(s.clientPayments, 'amount'))) + stat('Outstanding', inr(sum(s.invoices, 'pending')), 'invoices') + '</div>' +
      '<div class="cols">' + panel('Received by month', table(['Month', '#Payments', '#Received'], months.map(m => [esc(m), s.clientPayments.filter(p => ym(p.receivedAt) === m).length, inr(of(m))]), '')) +
      panel('By client', table(['Client', '#Billed', '#Received', '#Outstanding'], byClient.map(x => ['<a href="#/clients/' + esc(x[0].id) + '">' + esc(x[0].fullName) + '</a>', inr(x[1].total), inr(x[1].paid), inr(x[1].pending)]), 'Nothing billed yet.')) + '</div>' +
      panel('Payments received', table(['Received', 'Client', 'Method', 'Reference', '#Amount'], s.clientPayments.slice().sort(byNewest('receivedAt')).map(p => [fmtDateTime(p.receivedAt), esc(user(p.clientId).fullName), esc(label(p.method)), esc(p.reference), inr(p.amount)]), 'No payments received yet. Only verified payments count as revenue.'));
  };

  // ───────── Billing / Invoices ─────────
  V.invoices = () => {
    const q = (SV.F.invQ || '').toLowerCase(), st = SV.F.invStatus || '';
    const list = S().invoices.filter(i => (!st || invoiceStatus(i) === st) && (!q || (i.id + ' ' + i.videoId + ' ' + user(i.clientId).fullName).toLowerCase().includes(q))).sort(byNewest('issuedAt'));
    return '<div class="toolbar">' + filterInput('invQ', 'Search by invoice, video or client') + filterSelect('invStatus', [['', 'All invoices'], ['UNPAID', 'Unpaid'], ['PARTLY_PAID', 'Partly paid'], ['PAID', 'Paid']], 'Status') + '</div>' +
      '<div class="cards">' + stat('Billed', inr(sum(list, 'amount'))) + stat('Paid', inr(sum(list, 'paid'))) + stat('Pending', inr(sum(list, 'pending'))) + '</div>' +
      panel('Invoices (' + list.length + ')', table(['Invoice', 'Client', 'Video', 'Issued', '#Amount', '#Paid', '#Pending', 'Status', ''], list.map(i => [esc(i.id), '<a href="#/clients/' + esc(i.clientId) + '">' + esc(user(i.clientId).fullName) + '</a>', videoLink(i.videoId), fmtDate(i.issuedAt), inr(i.amount), inr(i.paid), inr(i.pending), badge(invoiceStatus(i)), btn('View / print', 'a-invoice', { id: i.id })]),
        S().invoices.length ? 'No invoices match these filters.' : 'An invoice is issued automatically when a client submits a video.') +
        '<p class="muted">Payments are applied to a client\'s oldest invoice first.</p>');
  };

  SV.ACT['a-invoice'] = d => { const i = S().invoices.find(x => x.id === d.id), c = user(i.clientId); invoiceDialog({ inv: i, clientName: c.fullName, clientEmail: c.email, pay: S().settings }); };
  SV.SEARCH.SUPER_ADMIN = s => s.videos.map(v => ({ label: v.id + ' — ' + v.typeLabel, sub: 'Video · ' + label(v.status), keys: user(v.clientId).fullName, section: 'videos', id: v.id }))
    .concat(clients().map(c => ({ label: c.fullName, sub: 'Client', keys: c.email + ' ' + c.socialName, section: 'clients', id: c.id })))
    .concat(editors().map(e => ({ label: e.fullName, sub: 'Editor', keys: e.email, section: 'editors', id: e.id })));

  // ───────── Video Reviews ─────────
  V.reviews = () => {
    const s = S(), waiting = s.videos.filter(v => v.status === 'IN_REVIEW'), client = s.videos.filter(v => v.status === 'CLIENT_REVIEW');
    return panel('Waiting for your review (' + waiting.length + ')', table(['Video', 'Type', 'Editor', 'Submitted', 'Edited video', ''], waiting.map(v => [videoLink(v.id), esc(v.typeLabel), esc(user(v.editorId).fullName), fmtDateTime(v.submittedAt), ext(v.editedLink, 'Open link') + previewBtn(v.editedLink, 'Edited video — ' + v.id), videoActions(v, true)]), 'No edited videos are waiting for review.')) +
      panel('Waiting for the client\'s final approval (' + client.length + ')', table(['Video', 'Client', 'Approved by you', ''], client.map(v => [videoLink(v.id), esc(user(v.clientId).fullName), fmtDateTime(v.adminApprovedAt), '<a class="btn ghost small" href="#/videos/' + esc(v.id) + '">Open</a>']), 'Nothing is waiting on a client.')) +
      panel('Recent review history', table(['When', 'Video', 'By', 'Decision', 'Note'], s.reviews.slice().sort(byNewest('createdAt')).slice(0, 30).map(r => [fmtDateTime(r.createdAt), videoLink(r.videoId), esc(user(r.byUserId).fullName), esc(label(r.decision, { SUBMITTED: 'Submitted', APPROVED: 'Approved', REVISION: 'Revision requested', COMPLETED: 'Completed' })), esc(r.note || '—')]), 'No reviews yet.'));
  };

  // ───────── User Accounts ─────────
  V.accounts = () => {
    const q = (SV.F.accQ || '').toLowerCase(), role = SV.F.accRole || '', me = S().user.id;
    const pending = pendingUsers();
    const list = S().users.filter(u => u.status !== 'PENDING' && u.status !== 'REJECTED' && (!role || u.role === role) && (!q || (u.fullName + ' ' + u.email).toLowerCase().includes(q))).sort(byNewest('createdAt'));
    const open = u => (u.role === 'CLIENT' ? '<a class="btn ghost small" href="#/clients/' + esc(u.id) + '">View</a>' : u.role === 'EDITOR' ? '<a class="btn ghost small" href="#/editors/' + esc(u.id) + '">View</a>' : '');
    return '<div class="notice ok">People cannot register themselves. When someone contacts you, create their account here and send them the login details.</div>' +
      '<div class="toolbar">' + filterInput('accQ', 'Search by name or email') + filterSelect('accRole', [['', 'All account types'], ['CLIENT', 'Clients'], ['EDITOR', 'Editors'], ['SUPER_ADMIN', 'Super Admins']], 'Account type') + btn('Create account', 'a-account-add', {}, 'btn primary') + '</div>' +
      (pending.length ? panel('Earlier registrations waiting for a decision (' + pending.length + ')', table(['User', 'Role', 'Registered', ''], pending.map(u => [who(u, u.email), esc(label(u.role)), fmtDateTime(u.createdAt), '<div class="actions">' + btn('Approve', 'a-approve', { id: u.id }, 'btn primary small') + btn('Reject', 'a-reject', { id: u.id }) + '</div>']), '')) : '') +
      panel('Accounts (' + list.length + ')', table(['User', 'Account type', 'Status', 'Created', ''], list.map(u => [who(u, u.email), esc(label(u.role)), badge(u.status), fmtDate(u.createdAt),
        '<div class="actions">' + open(u) + (u.id === me ? '<span class="muted">You</span>' : btn('Reset password', 'a-reset-pw', { id: u.id }) + (u.status === 'ACTIVE' ? btn('Suspend', 'a-user-status', { id: u.id, status: 'SUSPENDED' }) : btn('Reactivate', 'a-user-status', { id: u.id, status: 'ACTIVE' }))) + '</div>']), 'No accounts match these filters.'));
  };
  SV.ACT['a-approve'] = d => {
    const u = user(d.id), isEditor = u.role === 'EDITOR';
    return openForm({ title: 'Approve ' + u.fullName, submit: 'Approve', intro: esc(label(u.role)) + ' · ' + esc(u.email), fields: isEditor ? payFields({}) : [], onSubmit: f => mutate('admin.decideUser', Object.assign({ userId: u.id, decision: 'APPROVE' }, f), u.fullName + ' approved.') });
  };
  SV.ACT['a-reject'] = async d => { const u = user(d.id); if (await confirmBox('Reject ' + u.fullName + '?', 'They will not be able to sign in.', 'Reject', true)) await mutate('admin.decideUser', { userId: d.id, decision: 'REJECT' }, 'Registration rejected.'); };

  // ───────── Pricings ─────────
  V.pricings = () => panel('Prices per video (INR)', '<form data-form="a-pricing" novalidate><div class="price-cards">' + S().pricings.map(p => '<label class="field"><span>' + esc(p.label) + '</span><input name="' + p.type + '" inputmode="decimal" value="' + esc(p.price || '') + '" placeholder="Not set" required>' +
    '<small>' + (p.price ? 'Last changed ' + fmtDateTime(p.updatedAt) : 'Clients cannot request this type until a price is set.') + '</small></label>').join('') + '</div>' +
    '<p class="muted">New prices show at once in Client → Pricings and in the Add Video form. Videos already submitted keep the price they were submitted at.</p><button class="btn primary" type="submit">Save prices</button></form>');
  SV.FORMS['a-pricing'] = async v => {
    for (const p of S().pricings) if (!/^\d+(\.\d{1,2})?$/.test(String(v[p.type]).trim()) || Number(v[p.type]) <= 0) throw new Error(p.label + ' needs a price greater than zero.');
    await mutate('admin.savePricing', { prices: v }, 'Prices saved.');
  };

  // ───────── Payment Requests ─────────
  V.payments = () => {
    const s = S(), tab = SV.F.payTab || 'client';
    const tabs = subtabs('payTab', [['client', 'Client payments to verify (' + pendingManual().length + ')'], ['editor', 'Editor payment requests (' + s.paymentRequests.filter(r => r.status === 'PENDING').length + ')'], ['payouts', 'Payout history']]);
    if (tab === 'client') {
      const list = s.manualPayments.slice().sort((a, b) => (a.status === 'PENDING_VERIFICATION' ? 0 : 1) - (b.status === 'PENDING_VERIFICATION' ? 0 : 1) || byNewest('submittedAt')(a, b));
      return tabs + '<div class="toolbar"><span class="muted grow">Received cash, a direct transfer or a cheque? Record it here and the client\'s balance updates at once.</span>' + btn('Record a payment received', 'a-record-pay', {}, 'btn primary') + '</div>' + panel('Manual payments submitted by clients', table(['Submitted', 'Client', 'Method', 'Reference', '#Amount', 'Status', ''], list.map(m => [fmtDateTime(m.submittedAt), '<a href="#/clients/' + esc(m.clientId) + '">' + esc(user(m.clientId).fullName) + '</a>', esc(label(m.method)), esc(m.reference) + (m.note ? '<br><small class="muted">' + esc(m.note) + '</small>' : ''), inr(m.amount),
        badge(m.status) + (m.decisionNote ? '<br><small class="muted">' + esc(m.decisionNote) + '</small>' : ''),
        m.status === 'PENDING_VERIFICATION' ? '<div class="actions">' + btn('Verify', 'a-mp', { id: m.id, decision: 'VERIFY' }, 'btn primary small') + btn('Reject', 'a-mp', { id: m.id, decision: 'REJECT' }) + '</div>' : '']), 'No manual payments have been submitted.') +
        '<p class="muted">Only a verified payment reduces the client\'s balance, and it is counted once.</p>');
    }
    if (tab === 'editor') {
      const order = { PENDING: 0, APPROVED: 1 };
      const list = s.paymentRequests.slice().sort((a, b) => (order[a.status] === undefined ? 2 : order[a.status]) - (order[b.status] === undefined ? 2 : order[b.status]) || byNewest('createdAt')(a, b));
      return tabs + panel('Payment requests from editors', table(['Request', 'Editor', 'Requested', '#Amount', '#Paid', '#Left', 'Status', ''], list.map(r => [esc(r.id), '<a href="#/editors/' + esc(r.editorId) + '">' + esc(user(r.editorId).fullName) + '</a>', fmtDateTime(r.createdAt), inr(r.amount), inr(r.paidAmount), inr(r.amount - r.paidAmount),
        badge(r.status) + (r.decisionNote ? '<br><small class="muted">' + esc(r.decisionNote) + '</small>' : ''),
        '<div class="actions">' + (r.status === 'PENDING' ? btn('Approve', 'a-req', { id: r.id, decision: 'APPROVE' }, 'btn primary small') + btn('Reject', 'a-req', { id: r.id, decision: 'REJECT' }) : '') +
        (r.status === 'APPROVED' ? btn('Record payout', 'a-payout', { id: r.id }, 'btn primary small') + (Number(r.paidAmount) > 0 ? btn('Close request', 'a-req-close', { id: r.id }) : '') : '') + '</div>']), 'No payment requests yet.'));
    }
    return tabs + panel('Payouts to editors', table(['Paid', 'Editor', 'Request', 'Reference', 'Note', '#Amount'], s.payouts.slice().sort(byNewest('paidAt')).map(p => [fmtDateTime(p.paidAt), esc(user(p.editorId).fullName), esc(p.requestId), esc(p.reference), esc(p.note || '—'), inr(p.amount)]), 'No payouts recorded yet.'));
  };
  SV.ACT['a-mp'] = d => {
    const m = S().manualPayments.find(x => x.id === d.id), verify = d.decision === 'VERIFY', c = user(m.clientId);
    return openForm({ title: (verify ? 'Verify' : 'Reject') + ' payment of ' + inr(m.amount), submit: verify ? 'Verify payment' : 'Reject payment', danger: !verify,
      intro: esc(c.fullName) + ' · ' + esc(label(m.method)) + ' · reference <strong>' + esc(m.reference) + '</strong>' + (verify ? '<br>Check your bank or UPI statement first. Outstanding balance now: ' + inr(c.ledger.pending) + '.' : ''),
      fields: [{ name: 'note', label: verify ? 'Note (optional)' : 'Reason (shown to the client)', required: !verify, max: 300 }],
      onSubmit: f => mutate('admin.decideManualPayment', { id: m.id, decision: d.decision, note: f.note }, verify ? 'Payment verified. The client\'s balance was updated.' : 'Payment rejected. The client was notified.') });
  };
  SV.ACT['a-req'] = d => {
    const r = S().paymentRequests.find(x => x.id === d.id), approve = d.decision === 'APPROVE';
    return openForm({ title: (approve ? 'Approve ' : 'Reject ') + r.id, submit: approve ? 'Approve request' : 'Reject request', danger: !approve, intro: esc(user(r.editorId).fullName) + ' requested ' + inr(r.amount) + '.' + (approve ? ' Approving does not record a payment — use Record payout after you pay.' : ''),
      fields: [{ name: 'note', label: approve ? 'Note (optional)' : 'Reason (shown to the Editor)', required: !approve, max: 300 }],
      onSubmit: f => mutate('admin.decidePaymentRequest', { id: r.id, decision: d.decision, note: f.note }, approve ? 'Request approved.' : 'Request rejected.') });
  };
  SV.ACT['a-payout'] = d => {
    const r = S().paymentRequests.find(x => x.id === d.id), left = Math.round((r.amount - r.paidAmount) * 100) / 100;
    return openForm({ title: 'Record payout on ' + r.id, submit: 'Record payout', intro: esc(user(r.editorId).fullName) + ' · left on this request: <strong>' + inr(left) + '</strong>. Enter less for a partial payout.',
      fields: [{ name: 'amount', label: 'Amount paid (INR)', type: 'money', required: true, value: left }, { name: 'reference', label: 'Payment reference', required: true, max: 60, help: 'UPI or bank transaction reference.' }, { name: 'note', label: 'Note', max: 300 }],
      validate: f => (Number(f.amount) > left ? 'The payout cannot be more than ' + inr(left) + '.' : ''),
      onSubmit: f => mutate('admin.recordPayout', { requestId: r.id, amount: f.amount, reference: f.reference, note: f.note }, 'Payout recorded. The Editor was notified.') });
  };
  SV.ACT['a-req-close'] = d => openForm({ title: 'Close ' + d.id, submit: 'Close request', intro: 'The unpaid part stays owed to the Editor, who can then raise a new request for it.', fields: [{ name: 'note', label: 'Reason', required: true, max: 300 }], onSubmit: f => mutate('admin.closePaymentRequest', { id: d.id, note: f.note }, 'Request closed.') });

  // ───────── Reports ─────────
  V.reports = () => {
    const s = S(), statuses = OPEN.concat(['COMPLETED']);
    return panel('Videos by status', table(['Status', '#Videos'], statuses.map(x => [badge(x), s.videos.filter(v => v.status === x).length]), '')) +
      panel('Videos by type', table(['Type', '#Videos', '#Billed'], Object.keys(s.videoTypes).map(k => [esc(s.videoTypes[k]), s.videos.filter(v => v.type === k).length, inr(sum(s.videos.filter(v => v.type === k), 'price'))]), '')) +
      panel('Editors', table(['Editor', 'Employment', '#Assigned', '#Completed', '#Earned', '#Paid', '#Owed'], editors().map(e => [esc(e.fullName), esc(label(e.employmentType)), s.videos.filter(v => v.editorId === e.id).length, s.videos.filter(v => v.editorId === e.id && v.status === 'COMPLETED').length, inr(e.ledger.earned), inr(e.ledger.received), inr(e.ledger.pending)]), 'No editors yet.')) +
      panel('Clients', table(['Client', '#Videos', '#Billed', '#Paid', '#Pending'], clients().map(c => [esc(c.fullName), s.videos.filter(v => v.clientId === c.id).length, inr(c.ledger.total), inr(c.ledger.paid), inr(c.ledger.pending)]), 'No clients yet.')) +
      panel('Export', '<div class="actions">' + btn('Videos (CSV)', 'a-csv', { what: 'videos' }, 'btn ghost') + btn('Client payments (CSV)', 'a-csv', { what: 'payments' }, 'btn ghost') + btn('Editor payouts (CSV)', 'a-csv', { what: 'payouts' }, 'btn ghost') + '</div>');
  };
  SV.ACT['a-csv'] = d => {
    const s = S();
    if (d.what === 'videos') SV.downloadCsv('sv-videos.csv', ['Video', 'Client', 'Type', 'Price', 'Status', 'Editor', 'Deadline', 'Submitted', 'Completed'], s.videos.map(v => [v.id, user(v.clientId).fullName, v.typeLabel, v.price, label(v.status), v.editorId ? user(v.editorId).fullName : '', v.deadline, v.createdAt, v.completedAt]));
    if (d.what === 'payments') SV.downloadCsv('sv-client-payments.csv', ['Payment', 'Client', 'Amount', 'Method', 'Reference', 'Received'], s.clientPayments.map(p => [p.id, user(p.clientId).fullName, p.amount, label(p.method), p.reference, p.receivedAt]));
    if (d.what === 'payouts') SV.downloadCsv('sv-editor-payouts.csv', ['Payout', 'Editor', 'Request', 'Amount', 'Reference', 'Paid'], s.payouts.map(p => [p.id, user(p.editorId).fullName, p.requestId, p.amount, p.reference, p.paidAt]));
    toast('Export downloaded.');
  };

  // ───────── Settings / Profile ─────────
  V.settings = () => {
    const st = S().settings, f = (name, text, max) => '<label class="field"><span>' + text + '</span><input name="' + name + '" maxlength="' + (max || 100) + '" value="' + esc(st[name]) + '"></label>';
    return panel('My profile', SV.profileForm('')) + SV.passwordPanel() +
      panel('Contact and payment details', '<form data-form="a-settings" novalidate><h4 style="margin-bottom:4px">How new clients reach you</h4><p class="muted" style="margin:0 0 12px">Shown on the public website when someone presses “Start a Project”. There is no self-registration: you create every account.</p><div class="grid2">' + f('contactEmail', 'Contact email') + f('contactWhatsapp', 'WhatsApp number (with country code)', 20) + f('contactPhone', 'Phone number', 20) + '</div><h4 style="margin:8px 0 12px">Manual payment details</h4><div class="grid2">' + f('upiId', 'UPI ID') + f('upiName', 'UPI payee name') + f('bankName', 'Bank name') + f('accountName', 'Account holder name') + f('accountNumber', 'Account number', 34) + f('ifsc', 'IFSC code', 15) + '</div>' +
        f('paymentNote', 'Note to clients (optional)', 300) + '<p class="muted">Signed-in clients see these under Payment → Manual Payment. Until a UPI ID or a bank account is entered, clients cannot submit manual payments.</p><button class="btn primary" type="submit">Save payment details</button></form>') +
      panel('Online payment gateway', S().online.enabled
        ? '<div class="notice ok">Razorpay keys are set on the server. Clients can pay online; each payment is confirmed with Razorpay before it counts.</div>'
        : '<div class="notice warn">Online payment is switched off because no gateway keys are set. Clients see it as unavailable and use manual payment.</div><p class="muted">To switch it on: create a Razorpay account, then in the Apps Script editor open Project Settings → Script Properties and add <code>RAZORPAY_KEY_ID</code> and <code>RAZORPAY_KEY_SECRET</code>. The keys never go into this website\'s files. See the README.</p>');
  };
  SV.FORMS['a-settings'] = v => mutate('admin.saveSettings', v, 'Contact and payment details saved.');
})(window.SV);

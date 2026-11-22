/* SV Workspace — Editor dashboard: Overview, My Videos, Payments, Notifications, Profile.
   The server never sends an Editor anything that identifies a client. */
(function (SV) {
  'use strict';
  const { dueChip, stepper, previewBtn, commentsBlock } = SV;
  const { esc, inr, fmtDate, fmtDateTime, today, byNewest, ext, label, badge, table, stat, panel, kv, btn, mutate, openForm, greeting, UNDERWAY, OPEN } = SV;

  SV.NAV.EDITOR = [['overview', 'Overview', 'home'], ['videos', 'My Videos', 'film'], ['payments', 'Payments', 'card'], ['notifications', 'Notifications', 'bell'], ['profile', 'Profile', 'user']];
  SV.OPEN_REF.EDITOR = n => (n.refType === 'video' ? ['videos', n.refId] : ['paymentRequest', 'payout', 'earning'].includes(n.refType) ? ['payments'] : n.refType === 'user' ? ['profile'] : null);

  const S = () => SV.S;
  const MINE = { CLIENT_REVIEW: 'Approved — Awaiting Final Approval' };
  const V = (SV.VIEWS.EDITOR = {});
  V.notifications = SV.notificationsView;

  V.overview = () => greeting(SV.chip(S().videos.filter(v => v.status === 'NOT_STARTED').length, 'new to start', 'videos') + SV.chip(S().videos.filter(v => v.status === 'REVISION').length, 'revisions requested', 'videos') + SV.chip(S().videos.filter(v => OPEN.includes(v.status) && v.deadline && v.deadline < today()).length, 'overdue', 'videos') + (S().ledger.pending > 0 ? '<a href="#/payments">' + inr(S().ledger.pending) + ' pending payment</a>' : '')) + '<div class="cards">' +
    stat('Total Assigned Videos', S().videos.length, 'videos') +
    stat('Currently In Progress', S().videos.filter(v => UNDERWAY.includes(v.status)).length, 'videos') +
    stat('Completed Videos', S().videos.filter(v => v.status === 'COMPLETED').length, 'videos') + '</div>' +
    panel('Upcoming deadlines', table(['Video', 'Type', 'Status', 'Deadline'], S().videos.filter(v => OPEN.includes(v.status) && v.deadline).sort((a, b) => a.deadline.localeCompare(b.deadline)).slice(0, 5).map(v => ['<a href="#/videos/' + esc(v.id) + '">' + esc(v.id) + '</a>', esc(v.typeLabel), badge(v.status, MINE), fmtDate(v.deadline) + ' ' + dueChip(v.deadline, v.status)]), 'Nothing is due. New assignments will show here.'));

  // ───────── My Videos ─────────
  V.videos = () => {
    const f = SV.F.eStatus || '', vids = S().videos.slice().sort((a, b) => (a.status === 'COMPLETED') - (b.status === 'COMPLETED') || String(a.deadline).localeCompare(String(b.deadline)));
    const list = vids.filter(v => !f || v.status === f);
    const item = v => {
      const late = v.deadline && v.deadline < today() && OPEN.includes(v.status);
      const actions = (v.status === 'NOT_STARTED' ? btn('Start editing', 'e-start', { id: v.id }, 'btn primary') : '') +
        (v.status === 'REVISION' || v.status === 'IN_PROGRESS' ? btn(v.editedLink ? 'Submit new edited video link' : 'Submit edited video link', 'e-submit', { id: v.id }, 'btn primary') : '');
      return '<div class="item' + (SV.route.id === v.id ? ' focus' : '') + '"><div class="item-head"><div><strong>' + esc(v.id) + ' — ' + esc(v.typeLabel) + '</strong></div><div>' + badge(v.status, MINE) + (late ? ' ' + badge('OVERDUE') : '') + '</div></div>' + stepper(v.status, ['Assigned', 'Editing', 'Studio review', 'Final approval', 'Completed']) +
        kv([['Video ID', esc(v.id)], ['Video Type', esc(v.typeLabel)], ['Raw Footage Link', ext(v.rawLink) + previewBtn(v.rawLink, 'Raw footage — ' + v.id)], ['Editing Remarks', '<span class="pre">' + esc(v.remarks) + '</span>'], ['Deadline', fmtDate(v.deadline) + ' ' + dueChip(v.deadline, v.status)],
          v.rate !== null ? ['Rate for this video', inr(v.rate)] : null, ['Edited Video Link', v.editedLink ? ext(v.editedLink) + (v.submittedAt ? ' <span class="muted">· submitted ' + fmtDateTime(v.submittedAt) + '</span>' : '') : 'Not submitted yet'],
          v.versions.length > 1 ? ['Versions', '<span class="versions">' + v.versions.map(x => '<a href="' + esc(x.link) + '" target="_blank" rel="noopener noreferrer">v' + x.n + ' · ' + fmtDate(x.at) + '</a>').join('') + '</span>'] : null]) +
        (v.revisionNote ? '<div class="notice warn" style="margin:12px 0 0"><strong>Revision requested:</strong> <span class="pre">' + esc(v.revisionNote) + '</span></div>' : '') +
        (actions ? '<div class="actions" style="margin-top:12px">' + actions + '</div>' : '') + commentsBlock(v.id) + '</div>';
    };
    return '<div class="toolbar">' + SV.filterSelect('eStatus', [['', 'All my videos']].concat(OPEN.concat(['COMPLETED']).map(x => [x, label(x, MINE)])), 'Filter by status') + '</div>' +
      (list.length ? '<div class="list">' + list.map(item).join('') + '</div>' : '<div class="empty">' + (vids.length ? 'No videos with this status.' : 'No videos have been assigned to you yet. You will be notified when one is.') + '</div>');
  };
  SV.ACT['e-start'] = d => mutate('editor.startVideo', { videoId: d.id }, d.id + ' is now In Progress.');
  SV.ACT['e-submit'] = d => openForm({
    title: 'Submit edited video for ' + d.id, submit: 'Submit for review', intro: 'Paste a Google Drive link (or another link) to the finished video. Make sure anyone with the link can view it.',
    fields: [{ name: 'link', label: 'Edited Video Link', type: 'url', required: true, max: 1000 }],
    onSubmit: v => mutate('editor.submitVideo', { videoId: d.id, link: v.link }, d.id + ' submitted. It is now In Review.')
  });

  SV.SEARCH.EDITOR = s => s.videos.map(v => ({ label: v.id + ' — ' + v.typeLabel, sub: 'Video · ' + label(v.status, MINE), keys: v.remarks, section: 'videos', id: v.id }));

  // ───────── Payments ─────────
  V.payments = () => {
    const s = S(), l = s.ledger, active = s.requests.find(r => r.id === l.activeRequestId);
    const why = active ? 'Request ' + active.id + ' is ' + label(active.status).toLowerCase() + '. You can request again once it is paid, rejected or closed.' : l.pending <= 0 ? 'You have no pending earnings to request.' : 'Requests your full pending amount of ' + inr(l.pending) + '.';
    return '<div class="cards">' + stat('Total Earnings', inr(l.earned)) + stat('Amount Received', inr(l.received)) + stat('Pending Payment', inr(l.pending)) + '</div>' +
      panel('Request Payment', '<p class="muted">' + esc(why) + '</p><div class="actions"><button type="button" class="btn primary" data-act="e-request"' + (active || l.pending <= 0 ? ' disabled' : '') + '>Request Payment</button></div>') +
      panel('My payment requests', table(['Request', 'Requested', '#Amount', '#Paid', 'Status'], s.requests.slice().sort(byNewest('createdAt')).map(r => [esc(r.id), fmtDateTime(r.createdAt), inr(r.amount), inr(r.paidAmount), badge(r.status) + (r.decisionNote ? '<br><small class="muted">' + esc(r.decisionNote) + '</small>' : '')]), 'You have not requested a payment yet.')) +
      panel('Payment History', table(['Paid', 'Payout', 'Request', 'Reference', '#Amount'], s.payouts.slice().sort(byNewest('paidAt')).map(p => [fmtDateTime(p.paidAt), esc(p.id), esc(p.requestId), esc(p.reference), inr(p.amount)]), 'No payouts yet.')) +
      panel('Earnings', table(['Added', 'Kind', 'For', '#Amount'], s.earnings.slice().sort(byNewest('createdAt')).map(e => [fmtDateTime(e.createdAt), esc(label(e.kind)), e.videoId ? '<a href="#/videos/' + esc(e.videoId) + '">' + esc(e.videoId) + '</a>' : esc(e.note), inr(e.amount)]), 'No earnings yet. Per-video earnings are added when the Super Admin approves your edit.'));
  };
  SV.ACT['e-request'] = async () => { const out = await mutate('editor.requestPayment', {}, ''); SV.toast('Payment request ' + out.id + ' for ' + inr(out.amount) + ' was sent to the Super Admin.'); };

  // ───────── Profile ─────────
  V.profile = () => {
    const e = S().editor, u = S().user;
    return panel('Profile', SV.profileForm('') + '<hr style="border:0;border-top:1px solid var(--line);margin:18px 0">' +
      kv([['Employment Type', esc(label(e.employmentType))], [e.employmentType === 'FULL_TIME' ? 'Monthly Salary' : 'Default Per-Video Rate', e.employmentType === 'FULL_TIME' ? inr(e.monthlySalary) : inr(e.perVideoRate)], ['Account Status', badge(u.status)]]) +
      '<p class="muted">Employment type, pay and account status are set by the Super Admin.</p>') + SV.passwordPanel();
  };
})(window.SV);

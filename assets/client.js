/* SV Workspace — Client dashboard: Overview, Status, Payment, Pricings, Notifications, Profile. */
(function (SV) {
  'use strict';
  const { dueChip, stepper, previewBtn, commentsBlock, invoiceDialog } = SV;
  const { esc, inr, fmtDate, fmtDateTime, byNewest, ext, label, badge, table, stat, panel, kv, btn, subtabs, toast, api, reload, mutate, openForm, confirmBox, greeting, UNDERWAY } = SV;

  SV.NAV.CLIENT = [['overview', 'Overview', 'home'], ['status', 'Status', 'film'], ['payment', 'Payment', 'card'], ['pricings', 'Pricings', 'tag'], ['notifications', 'Notifications', 'bell'], ['profile', 'Profile', 'user']];
  SV.OPEN_REF.CLIENT = n => (n.refType === 'video' ? ['status', n.refId] : n.refType === 'payment' ? ['payment'] : n.refType === 'user' ? ['profile'] : null);

  const S = () => SV.S;
  const STEPS = ['Submitted', 'Editing', 'Studio review', 'Your approval', 'Completed'];
  const MINE = { CLIENT_REVIEW: 'Awaiting Your Approval', REVISION: 'Being Revised' };
  const payable = () => Math.max(0, Math.round((S().ledger.pending - S().ledger.awaitingVerification) * 100) / 100);
  const V = (SV.VIEWS.CLIENT = {});
  V.notifications = SV.notificationsView;

  V.overview = () => greeting(SV.chip(S().videos.filter(v => v.status === 'CLIENT_REVIEW').length, 'waiting for your approval', 'status') + SV.chip(S().videos.filter(v => UNDERWAY.includes(v.status) && v.status !== 'CLIENT_REVIEW').length, 'being edited', 'status') + (S().ledger.pending > 0 ? '<a href="#/payment">' + inr(S().ledger.pending) + ' to pay</a>' : '')) + '<div class="cards">' +
    stat('Total Videos', S().videos.length, 'status') +
    stat('Currently In Progress', S().videos.filter(v => UNDERWAY.includes(v.status)).length, 'status', 'Being edited or reviewed') + '</div>' +
    panel('Latest videos', S().videos.length ? S().videos.slice().sort(byNewest('updatedAt')).slice(0, 3).map(v => '<div style="margin-bottom:6px"><div class="item-head" style="margin-bottom:0"><a href="#/status/' + esc(v.id) + '"><strong>' + esc(v.id) + ' — ' + esc(v.typeLabel) + '</strong></a>' + badge(v.status, MINE) + '</div>' + stepper(v.status, STEPS) + '</div>').join('') : '<div class="empty">Your videos will appear here once you submit one.</div>', btn('Add Video', 'c-add-video', {}, 'btn primary small'));

  // ───────── Status ─────────
  V.status = () => {
    const vids = S().videos.slice().sort(byNewest('createdAt')), f = SV.F.cStatus || '';
    const list = vids.filter(v => !f || (f === 'UNDERWAY' ? UNDERWAY.includes(v.status) : v.status === f));
    const item = v => '<div class="item' + (SV.route.id === v.id ? ' focus' : '') + '" id="video-' + esc(v.id) + '"><div class="item-head"><div><strong>' + esc(v.id) + ' — ' + esc(v.typeLabel) + '</strong><br><small class="muted">Submitted ' + fmtDateTime(v.createdAt) + '</small></div>' + badge(v.status, MINE) + '</div>' + stepper(v.status, STEPS) +
      kv([['Price', inr(v.price)], v.deadline && v.status !== 'COMPLETED' ? ['Expected delivery', fmtDate(v.deadline) + ' ' + dueChip(v.deadline, v.status).replace('Due ', 'Expected ').replace('Overdue by', 'Running late by')] : null, ['Raw footage', ext(v.rawLink)], ['Remarks', '<span class="pre">' + esc(v.remarks) + '</span>'],
        v.editedLink ? ['Edited video', ext(v.editedLink) + previewBtn(v.editedLink, 'Your video — ' + v.id)] : null, v.completedAt ? ['Completed', fmtDateTime(v.completedAt)] : null]) +
      (v.status === 'CLIENT_REVIEW' ? '<div class="notice ok" style="margin:12px 0 8px">Your video is ready. Watch it, then approve it or ask for changes.</div><div class="actions">' + btn('Approve video', 'c-approve', { id: v.id }, 'btn primary') + btn('Request changes', 'c-changes', { id: v.id }, 'btn ghost') + '</div>' : '') + commentsBlock(v.id) + '</div>';
    return '<div class="cards">' + stat('Completed Videos', vids.filter(v => v.status === 'COMPLETED').length) + stat('In Progress Videos', vids.filter(v => UNDERWAY.includes(v.status)).length) + '</div>' +
      '<div class="toolbar">' + SV.filterSelect('cStatus', [['', 'All videos'], ['NOT_STARTED', 'Not Started'], ['UNDERWAY', 'In Progress'], ['CLIENT_REVIEW', 'Awaiting Your Approval'], ['COMPLETED', 'Completed']], 'Filter by status') + '<span class="grow"></span>' + btn('Add Video', 'c-add-video', {}, 'btn primary') + '</div>' +
      (list.length ? '<div class="list">' + list.map(item).join('') + '</div>' : '<div class="empty">' + (vids.length ? 'No videos with this status.' : 'You have not submitted a video yet. Press Add Video to send your first one.') + '</div>');
  };
  SV.ACT['c-add-video'] = () => {
    const prices = S().pricings, priceOf = t => { const p = prices.find(x => x.type === t); return p && p.price > 0 ? inr(p.price) : 'Not available yet'; };
    return openForm({
      title: 'Add Video', submit: 'Submit Video',
      fields: [
        { name: 'type', label: 'Video Type', type: 'select', required: true, options: [['', 'Choose a video type…']].concat(prices.map(p => [p.type, p.label])) },
        { name: 'price', label: 'Price', readonly: true, compute: v => (v.type ? priceOf(v.type) : ''), help: 'Set by SV Workspace. It is saved with your video and does not change later.' },
        { name: 'rawLink', label: 'Raw Footage', type: 'url', required: true, max: 1000, help: 'Paste a Google Drive link (or another link) that SV Workspace can open.' },
        { name: 'remarks', label: 'Remarks', type: 'textarea', required: true, help: 'Your editing instructions.' }
      ],
      validate: v => { const p = prices.find(x => x.type === v.type); return p && p.price > 0 ? '' : 'This video type has no price yet. Please choose another type or contact SV Workspace.'; },
      onSubmit: async v => { const out = await api('client.addVideo', { type: v.type, rawLink: v.rawLink, remarks: v.remarks }); SV.F.cStatus = ''; await reload(); toast(out.id + ' submitted at ' + inr(out.price) + '.'); SV.go('status', out.id); }
    });
  };
  SV.ACT['c-approve'] = async d => { if (await confirmBox('Approve ' + d.id + '?', 'This is your final approval. The video will be marked Completed.', 'Approve video')) await mutate('client.videoDecision', { videoId: d.id, decision: 'APPROVE' }, d.id + ' is completed. Thank you!'); };
  SV.ACT['c-changes'] = d => openForm({ title: 'Request changes on ' + d.id, submit: 'Send request', fields: [{ name: 'note', label: 'What should be changed', type: 'textarea', required: true }], onSubmit: v => mutate('client.videoDecision', { videoId: d.id, decision: 'REVISION', note: v.note }, 'Your change request was sent.') });

  // ───────── Payment ─────────
  V.payment = () => {
    const s = S(), l = s.ledger, pd = s.paymentDetails, can = payable();
    const hasManual = !!(pd.upiId || pd.accountNumber);
    const details = hasManual ? kv([pd.upiId ? ['UPI ID', '<strong>' + esc(pd.upiId) + '</strong>' + (pd.upiName ? ' (' + esc(pd.upiName) + ')' : '')] : null, pd.accountNumber ? ['Bank account', esc(pd.accountName) + '<br>' + esc(pd.bankName) + '<br>A/c <strong>' + esc(pd.accountNumber) + '</strong> · IFSC <strong>' + esc(pd.ifsc) + '</strong>'] : null, pd.paymentNote ? ['Note', esc(pd.paymentNote)] : null])
      : '<div class="notice warn">SV Workspace has not added its UPI or bank details yet, so manual payments cannot be submitted. Please contact SV Workspace.</div>';
    const nothing = can <= 0 ? '<p class="muted">' + (l.pending > 0 ? 'Your whole balance is already covered by payments awaiting verification.' : 'You have nothing to pay right now.') + '</p>' : '';
    const online = s.online.enabled
      ? '<p class="muted">Pay securely by card, UPI or net banking through Razorpay. The payment counts once Razorpay confirms it.</p>' + nothing + '<div class="actions">' + btn('Pay full balance ' + inr(can), 'c-pay-online', { amount: can }, 'btn primary') + btn('Pay another amount', 'c-pay-online', {}, 'btn ghost') + '</div>'
      : '<div class="notice warn">Online payment is not available yet — SV Workspace has not connected a payment gateway. Please use Manual Payment below.</div><div class="actions"><button type="button" class="btn primary" disabled>Pay online</button></div>';
    const history = s.payments.map(p => ({ at: p.receivedAt, text: label(p.method), ref: p.reference, amount: p.amount, status: 'VERIFIED', note: '', source: p.sourceId }))
      .concat(s.submissions.filter(m => m.status !== 'VERIFIED').map(m => ({ at: m.submittedAt, text: label(m.method), ref: m.reference, amount: m.amount, status: m.status, note: m.decisionNote })))
      .sort(byNewest('at'));
    return '<div class="cards">' + stat('Total Amount', inr(l.total)) + stat('Amount Paid', inr(l.paid)) + stat('Pending Amount', inr(l.pending)) + (l.awaitingVerification > 0 ? stat('Awaiting Verification', inr(l.awaitingVerification), '', 'Not yet deducted') : '') + '</div>' +
      '<div class="cols">' + panel('Online Payment', online) +
      panel('Manual Payment', '<p class="muted">Pay by UPI or bank transfer, then submit the transaction reference. SV Workspace verifies it before your balance changes.</p>' + details + (hasManual ? nothing + '<div class="actions" style="margin-top:12px">' + '<button type="button" class="btn primary" data-act="c-pay-manual"' + (can > 0 ? '' : ' disabled') + '>Submit payment details</button></div>' : '')) + '</div>' +
      panel('Video-wise payment details', table(['Video', 'Invoice', 'Issued', '#Amount', '#Paid', '#Pending', ''], l.invoices.map(i => ['<a href="#/status/' + esc(i.videoId) + '">' + esc(i.videoId) + '</a>', esc(i.id), fmtDate(i.issuedAt), inr(i.amount), inr(i.paid), inr(i.pending), btn('Invoice', 'c-invoice', { id: i.id })]), 'No videos yet, so nothing to pay.') + '<p class="muted">Payments are applied to your oldest video first.</p>') +
      panel('Payment history', table(['Date', 'Method', 'Reference', '#Amount', 'Status'], history.map(h => [fmtDateTime(h.at), esc(h.text), esc(h.ref), inr(h.amount), badge(h.status) + (h.note ? '<br><small class="muted">' + esc(h.note) + '</small>' : '')]), 'No payments yet.'));
  };
  SV.ACT['c-invoice'] = d => invoiceDialog({ inv: S().ledger.invoices.find(x => x.id === d.id), clientName: S().user.fullName, clientEmail: S().user.email, pay: S().paymentDetails });
  SV.SEARCH.CLIENT = s => s.videos.map(v => ({ label: v.id + ' — ' + v.typeLabel, sub: 'Video · ' + label(v.status, MINE), keys: v.remarks, section: 'status', id: v.id }));
  const amountProblem = v => (Number(v.amount) > payable() ? 'The amount cannot be more than ' + inr(payable()) + '.' : '');
  SV.ACT['c-pay-manual'] = () => openForm({
    title: 'Submit manual payment', submit: 'Submit for verification', intro: 'Enter the payment you have already made. You can pay part of your balance.',
    fields: [{ name: 'amount', label: 'Amount paid (INR)', type: 'money', required: true, value: payable(), help: 'Up to ' + inr(payable()) + '.' },
      { name: 'method', label: 'Paid by', type: 'select', required: true, options: [['UPI', 'UPI'], ['BANK', 'Bank transfer']] },
      { name: 'reference', label: 'Transaction reference', required: true, max: 60, help: 'The UTR / reference number shown in your UPI or bank app.' }, { name: 'note', label: 'Note (optional)', max: 300 }],
    validate: v => amountProblem(v) || (v.reference.length < 4 ? 'Enter the full transaction reference.' : ''),
    onSubmit: v => mutate('client.submitManualPayment', v, 'Payment submitted. It shows as Pending Verification until SV Workspace verifies it.')
  });
  const loadScript = src => new Promise((resolve, reject) => { if (window.Razorpay) return resolve(); const el = document.createElement('script'); el.src = src; el.onload = resolve; el.onerror = () => reject(new Error('The payment window could not be loaded. Check your connection.')); document.head.appendChild(el); });
  async function payOnline(amount) {
    const order = await api('client.createOnlineOrder', { amount: amount });
    await loadScript('https://checkout.razorpay.com/v1/checkout.js');
    await new Promise((resolve, reject) => {
      new window.Razorpay({
        key: order.keyId, order_id: order.orderId, amount: Math.round(order.amount * 100), currency: 'INR', name: 'SV Workspace', description: 'Video editing', theme: { color: '#64805a' },
        prefill: { name: S().user.fullName, email: S().user.email },
        handler: r => api('client.verifyOnlinePayment', { orderId: r.razorpay_order_id, paymentId: r.razorpay_payment_id, signature: r.razorpay_signature }).then(resolve, reject),
        modal: { ondismiss: () => reject(new Error('The payment window was closed. Nothing was recorded.')) }
      }).open();
    });
    await reload();
    toast('Payment of ' + inr(order.amount) + ' received.');
  }
  SV.ACT['c-pay-online'] = d => {
    if (payable() <= 0) { toast('There is nothing to pay right now.', 'error'); return; }
    if (d.amount) return payOnline(String(d.amount));
    let chosen = '';
    return openForm({ title: 'Pay another amount', submit: 'Continue to payment', fields: [{ name: 'amount', label: 'Amount (INR)', type: 'money', required: true, help: 'More than zero, up to ' + inr(payable()) + '.' }], validate: amountProblem, onSubmit: async v => { chosen = v.amount; } })
      .then(ok => (ok ? payOnline(chosen) : null));
  };

  // ───────── Pricings (view only) ─────────
  V.pricings = () => '<div class="price-cards">' + S().pricings.map(p => '<div class="price-card"><strong>' + esc(p.label) + '</strong><div class="amount">' + (p.price > 0 ? inr(p.price) : '—') + '</div><span class="muted">' + (p.price > 0 ? 'per video' : 'Price not set yet') + '</span></div>').join('') + '</div>' +
    '<p class="muted" style="margin-top:14px">Prices are set by SV Workspace. The price shown when you submit a video is the price you pay for it.</p>';

  // ───────── Profile ─────────
  V.profile = () => {
    const ch = S().channels;
    return panel('Profile', SV.profileForm('<label class="field"><span>Social Media Name</span><input name="socialName" maxlength="80" value="' + esc(S().profile.socialName) + '"></label>')) +
      panel('Your Channels', table(['Platform', 'Channel / Page Name', 'Channel / Page Link', ''], ch.map(c => [esc(label(c.platform)), esc(c.name), ext(c.link), '<div class="actions">' + btn('Edit', 'c-channel', { id: c.id }) + btn('Remove', 'c-channel-del', { id: c.id }) + '</div>']), 'No channels added yet.'), btn('Add Your Channels', 'c-channel', {}, 'btn primary')) +
      SV.passwordPanel();
  };
  SV.ACT['c-channel'] = d => {
    const c = S().channels.find(x => x.id === d.id) || {};
    return openForm({ title: c.id ? 'Edit channel' : 'Add Your Channels', submit: c.id ? 'Save channel' : 'Add channel',
      fields: [{ name: 'platform', label: 'Platform', type: 'select', required: true, value: c.platform, options: [['YOUTUBE', 'YouTube Channel'], ['INSTAGRAM', 'Instagram Page']] },
        { name: 'name', label: 'Channel / Page Name', required: true, max: 100, value: c.name }, { name: 'link', label: 'Channel / Page Link', type: 'url', required: true, max: 1000, value: c.link }],
      onSubmit: v => mutate('client.saveChannel', Object.assign({ id: c.id || '' }, v), c.id ? 'Channel saved.' : 'Channel added.') });
  };
  SV.ACT['c-channel-del'] = async d => { const c = S().channels.find(x => x.id === d.id); if (c && await confirmBox('Remove ' + c.name + '?', 'The channel is removed from your profile.', 'Remove', true)) await mutate('client.deleteChannel', { id: d.id }, 'Channel removed.'); };
})(window.SV);

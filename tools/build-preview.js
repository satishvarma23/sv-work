/**
 * Builds preview.html: ONE file you can open by double-click, with no server and no Google account.
 * It contains the same frontend and the same backend/Code.gs; the backend runs inside the page
 * against a stand-in for Google Sheets kept in this browser's localStorage.
 *
 *   node tools/build-preview.js
 *
 * It is for checking the site. It is not what you publish: the real site is index.html + assets/.
 */
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
const inline = s => s.replace(/<\/script/gi, '<\\/script');

const runtime = `
(function () {
  'use strict';
  var STORE = 'sv_workspace_preview_db', PREVIEW_URL = 'sv-preview://api';

  // ── SHA-256 / HMAC (synchronous, because Apps Script's Utilities is synchronous) ──
  var K = new Uint32Array([0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2]);
  function sha256(bytes) {
    var h = new Uint32Array([0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19]);
    var len = bytes.length, total = ((len + 9 + 63) >> 6) << 6, m = new Uint8Array(total), w = new Uint32Array(64), view = new DataView(m.buffer);
    m.set(bytes); m[len] = 0x80;
    view.setUint32(total - 8, Math.floor(len / 0x20000000)); view.setUint32(total - 4, (len << 3) >>> 0);
    for (var o = 0; o < total; o += 64) {
      for (var i = 0; i < 16; i++) w[i] = view.getUint32(o + i * 4);
      for (i = 16; i < 64; i++) {
        var a15 = w[i - 15], a2 = w[i - 2];
        var s0 = ((a15 >>> 7) | (a15 << 25)) ^ ((a15 >>> 18) | (a15 << 14)) ^ (a15 >>> 3);
        var s1 = ((a2 >>> 17) | (a2 << 15)) ^ ((a2 >>> 19) | (a2 << 13)) ^ (a2 >>> 10);
        w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
      }
      var a = h[0], b = h[1], c = h[2], d = h[3], e = h[4], f = h[5], g = h[6], hh = h[7];
      for (i = 0; i < 64; i++) {
        var S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
        var t1 = (hh + S1 + ((e & f) ^ (~e & g)) + K[i] + w[i]) >>> 0;
        var S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
        var t2 = (S0 + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
        hh = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
      }
      h[0] += a; h[1] += b; h[2] += c; h[3] += d; h[4] += e; h[5] += f; h[6] += g; h[7] += hh;
    }
    var out = new Uint8Array(32), ov = new DataView(out.buffer);
    for (i = 0; i < 8; i++) ov.setUint32(i * 4, h[i]);
    return out;
  }
  function hmac(key, msg) {
    if (key.length > 64) key = sha256(key);
    var ipad = new Uint8Array(64 + msg.length), opad = new Uint8Array(96);
    for (var i = 0; i < 64; i++) { var k = key[i] || 0; ipad[i] = k ^ 0x36; opad[i] = k ^ 0x5c; }
    ipad.set(msg, 64); opad.set(sha256(ipad), 64);
    return sha256(opad);
  }
  var enc = new TextEncoder();
  var unsigned = function (v) { return typeof v === 'string' ? enc.encode(v) : Uint8Array.from(v, function (b) { return (b + 256) % 256; }); };
  var signed = function (u) { return Array.from(u, function (b) { return b > 127 ? b - 256 : b; }); };
  function uuid() {
    var b = crypto.getRandomValues(new Uint8Array(16)); b[6] = (b[6] & 15) | 64; b[8] = (b[8] & 63) | 128;
    var h = Array.from(b, function (x) { return ('0' + x.toString(16)).slice(-2); }).join('');
    return h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-' + h.slice(16, 20) + '-' + h.slice(20);
  }

  // ── a stand-in for the Google Sheet ──
  function Sheet(data) { this.data = data || []; this.maxRows = Math.max(1000, this.data.length); }
  Sheet.prototype = {
    getMaxRows: function () { return this.maxRows; }, getMaxColumns: function () { return 26; },
    insertRowsAfter: function (a, n) { this.maxRows += n; }, setFrozenRows: function () {},
    getLastRow: function () { return this.data.length; },
    getLastColumn: function () { return this.data.reduce(function (m, r) { return Math.max(m, r.length); }, 0); },
    getDataRange: function () { return this.getRange(1, 1, Math.max(1, this.getLastRow()), Math.max(1, this.getLastColumn())); },
    deleteRow: function (n) { this.data.splice(n - 1, 1); },
    getRange: function (row, col, nr, nc) {
      var sh = this; nr = nr || 1; nc = nc || 1;
      return {
        setNumberFormat: function () { return this; },
        getValues: function () { var out = []; for (var r = 0; r < nr; r++) { var line = []; for (var c = 0; c < nc; c++) { var v = (sh.data[row - 1 + r] || [])[col - 1 + c]; line.push(v === undefined ? '' : v); } out.push(line); } return out; },
        setValues: function (vals) {
          for (var r = 0; r < nr; r++) {
            while (sh.data.length < row + r) sh.data.push([]);
            var line = sh.data[row - 1 + r];
            for (var c = 0; c < nc; c++) { while (line.length < col + c) line.push(''); line[col - 1 + c] = vals[r][c] === null || vals[r][c] === undefined ? '' : String(vals[r][c]); }
          }
          return this;
        }
      };
    }
  };
  var sheets = {};
  try { var saved = JSON.parse(localStorage.getItem(STORE) || 'null'); if (saved) Object.keys(saved).forEach(function (k) { sheets[k] = new Sheet(saved[k]); }); } catch (e) { /* start empty */ }
  function persist() {
    var dump = {}; Object.keys(sheets).forEach(function (k) { dump[k] = sheets[k].data; });
    try { localStorage.setItem(STORE, JSON.stringify(dump)); } catch (e) { console.warn('Preview data could not be saved in this browser; it lasts until you close the page.'); }
  }
  var spreadsheet = { getSheetByName: function (n) { return sheets[n] || null; }, insertSheet: function (n) { return (sheets[n] = new Sheet()); } };
  var services = {
    SpreadsheetApp: { getActiveSpreadsheet: function () { return spreadsheet; }, openById: function () { return spreadsheet; } },
    LockService: { getScriptLock: function () { return { waitLock: function () {}, releaseLock: function () {} }; } },
    PropertiesService: { getScriptProperties: function () { return { getProperty: function () { return null; } }; } }, // no gateway keys: online payment stays off
    ContentService: { MimeType: { JSON: 'JSON' }, createTextOutput: function (s) { return { setMimeType: function () { return this; }, getContent: function () { return s; } }; } },
    UrlFetchApp: { fetch: function () { throw new Error('The preview has no network access.'); } },
    Utilities: {
      DigestAlgorithm: { SHA_256: 'sha256' }, Charset: { UTF_8: 'utf8' }, getUuid: uuid,
      base64Encode: function (s) { return btoa(unescape(encodeURIComponent(String(s)))); },
      computeDigest: function (alg, value) { return signed(sha256(unsigned(value))); },
      computeHmacSha256Signature: function (value, key) { return signed(hmac(unsigned(key), unsigned(value))); }
    }
  };

  // ── backend/Code.gs, unchanged ──
  var backend = (function (SpreadsheetApp, LockService, PropertiesService, ContentService, UrlFetchApp, Utilities) {
/*__CODE_GS__*/
    return { doPost: doPost, setup: setup };
  })(services.SpreadsheetApp, services.LockService, services.PropertiesService, services.ContentService, services.UrlFetchApp, services.Utilities);
  backend.setup(); persist();

  // A realistic studio, created through the same backend actions a person would use.
  function seedSample() {
    Object.keys(sheets).forEach(function (k) { delete sheets[k]; });
    backend.setup();
    var call = function (action, payload, token) {
      var out = JSON.parse(backend.doPost({ postData: { contents: JSON.stringify({ action: action, payload: payload, token: token }) } }).getContent());
      if (!out.ok) throw new Error(action + ': ' + out.error);
      return out.data;
    };
    var PW = 'demo1234', day = function (n) { var d = new Date(Date.now() + n * 86400000); return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); };
    call('register', { role: 'SUPER_ADMIN', fullName: 'Sai Varma', email: 'admin@demo.sv', password: PW });
    var admin = call('login', { email: 'admin@demo.sv', password: PW }).token;
    var id = {};
    [{ role: 'CLIENT', fullName: 'Chitra Rao', email: 'client@demo.sv', socialName: 'chitra.creates' }, { role: 'CLIENT', fullName: 'Dev Malhotra', email: 'dev@demo.sv', socialName: 'devtalks' }, { role: 'CLIENT', fullName: 'Anika Shah', email: 'anika@demo.sv', socialName: 'anika.eats' },
      { role: 'EDITOR', fullName: 'Farid Khan', email: 'editor@demo.sv', employmentType: 'FREELANCE', perVideoRate: '600' }, { role: 'EDITOR', fullName: 'Meera Iyer', email: 'meera@demo.sv', employmentType: 'FULL_TIME', monthlySalary: '32000' }]
      .forEach(function (u) { u.password = PW; id[u.email] = call('admin.createUser', u, admin).id; });
    call('admin.savePricing', { prices: { REEL: '1500', LONG: '6000', BRAND: '9000' } }, admin);
    call('admin.saveSettings', { contactEmail: 'hello@svworkspace.example', contactWhatsapp: '+91 98765 43210', upiId: 'svworkspace@upi', upiName: 'SV Workspace', bankName: 'HDFC Bank', accountName: 'SV Workspace', accountNumber: '50100234567890', ifsc: 'HDFC0001234' }, admin);
    var tok = function (e) { return call('login', { email: e, password: PW }).token; };
    var c = tok('client@demo.sv'), d = tok('dev@demo.sv'), a = tok('anika@demo.sv'), f = tok('editor@demo.sv'), m = tok('meera@demo.sv');
    var add = function (t, type, remarks) { return call('client.addVideo', { type: type, rawLink: 'https://drive.google.com/file/d/1SampleRawFootage', remarks: remarks }, t).id; };
    var v1 = add(c, 'REEL', 'Cut the pauses, add captions and upbeat music'), v2 = add(c, 'LONG', 'Full vlog edit with chapters and b-roll'), v3 = add(d, 'BRAND', 'Product launch film, 45 seconds, logo sting at the end');
    var v4 = add(d, 'REEL', 'Podcast highlight with subtitles'), v5 = add(a, 'REEL', 'Recipe reel, fast cuts, on-screen ingredients'), v6 = add(a, 'LONG', 'Restaurant tour, warm colour grade'), v7 = add(c, 'REEL', 'Behind the scenes montage');
    var assign = function (v, editor, n, rate) { call('admin.assignVideo', { videoId: v, editorId: id[editor], deadline: day(n), rate: rate || '' }, admin); };
    assign(v1, 'editor@demo.sv', 2); assign(v2, 'meera@demo.sv', 6); assign(v3, 'editor@demo.sv', -1, '1500'); assign(v4, 'meera@demo.sv', 1); assign(v5, 'editor@demo.sv', 4); assign(v6, 'meera@demo.sv', 9);
    var submit = function (v, t, link) { call('editor.startVideo', { videoId: v }, t); call('editor.submitVideo', { videoId: v, link: 'https://drive.google.com/file/d/' + link }, t); };
    submit(v1, f, '1SampleFinalCutA'); call('admin.reviewVideo', { videoId: v1, decision: 'APPROVE' }, admin);
    call('editor.startVideo', { videoId: v2 }, m);
    submit(v3, f, '1SampleBrandFilm');
    submit(v4, m, '1SamplePodcastCut'); call('admin.reviewVideo', { videoId: v4, decision: 'APPROVE' }, admin); call('client.videoDecision', { videoId: v4, decision: 'APPROVE' }, d);
    submit(v5, f, '1SampleRecipeV1'); call('admin.reviewVideo', { videoId: v5, decision: 'REVISION', note: 'Ingredient text is too small on mobile. Make it larger and hold it longer.' }, admin);
    call('video.comment', { videoId: v1, text: 'Love it! Can the logo stay a second longer?', timecode: '0:12' }, c);
    call('video.comment', { videoId: v1, text: 'Sure — we will extend it in the final export.', audience: 'ALL' }, admin);
    call('video.comment', { videoId: v3, text: 'Check the audio dip here before I approve.', timecode: '0:31', audience: 'INTERNAL' }, admin);
    var pay = function (t, amount, method, ref, verify) { var p = call('client.submitManualPayment', { amount: amount, method: method, reference: ref }, t); if (verify) call('admin.decideManualPayment', { id: p.id, decision: 'VERIFY' }, admin); };
    pay(c, '6000', 'UPI', 'UTR40218876', true); pay(d, '10500', 'BANK', 'NEFT77120934', true); pay(a, '1500', 'UPI', 'UTR40991122', false);
    call('admin.recordClientPayment', { clientId: id['anika@demo.sv'], amount: '3000', method: 'CASH', reference: 'Cash receipt 021', date: day(0), note: 'Paid at the studio' }, admin);
    call('admin.generateSalary', { editorId: id['meera@demo.sv'], month: day(0).slice(0, 7) }, admin);
    call('editor.requestPayment', {}, f);
    call('client.saveChannel', { platform: 'YOUTUBE', name: 'Chitra Creates', link: 'https://youtube.com/@chitracreates' }, c);
    call('client.saveChannel', { platform: 'INSTAGRAM', name: 'chitra.creates', link: 'https://instagram.com/chitra.creates' }, c);
    call('admin.saveExpense', { date: day(-3), category: 'Software', description: 'Editing suite subscription', amount: '4200' }, admin);
    persist();
    localStorage.setItem(STORE + '_sample', '1');
    localStorage.setItem('sv_workspace_token', admin);
  }

  // The frontend's fetch() to the backend address is answered here instead of by Google.
  var realFetch = window.fetch ? window.fetch.bind(window) : null;
  window.fetch = function (url, options) {
    if (url !== PREVIEW_URL) return realFetch(url, options);
    return new Promise(function (resolve) {
      setTimeout(function () {
        var text = backend.doPost({ postData: { contents: options.body } }).getContent();
        persist();
        resolve({ ok: true, status: 200, json: function () { return Promise.resolve(JSON.parse(text)); } });
      }, 250); // a short wait, so loading states can be seen
    });
  };
  window.SV_CONFIG = { API_URL: PREVIEW_URL };

  document.addEventListener('DOMContentLoaded', function () {
    var bar = document.createElement('div');
    bar.setAttribute('style', 'position:fixed;left:50%;bottom:10px;transform:translateX(-50%);z-index:40;background:#071b30;color:#fff;border:1px solid #1d688d;font:13px/1.3 Segoe UI,system-ui,sans-serif;padding:7px 12px;border-radius:999px;box-shadow:0 4px 14px rgba(0,0,0,.25);white-space:nowrap;max-width:calc(100vw - 20px);overflow:hidden;text-overflow:ellipsis');
    bar.innerHTML = 'Preview · <a href="#" id="sv-preview-seed" style="color:#20d9eb;font-weight:700">Load sample studio</a> · <a href="#" id="sv-preview-reset" style="color:#bfd9e9">Erase data</a>' + (localStorage.getItem(STORE + '_sample') ? ' · sample logins: admin@demo.sv, client@demo.sv, editor@demo.sv — password demo1234' : '');
    bar.querySelector('#sv-preview-seed').addEventListener('click', function (e) {
      e.preventDefault();
      if (!confirm('Replace the preview data in this browser with a sample studio?')) return;
      try { seedSample(); } catch (err) { alert('The sample could not be loaded: ' + err.message); return; }
      location.hash = '#/overview'; location.reload();
    });
    document.body.appendChild(bar);
    document.getElementById('sv-preview-reset').addEventListener('click', function (e) {
      e.preventDefault();
      if (!confirm('Erase all preview data in this browser and start again?')) return;
      localStorage.removeItem(STORE); localStorage.removeItem(STORE + '_sample'); localStorage.removeItem('sv_workspace_token'); location.hash = ''; location.reload();
    });
  });
})();
`;

let html = read('index.html');
html = html.replace(/<title>[^<]*<\/title>/, '<title>SV Workspace — preview</title>');
html = html.replace('<link rel="stylesheet" href="assets/app.css">', () => '<style>\n' + read('assets/app.css') + '\n</style>');
html = html.replace('<link rel="stylesheet" href="assets/landing.css">', () => '<style>\n' + read('assets/landing.css') + '\n</style>');
html = html.replace('<script src="assets/config.js"></script>', () => '<script>' + inline(runtime.replace('/*__CODE_GS__*/', () => read('backend/Code.gs'))) + '</script>');
for (const f of ['core', 'landing', 'admin', 'client', 'editor']) html = html.replace('<script src="assets/' + f + '.js"></script>', () => '<script>\n' + inline(read('assets/' + f + '.js')) + '\n</script>');
if (/src="assets\/|href="assets\//.test(html)) throw new Error('Something was not inlined.');
fs.writeFileSync(path.join(root, 'preview.html'), html);
console.log('preview.html written (' + Math.round(html.length / 1024) + ' KB)');

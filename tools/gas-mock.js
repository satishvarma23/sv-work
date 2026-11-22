/**
 * Runs backend/Code.gs unchanged under Node, against an in-memory stand-in for
 * Google Sheets and the Apps Script services it uses. Used by the tests and by
 * the local dev server. It is NOT part of the deployed site.
 */
const vm = require('vm');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const signed = buf => Array.from(buf, b => (b > 127 ? b - 256 : b));
const unsigned = v => (typeof v === 'string' ? Buffer.from(v, 'utf8') : Buffer.from(v.map(b => (b + 256) % 256)));

class Sheet {
  constructor(name, data) { this.name = name; this.data = data || []; }
  _cell(v) {
    const s = v === null || v === undefined ? '' : String(v);
    if (s.length > 50000) throw new Error('Your input contains more than the maximum of 50000 characters in a single cell.');
    return s;
  }
  getMaxRows() { return this.maxRows || (this.maxRows = Math.max(5, this.data.length)); } // small on purpose: exercises row growth
  insertRowsAfter(after, n) { this.maxRows = this.getMaxRows() + n; }
  getMaxColumns() { return 26; }
  getLastRow() { return this.data.length; }
  getLastColumn() { return this.data.reduce((m, r) => Math.max(m, r.length), 0); }
  setFrozenRows() {}
  getDataRange() { return this.getRange(1, 1, Math.max(1, this.getLastRow()), Math.max(1, this.getLastColumn())); }
  getRange(row, col, nr = 1, nc = 1) {
    const sh = this;
    if (row + nr - 1 > sh.getMaxRows()) throw new Error('The coordinates of the range are outside the dimensions of the sheet.');
    return {
      setNumberFormat() { return this; },
      getValues() {
        const out = [];
        for (let r = 0; r < nr; r++) { const line = []; for (let c = 0; c < nc; c++) line.push((sh.data[row - 1 + r] || [])[col - 1 + c] ?? ''); out.push(line); }
        return out;
      },
      setValues(vals) {
        if (vals.length !== nr || vals.some(v => v.length !== nc)) throw new Error('The number of rows or columns in the data does not match the range.');
        for (let r = 0; r < nr; r++) {
          while (sh.data.length < row + r) sh.data.push([]);
          const line = sh.data[row - 1 + r];
          for (let c = 0; c < nc; c++) { while (line.length < col + c) line.push(''); line[col - 1 + c] = sh._cell(vals[r][c]); }
        }
        return this;
      }
    };
  }
  appendRow(arr) { this.data.push(arr.map(v => this._cell(v))); this.maxRows = Math.max(this.getMaxRows(), this.data.length); }
  deleteRow(n) { if (n < 1 || n > this.data.length) throw new Error('Row out of bounds.'); this.data.splice(n - 1, 1); }
}

function createBackend(options = {}) {
  const sheets = {};
  if (options.data) for (const k of Object.keys(options.data)) sheets[k] = new Sheet(k, options.data[k]);
  const props = Object.assign({}, options.props);
  const spreadsheet = {
    getSheetByName: n => sheets[n] || null,
    insertSheet: n => (sheets[n] = new Sheet(n))
  };
  const sandbox = {
    console: options.quiet ? { log() {}, error() {}, warn() {} } : console,
    SpreadsheetApp: { getActiveSpreadsheet: () => spreadsheet, openById: () => spreadsheet },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => (k in props ? props[k] : null), setProperty: (k, v) => { props[k] = String(v); } }) },
    ContentService: { MimeType: { JSON: 'JSON' }, createTextOutput: s => ({ setMimeType() { return this; }, getContent: () => s }) },
    UrlFetchApp: { fetch: (url, opts) => { if (!options.fetch) throw new Error('No network in tests: ' + url); return options.fetch(url, opts); } },
    Utilities: {
      DigestAlgorithm: { SHA_256: 'sha256' },
      Charset: { UTF_8: 'utf8' },
      getUuid: () => crypto.randomUUID(),
      base64Encode: s => Buffer.from(String(s), 'utf8').toString('base64'),
      computeDigest: (alg, value) => signed(crypto.createHash('sha256').update(unsigned(value)).digest()),
      computeHmacSha256Signature: (value, key) => signed(crypto.createHmac('sha256', unsigned(key)).update(unsigned(value)).digest())
    }
  };
  vm.createContext(sandbox);
  const file = path.join(__dirname, '..', 'backend', 'Code.gs');
  vm.runInContext(fs.readFileSync(file, 'utf8'), sandbox, { filename: 'Code.gs' });

  const post = body => JSON.parse(sandbox.doPost({ postData: { contents: typeof body === 'string' ? body : JSON.stringify(body) } }).getContent());
  return {
    sheets, props, post,
    setup: () => sandbox.setup(),
    call: (action, payload, token) => post({ action, payload, token }),
    /** Rows of a sheet as objects (for assertions). */
    rows(name) {
      const d = sheets[name].data; const head = d[0];
      return d.slice(1).map(r => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ''])));
    },
    dump: () => Object.fromEntries(Object.keys(sheets).map(k => [k, sheets[k].data]))
  };
}

module.exports = { createBackend };

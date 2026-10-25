(function (root) {
  'use strict';
  const LIMITS = Object.freeze({ bytes: 10 * 1024 * 1024, rows: 20000, columns: 200, cells: 1000000 });

  function delimiterOf(text) {
    const candidates = [',', '\t', ';', '|'];
    const counts = candidates.map(() => []), current = candidates.map(() => 0);
    let quoted = false, records = 0, meaningful = false;
    for (let i = 0; i < Math.min(text.length, 131072) && records < 25; i++) {
      const char = text[i];
      if (char === '"') {
        if (quoted && text[i + 1] === '"') { i++; continue; }
        quoted = !quoted;
      }
      if (!quoted && (char === '\n' || char === '\r')) {
        if (meaningful) { current.forEach((count, index) => counts[index].push(count)); records++; }
        current.fill(0); meaningful = false;
        if (char === '\r' && text[i + 1] === '\n') i++;
      } else {
        if (char.trim()) meaningful = true;
        if (!quoted) candidates.forEach((delimiter, index) => { if (char === delimiter) current[index]++; });
      }
    }
    if (meaningful) current.forEach((count, index) => counts[index].push(count));
    let best = ',', score = -1;
    counts.forEach((values, index) => {
      const header = values[0] || 0;
      if (!header) return;
      const consistent = values.filter(value => value === header).length / values.length;
      const value = consistent * 100 + Math.log2(header + 1);
      if (value > score) { score = value; best = candidates[index]; }
    });
    return best;
  }

  function parse(text, delimiter = 'auto') {
    if (typeof text !== 'string') throw new Error('Choose a text-based CSV or TSV file.');
    text = text.replace(/^\uFEFF/, '');
    if (new TextEncoder().encode(text).byteLength > LIMITS.bytes) throw new Error('Each table must be 10 MB or smaller.');
    if (text.includes('\0')) throw new Error('This looks like a binary file. Export the sheet as CSV or TSV first.');
    const separator = delimiter === 'auto' ? delimiterOf(text) : delimiter;
    if (![',', '\t', ';', '|'].includes(separator)) throw new Error('Choose a supported separator.');
    const records = [];
    let row = [], value = '', quoted = false, closed = false, touched = false, cells = 0;
    function field() {
      row.push(value); value = ''; closed = false;
      if (row.length > LIMITS.columns) throw new Error('A table can have up to 200 columns. Check the separator.');
    }
    function record() {
      field();
      if (touched || row.length > 1 || row[0] !== '') {
        cells += row.length;
        if (cells > LIMITS.cells) throw new Error('A table can have up to 1,000,000 cells. Try a smaller export.');
        records.push(row);
        if (records.length > LIMITS.rows + 1) throw new Error('A table can have up to 20,000 data rows.');
      }
      row = []; touched = false;
    }
    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      if (quoted) {
        if (char === '"') {
          if (text[i + 1] === '"') { value += '"'; i++; }
          else { quoted = false; closed = true; }
        } else value += char;
        continue;
      }
      if (char === separator) { touched = true; field(); }
      else if (char === '\r' || char === '\n') {
        record();
        if (char === '\r' && text[i + 1] === '\n') i++;
      } else if (char === '"') {
        if (value || closed) throw new Error(`Unexpected quote near record ${records.length + 1}. Check the separator or CSV formatting.`);
        quoted = true; touched = true;
      } else {
        if (closed) throw new Error(`Unexpected text after a closing quote near record ${records.length + 1}.`);
        value += char; touched = true;
      }
    }
    if (quoted) throw new Error('A quoted value is missing its closing quote. Check the source export.');
    if (value || row.length || touched) record();
    if (!records.length) throw new Error('This table is empty. Include a header row and your data.');
    const headers = records.shift().map(header => header.trim());
    if (headers.some(header => !header)) throw new Error('Every column needs a name in the first row.');
    if (new Set(headers).size !== headers.length) throw new Error('Column names must be unique. Rename repeated headers first.');
    records.forEach((record, index) => {
      if (record.length !== headers.length) throw new Error(`Data row ${index + 1} has ${record.length} cells; the header has ${headers.length}. Check the separator or export.`);
    });
    return { headers, rows: records, delimiter: separator };
  }

  const normalized = (value, rules) => {
    let text = String(value ?? '');
    if (rules.trim) text = text.trim();
    if (rules.ignoreCase) text = text.toLowerCase();
    return text;
  };
  const isDecimal = value => /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value);
  function decimalParts(value) {
    if (value.length > 80) return null;
    const [mantissa, exponent = '0'] = value.toLowerCase().split('e');
    const fraction = mantissa.split('.')[1]?.length || 0;
    const scale = fraction - Number(exponent);
    if (Math.abs(scale) > 400) return null;
    return { coefficient: BigInt(mantissa.replace('.', '').replace(/^\+/, '')), scale };
  }
  function equal(left, right, rules) {
    const a = normalized(left, rules), b = normalized(right, rules);
    if (a === b) return true;
    // Numeric equivalence is opt-in. IDs and leading zeroes stay text by default.
    if (!rules.numeric || !isDecimal(a) || !isDecimal(b)) return false;
    const x = Number(a), y = Number(b);
    if (!Number.isFinite(x) || !Number.isFinite(y) || Math.abs(x) > Number.MAX_SAFE_INTEGER || Math.abs(y) > Number.MAX_SAFE_INTEGER) return false;
    const p = decimalParts(a), q = decimalParts(b), t = decimalParts(String(rules.tolerance));
    if (!p || !q || !t) return false;
    const scale = Math.max(p.scale, q.scale, t.scale);
    const scaled = part => part.coefficient * 10n ** BigInt(scale - part.scale);
    const difference = scaled(p) - scaled(q);
    return (difference < 0n ? -difference : difference) <= scaled(t);
  }

  function indexRows(table, keys, rules, label) {
    const positions = keys.map(key => table.headers.indexOf(key));
    const map = new Map();
    table.rows.forEach((row, index) => {
      const values = positions.map(position => normalized(row[position], rules));
      if (values.some(value => !value.trim())) throw new Error(`${label}: data row ${index + 1} has an empty matching value. Fill it in or choose another matching column.`);
      const id = JSON.stringify(values);
      if (map.has(id)) throw new Error(`${label}: data rows ${map.get(id).index + 1} and ${index + 1} share a matching value. Add another matching column or choose a unique ID.`);
      map.set(id, { row, index, values });
    });
    return map;
  }

  function suggestKeys(before, after) {
    const common = before.headers.filter(header => after.headers.includes(header));
    const scores = common.map((header, index) => ({ header, score: /^(id|sku|key|code|email|part.?number|reference)$/i.test(header) ? 100 : /(?:^|[ _-])(id|sku|code|email|reference)(?:$|[ _-])/i.test(header) ? 50 : 0, index }));
    scores.sort((a, b) => b.score - a.score || a.index - b.index);
    for (const { header } of scores) {
      try {
        indexRows(before, [header], {}, 'Before'); indexRows(after, [header], {}, 'After');
        if (before.rows.length || after.rows.length) return [header];
      } catch { /* A suggestion must be unique on both sides. */ }
    }
    return [];
  }

  function compare(before, after, options = {}) {
    const keys = [...new Set(options.keys || [])];
    if (!keys.length) throw new Error('Choose at least one column to match rows. An ID, SKU or email usually works.');
    if (keys.some(key => !before.headers.includes(key) || !after.headers.includes(key))) throw new Error('Matching columns must exist in both tables. Header names are case-sensitive.');
    const tolerance = Number(options.tolerance ?? 0);
    if (!Number.isFinite(tolerance) || tolerance < 0 || tolerance > 1e12) throw new Error('Numeric tolerance must be a number from 0 to 1,000,000,000,000.');
    const rules = { trim: Boolean(options.trim), ignoreCase: Boolean(options.ignoreCase), numeric: Boolean(options.numeric), tolerance, ignored: (options.ignored || []).filter(key => !keys.includes(key)) };
    const left = indexRows(before, keys, rules, 'Before');
    const right = indexRows(after, keys, rules, 'After');
    const headers = [...new Set([...before.headers, ...after.headers])];
    const addedColumns = after.headers.filter(header => !before.headers.includes(header));
    const removedColumns = before.headers.filter(header => !after.headers.includes(header));
    const fields = headers.filter(header => !keys.includes(header) && !rules.ignored.includes(header));
    const beforePositions = new Map(before.headers.map((header, index) => [header, index]));
    const afterPositions = new Map(after.headers.map((header, index) => [header, index]));
    const rows = [], counts = { added: 0, removed: 0, changed: 0, unchanged: 0 }, fieldCounts = new Map();
    let changedCells = 0;
    for (const [id, record] of left) {
      const next = right.get(id);
      if (!next) {
        rows.push({ id, key: record.values, type: 'removed', before: record.row, after: null, changes: [] });
        counts.removed++; continue;
      }
      const changes = [];
      for (const header of fields) {
        const had = beforePositions.has(header), has = afterPositions.has(header);
        const oldValue = had ? record.row[beforePositions.get(header)] : null;
        const newValue = has ? next.row[afterPositions.get(header)] : null;
        if (had !== has || !equal(oldValue, newValue, rules)) {
          changes.push({ column: header, before: oldValue, after: newValue, kind: !had ? 'column-added' : !has ? 'column-removed' : 'value' });
          fieldCounts.set(header, (fieldCounts.get(header) || 0) + 1); changedCells++;
        }
      }
      const type = changes.length ? 'changed' : 'unchanged'; counts[type]++;
      rows.push({ id, key: record.values, type, before: record.row, after: next.row, changes });
    }
    for (const [id, record] of right) {
      if (!left.has(id)) { counts.added++; rows.push({ id, key: record.values, type: 'added', before: null, after: record.row, changes: [] }); }
    }
    const changedFields = [...fieldCounts].map(([column, count]) => ({ column, count })).sort((a, b) => b.count - a.count || a.column.localeCompare(b.column));
    return { version: 1, keys, rules, beforeHeaders: before.headers, afterHeaders: after.headers, beforeRows: before.rows.length, afterRows: after.rows.length, headers, addedColumns, removedColumns, changedFields, changedCells, counts, rows };
  }

  function quoteCSV(value) {
    let text = String(value ?? '');
    // Protect cells that spreadsheet software might interpret as formulas.
    if (/^[\s\uFEFF]*[=+\-@\t\r\n]/.test(text)) text = "'" + text;
    return /[",\r\n]/.test(text) ? '"' + text.replaceAll('"', '""') + '"' : text;
  }
  function changesCSV(report) {
    const rows = [['Change', 'Matching values', 'Column', 'Before', 'After']];
    for (const row of report.rows) {
      if (row.type === 'unchanged') continue;
      const key = JSON.stringify(row.key);
      if (row.type === 'changed') row.changes.forEach(change => rows.push([row.type, key, change.column, change.before, change.after]));
      else {
        const headers = row.type === 'added' ? report.afterHeaders : report.beforeHeaders;
        const values = row.type === 'added' ? row.after : row.before;
        headers.forEach((header, index) => rows.push([row.type, key, header, row.type === 'removed' ? values[index] : '', row.type === 'added' ? values[index] : '']));
      }
    }
    return '\uFEFF' + rows.map(row => row.map(quoteCSV).join(',')).join('\r\n');
  }
  const escapeHTML = value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
  function brief(report) {
    const { counts } = report;
    const parts = [`${counts.changed} changed, ${counts.added} added, ${counts.removed} removed, ${counts.unchanged} unchanged.`];
    if (report.changedFields.length) parts.push(`Most changed column: ${report.changedFields[0].column} (${report.changedFields[0].count} matched rows).`);
    if (report.addedColumns.length) parts.push(`Columns added: ${report.addedColumns.join(', ')}.`);
    if (report.removedColumns.length) parts.push(`Columns removed: ${report.removedColumns.join(', ')}.`);
    return parts.join(' ');
  }
  function reportHTML(report, meta = {}) {
    const e = escapeHTML;
    const headings = ['Status', ...report.headers].map(header => `<th scope="col">${e(header)}</th>`).join('');
    const oldPositions = new Map(report.beforeHeaders.map((header, index) => [header, index]));
    const newPositions = new Map(report.afterHeaders.map((header, index) => [header, index]));
    const rows = report.rows.filter(row => row.type !== 'unchanged').map(row => `<tr><th scope="row">${e(row.type)}</th>${report.headers.map(header => {
      const old = row.before && oldPositions.has(header) ? row.before[oldPositions.get(header)] : null;
      const next = row.after && newPositions.has(header) ? row.after[newPositions.get(header)] : null;
      const change = row.changes.find(change => change.column === header);
      return `<td>${change ? `<del>${old === null ? '(column absent)' : e(old)}</del><ins>${next === null ? '(column absent)' : e(next)}</ins>` : row.type === 'removed' ? e(old) : e(next)}</td>`;
    }).join('')}</tr>`).join('');
    const rules = [`Matching: ${report.keys.join(' + ')}`, `Trim spaces: ${report.rules.trim ? 'yes' : 'no'}`, `Ignore case: ${report.rules.ignoreCase ? 'yes' : 'no'}`, `Numeric equivalence: ${report.rules.numeric ? `yes (absolute tolerance ${report.rules.tolerance})` : 'no'}`, `Ignored columns: ${report.rules.ignored.join(', ') || 'none'}`];
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src 'none'; form-action 'none'; base-uri 'none'"><title>${e(meta.title || 'Rowglass change report')}</title><style>body{font:15px/1.7 system-ui,sans-serif;color:#1e302c;margin:40px}h1{font-size:36px;line-height:1.2}p{max-width:950px}table{border-collapse:collapse;min-width:100%;font-size:13px}th,td{border:1px solid #d6e0dc;padding:10px;text-align:left;vertical-align:top;white-space:pre-wrap;overflow-wrap:anywhere;max-width:350px}th{background:#f0f5f2}del,ins{display:block;text-decoration:none;padding:3px 6px}del{background:#fff0ef;color:#88382e}ins{background:#e8f5ee;color:#205f40}.table{overflow:auto}small{color:#52685f}@media print{body{margin:10mm}thead{display:table-header-group}tr{break-inside:avoid}table{font-size:9px}th,td{padding:4px}}</style></head><body><small>ROWGLASS · LOCAL CHANGE REPORT</small><h1>${e(meta.title || 'What changed?')}</h1><p><strong>${e(meta.before || 'Before')}</strong> → <strong>${e(meta.after || 'After')}</strong></p><p>${e(brief(report))}</p><p>${rules.map(e).join(' · ')}</p><p>Only changed, added and removed rows are listed. Original values are retained. This file contains table data; share it only with its intended recipients.</p><div class="table"><table><thead><tr>${headings}</tr></thead><tbody>${rows || `<tr><td colspan="${report.headers.length + 1}">No row changes under these rules.</td></tr>`}</tbody></table></div><p><small>Made with Rowglass by Umut Alisoglu. This report is self-contained, with no scripts or network requests. Use your browser’s Print menu to print or save as PDF.</small></p></body></html>`;
  }

  const api = { LIMITS, delimiterOf, parse, suggestKeys, compare, brief, changesCSV, reportHTML, escapeHTML };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.RowglassCore = Object.freeze(api);
})(typeof globalThis !== 'undefined' ? globalThis : this);

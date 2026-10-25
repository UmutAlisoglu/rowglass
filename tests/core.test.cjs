const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../src/core.js');
const parse = text => C.parse(text);
const diff = (left, right, options = {}) => C.compare(parse(left), parse(right), { keys: ['ID'], ...options });

test('CSV preserves quoted commas, escaped quotes, CRLF, multiline values and leading zeroes', () => {
  const table = parse('\uFEFFID,Name,Note\r\n001,"Smith, Alex","a ""quote""\r\nand another line"\r\n002,Sam,\r\n');
  assert.deepEqual(table.headers, ['ID', 'Name', 'Note']);
  assert.deepEqual(table.rows, [['001', 'Smith, Alex', 'a "quote"\r\nand another line'], ['002', 'Sam', '']]);
});
test('detects tab, semicolon and pipe without splitting quoted separators', () => {
  assert.equal(parse('ID\tValue\n1\tHello').delimiter, '\t');
  assert.equal(parse('ID;Price\n1;1,25\n2;3,50').delimiter, ';');
  assert.equal(parse('ID|Note\n1|"a,b;c"').delimiter, '|');
  assert.equal(C.parse('ID;Name\n1;Two', ';').rows[0][1], 'Two');
});
test('blank physical lines are skipped but quoted empty data is preserved', () => {
  assert.deepEqual(parse('ID\n\n""\nA\n').rows, [[''], ['A']]);
});
test('malformed, binary, ambiguous-header and inconsistent-width input is rejected', () => {
  for (const text of ['', 'ID,ID\na,b', 'ID,\na,b', 'ID,Name\na,b,c', 'ID,Name\na,"b', 'ID,Name\na,b"c', 'ID,Name\na,"b"x', 'PK\0binary']) assert.throws(() => parse(text), Error, text);
  assert.throws(() => C.parse('ID\nA', 'x'), /separator/);
  assert.deepEqual(parse('__proto__,constructor\na,b').headers, ['__proto__', 'constructor']);
});
test('bounded inputs reject too many rows and columns', () => {
  assert.throws(() => parse('ID\n' + 'a\n'.repeat(C.LIMITS.rows + 1)), /20,000/);
  assert.throws(() => parse(Array.from({ length: 201 }, (_, i) => `C${i}`).join(',')), /200 columns/);
});
test('reordered rows are unchanged; additions, removals and cells are counted separately', () => {
  const report = diff('ID,Value\nA,10\nB,20\nC,30', 'ID,Value\nC,30\nB,25\nD,40');
  assert.deepEqual(report.counts, { added: 1, removed: 1, changed: 1, unchanged: 1 });
  assert.deepEqual(report.rows.find(row => row.key[0] === 'B').changes, [{ column: 'Value', before: '20', after: '25', kind: 'value' }]);
  assert.equal(report.changedCells, 1);
});
test('matching is by header names, independent of column order', () => {
  assert.equal(diff('ID,Value\nA,10', 'Value,ID\n10,A').counts.unchanged, 1);
});
test('composite keys are collision-safe even with delimiters and prototype names', () => {
  const left = parse('ID,Store,Value\n"a,b",c,1\na,"b,c",2\n__proto__,x,3');
  const right = parse('ID,Store,Value\na,"b,c",2\n__proto__,x,3\n"a,b",c,1');
  assert.equal(C.compare(left, right, { keys: ['ID', 'Store'] }).counts.unchanged, 3);
});
test('duplicate, missing and normalized-colliding IDs stop comparison rather than pairing arbitrarily', () => {
  assert.throws(() => diff('ID,V\nA,1\nA,2', 'ID,V\nA,1'), /share a matching value/);
  assert.throws(() => diff('ID,V\nA,1', 'ID,V\n,1'), /empty matching value/);
  assert.throws(() => diff('ID,V\nA,1\na,2', 'ID,V\nA,1', { ignoreCase: true }), /share a matching value/);
  assert.throws(() => diff('ID,V\n A,1\nA,2', 'ID,V\nA,1', { trim: true }), /share a matching value/);
  assert.throws(() => diff('ID\nA', 'ID\nA', { keys: ['Missing'] }), /exist in both/);
});
test('key suggestions prefer familiar unique identifiers and decline non-unique columns', () => {
  assert.deepEqual(C.suggestKeys(parse('Name,SKU\nNotebook,A\nPen,B'), parse('Name,SKU\nPen,B\nNotebook,A')), ['SKU']);
  assert.deepEqual(C.suggestKeys(parse('ID,V\nA,1\nA,1'), parse('ID,V\nA,1\nA,1')), []);
});
test('column additions and removals remain visible even when the values are blank', () => {
  const report = diff('ID,Old\nA,', 'ID,New\nA,');
  assert.deepEqual(report.addedColumns, ['New']); assert.deepEqual(report.removedColumns, ['Old']);
  assert.equal(report.counts.changed, 1); assert.equal(report.changedCells, 2);
});
test('normalization and ignored fields are explicit; numeric rounding never applies to IDs', () => {
  const left = 'ID,Name,Amount,Updated\n001, Alex ,10.00,Monday';
  const right = 'ID,Name,Amount,Updated\n001,alex,10.005,Friday';
  assert.equal(diff(left, right).changedCells, 3);
  assert.equal(diff(left, right, { trim: true, ignoreCase: true, numeric: true, tolerance: .01, ignored: ['Updated'] }).counts.unchanged, 1);
  const ids = diff('ID,V\n001,10', 'ID,V\n1,10', { numeric: true, tolerance: 100 });
  assert.equal(ids.counts.added, 1); assert.equal(ids.counts.removed, 1);
  assert.throws(() => diff(left, right, { tolerance: -1 }), /tolerance/);
});
test('numeric comparison does not silently round large integers or interpret currency and decimal commas', () => {
  const report = diff('ID,V\nA,9007199254740993\nB,$12\nC,"1,20"', 'ID,V\nA,9007199254740992\nB,12\nC,1.2', { numeric: true, tolerance: 100 });
  assert.equal(report.counts.changed, 3);
  assert.equal(diff('ID,V\nA,1.00', 'ID,V\nA,1e0', { numeric: true }).counts.unchanged, 1);
});
test('header-only tables and completely replaced IDs are valid', () => {
  assert.deepEqual(diff('ID,Value', 'ID,Value').counts, { added: 0, removed: 0, changed: 0, unchanged: 0 });
  assert.deepEqual(diff('ID\nA', 'ID\nB').counts, { added: 1, removed: 1, changed: 0, unchanged: 0 });
});
test('decimal tolerance is exact at its boundary and does not hide safe-integer differences', () => {
  assert.equal(diff('ID,V\nA,1', 'ID,V\nA,1.01', { numeric: true, tolerance: .01 }).counts.unchanged, 1);
  assert.equal(diff('ID,V\nA,1', 'ID,V\nA,1.010000001', { numeric: true, tolerance: .01 }).counts.changed, 1);
  assert.equal(diff('ID,V\nA,9007199254740990', 'ID,V\nA,9007199254740991', { numeric: true }).counts.changed, 1);
  assert.equal(diff('ID,V\nA,.00000000000000000001', 'ID,V\nA,1e-20', { numeric: true }).counts.unchanged, 1);
});
test('HTML reports escape all untrusted values and contain no scripts or external resources', () => {
  const report = diff('ID,V\nA,old', 'ID,V\nA,<img src=x onerror=alert(1)>');
  const html = C.reportHTML(report, { title: '</title><script>alert(1)</script>', before: '"<svg onload=alert(1)>', after: 'safe' });
  assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'));
  assert.doesNotMatch(html, /<script|<img|<svg|onload="|href="https?:|src="https?:/i);
  assert.match(html, /default-src 'none'/);
  assert.match(html, /Matching: ID/);
});
test('changes CSV protects formulas and quotes multiline content; full JSON retains exact text', () => {
  const report = diff('ID,V\nA,old', 'ID,V\nA,"=HYPERLINK(""bad"")"');
  const csv = C.changesCSV(report);
  assert.ok(csv.includes("'=HYPERLINK"));
  assert.equal(parse(csv).rows[0][4], "'=HYPERLINK(\"bad\")");
  assert.equal(JSON.parse(JSON.stringify(report)).rows[0].after[1], '=HYPERLINK("bad")');
});
test('ignored-column rule cannot ignore a key; original values are kept', () => {
  const report = diff('ID,V\nA,old', 'ID,V\nA,new', { ignored: ['ID', 'V'] });
  assert.deepEqual(report.rules.ignored, ['V']); assert.equal(report.counts.unchanged, 1);
  assert.equal(report.rows[0].before[1], 'old'); assert.equal(report.rows[0].after[1], 'new');
});
test('20,000 keyed rows compare correctly without depending on position', () => {
  const headers = ['ID', 'Value'];
  const rows = Array.from({ length: 20000 }, (_, index) => [String(index), `value ${index}`]);
  const after = rows.map(row => [...row]).reverse(); after[10][1] = 'new';
  const report = C.compare({ headers, rows }, { headers, rows: after }, { keys: ['ID'] });
  assert.equal(report.counts.unchanged, 19999); assert.equal(report.counts.changed, 1);
});

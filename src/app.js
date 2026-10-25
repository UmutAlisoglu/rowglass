(function () {
  'use strict';
  const C = globalThis.RowglassCore;
  const $ = selector => document.querySelector(selector);
  const sides = ['before', 'after'];
  const emptySide = () => ({ text: '', name: '', table: null, token: 0 });
  const state = { before: emptySide(), after: emptySide(), report: null, filter: 'changes', page: 0, title: 'Table comparison', ignored: new Set() };
  const pageSize = 50;
  const downloadURLs = new Set();
  const formatNumber = number => number.toLocaleString();
  function node(tag, text, className) {
    const element = document.createElement(tag);
    if (text !== undefined) element.textContent = text;
    if (className) element.className = className;
    return element;
  }
  function status(text) { $('#workspace-status').textContent = text; }
  function error(selector, text) { const element = $(selector); element.textContent = text || ''; element.hidden = !text; }
  function invalidate() {
    state.report = null; $('#results').hidden = true; error('#compare-error', '');
    $('#row-dialog').close(); $('#row-dialog-body').replaceChildren();
    $('#row-dialog-title').textContent = 'Row details'; $('#row-dialog-status').textContent = '';
    $('#result-table thead').replaceChildren(); $('#result-table tbody').replaceChildren();
    $('#result-files').textContent = ''; $('#stats').replaceChildren(); $('#change-brief').textContent = ''; $('#rules-summary').textContent = ''; $('#column-summary').textContent = '';
  }
  function updateSide(side) {
    const value = state[side];
    const info = $(`#${side}-info`); info.replaceChildren();
    if (value.table) {
      info.append(node('strong', value.name), node('span', `${formatNumber(value.table.rows.length)} rows · ${value.table.headers.length} columns · ${value.table.delimiter === '\t' ? 'tab' : value.table.delimiter} separated`));
    } else info.textContent = 'CSV or TSV · Up to 10 MB';
    $(`[data-remove="${side}"]`).hidden = !value.table && !value.text;
    $(`[data-side="${side}"]`).classList.toggle('has-file', Boolean(value.table));
    $(`[data-side="${side}"] .file-drop strong`).textContent = value.table ? 'Replace this table' : 'Drop a table here';
  }
  function selectOption(select, value, label) { const option = node('option', label); option.value = value; select.append(option); }
  function updateMatch() {
    const ready = state.before.table && state.after.table;
    const common = ready ? state.before.table.headers.filter(header => state.after.table.headers.includes(header)) : [];
    const primary = $('#key-primary'), secondary = $('#key-secondary');
    const previous = [primary.value, secondary.value];
    primary.replaceChildren(); secondary.replaceChildren();
    selectOption(primary, '', 'Choose a column'); selectOption(secondary, '', 'No second column');
    common.forEach(header => { selectOption(primary, header, header); selectOption(secondary, header, header); });
    primary.disabled = secondary.disabled = !common.length;
    if (common.includes(previous[0])) primary.value = previous[0];
    else if (ready) primary.value = C.suggestKeys(state.before.table, state.after.table)[0] || '';
    if (common.includes(previous[1]) && previous[1] !== primary.value) secondary.value = previous[1];
    $('#compare').disabled = !common.length;
    $('#clear-all').disabled = !sides.some(side => state[side].text || state[side].name);
    $('#match-hint').textContent = !ready ? 'Add two tables to choose a matching column.' : !common.length ? 'No column names match. Use the same header names in both exports.' : primary.value ? 'A matching column is suggested. Check that it identifies the same record in both tables.' : 'Choose a stable ID, or combine two columns if one is not unique.';
    renderIgnored();
  }
  function keys() { return [...new Set([$('#key-primary').value, $('#key-secondary').value].filter(Boolean))]; }
  function renderIgnored() {
    const fields = $('#ignored-columns'); fields.replaceChildren();
    const ready = state.before.table && state.after.table;
    $('#ignored-empty').hidden = Boolean(ready);
    if (!ready) return;
    const headers = [...new Set([...state.before.table.headers, ...state.after.table.headers])];
    headers.forEach(header => {
      const label = node('label', undefined, 'check');
      const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.value = header;
      checkbox.disabled = keys().includes(header); checkbox.checked = !checkbox.disabled && state.ignored.has(header);
      if (checkbox.disabled) state.ignored.delete(header);
      checkbox.addEventListener('change', () => {
        if (checkbox.checked) state.ignored.add(header); else state.ignored.delete(header);
        invalidate(); status('Comparison rules changed. Find changes again to apply them.');
      });
      label.append(checkbox, node('span', header)); fields.append(label);
    });
  }
  function loadText(side, text, name) {
    invalidate(); error(`#${side}-error`, '');
    state[side].text = text; state[side].name = name; state[side].table = null;
    try {
      const selected = $(`#${side}-delimiter`).value;
      state[side].table = C.parse(text, selected === 'tab' ? '\t' : selected);
      status(`${side === 'before' ? 'Before' : 'After'} table ready. Your data is only in this page’s memory.`);
    } catch (problem) { error(`#${side}-error`, problem.message); status('Check the table highlighted above.'); }
    updateSide(side); updateMatch();
  }
  async function loadFile(side, file) {
    state.title = 'Table comparison';
    const token = ++state[side].token;
    invalidate(); state[side].table = null; state[side].text = ''; state[side].name = file.name;
    updateSide(side); updateMatch(); error(`#${side}-error`, '');
    if (file.size > C.LIMITS.bytes) { error(`#${side}-error`, 'Each file must be 10 MB or smaller.'); return; }
    status(`Reading ${side} table locally…`);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (token !== state[side].token) return;
      const encoding = bytes[0] === 255 && bytes[1] === 254 ? 'utf-16le' : bytes[0] === 254 && bytes[1] === 255 ? 'utf-16be' : 'utf-8';
      let text;
      try { text = new TextDecoder(encoding, { fatal: true }).decode(bytes); }
      catch { throw new Error('Save this export as UTF-8 CSV, or BOM-marked UTF-16 text, and try again.'); }
      loadText(side, text, file.name);
    } catch (problem) {
      if (token !== state[side].token) return;
      error(`#${side}-error`, problem.message); status('The file could not be read. Choose a CSV or TSV export.');
    }
  }
  function clearSide(side) {
    state[side] = { ...emptySide(), token: state[side].token + 1 };
    $(`#${side}-file`).value = ''; $(`#${side}-paste`).value = '';
    error(`#${side}-error`, ''); updateSide(side); invalidate(); updateMatch();
  }
  function resetRules() {
    ['trim', 'ignore-case', 'numeric'].forEach(id => { $(`#${id}`).checked = false; });
    $('#tolerance').value = '0'; $('#tolerance').disabled = true; state.ignored.clear();
  }
  for (const side of sides) {
    $(`#${side}-file`).addEventListener('change', event => { if (event.target.files[0]) loadFile(side, event.target.files[0]); event.target.value = ''; });
    $(`#${side}-delimiter`).addEventListener('change', () => { if (state[side].text) loadText(side, state[side].text, state[side].name); });
    $(`[data-paste="${side}"]`).addEventListener('click', () => {
      state.title = 'Table comparison'; state[side].token++; loadText(side, $(`#${side}-paste`).value, `Pasted ${side} table`);
    });
    $(`[data-remove="${side}"]`).addEventListener('click', () => { clearSide(side); status(`${side === 'before' ? 'Before' : 'After'} table removed.`); });
  }
  const workspace = $('#workspace');
  workspace.addEventListener('dragover', event => {
    if (![...event.dataTransfer.types].includes('Files')) return;
    event.preventDefault(); event.dataTransfer.dropEffect = 'copy';
    const panel = event.target.closest('[data-side]');
    document.querySelectorAll('.drag-over').forEach(element => element.classList.remove('drag-over'));
    if (panel) panel.classList.add('drag-over');
  });
  workspace.addEventListener('dragleave', event => {
    if (!workspace.contains(event.relatedTarget)) document.querySelectorAll('.drag-over').forEach(element => element.classList.remove('drag-over'));
  });
  workspace.addEventListener('drop', event => {
    event.preventDefault(); document.querySelectorAll('.drag-over').forEach(element => element.classList.remove('drag-over'));
    const files = [...event.dataTransfer.files];
    if (files.length === 2) { loadFile('before', files[0]); loadFile('after', files[1]); }
    else if (files.length === 1) loadFile(event.target.closest('[data-side]')?.dataset.side || (!state.before.table ? 'before' : 'after'), files[0]);
    else if (files.length) status('Drop one file into each panel, or two files together.');
  });
  // A file dropped outside the workspace should not navigate away from a session.
  document.addEventListener('dragover', event => { if ([...event.dataTransfer.types].includes('Files')) event.preventDefault(); });
  document.addEventListener('drop', event => event.preventDefault());
  $('#clear-all').addEventListener('click', () => {
    downloadURLs.forEach(url => URL.revokeObjectURL(url)); downloadURLs.clear();
    clearSide('before'); clearSide('after'); resetRules(); updateMatch();
    $('#key-primary').value = ''; $('#key-secondary').value = '';
    document.querySelectorAll('.paste-option,.rules-panel,.export-more').forEach(element => { element.open = false; });
    state.title = 'Table comparison'; $('#search').value = '';
    $('#row-dialog').close(); $('#row-dialog-body').replaceChildren(); $('#row-dialog-title').textContent = 'Row details'; $('#row-dialog-status').textContent = '';
    $('#result-table thead').replaceChildren(); $('#result-table tbody').replaceChildren();
    $('#result-files').textContent = ''; $('#stats').replaceChildren(); $('#change-brief').textContent = ''; $('#rules-summary').textContent = ''; $('#column-summary').textContent = '';
    status('Everything cleared. No table data or history has been saved by Rowglass.');
    $('#before-file').focus();
  });
  $('#load-example').addEventListener('click', () => {
    const sample = globalThis.RowglassSamples[$('#example').value];
    sides.forEach(side => { state[side].token++; $(`#${side}-paste`).value = ''; $(`#${side}-delimiter`).value = 'auto'; });
    resetRules(); $('#key-primary').value = ''; $('#key-secondary').value = '';
    state.title = sample.title;
    loadText('before', sample.left, sample.before); loadText('after', sample.right, sample.after);
    status('Fictional example loaded. Check the suggested matching column, then find changes.');
    $('#compare').focus();
  });
  ['key-primary', 'key-secondary'].forEach(id => $(`#${id}`).addEventListener('change', () => {
    if ($('#key-secondary').value === $('#key-primary').value) $('#key-secondary').value = '';
    invalidate(); renderIgnored(); status('Matching columns changed. Find changes again.');
  }));
  ['trim', 'ignore-case', 'numeric', 'tolerance'].forEach(id => $(`#${id}`).addEventListener('input', () => {
    $('#tolerance').disabled = !$('#numeric').checked; invalidate(); status('Comparison rules changed. Find changes again to apply them.');
  }));

  function runComparison() {
    error('#compare-error', '');
    if (!state.before.table || !state.after.table) return;
    try {
      state.report = C.compare(state.before.table, state.after.table, { keys: keys(), trim: $('#trim').checked, ignoreCase: $('#ignore-case').checked, numeric: $('#numeric').checked, tolerance: $('#tolerance').value, ignored: [...state.ignored] });
      state.page = 0; state.filter = 'changes'; $('#search').value = '';
      const report = state.report;
      $('#results').hidden = false;
      $('#result-files').textContent = `${state.before.name} → ${state.after.name}`;
      const stats = $('#stats'); stats.replaceChildren();
      [['changed', 'Changed rows'], ['added', 'Added rows'], ['removed', 'Removed rows'], ['unchanged', 'Unchanged rows']].forEach(([type, label]) => {
        const stat = node('div', undefined, `stat stat-${type}`); stat.append(node('strong', formatNumber(report.counts[type])), node('span', label)); stats.append(stat);
      });
      $('#change-brief').textContent = C.brief(report);
      const rules = [`Matched by ${report.keys.join(' + ')}`, report.rules.trim ? 'edge spaces ignored' : 'spaces kept', report.rules.ignoreCase ? 'case ignored' : 'case kept', report.rules.numeric ? `numbers within ${report.rules.tolerance} treated as equal` : 'exact text values', report.rules.ignored.length ? `${report.rules.ignored.length} columns ignored` : 'all non-key columns compared'];
      $('#rules-summary').textContent = rules.join(' · ');
      const columns = [];
      if (report.addedColumns.length) columns.push(`Columns added: ${report.addedColumns.join(', ')}`);
      if (report.removedColumns.length) columns.push(`Columns removed: ${report.removedColumns.join(', ')}`);
      $('#column-summary').textContent = columns.join(' · '); $('#column-summary').hidden = !columns.length;
      updateFilterButtons(); renderRows();
      status('Comparison complete. Save your report before closing the page.');
      $('#results-title').focus({ preventScroll: true });
      $('#results').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'start' });
    } catch (problem) { invalidate(); error('#compare-error', problem.message); status('Comparison paused. Check the matching columns or rules.'); }
  }
  $('#compare').addEventListener('click', runComparison);
  function updateFilterButtons() { document.querySelectorAll('[data-filter]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.filter === state.filter))); }
  $('#filters').addEventListener('click', event => {
    const button = event.target.closest('[data-filter]'); if (!button) return;
    state.filter = button.dataset.filter; state.page = 0; updateFilterButtons(); renderRows();
  });
  $('#search').addEventListener('input', () => { state.page = 0; renderRows(); });
  function valueCell(value, absent = false) { return node('span', absent ? '—' : value === '' ? '(empty)' : String(value ?? ''), absent ? 'absent-value' : 'cell-value'); }
  function visibleRows() {
    const query = $('#search').value.toLowerCase();
    return state.report.rows.filter(row => (state.filter === 'all' || state.filter === 'changes' && row.type !== 'unchanged' || row.type === state.filter) && (!query || [...row.key, ...(row.before || []), ...(row.after || [])].some(value => value.toLowerCase().includes(query))));
  }
  function renderRows() {
    if (!state.report) return;
    const report = state.report, rows = visibleRows();
    const pages = Math.max(1, Math.ceil(rows.length / pageSize)); state.page = Math.min(state.page, pages - 1);
    const tbody = $('#result-table tbody'), thead = $('#result-table thead'); tbody.replaceChildren(); thead.replaceChildren();
    // Wide input tables stay usable: show keys plus the first 6 relevant fields.
    // Row inspection and exports retain every column.
    const relevant = report.changedFields.map(field => field.column);
    const shown = [...new Set([...report.keys, ...relevant, ...report.headers])].slice(0, 8);
    const heading = node('tr');
    ['Change', ...shown].forEach(header => { const th = node('th', header); th.scope = 'col'; heading.append(th); }); thead.append(heading);
    const oldPositions = new Map(report.beforeHeaders.map((header, index) => [header, index]));
    const newPositions = new Map(report.afterHeaders.map((header, index) => [header, index]));
    rows.slice(state.page * pageSize, (state.page + 1) * pageSize).forEach(row => {
      const tr = node('tr', undefined, `row-${row.type}`);
      const statusCell = node('th'); statusCell.scope = 'row';
      const inspect = node('button', row.type[0].toUpperCase() + row.type.slice(1), `row-badge badge-${row.type}`);
      inspect.type = 'button'; inspect.setAttribute('aria-label', `Inspect ${row.type} row ${row.key.join(' / ')}`); inspect.addEventListener('click', () => inspectRow(row)); statusCell.append(inspect); tr.append(statusCell);
      shown.forEach(header => {
        const td = node('td');
        const change = row.changes.find(change => change.column === header);
        if (change) {
          const old = node('del'), next = node('ins'); old.append(node('span', 'Before: ', 'sr-only'), valueCell(change.before, change.before === null)); next.append(node('span', 'After: ', 'sr-only'), valueCell(change.after, change.after === null)); td.append(old, next);
        } else {
          const removed = row.type === 'removed', positions = removed ? oldPositions : newPositions, values = removed ? row.before : row.after;
          td.append(valueCell(positions.has(header) ? values[positions.get(header)] : '', !positions.has(header)));
          if (report.rules.ignored.includes(header)) td.append(node('span', 'Ignored', 'ignored-tag'));
        }
        tr.append(td);
      }); tbody.append(tr);
    });
    $('#empty-results').hidden = Boolean(rows.length);
    $('#empty-results').textContent = $('#search').value ? 'No rows match that search in this filter.' : state.filter === 'changes' ? 'No row changes under these rules. Check the comparison settings if you expected differences.' : 'No rows in this filter.';
    $('#result-count').textContent = `${formatNumber(rows.length)} ${rows.length === 1 ? 'row' : 'rows'} in this view${report.headers.length > shown.length ? ` · Showing ${shown.length} of ${report.headers.length} columns. Inspect a row or save the report for all fields.` : ' · Select a status to inspect every field.'}`;
    $('#page-number').textContent = `Page ${state.page + 1} of ${pages}`;
    $('#previous').disabled = state.page === 0; $('#next').disabled = state.page >= pages - 1;
  }
  $('#previous').addEventListener('click', () => { state.page--; renderRows(); });
  $('#next').addEventListener('click', () => { state.page++; renderRows(); });
  function inspectRow(row) {
    const report = state.report, body = $('#row-dialog-body'); body.replaceChildren();
    $('#row-dialog-title').textContent = row.key.join(' / ');
    $('#row-dialog-status').textContent = `${row.type[0].toUpperCase() + row.type.slice(1)} row · Original values, before comparison rules.`;
    report.headers.forEach(header => {
      const tr = node('tr'); const th = node('th', header); th.scope = 'row'; tr.append(th);
      for (const side of sides) {
        const positions = side === 'before' ? report.beforeHeaders : report.afterHeaders;
        const index = positions.indexOf(header), td = node('td');
        const absent = !row[side] || index < 0;
        td.append(valueCell(absent ? '' : row[side][index], absent));
        if (row.changes.some(change => change.column === header)) td.className = `detail-${side}`;
        tr.append(td);
      }
      if (report.rules.ignored.includes(header)) th.append(node('small', 'Ignored', 'ignored-tag'));
      body.append(tr);
    });
    $('#row-dialog').showModal();
  }
  $('#close-row').addEventListener('click', () => $('#row-dialog').close());
  $('#row-dialog').addEventListener('click', event => { if (event.target === event.currentTarget) { const rect = event.target.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) event.target.close(); } });
  function metadata() { return { title: state.title, before: state.before.name, after: state.after.name, created: new Date().toISOString() }; }
  function download(content, type, extension) {
    const blob = new Blob([content], { type }); const url = URL.createObjectURL(blob);
    downloadURLs.add(url);
    const a = document.createElement('a'); a.href = url; a.download = `rowglass-changes.${extension}`; document.body.append(a); a.click(); a.remove();
    setTimeout(() => { URL.revokeObjectURL(url); downloadURLs.delete(url); }, 30000);
    status('Download prepared. Reports contain your data; share them only with their intended recipients.');
  }
  $('#save-report').addEventListener('click', () => { if (state.report) download(C.reportHTML(state.report, metadata()), 'text/html;charset=utf-8', 'html'); });
  $('#save-csv').addEventListener('click', () => { if (state.report) download(C.changesCSV(state.report), 'text/csv;charset=utf-8', 'csv'); });
  $('#save-json').addEventListener('click', () => { if (state.report) download(JSON.stringify({ product: 'Rowglass 1.0.0', ...metadata(), ...state.report }, null, 2), 'application/json', 'json'); });
  $('#copy-brief').addEventListener('click', async () => {
    if (!state.report) return;
    try { await navigator.clipboard.writeText(`${state.before.name} → ${state.after.name}\n${C.brief(state.report)}\n${$('#rules-summary').textContent}`); status('Change brief copied.'); }
    catch { status('Clipboard access is unavailable. Select the change brief above to copy it manually, or save a report.'); }
  });
})();

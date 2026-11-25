// Token Launch Radar — the page. Plain script, no framework, no network: everything it shows
// comes from window.RADAR, the data.js main.ts writes beside dashboard/ from the same board it
// hands in as board.json. The detail view recomputes a row's implied value from the snapshot's
// figures and the printed model, and says whether it matches the board — page and data are the
// same arithmetic, checked in the open.
(function () {
  'use strict';

  var DATA = window.RADAR;
  var app = document.getElementById('board');
  if (!DATA || !app) return;

  var MULT = {};
  DATA.multiples.forEach(function (m) { MULT[m.category] = m.multiple; });

  // ---- state, seeded from the hash so a view can be linked (and screenshotted) exactly ----
  function hashState() {
    var s = { tab: 'board', q: '', cat: 'all', watch: false, sort: 'rank', dir: 1, detail: null };
    var h = window.location.hash.replace(/^#/, '');
    h.split('&').forEach(function (pair) {
      var kv = pair.split('=');
      if (kv.length !== 2) return;
      var k = kv[0], v = decodeURIComponent(kv[1]);
      if (k === 'tab' && (v === 'board' || v === 'live' || v === 'model')) s.tab = v;
      if (k === 'q') s.q = v;
      if (k === 'cat') s.cat = v;
      if (k === 'watch') s.watch = v === '1';
      if (k === 'detail') s.detail = v;
    });
    return s;
  }
  var state = hashState();

  // ---- formatting ----
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return '$' + Math.round(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(1) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + ' yrs';
    return Math.round(days) + ' days';
  }
  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // ---- the model, recomputed in the page from the row's own figures ----
  function clamp(n, lo, hi) { return Math.min(hi, Math.max(lo, n)); }
  function recompute(row) {
    var m = DATA.model;
    var multiple = MULT[row.category === null ? '(none)' : row.category];
    if (multiple === undefined) multiple = DATA.market_multiple;
    var growthPct = clamp(row.change_7d === null ? 0 : row.change_7d, m.growth_floor_pct, m.growth_cap_pct);
    var growth = Math.max(0.4, 1 + (growthPct / 100) * m.growth_weight);
    var age = row.age_days === null ? m.unknown_age_days : row.age_days;
    var readiness = m.readiness_base + (clamp(age, 0, m.readiness_days) / m.readiness_days) * m.readiness_range;
    var breadth = 1 + m.breadth_per_chain * Math.min(Math.max(row.chains.length - 1, 0), m.breadth_max_chains);
    return {
      multiple: multiple, growth: growth, readiness: readiness, breadth: breadth,
      implied: Math.max(1, Math.round(row.tvl_usd * multiple * growth * readiness * breadth))
    };
  }

  // ---- tiny DOM helper ----
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }
  function on(node, ev, fn) { node.addEventListener(ev, fn); return node; }

  // ---- masthead ----
  function masthead() {
    var head = el('header', 'masthead');
    head.appendChild(el('p', 'eyebrow', 'Token Launch Radar · model ' + DATA.model_version));
    var h1 = el('h1');
    h1.innerHTML = 'Pre-token protocols, <span class="thin">ranked by what a launch could be worth.</span>';
    head.appendChild(h1);
    var lede = el('p', 'lede');
    lede.innerHTML = 'Every protocol in the snapshot that records <strong>no token yet</strong>, priced from the snapshot\'s own figures: ' +
      'its TVL at the multiple the market already pays for its line of business, adjusted for growth, time tokenless and chain breadth. ' +
      'Protocols that already trade are <strong>never ranked</strong> — they sit in the live set at the market\'s own value, and they are the yardstick the multiples come from.';
    head.appendChild(lede);
    head.appendChild(el('p', 'source-line', 'Snapshot: ' + DATA.source + ' · as of ' + DATA.as_of + ' · watchlist floor ' + fmtUsd(DATA.floor_usd)));
    var stats = el('div', 'stats');
    [
      [String(DATA.scanned), '', 'protocols scanned'],
      [String(DATA.pre_token), '', 'record no token'],
      [String(DATA.watchlist_size), 'amber', 'on the watchlist'],
      [String(DATA.board_size), 'green', 'ranked on the board'],
      [String(DATA.live_size), '', 'live set aside']
    ].forEach(function (s) {
      var d = el('div', 'stat');
      d.appendChild(el('span', 'n ' + s[1], s[0]));
      d.appendChild(el('span', 'k', s[2]));
      stats.appendChild(d);
    });
    head.appendChild(stats);
    return head;
  }

  function tabs() {
    var bar = el('nav', 'tabs');
    [['board', 'The board'], ['live', 'Live tokens'], ['model', 'The model']].forEach(function (t) {
      var b = el('button', 'tab', t[1]);
      b.setAttribute('aria-selected', state.tab === t[0] ? 'true' : 'false');
      on(b, 'click', function () { state.tab = t[0]; render(); });
      bar.appendChild(b);
    });
    return bar;
  }

  // ---- board view ----
  function visibleRows() {
    var q = state.q.trim().toLowerCase();
    var rows = DATA.rows.filter(function (r) {
      if (state.watch && !r.watchlist) return false;
      if (state.cat !== 'all' && (r.category || '(none)') !== state.cat) return false;
      if (q && r.name.toLowerCase().indexOf(q) === -1 && r.slug.toLowerCase().indexOf(q) === -1) return false;
      return true;
    });
    var key = state.sort, dir = state.dir;
    rows.sort(function (a, b) {
      if (key === 'name') {
        var na = a.name.toLowerCase(), nb = b.name.toLowerCase();
        if (na !== nb) return (na < nb ? -1 : 1) * dir;
        return a.rank - b.rank;
      }
      if (key === 'rank') return (a.rank - b.rank) * dir;
      var va, vb;
      if (key === 'tvl') { va = a.tvl_usd; vb = b.tvl_usd; }
      else if (key === 'change') { va = a.change_7d === null ? -1e9 : a.change_7d; vb = b.change_7d === null ? -1e9 : b.change_7d; }
      else if (key === 'age') { va = a.age_days === null ? -1 : a.age_days; vb = b.age_days === null ? -1 : b.age_days; }
      else { va = a.implied_value_usd; vb = b.implied_value_usd; }
      if (va !== vb) return (vb - va) * dir; // dir 1: largest first
      return a.rank - b.rank;
    });
    return rows;
  }

  function boardView() {
    var wrap = el('section');
    var controls = el('div', 'controls');
    var search = el('input');
    search.type = 'search'; search.placeholder = 'Search name or slug…'; search.value = state.q;
    search.setAttribute('aria-label', 'Search protocols');
    on(search, 'input', function () { state.q = search.value; refreshTable(); });
    controls.appendChild(search);

    var catLabel = el('label', null, 'Category');
    var cat = el('select');
    var cats = {};
    DATA.rows.forEach(function (r) { cats[r.category || '(none)'] = true; });
    var all = el('option', null, 'All categories'); all.value = 'all'; cat.appendChild(all);
    Object.keys(cats).sort().forEach(function (c) {
      var o = el('option', null, c); o.value = c; cat.appendChild(o);
    });
    cat.value = state.cat;
    on(cat, 'change', function () { state.cat = cat.value; refreshTable(); });
    controls.appendChild(catLabel); controls.appendChild(cat);

    var checkLabel = el('label', 'check');
    var check = el('input');
    check.type = 'checkbox'; check.checked = state.watch;
    on(check, 'change', function () { state.watch = check.checked; refreshTable(); });
    checkLabel.appendChild(check);
    checkLabel.appendChild(document.createTextNode('Watchlist only'));
    controls.appendChild(checkLabel);

    var count = el('span', 'count-line');
    count.id = 'count-line';
    controls.appendChild(count);
    wrap.appendChild(controls);

    var detailHost = el('div');
    detailHost.id = 'detail-host';
    wrap.appendChild(detailHost);

    var tableHost = el('div');
    tableHost.id = 'table-host';
    wrap.appendChild(tableHost);

    function refreshTable() {
      var rows = visibleRows();
      count.textContent = rows.length + ' of ' + DATA.board_size + ' rows';
      tableHost.innerHTML = '';
      tableHost.appendChild(boardTable(rows));
      detailHost.innerHTML = '';
      if (state.detail) {
        var row = null;
        DATA.rows.forEach(function (r) { if (r.slug === state.detail) row = r; });
        if (row) detailHost.appendChild(detailPanel(row));
      }
    }
    wrap.refresh = refreshTable;
    return wrap;
  }

  function boardTable(rows) {
    var wrapT = el('div', 'table-wrap');
    if (rows.length === 0) { wrapT.appendChild(el('p', 'empty', 'No protocol matches that filter.')); return wrapT; }
    var table = el('table');
    var thead = el('thead');
    var trh = el('tr');
    var cols = [
      ['rank', '#', false], ['name', 'Protocol', true], ['cat', 'Category', false],
      ['chains', 'Chains', false], ['tvl', 'TVL', true], ['change', '7d', true],
      ['age', 'Tokenless for', true], ['implied', 'Implied value', true]
    ];
    cols.forEach(function (c) {
      var th = el('th', (c[0] === 'tvl' || c[0] === 'change' || c[0] === 'age' || c[0] === 'implied') ? 'num' : null, c[1]);
      if (c[0] === 'chains') th.className += ' chains-cell';
      if (c[2]) {
        th.className += ' sortable';
        if (state.sort === c[0]) th.appendChild(el('span', 'arrow', state.dir === 1 ? ' ↑' : ' ↓'));
        on(th, 'click', function () {
          if (state.sort === c[0]) state.dir = state.dir === 1 ? -1 : 1;
          else { state.sort = c[0]; state.dir = 1; }
          render();
        });
      }
      trh.appendChild(th);
    });
    thead.appendChild(trh);
    table.appendChild(thead);
    var tbody = el('tbody');
    rows.forEach(function (r) {
      var tr = el('tr');
      if (state.detail === r.slug) tr.className = 'selected';
      tr.appendChild(el('td', 'rank', String(r.rank)));
      var nameTd = el('td', 'name');
      nameTd.appendChild(document.createTextNode(r.name));
      var tag = el('span', 'tag' + (r.watchlist ? '' : ' early'), r.watchlist ? 'WATCH' : 'EARLY');
      nameTd.appendChild(tag);
      nameTd.appendChild(el('span', 'slug', r.slug));
      tr.appendChild(nameTd);
      tr.appendChild(el('td', null, r.category || '—'));
      var ch = el('td', 'chains chains-cell', r.chains.slice(0, 3).join(', ') + (r.chains.length > 3 ? ' +' + (r.chains.length - 3) : ''));
      tr.appendChild(ch);
      tr.appendChild(el('td', 'num', fmtUsd(r.tvl_usd)));
      var chg = el('td', 'num');
      var s = el('span', r.change_7d === null ? null : (r.change_7d >= 0 ? 'up' : 'down'), fmtPct(r.change_7d));
      chg.appendChild(s); tr.appendChild(chg);
      tr.appendChild(el('td', 'num', fmtAge(r.age_days)));
      tr.appendChild(el('td', 'num value', fmtUsd(r.implied_value_usd)));
      on(tr, 'click', function () {
        state.detail = state.detail === r.slug ? null : r.slug;
        render();
      });
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    wrapT.appendChild(table);
    return wrapT;
  }

  function kv(host, k, v, cls) {
    var row = el('div', 'kv');
    row.appendChild(el('span', 'k', k));
    row.appendChild(el('span', 'v' + (cls ? ' ' + cls : ''), v));
    host.appendChild(row);
  }

  function detailPanel(r) {
    var panel = el('article', 'detail');
    var close = el('button', 'close-btn', 'Close');
    on(close, 'click', function () { state.detail = null; render(); });
    panel.appendChild(close);
    panel.appendChild(el('h2', null, r.name));
    panel.appendChild(el('p', 'sub', r.slug + ' · rank #' + r.rank + (r.watchlist ? ' · on the house watchlist' : ' · early radar pick') + ' · ' + (r.category || 'no category')));
    var grid = el('div', 'detail-grid');

    var left = el('div');
    left.appendChild(el('h3', null, 'From the snapshot'));
    kv(left, 'TVL', fmtUsd(r.tvl_usd));
    kv(left, 'TVL change, 7 days', fmtPct(r.change_7d));
    kv(left, 'Chains with TVL', String(r.chains.length) + (r.chains.length ? ' — ' + r.chains.join(', ') : ''));
    kv(left, 'Tracked since', r.listed_at || 'unknown');
    kv(left, 'Tokenless for', fmtAge(r.age_days));
    kv(left, 'Token today', 'none recorded');
    grid.appendChild(left);

    var mid = el('div');
    mid.appendChild(el('h3', null, 'The model, recomputed here'));
    var rc = recompute(r);
    kv(mid, 'Category multiple', '×' + rc.multiple.toFixed(3));
    kv(mid, 'Growth factor (7d ' + fmtPct(r.change_7d) + ')', '×' + rc.growth.toFixed(3));
    kv(mid, 'Readiness factor', '×' + rc.readiness.toFixed(3));
    kv(mid, 'Breadth factor', '×' + rc.breadth.toFixed(3));
    kv(mid, 'Implied value', fmtUsd(r.implied_value_usd), 'green');
    var check = el('p', 'check-line', rc.implied === r.implied_value_usd
      ? 'Recomputed on this page: ' + fmtUsd(rc.implied) + ' — matches board.json.'
      : 'Recomputed on this page: ' + fmtUsd(rc.implied) + ' — differs from the board; the board was priced by main.ts.');
    mid.appendChild(check);
    grid.appendChild(mid);

    var right = el('div');
    right.appendChild(el('h3', null, 'Farm plan'));
    var ol = el('ol', 'steps');
    r.farm_steps.forEach(function (s) { ol.appendChild(el('li', null, s)); });
    right.appendChild(ol);
    grid.appendChild(right);

    panel.appendChild(grid);
    return panel;
  }

  // ---- live view ----
  function liveView() {
    var wrap = el('section');
    var p = el('p', 'prose');
    p.innerHTML = 'These protocols <strong>already have a token</strong>. The radar never ranks them: it shows the market\'s own ' +
      'value for them, and reads its category multiples off their market caps. If a name you expected on the board is here, that is why.';
    wrap.appendChild(p);
    var tw = el('div', 'table-wrap');
    var table = el('table');
    var thead = el('thead');
    var trh = el('tr');
    ['Protocol', 'Category', 'TVL', 'Market cap', '7d', 'Token'].forEach(function (h, i) {
      trh.appendChild(el('th', i >= 2 && i <= 4 ? 'num' : null, h));
    });
    thead.appendChild(trh); table.appendChild(thead);
    var tbody = el('tbody');
    DATA.live.forEach(function (r) {
      var tr = el('tr');
      var nameTd = el('td', 'name');
      nameTd.appendChild(document.createTextNode(r.name));
      nameTd.appendChild(el('span', 'slug', r.slug));
      tr.appendChild(nameTd);
      tr.appendChild(el('td', null, r.category || '—'));
      tr.appendChild(el('td', 'num', fmtUsd(r.tvl_usd)));
      tr.appendChild(el('td', 'num value', fmtUsd(r.mcap_usd)));
      var chg = el('td', 'num');
      chg.appendChild(el('span', r.change_7d === null ? null : (r.change_7d >= 0 ? 'up' : 'down'), fmtPct(r.change_7d)));
      tr.appendChild(chg);
      tr.appendChild(el('td', null, r.symbol || '—'));
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    tw.appendChild(table);
    wrap.appendChild(tw);
    return wrap;
  }

  // ---- model view ----
  function modelView() {
    var wrap = el('section');
    var p = el('p', 'prose');
    p.innerHTML = 'One formula prices every row. Nothing is keyed to a protocol\'s name: change the snapshot and the board changes. ' +
      'The <strong>category multiple</strong> is the median market-cap-to-TVL ratio of that category\'s already-token protocols in this snapshot ' +
      '(at least ' + DATA.model.min_live_for_multiple + ' live protocols, else the market-wide median), clamped to [' +
      DATA.model.multiple_floor + ', ' + DATA.model.multiple_cap + '].';
    wrap.appendChild(p);
    wrap.appendChild(el('div', 'formula',
      'implied = TVL × category multiple × growth factor × readiness × breadth'));
    var p2 = el('p', 'prose');
    p2.innerHTML = '<strong>Growth</strong>: the 7-day TVL change, clamped to [' + DATA.model.growth_floor_pct + '%, +' + DATA.model.growth_cap_pct + '%], ' +
      'worth ' + DATA.model.growth_weight + ' of itself, floored at ×0.40 so a bad week discounts but never zeroes a protocol. ' +
      '<strong>Readiness</strong>: ×' + DATA.model.readiness_base + ' on day one rising to ×' + (DATA.model.readiness_base + DATA.model.readiness_range).toFixed(2) +
      ' after ' + DATA.model.readiness_days + ' tokenless days — the longer a sizeable protocol runs without a token, the more a launch is worth waiting for. ' +
      '<strong>Breadth</strong>: +' + (DATA.model.breadth_per_chain * 100) + '% per extra chain with TVL, up to ' + DATA.model.breadth_max_chains + ' extra chains. ' +
      'A protocol of unknown age is scored as ' + DATA.model.unknown_age_days + ' days old.';
    wrap.appendChild(p2);
    var h = el('h3', null, 'Category multiples read off this snapshot');
    h.style.margin = '20px 0 10px';
    wrap.appendChild(h);
    var tw = el('div', 'table-wrap mult-table');
    var table = el('table');
    var thead = el('thead');
    var trh = el('tr');
    ['Category', 'Live protocols', 'Multiple'].forEach(function (x, i) { trh.appendChild(el('th', i > 0 ? 'num' : null, x)); });
    thead.appendChild(trh); table.appendChild(thead);
    var tbody = el('tbody');
    DATA.multiples.forEach(function (m) {
      var tr = el('tr');
      tr.appendChild(el('td', null, m.category));
      tr.appendChild(el('td', 'num', String(m.live)));
      tr.appendChild(el('td', 'num value', '×' + m.multiple.toFixed(3)));
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    tw.appendChild(table);
    wrap.appendChild(tw);
    var p3 = el('p', 'prose');
    p3.style.marginTop = '14px';
    p3.textContent = 'Market-wide median multiple: ×' + DATA.market_multiple.toFixed(3) + '. Board: ' + DATA.board_size +
      ' rows — every one of the ' + DATA.watchlist_size + ' watchlist protocols, every other pre-token protocol below the ' +
      fmtUsd(DATA.floor_usd) + ' floor that is not an exchange or a versioned pool (' + DATA.early_size + ' early rows), and nothing with a token.';
    wrap.appendChild(p3);
    return wrap;
  }

  function render() {
    app.innerHTML = '';
    app.appendChild(masthead());
    app.appendChild(tabs());
    var view = state.tab === 'live' ? liveView() : state.tab === 'model' ? modelView() : boardView();
    app.appendChild(view);
    if (view.refresh) view.refresh();
    var foot = el('footer');
    foot.innerHTML = 'Implied values are this entry\'s own claims, computed from the snapshot named above — not prices, not predictions of a launch date. ' +
      'Farm plans are starting points: check the protocol\'s own site before moving funds. <span class="mono">model ' + esc(DATA.model_version) + '</span>';
    app.appendChild(foot);
    app.setAttribute('aria-busy', 'false');
    if (state.detail && state.tab === 'board') {
      var host = document.getElementById('detail-host');
      if (host) host.scrollIntoView();
    }
  }

  render();
})();

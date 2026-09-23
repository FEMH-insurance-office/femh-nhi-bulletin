// 支付標準查詢。6,173 筆全部在瀏覽器比對——整份掃完是個位數毫秒，
// 不值得為此架伺服器，也才能做成 GitHub Pages 上的靜態站。
//
// 網址就是狀態：?q= 是關鍵字、?code= 是單一項目。重新整理、上一頁、
// 貼給同事都會回到同一個畫面。這跟公告查詢是同一條規則。
(function () {
  'use strict';

  var PAGE = 100;                    // 一次畫 100 列，按「載入更多」再畫
  var data = null, notes = null, titles = {};
  var view = [], shown = 0;

  function $(id) { return document.getElementById(id); }
  var sq = $('sq'), body = $('sbody'), table = $('stable'), count = $('scount');
  var more = $('smore'), empty = $('sempty'), detail = $('sdetail');

  try { titles = JSON.parse($('ann-titles').textContent) || {}; } catch (e) { titles = {}; }

  function num(n) {
    return (n === null || n === '' || n === undefined) ? '—' : Number(n).toLocaleString('en-US');
  }

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  function params() { return new URLSearchParams(location.search); }

  function setUrl(p) {
    var s = p.toString();
    history.pushState(null, '', location.pathname + (s ? '?' + s : ''));
  }

  // 規範文字 1 MB，只有點開項目時才需要。不該讓只想查點數的人都等它。
  function loadNotes() {
    if (notes) { return Promise.resolve(notes); }
    return fetch('../data/standard-notes.json')
      .then(function (r) { return r.json(); })
      .then(function (d) { notes = d; return d; });
  }

  // 中文沒有詞界，斷詞只會把「心肺甦醒術」拆得搜不到，直接比子字串反而準。
  function match(row, q) {
    if (!q) { return true; }
    return row[0].toLowerCase().indexOf(q) >= 0 ||
           row[1].toLowerCase().indexOf(q) >= 0;
  }

  function compute() {
    var p = params();
    var q = (p.get('q') || '').trim().toLowerCase();
    var onlyNote = $('onlynote').checked;
    var onlyChanged = $('onlychanged').checked;
    var sort = $('ssort').value;
    var hist = data.history || {};

    view = data.items.filter(function (r) {
      if (!match(r, q)) { return false; }
      if (onlyNote && !r[4]) { return false; }
      if (onlyChanged && !hist[r[0]]) { return false; }
      return true;
    });

    view.sort(function (a, b) {
      if (sort === 'points-desc') { return (b[2] || 0) - (a[2] || 0) || a[0].localeCompare(b[0]); }
      if (sort === 'points-asc') { return (a[2] || 0) - (b[2] || 0) || a[0].localeCompare(b[0]); }
      if (sort === 'from-desc') { return (b[3] || '').localeCompare(a[3] || '') || a[0].localeCompare(b[0]); }
      return a[0].localeCompare(b[0]);
    });

    shown = 0;
    body.innerHTML = '';
    draw();
  }

  function draw() {
    var frag = document.createDocumentFragment();
    var end = Math.min(shown + PAGE, view.length);
    for (var i = shown; i < end; i++) {
      var r = view[i];
      var tr = document.createElement('tr');
      tr.innerHTML =
        '<td><button type="button" class="codebtn" data-code="' + esc(r[0]) + '">' +
          esc(r[0]) + '</button></td>' +
        '<td>' + esc(r[1] || '—') +
          (r[4] ? ' <em class="hasnote">規範</em>' : '') + '</td>' +
        '<td class="n">' + num(r[2]) + '</td>' +
        '<td>' + esc(r[3] || '—') + '</td>';
      frag.appendChild(tr);
    }
    body.appendChild(frag);
    shown = end;

    table.hidden = view.length === 0;
    empty.hidden = view.length !== 0;
    more.hidden = shown >= view.length;
    more.textContent = '載入更多（還有 ' + (view.length - shown).toLocaleString('en-US') + ' 項）';
    count.textContent = view.length.toLocaleString('en-US') + ' 項' +
      (view.length > shown ? '，目前顯示前 ' + shown.toLocaleString('en-US') + ' 項' : '');
  }

  function find(code) {
    for (var i = 0; i < data.items.length; i++) {
      if (data.items[i][0] === code) { return data.items[i]; }
    }
    return null;
  }

  function showCode(code) {
    var row = find(code);
    if (!row) {
      detail.innerHTML = '<div class="stdcard"><p class="empty">查無代碼 ' + esc(code) +
        '。它可能已經停用，或不屬於診療項目——藥品與特材不在本頁範圍。</p>' +
        '<button type="button" class="back" id="sback">← 回到清單</button></div>';
      detail.hidden = false;
      table.hidden = true; more.hidden = true; empty.hidden = true; count.textContent = '';
      bindBack();
      return;
    }

    loadNotes().then(function (nt) {
      var note = nt[code];
      var refs = (data.refs && data.refs[code]) || [];
      var hist = (data.history && data.history[code]) || [];

      var h = '<div class="stdcard">' +
        '<button type="button" class="back" id="sback">← 回到清單</button>' +
        '<h2><code>' + esc(code) + '</code> ' + esc(row[1] || '') + '</h2>' +
        '<dl class="stdmeta">' +
          '<div><dt>支付點數</dt><dd class="big">' + num(row[2]) + '</dd></div>' +
          '<div><dt>生效日期</dt><dd>' + esc(row[3] || '—') + '</dd></div>' +
          '<div><dt>資料快照</dt><dd>' + esc(data.snapshot) + '</dd></div>' +
        '</dl>';

      h += note
        ? '<h3>規範</h3><div class="stdnote">' + esc(note) + '</div>'
        : '<p class="muted">健保署的支付標準未對本項列載規範說明。</p>';

      if (hist.length) {
        h += '<h3>異動紀錄</h3><ul class="stdhist">';
        for (var i = 0; i < hist.length; i++) {
          var x = hist[i];
          var isPts = x[1] === 'points';
          h += '<li><span class="when">' + esc(x[0]) + '</span> ' +
               (isPts ? '支付點數' : '生效日期') + ' ' +
               '<s>' + (isPts ? num(x[2]) : esc(x[2] || '—')) + '</s> → ' +
               '<b>' + (isPts ? num(x[3]) : esc(x[3] || '—')) + '</b></li>';
        }
        h += '</ul><p class="muted">自本站開始留存快照起累積，先前的異動不在其中。</p>';
      }

      if (refs.length) {
        h += '<h3>動過這個項目的公告</h3><ul class="stdrefs">';
        for (var j = 0; j < refs.length; j++) {
          h += '<li><a href="../announcements/' + encodeURIComponent(refs[j]) + '/">' +
               esc(titles[refs[j]] || refs[j]) + '</a></li>';
        }
        h += '</ul>';
      }

      h += '</div>';
      detail.innerHTML = h;
      detail.hidden = false;
      table.hidden = true; more.hidden = true; empty.hidden = true; count.textContent = '';
      bindBack();
      // 回到頂端而不是捲到卡片：卡片顯示時表格是隱藏的，整頁就只有它，
      // 捲過去只會在上面留一大片空白。直接貼網址進來的人尤其明顯。
      window.scrollTo({ top: 0 });
    });
  }

  function bindBack() {
    var b = $('sback');
    if (!b) { return; }
    b.addEventListener('click', function () {
      var p = params();
      p.delete('code');
      setUrl(p);
      apply();
    });
  }

  function apply() {
    var p = params();
    var code = p.get('code');
    sq.value = p.get('q') || '';
    if (code) { showCode(code.trim().toUpperCase()); return; }
    detail.hidden = true;
    detail.innerHTML = '';
    compute();
  }

  $('stdbar').addEventListener('submit', function (e) {
    e.preventDefault();
    var p = params();
    p.delete('code');
    if (sq.value.trim()) { p.set('q', sq.value.trim()); } else { p.delete('q'); }
    setUrl(p);
    apply();
  });

  ['onlynote', 'onlychanged', 'ssort'].forEach(function (id) {
    $(id).addEventListener('change', compute);
  });

  more.addEventListener('click', draw);

  document.addEventListener('click', function (e) {
    var b = e.target.closest ? e.target.closest('.codebtn') : null;
    if (!b) { return; }
    var p = params();
    p.set('code', b.dataset.code);
    setUrl(p);
    apply();
  });

  window.addEventListener('popstate', apply);

  fetch('../data/standard.json')
    .then(function (r) { return r.json(); })
    .then(function (d) { data = d; apply(); })
    .catch(function (err) {
      count.textContent = '資料載入失敗，請重新整理。';
      if (window.console) { console.error(err); }
    });
})();

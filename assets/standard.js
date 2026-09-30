// 給付規則查詢。健保署的兩份給付依據合在一頁：
//   支付標準      6,173 項  主鍵是健保代碼，有支付點數
//   藥品給付規定    526 條  主鍵是節次，沒有代碼也沒有點數
// 欄位完全不同，所以是兩份資料、兩張表，共用一個查詢框。
//
// 全部在瀏覽器比對——整份掃完是個位數毫秒，不值得為此架伺服器，
// 也才能做成 GitHub Pages 上的靜態站。
//
// 網址就是狀態：?q= 是關鍵字、?code= 是單一診療項目、?sec= 是單一給付規定。
// 重新整理、上一頁、貼給同事都會回到同一個畫面。
(function () {
  'use strict';

  var PAGE = 100;                    // 一次畫 100 列，按「載入更多」再畫
  var data = null, notes = null, titles = {};
  var drug = null, dnotes = null, dwant = false;
  var view = [], shown = 0;          // 診療項目
  var dview = [], dshown = 0;        // 藥品給付規定

  function $(id) { return document.getElementById(id); }
  var sq = $('sq'), body = $('sbody'), count = $('scount');
  var more = $('smore'), empty = $('sempty'), detail = $('sdetail');
  var dbody = $('dbody'), dmore = $('dmore');
  var gstd = $('gstd'), gdrug = $('gdrug');

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

  function kind() {
    var r = document.querySelector('input[name="kind"]:checked');
    return r ? r.value : 'all';
  }

  // ---- 兩份條文都是點開才需要，不該讓只想查點數的人開頁就等 ----

  function loadNotes() {
    if (notes) { return Promise.resolve(notes); }
    return fetch('../data/standard-notes.json')
      .then(function (r) { return r.json(); })
      .then(function (d) { notes = d; return d; });
  }

  // 藥品給付規定的條文 1 MB。名稱搜尋用索引就夠，但查「乳癌」「肝炎」這種
  // 要比對條文內容——而那才是這份資料真正有用的查法。所以一碰到查詢框就
  // 先抓，等按下搜尋通常已經到了；真的還沒到就先用名稱搜，回來再重跑一次。
  function loadDrugNotes() {
    if (dnotes) { return Promise.resolve(dnotes); }
    if (!loadDrugNotes.p) {
      loadDrugNotes.p = fetch('../data/drugreg-notes.json')
        .then(function (r) { return r.json(); })
        .then(function (d) {
          dnotes = d;
          if (dwant) { dwant = false; compute(); }   // 搜尋等過它，補畫
          return d;
        })
        .catch(function () { dnotes = {}; return {}; });
    }
    return loadDrugNotes.p;
  }

  // 中文沒有詞界，斷詞只會把「心肺甦醒術」拆得搜不到，直接比子字串反而準。
  function hit(s, q) { return String(s || '').toLowerCase().indexOf(q) >= 0; }

  function match(row, q) {
    if (!q) { return true; }
    return hit(row[0], q) || hit(row[1], q);
  }

  function dmatch(row, q) {
    if (!q) { return true; }
    // 節次(9.1.2)與成分名一定比；條文要等 1 MB 的檔到了才比得到
    if (hit(row[0], q) || hit(row[2], q)) { return true; }
    if (!dnotes) { dwant = true; return false; }
    var n = dnotes[row[0]];
    return !!(n && hit(n.b, q));
  }

  function compute() {
    var p = params();
    var q = (p.get('q') || '').trim().toLowerCase();
    var onlyNote = $('onlynote').checked;
    var onlyChanged = $('onlychanged').checked;
    var sort = $('ssort').value;
    var hist = (data && data.history) || {};
    var k = kind();

    view = (k === 'drug' || !data) ? [] : data.items.filter(function (r) {
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

    // 藥品給付規定不吃「有規範說明」「有異動紀錄」這兩個篩選——
    // 前者它條條都有，後者它根本沒有這種資料。勾了就等於沒有藥品結果，
    // 那會讓人以為是查不到，所以直接把整區收起來。
    var skipDrug = k === 'std' || onlyNote || onlyChanged || !drug;
    dview = skipDrug ? [] : drug.items.filter(function (r) { return dmatch(r, q); });
    dview.sort(function (a, b) { return cmpSec(a[0], b[0]); });

    // 有查詢需要比對條文，但 1 MB 還沒到——把它抓下來，回來自己重跑。
    // 少了這一步，直接貼「?q=乳癌」的網址進來會顯示藥品 0 條，
    // 而在框裡打同一個字卻查得到，同一個網址兩種結果最難查。
    if (dwant && !skipDrug) { loadDrugNotes(); }

    shown = 0; dshown = 0;
    body.innerHTML = ''; dbody.innerHTML = '';
    draw(); ddraw();

    gstd.hidden = view.length === 0;
    gdrug.hidden = dview.length === 0;
    var total = view.length + dview.length;
    count.textContent = total ? total.toLocaleString('en-US') + ' 項' : '';

    // **這兩個篩選只適用於診療項目**：藥品給付規定條條都是規範，也沒有
    // 點數異動可比。勾起來時整個藥品區會消失——不講清楚就變成
    // 「明明查得到，勾一下就說查不到」，而使用者不會聯想到是勾選造成的。
    var muted = (onlyNote || onlyChanged) && k !== 'std' && drug;
    var hint = $('shint');
    hint.hidden = !muted;
    if (muted) {
      hint.textContent = '「只看有規範說明的」「只看有異動紀錄的」只適用於診療項目，' +
        '已暫時不列藥品給付規定。';
    }
    empty.hidden = !(total === 0 && !muted);
  }

  // 9.2 要排在 9.10 前面，直接比字串會變成 9.10 < 9.2。
  function cmpSec(a, b) {
    var x = a.split('.'), y = b.split('.');
    for (var i = 0; i < Math.max(x.length, y.length); i++) {
      var d = (parseInt(x[i], 10) || 0) - (parseInt(y[i], 10) || 0);
      if (d) { return d; }
    }
    return 0;
  }

  function draw() {
    var frag = document.createDocumentFragment();
    var end = Math.min(shown + PAGE, view.length);
    for (var i = shown; i < end; i++) {
      var r = view[i];
      var name = r[1]
        ? '<button type="button" class="namebtn" data-code="' + esc(r[0]) + '">' +
            esc(r[1]) + '</button>'
        : '—';
      var tr = document.createElement('tr');
      tr.innerHTML =
        '<td><button type="button" class="codebtn" data-code="' + esc(r[0]) + '">' +
          esc(r[0]) + '</button></td>' +
        '<td>' + name + (r[4] ? ' <em class="hasnote">規範</em>' : '') + '</td>' +
        '<td class="n">' + num(r[2]) + '</td>' +
        '<td>' + esc(r[3] || '—') + '</td>';
      frag.appendChild(tr);
    }
    body.appendChild(frag);
    shown = end;

    more.hidden = shown >= view.length;
    more.textContent = '載入更多（還有 ' + (view.length - shown).toLocaleString('en-US') + ' 項）';
    $('ccount').textContent = view.length.toLocaleString('en-US') + ' 項' +
      (view.length > shown ? '，顯示前 ' + shown.toLocaleString('en-US') : '');
  }

  function ddraw() {
    var frag = document.createDocumentFragment();
    var end = Math.min(dshown + PAGE, dview.length);
    for (var i = dshown; i < end; i++) {
      var r = dview[i];
      var ch = (drug.chapters && drug.chapters[r[1]]) || {};
      var tr = document.createElement('tr');
      tr.innerHTML =
        '<td><button type="button" class="codebtn" data-sec="' + esc(r[0]) + '">' +
          esc(r[0]) + '</button></td>' +
        '<td><button type="button" class="namebtn" data-sec="' + esc(r[0]) + '">' +
          esc(r[2]) + '</button></td>' +
        '<td class="chcell">第' + esc(r[1]) + '節 ' + esc(ch.title || '') + '</td>' +
        '<td>' + esc(r[3] || '—') + '</td>';
      frag.appendChild(tr);
    }
    dbody.appendChild(frag);
    dshown = end;

    dmore.hidden = dshown >= dview.length;
    dmore.textContent = '載入更多（還有 ' + (dview.length - dshown).toLocaleString('en-US') + ' 條）';
    $('dcount').textContent = dview.length.toLocaleString('en-US') + ' 條' +
      (dview.length > dshown ? '，顯示前 ' + dshown.toLocaleString('en-US') : '');
  }

  function find(code) {
    for (var i = 0; i < data.items.length; i++) {
      if (data.items[i][0] === code) { return data.items[i]; }
    }
    return null;
  }

  function dfind(sec) {
    for (var i = 0; i < drug.items.length; i++) {
      if (drug.items[i][0] === sec) { return drug.items[i]; }
    }
    return null;
  }

  function showDetail(html) {
    detail.innerHTML = '<div class="stdcard">' +
      '<button type="button" class="back" id="sback">← 回到清單</button>' + html + '</div>';
    detail.hidden = false;
    gstd.hidden = true; gdrug.hidden = true;
    more.hidden = true; dmore.hidden = true; empty.hidden = true;
    count.textContent = '';
    bindBack();
    // 回到頂端而不是捲到卡片：卡片顯示時清單是隱藏的，整頁就只有它，
    // 捲過去只會在上面留一大片空白。直接貼網址進來的人尤其明顯。
    window.scrollTo({ top: 0 });
  }

  function refsHtml(list, heading) {
    if (!list || !list.length) { return ''; }
    var h = '<h3>' + heading + '</h3><ul class="stdrefs">';
    for (var j = 0; j < list.length; j++) {
      h += '<li><a href="../announcements/' + encodeURIComponent(list[j]) + '/">' +
           esc(titles[list[j]] || list[j]) + '</a></li>';
    }
    return h + '</ul>';
  }

  function showCode(code) {
    var row = find(code);
    if (!row) {
      showDetail('<p class="empty">查無健保代碼 ' + esc(code) +
        '。它可能已經停用，或不屬於診療項目——藥品與特材不在支付標準裡，' +
        '藥品請改查藥品給付規定。</p>');
      return;
    }

    loadNotes().then(function (nt) {
      var note = nt[code];
      var hist = (data.history && data.history[code]) || [];

      var h = '<h2><code>' + esc(code) + '</code> ' + esc(row[1] || '') + '</h2>' +
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

      h += refsHtml((data.refs && data.refs[code]) || [], '動過這個項目的公告');
      showDetail(h);
    });
  }

  function showSec(sec) {
    var row = drug && dfind(sec);
    if (!row) {
      showDetail('<p class="empty">查無節次 ' + esc(sec) +
        '。它可能已經刪除，或不在藥品給付規定裡。</p>');
      return;
    }

    loadDrugNotes().then(function (nt) {
      var n = nt[sec] || {};
      var ch = (drug.chapters && drug.chapters[row[1]]) || {};

      var h = '<h2><code>' + esc(sec) + '</code> ' + esc(row[2]) + '</h2>' +
        '<dl class="stdmeta">' +
          '<div><dt>所屬章節</dt><dd>第' + esc(row[1]) + '節 ' + esc(ch.title || '') + '</dd></div>' +
          '<div><dt>條文版本</dt><dd>' + esc(ch.version || '—') + '</dd></div>' +
        '</dl>';

      // 修訂日一整串是這份資料獨有的——支付標準只有單一生效日。
      // 它其實就是這條給付規定的沿革，直接當歷程顯示。
      if (n.d && n.d.length) {
        h += '<h3>歷次修訂</h3><p class="stddates">';
        for (var i = 0; i < n.d.length; i++) {
          h += '<span class="d' + (i === n.d.length - 1 ? ' last' : '') + '">' +
               esc(n.d[i]) + '</span>';
        }
        h += '</p><p class="muted">最右為最近一次修訂。日期取自條文原文，為民國年。</p>';
      }

      h += n.b
        ? '<h3>給付規定原文</h3><div class="stdnote reg">' + esc(n.b) + '</div>'
        : '<p class="muted">本條的規定內容寫在標題行上，見上方藥品成分欄。</p>';

      h += refsHtml((drug.refs && drug.refs[sec]) || [], '動過這一條的公告');

      h += '<p class="stdsrc">原文出自健保署「藥品給付規定」' +
           (ch.partial ? '完整版' : '第' + esc(row[1]) + '節分章節檔') +
           '（' + esc(ch.version || '') + ' 版），原封轉載未經改寫。' +
           '申報請以健保署最新公告為準。</p>';
      showDetail(h);
    });
  }

  function bindBack() {
    var b = $('sback');
    if (!b) { return; }
    b.addEventListener('click', function () {
      var p = params();
      p.delete('code'); p.delete('sec');
      setUrl(p);
      apply();
    });
  }

  function apply() {
    var p = params();
    sq.value = p.get('q') || '';
    var code = p.get('code'), sec = p.get('sec');
    if (code) { showCode(code.trim().toUpperCase()); return; }
    if (sec) { showSec(sec.trim()); return; }
    detail.hidden = true;
    detail.innerHTML = '';
    compute();
  }

  $('stdbar').addEventListener('submit', function (e) {
    e.preventDefault();
    var p = params();
    p.delete('code'); p.delete('sec');
    if (sq.value.trim()) { p.set('q', sq.value.trim()); } else { p.delete('q'); }
    setUrl(p);
    apply();
  });

  // 一碰查詢框就先抓條文，讓「查適應症」這種用法不必等
  sq.addEventListener('focus', loadDrugNotes, { once: true });

  ['onlynote', 'onlychanged', 'ssort'].forEach(function (id) {
    $(id).addEventListener('change', compute);
  });
  document.querySelectorAll('input[name="kind"]').forEach(function (r) {
    r.addEventListener('change', compute);
  });

  more.addEventListener('click', draw);
  dmore.addEventListener('click', ddraw);

  document.addEventListener('click', function (e) {
    var b = e.target.closest ? e.target.closest('[data-code],[data-sec]') : null;
    if (!b) { return; }
    var p = params();
    p.delete('code'); p.delete('sec');
    if (b.dataset.sec) { p.set('sec', b.dataset.sec); }
    else { p.set('code', b.dataset.code); }
    setUrl(p);
    apply();
  });

  window.addEventListener('popstate', apply);

  // 兩份索引一起載。**其中一份掛掉不該讓整頁空白**——規範庫是另一套系統
  // 每週更新的，它沒產出時支付標準還是要查得到。
  Promise.all([
    fetch('../data/standard.json').then(function (r) { return r.json(); })
      .catch(function () { return null; }),
    fetch('../data/drugreg.json').then(function (r) { return r.json(); })
      .catch(function () { return null; })
  ]).then(function (both) {
    data = both[0];
    drug = both[1];
    if (!data && !drug) {
      count.textContent = '資料載入失敗，請重新整理。';
      return;
    }
    if (!drug) { document.querySelector('.stdkind').hidden = true; }
    apply();
  });
})();

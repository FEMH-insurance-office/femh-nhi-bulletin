// 給付規則查詢。健保署的三份給付依據合在一頁：
//   支付標準      6,173 項  主鍵是健保代碼，有支付點數
//   藥品給付規定    528 條  主鍵是節次，沒有代碼也沒有點數
//   特殊材料      8,438 項  主鍵是特材代碼，有點數，條文另成一份用「給付規定代碼」連過去
// 欄位完全不同，所以是三份資料、三張表，共用一個查詢框。
//
// 全部在瀏覽器比對——整份掃完是個位數毫秒，不值得為此架伺服器，
// 也才能做成 GitHub Pages 上的靜態站。
//
// 網址就是狀態：?q= 關鍵字、?code= 診療項目、?sec= 藥品給付規定、
// ?tz= 特材品項、?tzr= 特材給付規定。重新整理、上一頁、貼給同事都回到同一個畫面。
(function () {
  'use strict';

  var PAGE = 100;                    // 一次畫 100 列，按「載入更多」再畫
  var data = null, notes = null, titles = {};
  var drug = null, dnotes = null, dwant = false;
  var tz = null, tzwant = false, tzdetail = {};
  var view = [], shown = 0;          // 診療項目
  var dview = [], dshown = 0;        // 藥品給付規定
  var tview = [], tshown = 0;        // 特材
  var tsnip = {};                    // 這次查詢：特材規定碼 → 條文片段（只有條文命中時才有）

  function $(id) { return document.getElementById(id); }
  var sq = $('sq'), body = $('sbody'), count = $('scount');
  var more = $('smore'), empty = $('sempty'), detail = $('sdetail');
  var dbody = $('dbody'), dmore = $('dmore');
  var tbody = $('tbody'), tmore = $('tmore');
  var gstd = $('gstd'), gdrug = $('gdrug'), gtz = $('gtz');
  var hasTz = !!gtz;                 // 規範庫沒有特材資料時模板不會產這一區
  var FILTERS = Array.prototype.slice.call(document.querySelectorAll('.stdopts input[type="checkbox"]'));
  var GROUP_NAME = { std: '診療項目', drug: '藥品給付規定', tz: '特材' };

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

  var DETAIL_KEYS = ['code', 'sec', 'tz', 'tzr'];
  function clearDetail(p) { DETAIL_KEYS.forEach(function (k) { p.delete(k); }); }

  function kind() {
    var r = document.querySelector('input[name="kind"]:checked');
    return r ? r.value : 'all';
  }

  // ---- 條文都是用到才抓，不該讓只想查點數的人開頁就等 ----

  function loadNotes() {
    if (notes) { return Promise.resolve(notes); }
    return fetch('../data/standard-notes.json')
      .then(function (r) { return r.json(); })
      .then(function (d) { notes = d; return d; });
  }

  // 支付標準代碼 → 提到它的特材條文。約 75 KB，點開診療項目才抓。
  var mentions = null;
  function loadMentions() {
    if (!hasTz) { return Promise.resolve({ codes: {} }); }
    if (mentions) { return Promise.resolve(mentions); }
    return fetch('../data/tezai-mentions.json')
      .then(function (r) { return r.ok ? r.json() : { codes: {} }; })
      .catch(function () { return { codes: {} }; })
      .then(function (d) { mentions = d; return d; });
  }

  // 抓回來之後要不要重畫清單：只有「清單正顯示著、而且這次查詢等過它」才重畫。
  // 詳細頁開著的時候重畫，會把清單整片疊回詳細頁底下。
  function redrawIfWaiting(flag) {
    if (flag && detail.hidden) { compute(); }
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
          var w = dwant; dwant = false; redrawIfWaiting(w);
          return d;
        })
        .catch(function () { dnotes = {}; return {}; });
    }
    return loadDrugNotes.p;
  }

  // 特材 8,400 項＋條文，壓縮後約 310 KB，開頁後在背景抓。
  // 它排在中間（診療項目 → 特材 → 藥品），所以等它的時候藥品區也先不畫：
  // 不然特材晚到，會把已經畫好的藥品區整片往下推，正在看的人畫面一跳。
  // 藥品在最下面，晚一點出現不會推動任何東西。
  var tzFailed = false;
  function loadTz() {
    if (!hasTz || tzFailed) { return Promise.resolve(null); }
    if (tz) { return Promise.resolve(tz); }
    if (!loadTz.p) {
      loadTz.p = fetch('../data/tezai.json')
        .then(function (r) { if (!r.ok) { throw new Error(r.status); } return r.json(); })
        .then(function (d) { tz = d; })
        // 抓不到就當作沒有特材，**一定要重畫**：不然藥品區會一直等它
        .catch(function () { tzFailed = true; })
        .then(function () {
          var w = tzwant; tzwant = false; redrawIfWaiting(w);
          return tz;
        });
    }
    return loadTz.p;
  }

  // 規格、許可證、申請者…原始 2.9 MB，依代碼前綴拆檔，點一個只抓那一份。
  // 前綴長短不一（品項多的那類拆得比較細），清單照長到短排好，取第一個相符的。
  function shardOf(code) {
    var s = (tz && tz.shards) || [];
    for (var i = 0; i < s.length; i++) {
      if (code.indexOf(s[i]) === 0) { return s[i]; }
    }
    return code.slice(0, 2);
  }

  function loadTzDetail(code) {
    var k = shardOf(code);
    if (tzdetail[k]) { return Promise.resolve(tzdetail[k]); }
    return fetch('../data/tezai-detail/' + encodeURIComponent(k) + '.json')
      .then(function (r) { return r.ok ? r.json() : {}; })
      .catch(function () { return {}; })
      .then(function (d) { tzdetail[k] = d; return d; });
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

  // 條文命中時，清單上要露出命中的那一句。**不能只說「命中條文」**：
  // 查 19007C 會帶出一批特材，而它們的條文寫的全是「不得同時併報超音波導引(19007C)」。
  // 不把句子露出來，看起來就像「這個診療項目要搭配這些特材」——正好說反了。
  function snippet(text, q) {
    var low = text.toLowerCase(), i = low.indexOf(q);
    if (i < 0) { return ''; }
    var a = Math.max(0, i - 28), b = Math.min(text.length, i + q.length + 36);
    return (a > 0 ? '…' : '') + esc(text.slice(a, i)) +
           '<b>' + esc(text.slice(i, i + q.length)) + '</b>' +
           esc(text.slice(i + q.length, b)) + (b < text.length ? '…' : '');
  }

  // 0 = 沒中；2 = 代碼、品名、規定碼或規定品名中；1 = 只有條文內容中
  function tlevel(row, q, ruleHit) {
    if (!q) { return 2; }
    if (hit(row[0], q) || hit(row[1], q) || hit(row[2], q) || hit(row[6], q)) { return 2; }
    var r = row[6] && tz.rules[row[6]];
    if (r && hit(r.n, q)) { return 2; }
    return ruleHit[row[6]] ? 1 : 0;
  }

  // 每個篩選只適用某一區（data-for）。勾了之後只留「每個勾選都適用」的區。
  function allowedGroups() {
    var k = kind(), ok = {
      std: k === 'all' || k === 'std',
      drug: (k === 'all' || k === 'drug') && !!drug,
      tz: (k === 'all' || k === 'tz') && hasTz && !tzFailed
    };
    var byKind = { std: ok.std, drug: ok.drug, tz: ok.tz };
    var checked = FILTERS.filter(function (f) { return f.checked; });
    checked.forEach(function (f) {
      Object.keys(ok).forEach(function (g) { if (g !== f.dataset.for) { ok[g] = false; } });
    });
    return { ok: ok, byKind: byKind, checked: checked };
  }

  function compute() {
    var p = params();
    var q = (p.get('q') || '').trim().toLowerCase();
    var sort = $('ssort').value;
    var hist = (data && data.history) || {};
    var A = allowedGroups(), ok = A.ok;
    var onlyNote = $('onlynote').checked, onlyChanged = $('onlychanged').checked;

    view = (!ok.std || !data) ? [] : data.items.filter(function (r) {
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

    var waitTz = ok.tz && !tz;
    if (waitTz) { tzwant = true; loadTz(); }

    // 特材還沒到時藥品先不畫（理由見 loadTz）
    dview = (!ok.drug || waitTz) ? [] : drug.items.filter(function (r) { return dmatch(r, q); });
    dview.sort(function (a, b) { return cmpSec(a[0], b[0]); });
    // 有查詢需要比對條文，但 1 MB 還沒到——把它抓下來，回來自己重跑。
    // 少了這一步，直接貼「?q=乳癌」的網址進來會顯示藥品 0 條，
    // 而在框裡打同一個字卻查得到，同一個網址兩種結果最難查。
    if (dwant && ok.drug) { loadDrugNotes(); }

    tview = []; tsnip = {};
    if (ok.tz && tz) {
      var pre = $('onlyprereview') && $('onlyprereview').checked;
      var self = $('onlyselfpay') && $('onlyselfpay').checked;
      // 條文命中是以「規定」為單位算的：361 條各比一次，不是 8,400 個品項各比一次
      var ruleHit = {};
      if (q) {
        Object.keys(tz.rules).forEach(function (rc) {
          var s = snippet(tz.rules[rc].t, q);
          if (s) { ruleHit[rc] = true; tsnip[rc] = s; }
        });
      }
      tz.items.forEach(function (r) {
        if (pre && !r[5]) { return; }
        if (self && !r[7]) { return; }
        var lv = tlevel(r, q, ruleHit);
        if (lv) { tview.push([lv, r]); }
      });
      tview.sort(function (a, b) {
        var x = a[1], y = b[1];
        if (sort === 'points-desc') { return (y[3] || 0) - (x[3] || 0) || x[0].localeCompare(y[0]); }
        if (sort === 'points-asc') { return (x[3] || 0) - (y[3] || 0) || x[0].localeCompare(y[0]); }
        if (sort === 'from-desc') { return (y[4] || '').localeCompare(x[4] || '') || x[0].localeCompare(y[0]); }
        // 預設：品名直接命中的排前面，只有條文提到的排後面
        return (b[0] - a[0]) || x[0].localeCompare(y[0]);
      });
    }

    shown = 0; dshown = 0; tshown = 0;
    body.innerHTML = ''; dbody.innerHTML = '';
    if (tbody) { tbody.innerHTML = ''; }
    draw(); ddraw(); tdraw();

    gstd.hidden = view.length === 0;
    gdrug.hidden = dview.length === 0;
    if (gtz) {
      gtz.hidden = !waitTz && tview.length === 0;
      if (waitTz) { $('tcount').textContent = '載入中…'; tmore.hidden = true; }
    }
    var total = view.length + dview.length + tview.length;
    count.textContent = total ? total.toLocaleString('en-US') + ' 項' : '';

    // **篩選只適用於某一區**：勾起來時其他區會整個消失——不講清楚就變成
    // 「明明查得到，勾一下就說查不到」，而使用者不會聯想到是勾選造成的。
    var dropped = Object.keys(A.byKind).filter(function (g) { return A.byKind[g] && !ok[g]; });
    var hint = $('shint');
    var muted = A.checked.length > 0 && dropped.length > 0;
    hint.hidden = !muted;
    if (muted) {
      var why = A.checked.map(function (f) {
        return '「' + f.parentNode.textContent.trim() + '」只適用於' + GROUP_NAME[f.dataset.for];
      }).join('；');
      var left = Object.keys(ok).some(function (g) { return ok[g]; });
      hint.textContent = why + (left
        ? '，已暫時不列' + dropped.map(function (g) { return GROUP_NAME[g]; }).join('、') + '。'
        : '。這幾個勾選適用的區不同，同時勾選時沒有任何一區符合。');
    }
    empty.hidden = !(total === 0 && !muted && !tzwant);
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

  function tzName(r) { return r[1] || r[2] || '—'; }

  function tdraw() {
    if (!tbody) { return; }
    var frag = document.createDocumentFragment();
    var end = Math.min(tshown + PAGE, tview.length);
    for (var i = tshown; i < end; i++) {
      var lv = tview[i][0], r = tview[i][1];
      var tr = document.createElement('tr');
      var sub = r[1] && r[2] ? '<div class="tzen">' + esc(r[2]) + '</div>' : '';
      if (lv === 1 && tsnip[r[6]]) {
        sub += '<div class="tzsnip"><span class="lbl">條文提及</span>' + tsnip[r[6]] + '</div>';
      }
      tr.innerHTML =
        '<td><button type="button" class="codebtn" data-tz="' + esc(r[0]) + '">' +
          esc(r[0]) + '</button></td>' +
        '<td><button type="button" class="namebtn" data-tz="' + esc(r[0]) + '">' +
          esc(tzName(r)) + '</button>' +
          (r[7] ? ' <em class="hasnote">自付差額</em>' : '') + sub + '</td>' +
        '<td class="n">' + num(r[3]) +
          (r[9] ? '<div class="tznext">' + esc(r[9]) + ' 起 ' + num(r[8]) + '</div>' : '') + '</td>' +
        '<td>' + (r[5] ? '<em class="needpre">需要</em>' : '—') + '</td>';
      frag.appendChild(tr);
    }
    tbody.appendChild(frag);
    tshown = end;

    tmore.hidden = tshown >= tview.length;
    tmore.textContent = '載入更多（還有 ' + (tview.length - tshown).toLocaleString('en-US') + ' 項）';
    $('tcount').textContent = tview.length.toLocaleString('en-US') + ' 項' +
      (tview.length > tshown ? '，顯示前 ' + tshown.toLocaleString('en-US') : '');
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

  function tfind(code) {
    for (var i = 0; i < tz.items.length; i++) {
      if (tz.items[i][0] === code) { return tz.items[i]; }
    }
    return null;
  }

  function showDetail(html) {
    detail.innerHTML = '<div class="stdcard">' +
      '<button type="button" class="back" id="sback">← 回到清單</button>' + html + '</div>';
    detail.hidden = false;
    gstd.hidden = true; gdrug.hidden = true;
    if (gtz) { gtz.hidden = true; tmore.hidden = true; }
    more.hidden = true; dmore.hidden = true; empty.hidden = true;
    $('shint').hidden = true;
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

  // 原文句子裡把這個代碼標粗。句子先整段跳脫，再把代碼包起來——
  // 代碼只有英數字，跳脫前後一樣，不會切到 HTML 實體。
  function markCode(s, code) {
    return esc(s).split(code).join('<b>' + code + '</b>');
  }

  // 「提到此代碼的特材條文」。**只露原文句子、不貼標籤**：同樣是提到代碼，
  // 條文寫的可能是「限併同申報」「得併報」或「不得併報」——實測 19007C 被
  // 4 條特材規定提到，4 條全是「不得同時併報」。貼「須併報」就把禁止寫成必須。
  function mentionsHtml(code, list, orphan) {
    if (!list || !list.length) { return ''; }
    var h = '<h3>提到此代碼的特材條文 <span class="n">' + list.length + ' 條規定</span></h3>' +
      '<p class="muted">以下是特材給付規定原文中提到 <code>' + esc(code) + '</code> 的句子。' +
      '<b>被提到不代表要搭配申報</b>——條文可能寫「限」、「得」或「不得」，請讀句子判斷。' +
      (orphan ? '<br>注意：這個代碼已不在現行支付標準裡，但特材條文仍寫著它。' : '') + '</p>' +
      '<ul class="tzmention">';
    list.forEach(function (e) {
      var rc = e[0], name = e[1], n = e[2], snips = e[3];
      h += '<li><div class="tzmhead"><button type="button" class="codebtn" data-tzr="' + esc(rc) + '">' +
           esc(rc) + '</button> <button type="button" class="namebtn" data-tzr="' + esc(rc) + '">' +
           esc(name) + '</button> <span class="muted">適用 ' + n.toLocaleString('en-US') + ' 項</span></div>';
      snips.forEach(function (s) {
        h += '<blockquote class="tzmquote">' + markCode(s, code) + '</blockquote>';
      });
      h += '</li>';
    });
    var v = (mentions && mentions.meta && mentions.meta.ods_ver) || '';
    return h + '</ul><p class="muted">原文出自「全民健康保險特殊材料給付規定」試算表版' +
      (v ? '（' + esc(v) + ' 版）' : '') + '。句子太長時，「…」表示中間省略的部分；' +
      '點規定碼看完整條文。</p>';
  }

  function showCode(code) {
    var row = find(code);
    if (!row) {
      // 不在支付標準裡、但特材條文還寫著它（實測 72035B）：照實講，並把句子給出來
      loadMentions().then(function (mt) {
        showDetail('<p class="empty">查無健保代碼 ' + esc(code) +
          '。它可能已經停用，或不屬於診療項目——藥品與特材不在支付標準裡，' +
          '請改查藥品給付規定或特材。</p>' + mentionsHtml(code, mt.codes[code], true));
      });
      return;
    }

    Promise.all([loadNotes(), loadMentions()]).then(function (got) {
      var nt = got[0], mt = got[1];
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

      h += mentionsHtml(code, mt.codes[code], false);
      h += refsHtml((data.refs && data.refs[code]) || [], '動過這個項目的公告');
      showDetail(h);
    });
  }

  // 健保署只在「該章改過版」時才在連結標題標更新日。解毒劑、耳鼻喉科製劑
  // 很久沒動過，標題沒有日期，檔名也就沒有。留白會看起來像抽漏了，要講明白。
  function chVer(ch) {
    if (ch.version) { return ch.version + ' 版'; }
    return ch.undated ? '健保署未標示更新日期' : '版本不明';
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
          '<div><dt>條文版本</dt><dd>' + esc(chVer(ch)) + '</dd></div>' +
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
           '，' + esc(chVer(ch)) + '。原封轉載未經改寫，' +
           '申報請以健保署最新公告為準。</p>';
      showDetail(h);
    });
  }

  // ---- 特材 ----

  function tzSource() {
    var m = (tz && tz.meta) || {};
    return '<p class="stdsrc">品項資料出自健保署「特材收錄品項表」（' + esc(m.csv || '') + '，' +
      esc(m.csv_ver || '') + ' 版）；給付規定出自「全民健康保險特殊材料給付規定」試算表版（' +
      esc(m.ods_ver || '') + ' 版）。原封轉載未經改寫，申報請以健保署最新公告為準。</p>';
  }

  // 歷次版本：[[起日, 迄日], ...]。現行那一版（迄日 999/12/31）標出來。
  function versionsHtml(h) {
    if (!h || h.length < 2) { return ''; }
    var s = '<h3>歷次版本</h3><p class="stddates">';
    for (var i = 0; i < h.length; i++) {
      var cur = h[i][1] >= '999';
      s += '<span class="d' + (cur ? ' last' : '') + '">' + esc(h[i][0]) +
           (cur ? ' 起（現行）' : ' – ' + esc(h[i][1])) + '</span>';
    }
    return s + '</p><p class="muted">日期為民國年。舊版條文請見健保署原檔「歷史資料」工作表。</p>';
  }

  function ruleName(r) { return (r.n || '').replace(/\s*\n\s*/g, ' '); }

  function showTz(code) {
    if (!hasTz) { showDetail('<p class="empty">本站目前沒有特材資料。</p>'); return; }
    // 要先有品項檔才知道明細在哪一份分片，所以不能兩個同時抓
    loadTz().then(function () { return loadTzDetail(code); }).then(function (shard) {
      if (!tz) { showDetail('<p class="empty">特材資料載入失敗，請重新整理。</p>'); return; }
      var row = tfind(code);
      if (!row) {
        showDetail('<p class="empty">查無特材代碼 ' + esc(code) +
          '。它可能已經停止給付，或不在健保署的特材收錄品項表裡。</p>');
        return;
      }
      var d = shard[code] || {};
      var rc = row[6], rule = rc && tz.rules[rc];

      var h = '<h2><code>' + esc(code) + '</code> ' + esc(tzName(row)) + '</h2>' +
        (row[1] && row[2] ? '<p class="tzen big">' + esc(row[2]) + '</p>' : '') +
        '<dl class="stdmeta">' +
          '<div><dt>支付點數</dt><dd class="big">' + num(row[3]) + '</dd></div>' +
          '<div><dt>生效日期</dt><dd>' + esc(row[4] || '—') + '</dd></div>' +
          '<div><dt>事前審查</dt><dd>' + (row[5] ? '<b>需要</b>' : '不需要') + '</dd></div>' +
          (d['給付類別'] ? '<div><dt>給付類別</dt><dd>' + esc(d['給付類別']) + '</dd></div>' : '') +
        '</dl>';

      // 健保署已經公告、但還沒生效的新點數。不講的話，月底前查到的點數下個月就不對了。
      if (row[9]) {
        h += '<p class="tzchange">已公告調整：自 <b>' + esc(row[9]) + '</b> 起支付點數 ' +
             num(row[3]) + ' → <b>' + num(row[8]) + '</b></p>';
      }

      var F = ['規格', '單位', '大小類', '功能類別', '核價類別', '自付差額品名', '核定費用',
               '事前審查生效', '許可證', '申請者', '生效迄日'];
      var rows = F.filter(function (k) { return d[k]; }).map(function (k) {
        return '<div><dt>' + esc(k === '事前審查生效' ? '事前審查生效日' : k) + '</dt><dd>' +
               esc(d[k]) + '</dd></div>';
      });
      if (d['整組組件']) {
        rows.push('<div><dt>整組組件</dt><dd>' + d['整組組件'].split(/[;；]/).map(function (c) {
          c = c.trim();
          return c ? '<button type="button" class="codebtn" data-tz="' + esc(c) + '">' + esc(c) + '</button>' : '';
        }).join(' ') + '</dd></div>');
      }
      if (rows.length) { h += '<h3>品項資料</h3><dl class="tzinfo">' + rows.join('') + '</dl>'; }

      if (rule) {
        var n = tz.items.filter(function (x) { return x[6] === rc; }).length;
        h += '<h3>給付規定 <code>' + esc(rc) + '</code> ' + esc(ruleName(rule)) + '</h3>' +
             '<p class="muted">' + esc(rule.f) + ' 起適用。</p>' +
             '<div class="stdnote reg">' + esc(rule.t) + '</div>' +
             versionsHtml(rule.h) +
             '<p><button type="button" class="linkbtn" data-tzr="' + esc(rc) + '">' +
               '看這條規定的完整頁（共 ' + n.toLocaleString('en-US') + ' 個品項適用）</button></p>';
      } else if (rc) {
        h += '<h3>給付規定</h3><p class="muted">品項表標示給付規定代碼 <code>' + esc(rc) +
             '</code>，但健保署的特材給付規定檔中查無此碼。</p>';
      } else {
        h += '<p class="muted">健保署的特材品項表未對本項列載給付規定代碼。</p>';
      }
      showDetail(h + tzSource());
    });
  }

  function showTzRule(rc) {
    if (!hasTz) { showDetail('<p class="empty">本站目前沒有特材資料。</p>'); return; }
    loadTz().then(function () {
      if (!tz) { showDetail('<p class="empty">特材資料載入失敗，請重新整理。</p>'); return; }
      var rule = tz.rules[rc];
      if (!rule) {
        showDetail('<p class="empty">查無特材給付規定代碼 ' + esc(rc) + '。</p>');
        return;
      }
      var list = tz.items.filter(function (x) { return x[6] === rc; });
      var h = '<h2><code>' + esc(rc) + '</code> ' + esc(ruleName(rule)) + '</h2>' +
        '<dl class="stdmeta">' +
          '<div><dt>現行版本起日</dt><dd>' + esc(rule.f) + '</dd></div>' +
          '<div><dt>適用品項</dt><dd class="big">' + list.length.toLocaleString('en-US') + '</dd></div>' +
        '</dl>' +
        '<h3>給付規定原文</h3><div class="stdnote reg">' + esc(rule.t) + '</div>' +
        versionsHtml(rule.h);

      if (list.length) {
        var LIM = 100;
        h += '<h3>適用的品項</h3><div class="tw"><table class="stdtable tztable"><thead><tr>' +
             '<th>特材代碼</th><th>品名</th><th class="n">支付點數</th><th>事前審查</th></tr></thead><tbody>';
        list.slice(0, LIM).forEach(function (r) {
          h += '<tr><td><button type="button" class="codebtn" data-tz="' + esc(r[0]) + '">' + esc(r[0]) +
               '</button></td><td><button type="button" class="namebtn" data-tz="' + esc(r[0]) + '">' +
               esc(tzName(r)) + '</button></td><td class="n">' + num(r[3]) + '</td><td>' +
               (r[5] ? '<em class="needpre">需要</em>' : '—') + '</td></tr>';
        });
        h += '</tbody></table></div>';
        if (list.length > LIM) {
          h += '<p class="muted">只列前 ' + LIM + ' 項。全部 ' + list.length.toLocaleString('en-US') +
               ' 項：<a href="?q=' + encodeURIComponent(rc) + '">搜尋 ' + esc(rc) + '</a></p>';
        }
      } else {
        h += '<p class="muted">目前沒有現行品項適用這條規定。</p>';
      }
      showDetail(h + tzSource());
    });
  }

  function bindBack() {
    var b = $('sback');
    if (!b) { return; }
    b.addEventListener('click', function () {
      var p = params();
      clearDetail(p);
      setUrl(p);
      apply();
    });
  }

  function apply() {
    var p = params();
    sq.value = p.get('q') || '';
    var code = p.get('code'), sec = p.get('sec'), t = p.get('tz'), tr = p.get('tzr');
    if (code) { showCode(code.trim().toUpperCase()); return; }
    if (sec) { showSec(sec.trim()); return; }
    if (t) { showTz(t.trim().toUpperCase()); return; }
    if (tr) { showTzRule(tr.trim().toUpperCase()); return; }
    detail.hidden = true;
    detail.innerHTML = '';
    compute();
  }

  $('stdbar').addEventListener('submit', function (e) {
    e.preventDefault();
    var p = params();
    clearDetail(p);
    if (sq.value.trim()) { p.set('q', sq.value.trim()); } else { p.delete('q'); }
    setUrl(p);
    apply();
  });

  // 一碰查詢框就先抓條文，讓「查適應症」這種用法不必等
  sq.addEventListener('focus', function () { loadDrugNotes(); loadTz(); }, { once: true });

  FILTERS.forEach(function (f) { f.addEventListener('change', compute); });
  $('ssort').addEventListener('change', compute);
  document.querySelectorAll('input[name="kind"]').forEach(function (r) {
    r.addEventListener('change', compute);
  });

  more.addEventListener('click', draw);
  dmore.addEventListener('click', ddraw);
  if (tmore) { tmore.addEventListener('click', tdraw); }

  document.addEventListener('click', function (e) {
    var b = e.target.closest ? e.target.closest('[data-code],[data-sec],[data-tz],[data-tzr]') : null;
    if (!b) { return; }
    var p = params();
    clearDetail(p);
    if (b.dataset.sec) { p.set('sec', b.dataset.sec); }
    else if (b.dataset.tzr) { p.set('tzr', b.dataset.tzr); }
    else if (b.dataset.tz) { p.set('tz', b.dataset.tz); }
    else { p.set('code', b.dataset.code); }
    setUrl(p);
    apply();
  });

  window.addEventListener('popstate', apply);

  // 兩份索引一起載。**其中一份掛掉不該讓整頁空白**——規範庫是另一套系統
  // 每週更新的，它沒產出時支付標準還是要查得到。特材在背景補上。
  Promise.all([
    fetch('../data/standard.json').then(function (r) { return r.json(); })
      .catch(function () { return null; }),
    fetch('../data/drugreg.json').then(function (r) { return r.json(); })
      .catch(function () { return null; })
  ]).then(function (both) {
    data = both[0];
    drug = both[1];
    if (!data && !drug && !hasTz) {
      count.textContent = '資料載入失敗，請重新整理。';
      return;
    }
    apply();
    loadTz();
  });
})();

/* 公告查詢頁 —— 搜尋／篩選／排序／分頁，全部在瀏覽器端做。
 *
 * 狀態的唯一來源是 URL query（規格 §5.1、Sitemap §10）：
 *   ?q= &department= &type= &change= &effective= &from= &to= &sort= &page= &size=
 * 這樣「骨科公告」「即將生效」這些入口就只是不同的連結，
 * 查詢結果可以直接分享，上一頁／下一頁也自然可用。
 *
 * 從詳情頁返回時要回到完全相同的查詢與捲動位置（Sitemap §11）：
 * 離開前把 URL 與 scrollY 寫進 sessionStorage，詳情頁的「返回搜尋結果」
 * 讀它，回來後再捲回去。
 */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const list = $('list'), none = $('none'), pager = $('pager'),
        countEl = $('count'), chips = $('chips');

  const MULTI = ['department', 'type', 'change'];
  const state = {
    q: '', department: [], type: [], change: [],
    effective: '', from: '', to: '',
    sort: '', page: 1, size: 20,
  };
  let DATA = [], TODAY = '';
  // 使用者有沒有自己動過排序。沒動過就讓它跟著關鍵字自動切換
  //（規格 §3：有關鍵字預設相關性，沒有就公告日新到舊）。
  // 少了這個旗標，第一次 collect() 會把「當下解析出來的預設值」寫死進
  // state.sort，之後再打關鍵字也不會切到相關性了。
  let sortTouched = false;

  /* ---------- URL ---------- */

  function readURL() {
    const p = new URLSearchParams(location.search);
    state.q = p.get('q') || '';
    MULTI.forEach(k => { state[k] = p.getAll(k).filter(Boolean); });
    state.effective = p.get('effective') || '';
    state.from = p.get('from') || '';
    state.to = p.get('to') || '';
    state.sort = p.get('sort') || '';
    state.page = Math.max(1, parseInt(p.get('page') || '1', 10) || 1);
    state.size = parseInt(p.get('size') || '20', 10) || 20;
  }

  function writeURL(push) {
    const p = new URLSearchParams();
    if (state.q) p.set('q', state.q);
    MULTI.forEach(k => state[k].forEach(v => p.append(k, v)));
    if (state.effective) p.set('effective', state.effective);
    if (state.from) p.set('from', state.from);
    if (state.to) p.set('to', state.to);
    if (state.sort) p.set('sort', state.sort);
    if (state.page > 1) p.set('page', state.page);
    if (state.size !== 20) p.set('size', state.size);
    const url = location.pathname + (p.toString() ? '?' + p : '');
    history[push ? 'pushState' : 'replaceState'](null, '', url);
  }

  /* ---------- 篩選 ---------- */

  function haystack(a) {
    if (a._h === undefined) {
      a._h = [a.title, a.summary, a.doc_no, a.type_name,
              a.depts.join(' '), a.changes.join(' '), a.codes.join(' ')]
             .join(' ').replace(/\s+/g, '').toLowerCase();
    }
    return a._h;
  }

  function shiftMonths(iso, n) {
    const d = new Date(iso + 'T00:00:00');
    d.setMonth(d.getMonth() + n);
    return d.toISOString().slice(0, 10);
  }
  function shiftDays(iso, n) {
    const d = new Date(iso + 'T00:00:00');
    d.setDate(d.getDate() + n);
    return d.toISOString().slice(0, 10);
  }

  // 生效日期條件。「最近 30 天／3 個月／今年」看的是**已經生效**的區間，
  // 「即將生效」看的是還沒到的；兩者方向相反，分開寫比塞成一個範圍清楚。
  function effOK(a) {
    const e = a.eff_date;
    switch (state.effective) {
      case '':         return true;
      case 'upcoming': return !!e && e >= TODAY;
      case '30d':      return !!e && e <= TODAY && e >= shiftDays(TODAY, -30);
      case '3m':       return !!e && e <= TODAY && e >= shiftMonths(TODAY, -3);
      case 'year':     return !!e && e.slice(0, 4) === TODAY.slice(0, 4);
      case 'custom':
        if (!e) return false;
        if (state.from && e < state.from) return false;
        if (state.to && e > state.to) return false;
        return true;
      default:         return true;
    }
  }

  function filtered() {
    const kw = state.q.replace(/\s+/g, '').toLowerCase();
    return DATA.filter(a => {
      if (kw && !haystack(a).includes(kw)) return false;
      if (state.department.length &&
          !state.department.some(d => a.depts.includes(d))) return false;
      if (state.type.length && !state.type.includes(a.type)) return false;
      if (state.change.length &&
          !state.change.some(c => a.changes.includes(c))) return false;
      return effOK(a);
    });
  }

  /* ---------- 排序 ---------- */

  function score(a, kw) {
    // 相關性：標題命中最重，其次摘要，再其次代碼／文號。
    // 置頂與生效日只拿來當同分時的次要排序，不讓它蓋過關鍵字相關性。
    let s = 0;
    const t = a.title.replace(/\s+/g, '').toLowerCase();
    if (t.includes(kw)) s += 100;
    if ((a.summary || '').toLowerCase().includes(kw)) s += 30;
    if (a.codes.some(c => c.toLowerCase().includes(kw))) s += 40;
    if ((a.doc_no || '').toLowerCase().includes(kw)) s += 40;
    return s;
  }

  function sorted(rows) {
    const kw = state.q.replace(/\s+/g, '').toLowerCase();
    const mode = state.sort || (kw ? 'relevance' : 'announcement-date');
    const byDateDesc = (x, y) => (y.ann_date || '').localeCompare(x.ann_date || '');
    const out = rows.slice();
    switch (mode) {
      case 'announcement-date-asc':
        out.sort((x, y) => (x.ann_date || '').localeCompare(y.ann_date || '')); break;
      case 'effective-date':
        // 沒有生效日的排最後，不要讓空字串排到最前面假裝「最近」
        out.sort((x, y) => (x.eff_date || '9999').localeCompare(y.eff_date || '9999')); break;
      case 'effective-date-desc':
        out.sort((x, y) => (y.eff_date || '0000').localeCompare(x.eff_date || '0000')); break;
      case 'relevance':
        if (kw) { out.sort((x, y) => score(y, kw) - score(x, kw) || byDateDesc(x, y)); break; }
        /* 沒有關鍵字時相關性沒有意義，退回公告日新到舊 */
      default:
        out.sort((x, y) => (y.pinned - x.pinned) || byDateDesc(x, y));
    }
    return out;
  }

  /* ---------- 繪製 ---------- */

  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

  function deptTags(a) {
    // 規格 §3.7：3 個以內全列，超過顯示前 3 個 +N，避免多科公告撐高列表
    const shown = a.depts.slice(0, 3).map(d =>
      `<a class="tag" href="?department=${encodeURIComponent(d)}">${esc(d)}</a>`).join('');
    const extra = a.depts.length > 3
      ? `<button type="button" class="tag more" data-more="${esc(a.id)}" data-n="${a.depts.length - 3}" aria-expanded="false" aria-controls="rest-${esc(a.id)}">+${a.depts.length - 3}</button>` : '';
    const rest = a.depts.length > 3
      ? `<span class="tag-rest" hidden id="rest-${esc(a.id)}">` +
        a.depts.slice(3).map(d =>
          `<a class="tag" href="?department=${encodeURIComponent(d)}">${esc(d)}</a>`).join('') +
        `</span>` : '';
    return `<div class="tags">${shown}${extra}${rest}</div>`;
  }

  function card(a) {
    const soon = a.eff_date && a.eff_date >= TODAY;
    return `<article class="card">
  <div class="metarow">
    <span class="badge t-${esc(a.type)}">${esc(a.type_name)}</span>
    ${a.pinned ? '<span class="badge b-pin">置頂</span>' : ''}
    ${a.eff_date ? `<span class="eff${soon ? ' soon' : ''}">生效 <time datetime="${esc(a.eff_date)}">${esc(a.eff_date)}</time></span>` : ''}
  </div>
  <h3><a href="${esc(a.id)}/">${esc(a.title)}</a></h3>
  ${a.summary ? `<p class="sum">${esc(a.summary)}</p>` : ''}
  ${a.depts.length ? deptTags(a) : ''}
  ${a.changes.length ? `<div class="tags ch">${a.changes.map(c =>
      `<span class="tag chg">${esc(c)}</span>`).join('')}</div>` : ''}
  <div class="metafoot">
    <span>公告日 <time datetime="${esc(a.ann_date)}">${esc(a.ann_date) || '—'}</time></span>
    ${a.doc_no ? `<code>${esc(a.doc_no)}</code>` : ''}
    <a class="go" href="${esc(a.id)}/">查看公告 →</a>
  </div>
</article>`;
  }

  function renderChips() {
    const bits = [];
    if (state.q) bits.push(['q', state.q, `關鍵字：${state.q}`]);
    state.department.forEach(d => bits.push(['department', d, d]));
    state.type.forEach(t => {
      const el = document.querySelector(`input[name=type][value="${CSS.escape(t)}"]`);
      bits.push(['type', t, el ? el.nextElementSibling.textContent : t]);
    });
    state.change.forEach(c => bits.push(['change', c, c]));
    if (state.effective) {
      const el = document.querySelector(`input[name=effective][value="${CSS.escape(state.effective)}"]`);
      bits.push(['effective', state.effective, el ? el.nextElementSibling.textContent : state.effective]);
    }
    chips.hidden = bits.length === 0;
    chips.innerHTML = bits.length
      ? '<span class="lead">已套用</span>' + bits.map(([k, v, label]) =>
          `<button type="button" class="chip" data-k="${esc(k)}" data-v="${esc(v)}">${esc(label)} <span aria-hidden="true">×</span><span class="sr">移除</span></button>`
        ).join('') + '<button type="button" class="chip clear" id="chipclear">清除全部</button>'
      : '';
    const n = bits.length;
    const fc = $('filtercount');
    fc.hidden = n === 0;
    fc.textContent = n;
  }

  function renderPager(total, pages) {
    if (pages <= 1) { pager.innerHTML = ''; return; }
    // 頁數多的時候只顯示目前頁附近，否則手機上會被頁碼佔滿一整排
    const win = 2, nums = [];
    for (let i = 1; i <= pages; i++) {
      if (i === 1 || i === pages || Math.abs(i - state.page) <= win) nums.push(i);
      else if (nums[nums.length - 1] !== '…') nums.push('…');
    }
    pager.innerHTML =
      `<button type="button" class="pg" data-page="${state.page - 1}" ${state.page === 1 ? 'disabled' : ''}>‹ 上一頁</button>` +
      nums.map(n => n === '…'
        ? '<span class="gap">…</span>'
        : `<button type="button" class="pg${n === state.page ? ' on' : ''}" data-page="${n}"${n === state.page ? ' aria-current="page"' : ''}>${n}</button>`).join('') +
      `<button type="button" class="pg" data-page="${state.page + 1}" ${state.page === pages ? 'disabled' : ''}>下一頁 ›</button>`;
  }

  function render() {
    const rows = sorted(filtered());
    const total = rows.length;
    const pages = Math.max(1, Math.ceil(total / state.size));
    if (state.page > pages) state.page = pages;
    const start = (state.page - 1) * state.size;
    const page = rows.slice(start, start + state.size);

    countEl.textContent = total;
    $('mobilecount').textContent = total;
    list.innerHTML = page.map(card).join('');
    none.hidden = total > 0;
    renderPager(total, pages);
    renderChips();
  }

  /* ---------- 表單 ↔ 狀態 ---------- */

  function syncFormFromState() {
    $('q').value = state.q;
    document.querySelectorAll('input[name=department]').forEach(
      el => { el.checked = state.department.includes(el.value); });
    document.querySelectorAll('input[name=type]').forEach(
      el => { el.checked = state.type.includes(el.value); });
    document.querySelectorAll('input[name=change]').forEach(
      el => { el.checked = state.change.includes(el.value); });
    const eff = document.querySelector(`input[name=effective][value="${CSS.escape(state.effective)}"]`);
    if (eff) eff.checked = true;
    $('range').hidden = state.effective !== 'custom';
    $('from').value = state.from;
    $('to').value = state.to;
    sortTouched = !!state.sort;
    $('sort').value = state.sort || (state.q ? 'relevance' : 'announcement-date');
    $('size').value = String(state.size);
  }

  function collect(push) {
    state.q = $('q').value.trim();
    MULTI.forEach(k => {
      state[k] = [...document.querySelectorAll(`input[name=${k}]:checked`)].map(el => el.value);
    });
    const eff = document.querySelector('input[name=effective]:checked');
    state.effective = eff ? eff.value : '';
    $('range').hidden = state.effective !== 'custom';
    state.from = $('from').value;
    state.to = $('to').value;
    state.sort = sortTouched ? $('sort').value : '';
    state.size = parseInt($('size').value, 10) || 20;
    state.page = 1;
    writeURL(push);
    render();
  }

  /* ---------- 事件 ---------- */

  document.addEventListener('change', (e) => {
    if (e.target.id === 'sort') sortTouched = true;
    if (e.target.closest('.filters') || e.target.id === 'sort' || e.target.id === 'size') {
      collect(true);
    }
  });

  $('searchbar').addEventListener('submit', (e) => {
    e.preventDefault();
    collect(true);
    // 關鍵字改了而使用者沒指定排序時，select 要跟著回到自動解析的值，
    // 否則畫面上顯示的排序跟實際套用的不一致
    if (!sortTouched) $('sort').value = state.q ? 'relevance' : 'announcement-date';
  });

  chips.addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    if (chip.id === 'chipclear') { clearAll(); return; }
    const k = chip.dataset.k, v = chip.dataset.v;
    if (k === 'q') state.q = '';
    else if (k === 'effective') state.effective = '';
    else state[k] = state[k].filter(x => x !== v);
    state.page = 1;
    syncFormFromState(); writeURL(true); render();
  });

  function clearAll() {
    state.q = ''; MULTI.forEach(k => { state[k] = []; });
    state.effective = ''; state.from = ''; state.to = ''; state.page = 1;
    state.sort = ''; sortTouched = false;
    syncFormFromState(); writeURL(true); render();
  }
  $('clearall').addEventListener('click', clearAll);

  pager.addEventListener('click', (e) => {
    const b = e.target.closest('.pg');
    if (!b || b.disabled) return;
    state.page = parseInt(b.dataset.page, 10);
    writeURL(true); render();
    document.querySelector('.results').scrollIntoView({ block: 'start' });
  });

  // 科別標籤的「+N」：展開其餘科別，不另開頁面。
  // 按鈕文字要兩個方向都寫，收合時才回得到「+N」——
  // 原本寫成 rest.hidden ? b.textContent : '收合'，收合那一邊等於沒改。
  list.addEventListener('click', (e) => {
    const b = e.target.closest('[data-more]');
    if (!b) return;
    const rest = $('rest-' + b.dataset.more);
    if (!rest) return;
    rest.hidden = !rest.hidden;
    b.textContent = rest.hidden ? '+' + b.dataset.n : '收合';
    b.setAttribute('aria-expanded', String(!rest.hidden));
  });

  // 科別清單本身的篩選（90 幾個科別用捲的太慢）
  $('deptq').addEventListener('input', () => {
    const v = $('deptq').value.trim().toLowerCase();
    let total = 0;
    document.querySelectorAll('#deptlist [data-grp]').forEach(g => {
      let n = 0;
      g.querySelectorAll('[data-dept]').forEach(l => {
        const ok = !v || l.textContent.toLowerCase().includes(v);
        l.hidden = !ok; if (ok) n++;
      });
      g.hidden = n === 0; total += n;
    });
    $('deptnone').hidden = total > 0;
  });

  // 手機：篩選面板做成覆蓋層
  const panel = $('filters');
  $('filtertoggle').addEventListener('click', () => {
    const open = panel.classList.toggle('open');
    $('filtertoggle').setAttribute('aria-expanded', String(open));
    document.body.classList.toggle('noscroll', open);
  });
  function closePanel() {
    panel.classList.remove('open');
    $('filtertoggle').setAttribute('aria-expanded', 'false');
    document.body.classList.remove('noscroll');
  }
  $('closefilters').addEventListener('click', closePanel);
  $('applymobile').addEventListener('click', closePanel);

  addEventListener('popstate', () => { readURL(); syncFormFromState(); render(); });

  // 離開到詳情頁前記住查詢狀態與捲動位置（Sitemap §11）
  addEventListener('pagehide', () => {
    try {
      sessionStorage.setItem('nhi:list', JSON.stringify({
        url: location.pathname + location.search, y: scrollY,
      }));
    } catch (_) { /* 無痕模式會丟例外，記不住就算了，不能讓它擋住導覽 */ }
  });

  /* ---------- 啟動 ---------- */

  fetch(window.NHI_DATA)
    .then(r => r.json())
    .then(d => {
      DATA = d.announcements || [];
      TODAY = d.today;
      readURL();
      syncFormFromState();
      render();
      // 從詳情頁按上一頁回來時，瀏覽器不一定會還原捲動位置
      try {
        const saved = JSON.parse(sessionStorage.getItem('nhi:list') || 'null');
        if (saved && saved.url === location.pathname + location.search && saved.y) {
          scrollTo(0, saved.y);
        }
      } catch (_) { /* 同上 */ }
    })
    .catch(() => {
      list.innerHTML = '<p class="empty">公告資料載入失敗，請重新整理頁面。</p>';
    });
})();

// 通知收件人登記。
//
// **這一頁不送出、不儲存任何東西。** 填的姓名與信箱是個資，網站是公開的
// GitHub Pages，所以整理成文字之後交給填寫人自己用 Teams／院內 email 傳給保險課。
// 也刻意不存 localStorage：醫院很多電腦是共用的，存了下一個人打開就看得到。
//
// 輸出最後的「ROSTER|科部|姓名|Email」是給 `nhi roster-add` 匯入用的，
// 一人一科一行，跟通知名單 Excel 的格式一致。
(function () {
  'use strict';
  const GROUPS = JSON.parse(document.getElementById('sf-depts').textContent);
  const ALL = new Set(GROUPS.flatMap(g => g.depts));
  const MAIL = /^[^@\s,;|]+@[^@\s,;|]+\.[A-Za-z]{2,}$/;

  const $ = (s, r = document) => r.querySelector(s);
  const people = $('#sf-people');
  const tpl = $('#sf-person');

  // ---------- 科別下拉多選 ----------
  //
  // 全選有兩層：最上面「全院全選」；各分組各自的全選。分組裡如果有一個同名的科
  // （內科部分組裡的「內科部」），勾它就等於全選整組——主管說「我要內科部」，
  // 意思通常就是整個內科部，不是只有「內科部」這一個標籤。沒有同名科的分組
  // （其他科部、醫事單位…）在分組標題上放一個「全選」。
  //
  // 送出的仍然是一科一筆：通知名單本來就是逐科比對，全選只是勾選的捷徑。
  const parentOf = g => g.depts.includes(g.name) ? g.name : null;

  function buildList(box) {
    const list = $('.msel-list', box);
    const opt = (d, extra = '') => `
          <label class="msel-o${extra ? ' parent' : ''}" data-d="${d}">
            <input type="checkbox" class="d" value="${d}"><span>${d}</span>${extra}
          </label>`;
    list.innerHTML = `
      <label class="msel-allrow"><input type="checkbox" class="all">
        <span>全院全選（全部 ${ALL.size} 個科別）</span></label>` +
      GROUPS.map(g => {
        const p = parentOf(g);
        const rest = g.depts.filter(d => d !== p);
        return `
      <div class="msel-g" data-g="${g.name}">
        <div class="msel-gh"><span>${g.name}</span>${p ? '' :
          `<label class="msel-gall"><input type="checkbox" class="gall" data-g="${g.name}"> 全選</label>`}</div>
        ${p ? opt(p, `<em class="hint">＝全選本組 ${g.depts.length} 科</em>`) : ''}
        ${rest.map(d => opt(d)).join('')}
      </div>`;
      }).join('');
  }

  const deptBoxes = box => [...box.querySelectorAll('.msel-list input.d')];
  const groupBoxes = (box, g) => g.depts.map(d =>
    box.querySelector(`.msel-list input.d[value="${CSS.escape(d)}"]`));

  function selected(box) {
    return deptBoxes(box).filter(i => i.checked).map(i => i.value);
  }

  // 已選的科別，盡量用整組表示：「全院」「內科部（全部 11 科）」，其餘逐科列
  function summarize(box) {
    const on = new Set(selected(box));
    if (on.size && on.size === ALL.size) return [{ label: `全院（全部 ${ALL.size} 科）`, text: '全院', all: true }];
    const out = [];
    GROUPS.forEach(g => {
      const hit = g.depts.filter(d => on.has(d));
      if (g.depts.length > 1 && hit.length === g.depts.length) {
        out.push({ label: `${g.name}（全部 ${g.depts.length} 科）`, text: `${g.name}（全部）`, group: g.name });
      } else {
        hit.forEach(d => out.push({ label: d, text: d, dept: d }));
      }
    });
    return out;
  }

  // 全選框的狀態跟著實際勾選走：整組都勾了就打勾，勾了一部分顯示「部分」
  function syncToggles(box) {
    const all = deptBoxes(box);
    const n = all.filter(i => i.checked).length;
    const a = $('.msel-list input.all', box);
    a.checked = n === all.length; a.indeterminate = n > 0 && n < all.length;
    GROUPS.forEach(g => {
      const gb = box.querySelector(`.msel-list input.gall[data-g="${CSS.escape(g.name)}"]`);
      if (!gb) return;
      const k = groupBoxes(box, g).filter(i => i.checked).length;
      gb.checked = k === g.depts.length; gb.indeterminate = k > 0 && k < g.depts.length;
    });
  }

  function renderChips(box) {
    syncToggles(box);
    const items = summarize(box);
    $('.msel-chips', box).innerHTML = items.map((it, i) =>
      `<span class="chip${it.dept ? '' : ' wide'}">${it.label}<button type="button" data-rm="${i}" aria-label="移除 ${it.label}">×</button></span>`).join('');
    box._chips = items;
    $('.msel-ph', box).hidden = items.length > 0;
  }

  function onChange(box, t) {
    if (t.classList.contains('all')) {
      deptBoxes(box).forEach(i => { i.checked = t.checked; });
    } else if (t.classList.contains('gall')) {
      const g = GROUPS.find(x => x.name === t.dataset.g);
      groupBoxes(box, g).forEach(i => { i.checked = t.checked; });
    } else if (t.classList.contains('d')) {
      // 勾／取消同名科＝整組一起勾／取消；組內其他科單獨勾選不影響同名科
      const g = GROUPS.find(x => parentOf(x) === t.value);
      if (g) groupBoxes(box, g).forEach(i => { i.checked = t.checked; });
    }
    renderChips(box);
  }

  function removeChip(box, i) {
    const it = (box._chips || [])[i];
    if (!it) return;
    if (it.all) deptBoxes(box).forEach(x => { x.checked = false; });
    else if (it.group) groupBoxes(box, GROUPS.find(g => g.name === it.group)).forEach(x => { x.checked = false; });
    else { const cb = box.querySelector(`.msel-list input.d[value="${CSS.escape(it.dept)}"]`); if (cb) cb.checked = false; }
    renderChips(box);
  }

  function openPanel(box, open) {
    document.querySelectorAll('.msel.open').forEach(o => { if (o !== box) openPanel(o, false); });
    box.classList.toggle('open', open);
    $('.msel-panel', box).hidden = !open;
    $('.msel-btn', box).setAttribute('aria-expanded', String(open));
    if (open) { const q = $('.msel-q', box); q.value = ''; filter(box, ''); q.focus(); }
  }

  function filter(box, q) {
    q = q.trim();
    $('.msel-allrow', box).hidden = !!q;      // 搜尋時「全院全選」沒有意義，先藏起來
    box.querySelectorAll('.msel-g').forEach(g => {
      let any = false;
      g.querySelectorAll('.msel-o').forEach(o => {
        const hit = !q || o.dataset.d.includes(q) || g.dataset.g.includes(q);
        o.hidden = !hit; any = any || hit;
      });
      g.hidden = !any;
    });
  }

  function wireSelect(box) {
    buildList(box);
    $('.msel-btn', box).addEventListener('click', e => {
      const rm = e.target.closest('[data-rm]');
      if (rm) { removeChip(box, +rm.dataset.rm); return; }   // 點標籤上的 × 不打開清單
      openPanel(box, !box.classList.contains('open'));
    });
    $('.msel-q', box).addEventListener('input', e => filter(box, e.target.value));
    $('.msel-list', box).addEventListener('change', e => onChange(box, e.target));
    $('.msel-done', box).addEventListener('click', () => { openPanel(box, false); $('.msel-btn', box).focus(); });
    box.addEventListener('keydown', e => {
      if (e.key === 'Escape' && box.classList.contains('open')) {
        openPanel(box, false); $('.msel-btn', box).focus();
      }
    });
    renderChips(box);
  }

  document.addEventListener('click', e => {
    document.querySelectorAll('.msel.open').forEach(b => { if (!b.contains(e.target)) openPanel(b, false); });
  });

  // ---------- 填寫單位（下拉，最後一項「其它」自己填） ----------
  const OTHER = '__other__';
  (function buildUnit() {
    const sel = $('#sf-unit');
    sel.innerHTML = '<option value="">請選擇單位</option>' +
      GROUPS.map(g => `<optgroup label="${g.name}">${g.depts.map(d =>
        `<option value="${d}">${d}</option>`).join('')}</optgroup>`).join('') +
      `<option value="${OTHER}">其它（自行填寫）</option>`;
    sel.addEventListener('change', unitChanged);
  })();
  function unitChanged() {
    const other = $('#sf-unit').value === OTHER;
    $('#sf-unit-other').hidden = !other;
    if (other) $('#sf-unit-other').focus();
  }
  function unitValue() {
    const v = $('#sf-unit').value;
    return v === OTHER ? clean($('#sf-unit-other').value) : v;
  }

  // ---------- 人員 ----------
  function renumber() {
    const ps = people.querySelectorAll('.sf-p');
    ps.forEach((p, i) => {
      $('.n', p).textContent = `第 ${i + 1} 位`;
      $('.sf-del', p).hidden = ps.length === 1;   // 至少留一位
    });
  }

  function addPerson(focus) {
    const node = tpl.content.firstElementChild.cloneNode(true);
    people.appendChild(node);
    wireSelect($('.msel', node));
    $('.sf-del', node).addEventListener('click', () => { node.remove(); renumber(); });
    renumber();
    if (focus) $('.f-name', node).focus();
  }

  $('#sf-add').addEventListener('click', () => addPerson(true));
  $('#sf-reset').addEventListener('click', () => {
    if (!confirm('確定要清除全部內容重填？')) return;
    people.innerHTML = '';
    $('#sf-unit').value = ''; $('#sf-unit-other').value = ''; unitChanged(); $('#sf-by').value = '';
    $('#sf-out').hidden = true; $('#sf-err').hidden = true;
    addPerson(false);
  });

  // ---------- 整理成文字 ----------
  // 「|」是匯入格式的分隔字元，姓名裡出現會把欄位切錯，先拿掉
  const clean = s => s.replace(/[|｜\r\n\t]/g, ' ').replace(/\s+/g, ' ').trim();

  // 有設定收件網址（Google Apps Script）就直接送出；沒有就整理成文字讓人複製
  const ENDPOINT = $('#sf').dataset.endpoint || '';

  function collect() {
    const errs = [];
    const rows = [];
    people.querySelectorAll('.sf-p').forEach((p, i) => {
      const name = clean($('.f-name', p).value);
      const mail = clean($('.f-mail', p).value).toLowerCase();
      const depts = selected($('.msel', p)).filter(d => ALL.has(d));
      p.classList.remove('bad');
      const n = `第 ${i + 1} 位`;
      if (!name && !mail && !depts.length) return;       // 整欄空白的就略過
      if (!name) errs.push(`${n}：請填姓名`);
      if (!MAIL.test(mail)) errs.push(`${n}：Email 格式不對`);
      if (!depts.length) errs.push(`${n}：請至少選一個科別`);
      if (!name || !MAIL.test(mail) || !depts.length) { p.classList.add('bad'); return; }
      rows.push({ name, mail, depts, summary: summarize($('.msel', p)).map(x => x.text).join('、') });
    });
    if (!rows.length && !errs.length) errs.push('請至少填一位收件人');
    return { errs, rows, unit: unitValue(), by: clean($('#sf-by').value) };
  }

  function asText({ rows, unit, by }) {
    const lines = ['【健保公告通知 收件人登記】'];
    if (unit) lines.push(`填寫單位：${unit}`);
    if (by) lines.push(`填寫人：${by}`);
    lines.push(`共 ${rows.length} 位`, '');
    rows.forEach((r, i) => {
      lines.push(`${i + 1}. ${r.name}　${r.mail}`);
      lines.push(`   科別：${r.summary}`);
    });
    lines.push('', '（以下給系統匯入用，請整段保留）');
    rows.forEach(r => r.depts.forEach(d => lines.push(`ROSTER|${d}|${r.name}|${r.mail}`)));
    return lines.join('\n');
  }

  function showText(data, heading) {
    $('#sf-text').value = asText(data);
    $('#sf-copied').hidden = true;
    $('#sf-out-h').textContent = heading;
    const out = $('#sf-out');
    out.hidden = false;
    out.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  async function post(data) {
    // 不帶 Content-Type（瀏覽器預設 text/plain）：這樣是「簡單請求」，不會先送
    // CORS 預檢——Apps Script 不處理預檢，帶了 application/json 會直接失敗。
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      body: JSON.stringify({
        unit: data.unit, by: data.by, website: $('#sf-website').value,
        people: data.rows.map(r => ({ name: r.name, email: r.mail, depts: r.depts, summary: r.summary })),
      }),
    });
    const j = await res.json();
    if (!j.ok) throw new Error(j.error || '收件端回報失敗');
    return j;
  }

  let sending = false;
  $('#sf').addEventListener('submit', async e => {
    e.preventDefault();
    if (sending) return;                 // 連按兩下不要送兩次
    const data = collect();
    const err = $('#sf-err');
    if (data.errs.length) {
      err.innerHTML = data.errs.join('<br>'); err.hidden = false;
      $('#sf-out').hidden = true;
      const bad = people.querySelector('.sf-p.bad');
      if (bad) bad.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    err.hidden = true;

    if (!ENDPOINT) { showText(data, '請把以下內容傳給保險課'); return; }

    const btn = $('#sf .sf-go');
    sending = true; btn.disabled = true; btn.textContent = '送出中…';
    try {
      const r = await post(data);
      $('#sf-done-msg').textContent =
        `已登記 ${r.people} 位：${data.rows.map(x => x.name).join('、')}。`;
      $('#sf').hidden = true; $('#sf-out').hidden = true;
      const done = $('#sf-done');
      done.hidden = false;
      done.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (ex) {
      // 送不出去（院內網路擋住 Google、收件端錯誤）時不要讓人白填：
      // 退回複製模式，內容整理好讓他改用 Teams／email 傳
      err.innerHTML = `送出失敗（${String(ex.message || ex).replace(/[<>&]/g, '')}）。` +
        '請改用下方「複製內容」，貼到 Teams 或院內 email 傳給保險課。';
      err.hidden = false;
      showText(data, '送出失敗，請改用複製傳送');
    } finally {
      sending = false; btn.disabled = false; btn.textContent = '送出登記';
    }
  });

  $('#sf-again').addEventListener('click', () => {
    people.innerHTML = '';
    $('#sf-done').hidden = true; $('#sf').hidden = false;
    addPerson(true);
  });

  $('#sf-copy').addEventListener('click', async () => {
    const ta = $('#sf-text');
    let ok = false;
    try { await navigator.clipboard.writeText(ta.value); ok = true; } catch (e) {
      // 舊版瀏覽器或非 https 環境沒有 clipboard API，退回選取＋複製
      ta.select();
      try { ok = document.execCommand('copy'); } catch (e2) { ok = false; }
    }
    const c = $('#sf-copied');
    c.textContent = ok ? '已複製 ✓ 請貼到 Teams 或 email 傳給保險課' : '請手動全選上面的文字複製（Ctrl+A、Ctrl+C）';
    c.hidden = false;
  });

  addPerson(false);
})();

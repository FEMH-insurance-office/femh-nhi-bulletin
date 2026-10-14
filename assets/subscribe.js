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
  function buildList(box) {
    const list = $('.msel-list', box);
    list.innerHTML = GROUPS.map(g => `
      <div class="msel-g" data-g="${g.name}">
        <div class="msel-gh">${g.name}</div>
        ${g.depts.map(d => `
          <label class="msel-o" data-d="${d}">
            <input type="checkbox" value="${d}"><span>${d}</span>
          </label>`).join('')}
      </div>`).join('');
  }

  function selected(box) {
    return [...box.querySelectorAll('.msel-list input:checked')].map(i => i.value);
  }

  function renderChips(box) {
    const v = selected(box);
    $('.msel-chips', box).innerHTML = v.map(d =>
      `<span class="chip">${d}<button type="button" data-rm="${d}" aria-label="移除 ${d}">×</button></span>`).join('');
    $('.msel-ph', box).hidden = v.length > 0;
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
      if (rm) {                       // 點標籤上的 × 只移除那一科，不打開清單
        const cb = box.querySelector(`.msel-list input[value="${CSS.escape(rm.dataset.rm)}"]`);
        if (cb) cb.checked = false;
        renderChips(box);
        return;
      }
      openPanel(box, !box.classList.contains('open'));
    });
    $('.msel-q', box).addEventListener('input', e => filter(box, e.target.value));
    $('.msel-list', box).addEventListener('change', () => renderChips(box));
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
    $('#sf-unit').value = ''; $('#sf-by').value = '';
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
      rows.push({ name, mail, depts });
    });
    if (!rows.length && !errs.length) errs.push('請至少填一位收件人');
    return { errs, rows, unit: clean($('#sf-unit').value), by: clean($('#sf-by').value) };
  }

  function asText({ rows, unit, by }) {
    const lines = ['【健保公告通知 收件人登記】'];
    if (unit) lines.push(`填寫單位：${unit}`);
    if (by) lines.push(`填寫人：${by}`);
    lines.push(`共 ${rows.length} 位`, '');
    rows.forEach((r, i) => {
      lines.push(`${i + 1}. ${r.name}　${r.mail}`);
      lines.push(`   科別：${r.depts.join('、')}`);
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
        people: data.rows.map(r => ({ name: r.name, email: r.mail, depts: r.depts })),
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

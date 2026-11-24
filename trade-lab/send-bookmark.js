/* Send with Trade Lab: bookmark script. Runs only on sleeper.com.
   Reads the trade Trade Lab put in the link (#tradelab=...), shows it, and on your click
   proposes it through Sleeper's own endpoint with the session you are already signed into.
   Your token is read from sleeper.com's storage and sent only to sleeper.com. */
(() => {
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  if (!/(^|\.)sleeper\.com$/.test(location.hostname)) { alert('Use this bookmark on sleeper.com after tapping Send in Trade Lab.'); return; }
  const grab = str => { const m = String(str || '').match(/(?:tradelab=|TL1:)([A-Za-z0-9_-]{20,})/); return m ? m[1] : null; };
  const parse = code => {
    let t;
    try { t = JSON.parse(decodeURIComponent(escape(atob(code.replace(/-/g, '+').replace(/_/g, '/'))))); } catch (e) { return null; }
    const ok = t && /^\d+$/.test(t.lid) && Array.isArray(t.adds) && Array.isArray(t.drops)
      && t.adds.concat(t.drops).every(x => /^[A-Za-z0-9]+$/.test(x[0]) && Number.isInteger(x[1]))
      && (t.picks || []).every(p => /^\d+,\d{4},\d+,\d+,\d+$/.test(p))
      && (t.faab || []).every(p => /^\d+,\d+,\d+$/.test(p));
    return ok ? t : null;
  };
  const tok = (localStorage.getItem('token') || '').replace(/^"|"$/g, '');
  if (!tok) { alert('Sign in to Sleeper in this browser first.'); return; }
  const gql = (op, query, variables) => fetch('/graphql', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: tok, 'X-Sleeper-GraphQL-Op': op },
    body: JSON.stringify({ operationName: op, variables: variables || {}, query })
  }).then(r => r.json());
  const old = document.getElementById('tl-send'); if (old) old.remove();
  const box = document.createElement('div');
  box.id = 'tl-send';
  box.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:rgba(3,6,12,.72);display:flex;align-items:center;justify-content:center;font:15px/1.45 -apple-system,BlinkMacSystemFont,sans-serif';
  const btn = 'border:0;border-radius:10px;padding:10px 16px;font-weight:700;font-size:15px;cursor:pointer;margin-right:8px';
  const card = inner => { box.innerHTML = `<div style="background:#171f2d;color:#eaf0fa;border:1px solid #2a3448;border-radius:16px;padding:22px;max-width:440px;width:92%"><div style="color:#00d4b4;font-weight:800;font-size:13px">TRADE LAB</div>${inner}</div>`; };
  document.body.appendChild(box);
  const msg = s => { const el = box.querySelector('#tl-msg'); if (el) el.innerHTML = s; };
  const close = () => { box.remove(); if (location.hash.includes('tradelab')) history.replaceState(null, '', location.pathname + location.search); };
  let t = null;
  const showPaste = () => {
    card(`<div style="font-size:21px;font-weight:800;margin:4px 0 8px">Paste your trade</div>
      <div style="color:#8c98ae;font-size:13px;margin-bottom:10px">Tapping Open in Sleeper in Trade Lab copied a trade code. Paste it here with Command + V.</div>
      <input id="tl-code" placeholder="TL1:..." style="width:100%;box-sizing:border-box;padding:11px 12px;border-radius:10px;border:1px solid #2a3448;background:#121926;color:#eaf0fa;font-size:16px;margin-bottom:10px">
      <div id="tl-msg" style="color:#8c98ae;font-size:13px;min-height:20px;margin-bottom:12px"></div>
      <div><button id="tl-next" style="${btn};background:#00d4b4;color:#002b25">Continue</button><button id="tl-no" style="${btn};background:#2a3448;color:#eaf0fa">Cancel</button></div>`);
    const inp = box.querySelector('#tl-code');
    const tryCode = v => { const c = grab(v); const tt = c && parse(c); if (tt) { t = tt; showTrade(); return true; } return false; };
    inp.addEventListener('input', () => tryCode(inp.value));
    box.querySelector('#tl-next').onclick = () => { if (!tryCode(inp.value)) msg('<span style="color:#ff5d6e">That is not a Trade Lab code. Copy it again from Trade Lab.</span>'); };
    box.querySelector('#tl-no').onclick = close;
    inp.focus();
    if (navigator.clipboard && navigator.clipboard.readText) navigator.clipboard.readText().then(v => { if (!t) { inp.value = v; tryCode(v); } }).catch(() => {});
  };
  const showTrade = () => {
    card(`<div style="font-size:21px;font-weight:800;margin:4px 0 10px">Send this trade to ${esc(t.mgr)}?</div>
    <div style="color:#8c98ae;font-size:13px">You send</div><div style="margin-bottom:8px">${esc((t.give || []).join(', ') || 'Nothing')}</div>
    <div style="color:#8c98ae;font-size:13px">You get</div><div style="margin-bottom:14px">${esc((t.get || []).join(', ') || 'Nothing')}</div>
    <div id="tl-msg" style="color:#8c98ae;font-size:13px;min-height:20px;margin-bottom:12px"></div>
    <div id="tl-btns"><button id="tl-go" style="${btn};background:#00d4b4;color:#002b25">Send trade</button><button id="tl-no" style="${btn};background:#2a3448;color:#eaf0fa">Cancel</button></div>`);
    box.querySelector('#tl-no').onclick = close;
    box.querySelector('#tl-go').onclick = send;
  };
  const send = async () => {
    const go = box.querySelector('#tl-go'); go.disabled = true; go.textContent = 'Sending…';
    const S = JSON.stringify;
    const q = `mutation propose_trade($k_adds: [String], $v_adds: [Int], $k_drops: [String], $v_drops: [Int]) {
      propose_trade(league_id: ${S(t.lid)},draft_picks: ${S(t.picks || [])},k_adds: $k_adds,v_adds: $v_adds,k_drops: $k_drops,v_drops: $v_drops,waiver_budget: ${S(t.faab || [])}){ transaction_id status leg }
    }`;
    try {
      const j = await gql('propose_trade', q, { k_adds: t.adds.map(x => x[0]), v_adds: t.adds.map(x => x[1]), k_drops: t.drops.map(x => x[0]), v_drops: t.drops.map(x => x[1]) });
      const tx = j && j.data && j.data.propose_trade;
      if (!tx || j.errors) { go.disabled = false; go.textContent = 'Try again'; msg(`<span style="color:#ff5d6e">Sleeper said no: ${esc((j.errors && j.errors[0] && j.errors[0].message) || 'unknown error')}</span>`); return; }
      msg(`<span style="color:#2fd68e;font-weight:700">Sent. It is in ${esc(t.mgr)}'s trade inbox now.</span>`);
      box.querySelector('#tl-btns').innerHTML = `<button id="tl-undo" style="${btn};background:#2a3448;color:#eaf0fa">Undo</button><button id="tl-done" style="${btn};background:#00d4b4;color:#002b25">Done</button>`;
      box.querySelector('#tl-done').onclick = close;
      box.querySelector('#tl-undo').onclick = async () => {
        const u = await gql('reject_trade', `mutation reject_trade { reject_trade(league_id: ${S(t.lid)},transaction_id: ${S(String(tx.transaction_id))},leg: ${parseInt(tx.leg, 10) || 1}){ transaction_id status } }`);
        if (u && u.data && u.data.reject_trade) { msg('<span style="color:#ffb648;font-weight:700">Withdrawn.</span>'); box.querySelector('#tl-btns').innerHTML = `<button id="tl-done2" style="${btn};background:#2a3448;color:#eaf0fa">Close</button>`; box.querySelector('#tl-done2').onclick = close; }
        else msg(`<span style="color:#ff5d6e">Could not withdraw: ${esc((u && u.errors && u.errors[0] && u.errors[0].message) || 'unknown error')}. Withdraw it in Sleeper.</span>`);
      };
    } catch (e) { go.disabled = false; go.textContent = 'Try again'; msg(`<span style="color:#ff5d6e">${esc(e.message)}</span>`); }
  };
  const code = grab(location.hash) || grab(location.search);
  t = code && parse(code);
  if (t) showTrade(); else showPaste();
})();

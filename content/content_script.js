// content/content_script.js
console.log('[TM] injected on', location.href);

(() => {
  const $ = sel => document.querySelector(sel);

  /* 1. Detect exchange & symbol by host */
  function detect() {
    const host = location.host.toLowerCase();
    const parts = location.pathname.split('/').filter(Boolean);
    const sym   = parts.pop()?.toUpperCase() || null;
    if (host.endsWith('binance.com')) {
      const kind = location.pathname.includes('/futures/') ? 'usdm' : 'spot';
      return { ex:'binance', sym, kind };
    }
    if (host.endsWith('bybit.com')) {
      let kind = 'spot';
      if (location.pathname.includes('/trade/usdt/'))   kind = 'linear';
      else if (location.pathname.includes('/trade/inverse/')) kind = 'inverse';
      return { ex:'bybit', sym, kind };
    }
    return { ex:null, sym:null, kind:null };
  }

  let MK = detect();

  // subscribe to price & fetch balance
  if (MK.sym)    chrome.runtime.sendMessage({ type:'subscribe',   symbol: MK.sym,   exchange: MK.ex, kind: MK.kind });
  if (MK.ex)     chrome.runtime.sendMessage({ type:'getBalance', exchange: MK.ex });

  // 2. Inject CSS & build panel
  const css = `
#tm { position:fixed; top:10px; left:10px; z-index:2147483647; width:300px;
  background:#2a2a2a; border-radius:8px; box-shadow:0 4px 12px rgba(0,0,0,0.5);
  color:#eee; font-family:"Segoe UI",Roboto,sans-serif; }
#tm-header { display:flex; justify-content:space-between; align-items:center;
  background:#1e1e1e; padding:8px 12px; border-top-left-radius:8px;
  border-top-right-radius:8px; cursor:grab; }
#tm-header:active { cursor:grabbing; }
#tm-header h1 { margin:0; font-size:14px; user-select:none; }
#tm-header button { background:transparent; border:none; color:#888;
  font-size:16px; cursor:pointer; }
#tm-header button:hover { color:#fff; }
#tm main { padding:12px; font-size:13px; }
#tm-controls label { margin-right:10px; color:#ccc; font-size:12px;
  user-select:none; }
#tm-controls input[type=number] { width:70px; margin-left:6px; padding:2px 4px;
  background:#333; border:1px solid #444; border-radius:4px; color:#eee; }
#tm-prices div, #tm-fee, #tm-rr, #tm-size { margin:6px 0; font-size:12px; }
#tm-sl-tp { margin:6px 0; }
#tm-sl-tp label { display:block; font-size:12px; margin-bottom:4px; }
#tm-sl-tp input { width:100%; padding:2px 4px; background:#333;
  border:1px solid #444; border-radius:4px; color:#eee; }
.auto-rr-container {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin: 6px 0;
  font-size:11px;
  color:#aaa;
  user-select:none;
}
.auto-rr-container input[type="checkbox"] { margin:0; }
.auto-rr-container input[type="number"] {
  width:50px; padding:2px 4px; background:#333; border:1px solid #444;
  border-radius:4px; color:#eee; font-size:11px;
}
#tm-actions { text-align:center; margin-top:12px; }
#tm-actions button { margin:0 6px; padding:6px 14px; border:none;
  border-radius:4px; color:#fff; font-size:13px; font-weight:500;
  cursor:pointer; transition:background .2s; }
#tm-actions button#buy { background:#4CAF50; }
#tm-actions button#buy:hover { background:#45a049; }
#tm-actions button#sell { background:#ff6b6b; }
#tm-actions button#sell:hover { background:#ff4c4c; }
#tm-message { margin-top:8px; font-size:12px; color:#ffcc00; text-align:center; }
`;
  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);

  const panel = document.createElement('div');
  panel.id = 'tm';
  panel.innerHTML = `
    <div id="tm-header">
      <h1>Risk Manager</h1><button id="tm-x">×</button>
    </div>
    <main>
      <div id="tm-controls">
        <label><input type="radio" name="mode" value="percent" checked>% bal</label>
        <label><input type="radio" name="mode" value="fixed">fixed $</label>
        <input id="risk" type="number" step="0.1" value="1">
      </div>
      <div id="tm-prices">
        <div>Entry Price <span id="price">--</span></div>
        <div>Balance <span id="bal">--</span></div>
      </div>
      <div id="tm-sl-tp">
        <label>Stop Loss <input id="sl" type="number"></label>
        <label>Take Profit <input id="tp" type="number"></label>
      </div>
      <div class="auto-rr-container">
        <input type="checkbox" id="auto-rr">
        <label for="auto-rr">Auto RR —</label>
        <label for="rr-target">Target RR:</label>
        <input id="rr-target" type="number" step="0.1" value="1.1">
      </div>
      <div id="tm-fee">Est. Fee <span id="rm-fee-val">--</span></div>
      <div id="tm-rr">RR <span id="rr">--</span></div>
      <div id="tm-size">Size <span id="size">--</span></div>
      <div id="tm-actions">
        <button id="buy">Buy</button><button id="sell">Sell</button>
      </div>
      <div id="tm-message"></div>
    </main>`;
  document.body.appendChild(panel);

  /* 3. Close button */
  $('#tm-x').onclick = () => panel.remove();

  /* 4. Drag handle on header only */
  (() => {
    const hdr = $('#tm-header');
    let dragging = false, x0 = 0, y0 = 0;
    hdr.onmousedown = e => {
      dragging = true;
      x0 = e.clientX - panel.offsetLeft;
      y0 = e.clientY - panel.offsetTop;
      document.onmousemove = m => {
        if (!dragging) return;
        panel.style.left = `${m.clientX - x0}px`;
        panel.style.top  = `${m.clientY - y0}px`;
      };
      document.onmouseup = () => {
        dragging = false;
        document.onmousemove = null;
        document.onmouseup = null;
        chrome.storage.local.set({
          panelPos: { x: panel.offsetLeft, y: panel.offsetTop }
        });
      };
      e.preventDefault();
    };
    chrome.storage.local.get('panelPos', r => {
      if (r.panelPos) {
        panel.style.left = `${r.panelPos.x}px`;
        panel.style.top  = `${r.panelPos.y}px`;
      }
    });
  })();

  /* 5. State & calculation */
  let entry = null, balance = null;
  function calc() {
    const sl = parseFloat($('#sl').value);
    let tp = parseFloat($('#tp').value);

    // Auto‐RR logic
    const autoRR = $('#auto-rr').checked;
    const targetRR = parseFloat($('#rr-target').value) || 1.1;
    if (autoRR && entry != null && sl && entry !== sl) {
      const dist = Math.abs(entry - sl);
      const tpDist = dist * targetRR;
      const newTp = sl < entry
        ? entry + tpDist
        : entry - tpDist;
      // choose precision based on price scale
      const precision = entry < 1 ? 6 : entry < 100 ? 4 : 2;
      $('#tp').value = newTp.toFixed(precision);
      $('#tp').disabled = true;
      tp = newTp;
    } else {
      $('#tp').disabled = false;
    }

    // Size & Fee
    if (entry == null || !sl) {
      $('#size').textContent = '--';
      $('#rm-fee-val').textContent = '--';
    } else {
      const mode = [...document.getElementsByName('mode')]
        .find(r => r.checked).value;
      const rv = parseFloat($('#risk').value) || 0;
      const riskAmt = mode === 'fixed'
        ? rv
        : (balance || 0) * (rv / 100);
      const diff = Math.abs(entry - sl);
      if (!riskAmt || !diff) {
        $('#size').textContent = '--';
        $('#rm-fee-val').textContent = '--';
      } else {
        const size = riskAmt / diff;
        $('#size').textContent = size.toFixed(4);
        // fee estimate: maker+taker ~ 0.05% each side
        const feeRate = MK.ex === 'binance' ? 0.05 : MK.ex === 'bybit' ? 0.055 : 0;
        const totalFee = (size * entry) * (feeRate/100) * 2;
        $('#rm-fee-val').textContent = totalFee.toFixed(4);
      }
    }

    // RR display
    if (entry == null || !sl || !tp || entry === sl) {
      $('#rr').textContent = '--';
    } else {
      const rrv = Math.abs(tp - entry) / Math.abs(entry - sl);
      $('#rr').textContent = `1:${rrv.toFixed(2)}`;
    }
  }
  ['risk','sl','tp','#rr-target'].forEach(id => {
    if (id.startsWith('#')) document.querySelector(id).oninput = calc;
    else $('#'+id).oninput = calc;
  });
  document.getElementsByName('mode').forEach(r => r.onchange = calc);
  $('#auto-rr').onchange = calc;

  /* 6. Buttons & messaging */
  $('#buy').onclick = () => {
    const size = parseFloat($('#size').textContent) || 0;
    const sl   = parseFloat($('#sl').value) || null;
    const tp   = parseFloat($('#tp').value) || null;
    if (size <= 0) {
      $('#tm-message').textContent = 'Please set valid size';
      return;
    }
    $('#tm-message').textContent = 'Sending order…';
    chrome.runtime.sendMessage({
      type: 'placeOrder',
      side: 'BUY',
      size,
      symbol: MK.sym,
      exchange: MK.ex,
      stopLoss: sl,
      takeProfit: tp
    });
  };
  $('#sell').onclick = () => {
    const size = parseFloat($('#size').textContent) || 0;
    const sl   = parseFloat($('#sl').value) || null;
    const tp   = parseFloat($('#tp').value) || null;
    if (size <= 0) {
      $('#tm-message').textContent = 'Please set valid size';
      return;
    }
    $('#tm-message').textContent = 'Sending order…';
    chrome.runtime.sendMessage({
      type: 'placeOrder',
      side: 'SELL',
      size,
      symbol: MK.sym,
      exchange: MK.ex,
      stopLoss: sl,
      takeProfit: tp
    });
  };

  chrome.runtime.onMessage.addListener(msg => {
    if (msg.type === 'priceUpdate') {
      entry = parseFloat(msg.price);
      $('#price').textContent = msg.price;
      calc();
    }
    if (msg.type === 'balanceUpdate') {
      balance = parseFloat(msg.balance);
      $('#bal').textContent = balance.toFixed(4);
      calc();
    }
    if (msg.type === 'orderResult') {
      $('#tm-message').textContent = (msg.success ? '✓ ' : '✗ ') + (msg.info||'');
      if (msg.success && MK.ex) {
        chrome.runtime.sendMessage({ type:'getBalance', exchange: MK.ex });
      }
    }
  });

  /* 7. Auto-refresh balance every 30s */
  setInterval(() => {
    if (MK.ex) chrome.runtime.sendMessage({ type:'getBalance', exchange: MK.ex });
  }, 30000);

  /* 8. Live price feeds & SPA nav */
  let bWS=null, byWS=null, domObs=null, titlePoll=null, retry=null;
  const tick = raw => {
    entry = parseFloat(raw);
    $('#price').textContent = raw;
    calc();
  };

  function startBinanceWS() {
    if (bWS) bWS.close();
    if (MK.ex!=='binance' || !MK.sym) return;
    const base = MK.kind==='usdm'
      ? 'wss://fstream.binance.com/ws'
      : 'wss://stream.binance.com:9443/ws';
    bWS = new WebSocket(`${base}/${MK.sym.toLowerCase()}@trade`);
    bWS.onmessage = ev => tick(JSON.parse(ev.data).p);
  }

  function startBybitWS() {
    if (byWS) byWS.close();
    clearTimeout(retry);
    if (MK.ex!=='bybit' || !MK.sym) return;
    const base = MK.kind==='spot'
      ? 'wss://stream.bybit.com/v5/public/spot'
      : MK.kind==='linear'
        ? 'wss://stream.bybit.com/v5/public/linear'
        : 'wss://stream.bybit.com/v5/public/inverse';
    byWS = new WebSocket(base);
    let got=false;
    byWS.onopen = () => {
      const topic = `publicTrade.${MK.sym}`;
      byWS.send(JSON.stringify({ op:'subscribe', args:[topic] }));
      retry = setTimeout(()=>{ if(!got) startBybitWS(); }, 5000);
    };
    byWS.onmessage = ev => {
      const d = JSON.parse(ev.data);
      if (Array.isArray(d.data) && d.data[0]?.p) { got=true; tick(d.data[0].p); }
    };
  }

  function startBybitFallback() {
    if (domObs) domObs.disconnect();
    clearInterval(titlePoll);
    const el =
      document.querySelector('[data-testid="HeaderTickerPrice"]') ||
      document.querySelector('.tv-widget-chart-header__price') ||
      document.querySelector('.tv-symbol-price-quote__value');
    if (el) {
      const r0 = el.textContent.trim().replace(/,/g,'');
      if (r0) tick(r0);
      domObs = new MutationObserver(()=>{
        const r = el.textContent.trim().replace(/,/g,'');
        if (r && parseFloat(r)!==entry) tick(r);
      });
      domObs.observe(el,{childList:true,characterData:true,subtree:true});
    }
    titlePoll = setInterval(()=>{
      const m = document.title.match(/(\d[\d.,]+)/);
      if (m) tick(m[1].replace(/,/g,''));
    },300);
  }

  function startFeeds() {
    if (MK.ex==='binance') {
      if (byWS) byWS.close();
      if (domObs) domObs.disconnect();
      clearInterval(titlePoll);
      startBinanceWS();
    } else if (MK.ex==='bybit') {
      if (bWS) bWS.close();
      startBybitWS();
      startBybitFallback();
    }
  }
  startFeeds();

  /* 9. SPA navigation watch */
  let lastPath = location.pathname;
  setInterval(()=>{
    if (location.pathname !== lastPath) {
      lastPath = location.pathname;
      MK = detect();
      if (MK.sym)    chrome.runtime.sendMessage({ type:'subscribe',   symbol: MK.sym,   exchange: MK.ex, kind: MK.kind });
      if (MK.ex)     chrome.runtime.sendMessage({ type:'getBalance', exchange: MK.ex });
      startFeeds();
    }
  }, 500);

})();

// panel/panel.js
(function() {
  const panel       = document.getElementById('rm-panel');
  const header      = document.getElementById('rm-header');
  const entrySpan   = document.getElementById('rm-entry');
  const balanceSpan = document.getElementById('rm-balance');
  const modes       = Array.from(document.getElementsByName('mode'));
  const riskInput   = document.getElementById('rm-risk-input');
  const slInput     = document.getElementById('rm-sl');
  const tpInput     = document.getElementById('rm-tp');
  const sizeVal     = document.getElementById('rm-size-val');
  const buyBtn      = document.getElementById('rm-buy');
  const sellBtn     = document.getElementById('rm-sell');
  let entryPrice = null, balance = null;

  // 1) Recalculate position size
  function recalc() {
    if (entryPrice == null || !slInput.value) return;
    const mode    = modes.find(i => i.checked).value;
    const riskVal = parseFloat(riskInput.value) || 0;
    const riskAmt = mode === 'fixed'
      ? riskVal
      : (balance || 0) * (riskVal / 100);
    const sl  = parseFloat(slInput.value);
    const diff = Math.abs(entryPrice - sl);
    if (!riskAmt || !diff) {
      sizeVal.innerText = '--';
      return;
    }
    sizeVal.innerText = (riskAmt / diff).toFixed(4);
  }

  // 2) Handlers for incoming data
  window.addEventListener('TradeManager:PriceUpdate', e => {
    entryPrice = +e.detail.price;
    entrySpan.innerText = entryPrice.toFixed(2);
    recalc();
  });
  window.addEventListener('TradeManager:BalanceUpdate', e => {
    balance = +e.detail.balance;
    balanceSpan.innerText = balance.toFixed(2);
    recalc();
  });

  // 3) User inputs
  modes.forEach(i => i.addEventListener('change', recalc));
  [riskInput, slInput, tpInput].forEach(el => el.addEventListener('input', recalc));

  buyBtn.addEventListener('click', () => {
    const size = parseFloat(sizeVal.innerText);
    window.dispatchEvent(new CustomEvent('TradeManager:PlaceOrder', {
      detail: { side: 'BUY', size }
    }));
  });
  sellBtn.addEventListener('click', () => {
    const size = parseFloat(sizeVal.innerText);
    window.dispatchEvent(new CustomEvent('TradeManager:PlaceOrder', {
      detail: { side: 'SELL', size }
    }));
  });

  // 4) Drag and drop
  let dragging = false, offX = 0, offY = 0;
  header.addEventListener('mousedown', e => {
    dragging = true;
    offX = e.clientX - panel.offsetLeft;
    offY = e.clientY - panel.offsetTop;
    document.addEventListener('mousemove', onDrag);
    document.addEventListener('mouseup', () => {
      dragging = false;
      document.removeEventListener('mousemove', onDrag);
      // persist position
      chrome.storage.local.set({ panelPos: { x: panel.offsetLeft, y: panel.offsetTop } });
    }, { once: true });
    e.preventDefault();
  });
  function onDrag(e) {
    if (!dragging) return;
    panel.style.left = `${e.clientX - offX}px`;
    panel.style.top  = `${e.clientY - offY}px`;
  }

  // 5) Restore last position and signal ready
  chrome.storage.local.get('panelPos', res => {
    if (res.panelPos) {
      panel.style.left = res.panelPos.x + 'px';
      panel.style.top  = res.panelPos.y + 'px';
    }
    // only now un-hide the panel
    window.dispatchEvent(new Event('TradeManager:Ready'));
  });

  // 6) Auto-subscribe to the symbol based on the URL
  const m = location.pathname.match(/\/futures\/([\w-]+)/);
  if (m) {
    const symbol = m[1].replace('-', '');
    window.dispatchEvent(new CustomEvent('TradeManager:Subscribe', {
      detail: { symbol }
    }));
  }
})();

import { encryptManagerConfig, decryptManagerConfig } from './crypto-util.js';

let ws               = null;   // Binance price socket
let currentSymbol    = null;
let currentExchange  = null;
let currentKind      = null;   // 'spot' | 'linear' | 'inverse'
let cachedPosIdxBuy  = null;   // 0 | 1
let cachedPosIdxSell = null;   // 0 | 2
let cachedPassphrase = null;   // Store passphrase in memory during session
let pendingRequests  = [];     // Queue for pending requests that need keys

/* ---------- helpers -------------------------------------------------- */
// Fetch keys with fallback to plaintext if no encryption
async function getKeys(forcePrompt = false) {
  // First, try to get plaintext keys - simplest approach
  const plainKeys = await new Promise(resolve => {
    chrome.storage.local.get([
      'binanceKey', 'binanceSecret', 'bybitKey', 'bybitSecret'
    ], resolve);
  });

  // If all keys exist in plaintext, use them without encryption
  if (plainKeys.binanceKey && plainKeys.binanceSecret &&
      plainKeys.bybitKey && plainKeys.bybitSecret) {
    console.log('[TM] Using plaintext keys');
    return plainKeys;
  }

  // If we have some keys but not all, use what we have
  if (plainKeys.binanceKey || plainKeys.binanceSecret ||
      plainKeys.bybitKey || plainKeys.bybitSecret) {
    console.log('[TM] Using partial plaintext keys');
    return plainKeys;
  }

  // If we have a cached passphrase and don't need to force a prompt, try it
  if (cachedPassphrase && !forcePrompt) {
    try {
      return await decryptManagerConfig(cachedPassphrase);
    } catch (e) {
      console.error('[TM] Error using cached passphrase:', e);
      // Cached passphrase no longer valid
      cachedPassphrase = null;
    }
  }

  // Check if encrypted config exists
  const { encryptedConfig } = await new Promise(resolve =>
    chrome.storage.local.get('encryptedConfig', resolve)
  );

  if (!encryptedConfig) {
    console.error('[TM] No keys found (neither plaintext nor encrypted)');
    return {}; // No keys at all
  }

  // We need the passphrase but can't prompt here, so check if we're in the middle
  // of a passphrase request already
  if (pendingRequests.length > 0) {
    console.log('[TM] Waiting for pending passphrase request');
    // Wait for the pending request to complete
    return new Promise((resolve, reject) => {
      pendingRequests.push({ resolve, reject });
    });
  }

  // Create a new passphrase request
  console.log('[TM] Creating new passphrase request');
  return new Promise((resolve, reject) => {
    pendingRequests.push({ resolve, reject });

    // Request passphrase from any open tab
    chrome.tabs.query({}, tabs => {
      if (tabs.length === 0) {
        // No tabs available to request passphrase
        console.error('[TM] No tabs available to request passphrase');
        pendingRequests.forEach(req => req.reject(new Error('No tabs available to request passphrase')));
        pendingRequests = [];
        return;
      }

      let requestSent = false;

      // Try to send to each tab until we find one that works
      for (const tab of tabs) {
        chrome.tabs.sendMessage(tab.id, {
          type: 'requestPassphrase'
        }).then(() => {
          requestSent = true;
          console.log('[TM] Passphrase request sent to tab', tab.id);
        }).catch(err => {
          console.warn('[TM] Failed to send passphrase request to tab', tab.id, err);
        });
      }

      // After attempting all tabs, check if any succeeded
      setTimeout(() => {
        if (!requestSent && pendingRequests.length > 0) {
          console.error('[TM] Could not send passphrase request to any tab');
          pendingRequests.forEach(req => req.reject(new Error('Failed to send passphrase request')));
          pendingRequests = [];
        }
      }, 1000);
    });
  });
}

// Handle passphrase from content script
function handlePassphrase(passphrase) {
  console.log('[TM] Received passphrase response');

  if (!passphrase) {
    // User canceled, reject all pending requests
    console.log('[TM] Passphrase entry canceled');
    pendingRequests.forEach(req => req.reject(new Error('Passphrase entry canceled')));
    pendingRequests = [];
    return;
  }

  // Try to decrypt with the provided passphrase
  decryptManagerConfig(passphrase)
    .then(keys => {
      // Success, cache the passphrase and resolve all pending requests
      console.log('[TM] Decryption successful with provided passphrase');
      cachedPassphrase = passphrase;
      pendingRequests.forEach(req => req.resolve(keys));
      pendingRequests = [];
    })
    .catch(error => {
      // Wrong passphrase, send error back to content script
      console.error('[TM] Decryption failed with provided passphrase:', error);
      broadcast({ type: 'passphraseError', message: 'Incorrect passphrase' });
      // Don't reject pending requests yet, wait for another attempt
    });
}

async function hmac (msg, sec) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(sec),
    { name:'HMAC', hash:'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(msg));
  return [...new Uint8Array(sig)]
    .map(b=>b.toString(16).padStart(2,'0')).join('');
}

function broadcast (m){
  chrome.tabs.query({},tabs=>
    tabs.forEach(t=>chrome.tabs.sendMessage(t.id,m).catch(()=>{})));
}

/* ---------- Binance mark-price WebSocket ----------------------------- */
function startPriceStream (symbol){
  if (ws) ws.close();
  currentSymbol   = symbol;
  currentExchange = 'binance';

  ws = new WebSocket(
    `wss://fstream.binance.com/ws/${symbol.toLowerCase()}@markPrice`
  );
  ws.onopen    = ()  => console.log('[TM] 🟢 Binance WS open', symbol);
  ws.onclose   = ()  => console.log('[TM] 🔴 Binance WS closed');
  ws.onerror   = err => console.error('[TM] Binance WS error', err);
  ws.onmessage = ev  => {
    const d = JSON.parse(ev.data);
    broadcast({ type:'priceUpdate', price: parseFloat(d.p) });
  };
}

/* ---------- Determine lot-size step for Bybit symbol --------------- */
async function getQtyStep (symbol){
  if (!symbol) return 0;

  // Default category to linear if not specified
  const cat = (currentKind === 'spot' ? 'spot' :
               currentKind === 'inverse' ? 'inverse' : 'linear');

  try {
    const response = await fetch(
      `https://api.bybit.com/v5/market/instruments-info?category=${cat}&symbol=${symbol}`
    );

    if (!response.ok) {
      console.warn('[TM] qtyStep fetch failed for', symbol, 'HTTP error:', response.status);
      return 0;
    }

    const j = await response.json();

    if (j.retCode !== 0 || !j.result?.list?.length) {
      console.warn('[TM] qtyStep fetch returned no data for', symbol, j);
      return 0;
    }

    return parseFloat(j.result.list[0].lotSizeFilter.qtyStep || 0);
  } catch (error) {
    console.warn('[TM] qtyStep fetch failed for', symbol, error);
    return 0;
  }
}

/* ---------- Determine lot-size and precision for Binance symbol ----------- */
async function getBinanceSymbolInfo(symbol) {
  if (!symbol) return { qtyStep: 0, precision: 0 };

  try {
    const response = await fetch('https://fapi.binance.com/fapi/v1/exchangeInfo');

    if (!response.ok) {
      console.warn('[TM] Binance exchangeInfo fetch failed, HTTP error:', response.status);
      return { qtyStep: 0, precision: 0 };
    }

    const data = await response.json();
    const symbolInfo = data.symbols.find(s => s.symbol === symbol);

    if (!symbolInfo) {
      console.warn('[TM] Symbol not found in Binance exchangeInfo:', symbol);
      return { qtyStep: 0, precision: 0 };
    }

    const lotSizeFilter = symbolInfo.filters.find(f => f.filterType === 'LOT_SIZE');
    const qtyStep = parseFloat(lotSizeFilter?.stepSize || 0);

    // Calculate precision based on stepSize
    let precision = 0;
    if (qtyStep > 0) {
      const stepStr = qtyStep.toString();
      precision = stepStr.includes('.') ?
        stepStr.split('.')[1].replace(/0+$/, '').length :
        0;
    }

    console.log(`[TM] Binance symbol info for ${symbol}: step=${qtyStep}, precision=${precision}`);
    return { qtyStep, precision };
  } catch (error) {
    console.warn('[TM] Error fetching Binance symbol info:', error);
    return { qtyStep: 0, precision: 0 };
  }
}

/* ---------- Probe Bybit position-mode once per session ------------- */
async function ensurePosIdx () {
  // For Bybit, we're going to default to NOT sending positionIdx at all
  // This seems to work in both hedge and one-way modes
  cachedPosIdxBuy = cachedPosIdxSell = null;

  const { bybitKey, bybitSecret } = await getKeys();
  if (!bybitKey || !bybitSecret) {
    return; // No credentials, we'll use null
  }

  // For spot, we don't need to check position mode
  if (currentKind === 'spot') {
    return;
  }

  // We won't try to determine position mode as it's causing issues
  // Just use null which means don't send positionIdx at all
}

/* ---------- Wallet-balance fetch ------------------------------------- */
async function fetchBalance (exchange){
  const { binanceKey, binanceSecret, bybitKey, bybitSecret } = await getKeys();
  let balance = 0;

  /* ---- Binance Futures --------------------------------------- */
  if (exchange === 'binance' && binanceKey && binanceSecret) {
    try {
      const ts  = Date.now();
      const qs  = `timestamp=${ts}&recvWindow=5000`;
      const sig = await hmac(qs, binanceSecret);
      const url = `https://fapi.binance.com/fapi/v2/balance?${qs}&signature=${sig}`;
      const j   = await fetch(url, { headers:{ 'X-MBX-APIKEY': binanceKey }}).then(r=>r.json());
      balance   = parseFloat(j.find(x=>x.asset==='USDT')?.balance||0);
    } catch (e){
      console.error('[TM] Binance fetchBalance error', e);
    }
    return broadcast({ type:'balanceUpdate', balance });
  }

  /* ---- Bybit Unified ----------------------------------------- */
  if (exchange === 'bybit' && bybitKey && bybitSecret) {
      const hosts = ['https://api.bybit.com', 'https://api-testnet.bybit.com'];
      const acct = ['UNIFIED', 'CONTRACT', 'SPOT', 'FUND', 'OPTION']; // Reordered to prioritize UNIFIED and CONTRACT
      const ts = Date.now().toString();
      const rw = '5000';

      outer: for (const host of hosts) {
        for (const a of acct) {
          try {
            const query = `accountType=${a}`;
            const sig = await hmac(ts + bybitKey + rw + query, bybitSecret);
            const j = await fetch(`${host}/v5/account/wallet-balance?${query}`, {
              headers: {
                'X-BAPI-API-KEY': bybitKey,
                'X-BAPI-TIMESTAMP': ts,
                'X-BAPI-RECV-WINDOW': rw,
                'X-BAPI-SIGN': sig,
                'X-BAPI-SIGN-TYPE': '2'
              }
            }).then(r => r.json());

            if (j.retCode === 10003) break; // wrong host
            if (j.retCode !== 0 || !j.result?.list?.length) continue;

            const acc = j.result.list[0];

            // Detailed logging to debug what we're receiving
            console.log(`[TM] Bybit ${a} balance response:`, {
              walletBalance: acc.totalWalletBalance,
              equity: acc.totalEquity,
              availableBalance: acc.totalAvailableBalance,
              accountType: a
            });

            // IMPORTANT: Only use totalWalletBalance to exclude unrealized PnL
            balance = parseFloat(acc.totalWalletBalance || 0);

            // If we can't find totalWalletBalance, fall back to coin array
            if (!balance && Array.isArray(acc.coin)) {
              console.log('[TM] Falling back to coin array calculation');
              // Sum wallet balances from individual coins, excludes unrealized PnL
              balance = acc.coin.reduce((sum, c) => sum + parseFloat(c.walletBalance || 0), 0);
              console.log('[TM] Calculated balance from coins:', balance);
            }

            if (balance) {
              console.log(`[TM] Found Bybit balance for ${a}: ${balance}`);
              break outer;
            }
          } catch (error) {
            console.error(`[TM] Error fetching Bybit ${a} balance:`, error);
          }
        }
      }
      return broadcast({ type: 'balanceUpdate', balance });
    }

    broadcast({ type: 'balanceUpdate', balance });
  }
/* ---------- Place Binance Futures Stop Loss or Take Profit ------------- */
async function placeBinanceStopOrder(symbol, side, quantity, stopPrice, isStopLoss) {
  const { binanceKey, binanceSecret } = await getKeys();
  if (!binanceKey || !binanceSecret) return null;

  try {
    // Get symbol info for precision
    const { qtyStep, precision } = await getBinanceSymbolInfo(symbol);

    // Round quantity to correct precision
    let qty = quantity;
    if (qtyStep && qtyStep > 0) {
      qty = (Math.floor(quantity / qtyStep) * qtyStep).toFixed(precision);
    }

    console.log(`[TM] Binance stop order quantity: ${quantity}, rounded to: ${qty}`);

    const ts = Date.now();
    // Determine the right parameters based on whether it's SL or TP
    const orderType = isStopLoss ? 'STOP_MARKET' : 'TAKE_PROFIT_MARKET';
    // For stop loss/take profit, the side is reversed from the original order
    const stopSide = side === 'BUY' ? 'SELL' : 'BUY';

    const qs = `symbol=${symbol}&side=${stopSide}&type=${orderType}`
            + `&quantity=${qty}&stopPrice=${stopPrice}`
            + `&timeInForce=GTC&closePosition=true`
            + `&timestamp=${ts}&recvWindow=5000`;
    const sig = await hmac(qs, binanceSecret);
    const url = `https://fapi.binance.com/fapi/v1/order?${qs}&signature=${sig}`;

    const res = await fetch(url, { method: 'POST', headers: { 'X-MBX-APIKEY': binanceKey } });
    const data = await res.json();

    if (data.orderId) {
      console.log(`[TM] Binance ${isStopLoss ? 'Stop Loss' : 'Take Profit'} placed:`, data);
      return data.orderId;
    } else {
      console.error(`[TM] Failed to place ${isStopLoss ? 'Stop Loss' : 'Take Profit'} on Binance:`, data);
      return null;
    }
  } catch (error) {
    console.error(`[TM] Error placing ${isStopLoss ? 'SL' : 'TP'} on Binance:`, error);
    return null;
  }
}

/* ---------- Place Bybit Stop Loss or Take Profit -------------------- */
async function placeBybitStopOrder(symbol, side, qty, stopPrice, isStopLoss) {
  const { bybitKey, bybitSecret } = await getKeys();
  if (!bybitKey || !bybitSecret) return null;

  try {
    const category = currentKind === 'spot' ? 'spot' :
                     currentKind === 'inverse' ? 'inverse' : 'linear';

    // For spot, we can't set SL/TP
    if (category === 'spot') {
      console.log('[TM] SL/TP not supported for spot markets');
      return null;
    }

    // For futures, use the trading-stop endpoint
    const positionIdx = (side === 'BUY' ? 1 : 2); // Use 1 for long, 2 for short in hedge mode

    const body = {
      category,
      symbol,
      positionIdx
    };

    if (isStopLoss) {
      body.stopLoss = stopPrice.toString();
      body.slTriggerBy = 'MarkPrice';
    } else {
      body.takeProfit = stopPrice.toString();
      body.tpTriggerBy = 'MarkPrice';
    }

    const ts = Date.now().toString();
    const rw = '5000';
    const btxt = JSON.stringify(body);
    const sig = await hmac(ts + bybitKey + rw + btxt, bybitSecret);

    console.log(`[TM] Sending Bybit ${isStopLoss ? 'Stop Loss' : 'Take Profit'}:`, body);

    const res = await fetch('https://api.bybit.com/v5/position/trading-stop', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-BAPI-API-KEY': bybitKey,
        'X-BAPI-TIMESTAMP': ts,
        'X-BAPI-RECV-WINDOW': rw,
        'X-BAPI-SIGN': sig,
        'X-BAPI-SIGN-TYPE': '2'
      },
      body: btxt
    });

    const j = await res.json();
    console.log(`[TM] Bybit ${isStopLoss ? 'SL' : 'TP'} response:`, j);

    if (j.retCode === 0) {
      return `TS-${isStopLoss ? 'SL' : 'TP'}-${Date.now()}`;
    }

    // If position mode error, retry with positionIdx = 0 (one-way mode)
    if (j.retCode === 10001 && j.retMsg.includes('position idx not match position mode')) {
      console.log('[TM] Retrying with one-way mode');

      body.positionIdx = 0;

      const newTs = Date.now().toString();
      const retryBtxt = JSON.stringify(body);
      const retrySig = await hmac(newTs + bybitKey + rw + retryBtxt, bybitSecret);

      const retryRes = await fetch('https://api.bybit.com/v5/position/trading-stop', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-BAPI-API-KEY': bybitKey,
          'X-BAPI-TIMESTAMP': newTs,
          'X-BAPI-RECV-WINDOW': rw,
          'X-BAPI-SIGN': retrySig,
          'X-BAPI-SIGN-TYPE': '2'
        },
        body: retryBtxt
      });

      const retryJ = await retryRes.json();
      console.log(`[TM] Bybit retry ${isStopLoss ? 'SL' : 'TP'} response:`, retryJ);

      if (retryJ.retCode === 0) {
        // Update cache for future orders
        cachedPosIdxBuy = cachedPosIdxSell = 0;
        return `TS-${isStopLoss ? 'SL' : 'TP'}-${Date.now()}`;
      }
    }
    console.error(`[TM] Failed to place ${isStopLoss ? 'Stop Loss' : 'Take Profit'} on Bybit:`, j);
return null;
} catch (error) {
console.error(`[TM] Error placing ${isStopLoss ? 'SL' : 'TP'} on Bybit:`, error);
return null;
}
}

/* ---------- Market-order placement ---------------------------------- */
async function placeOrder(msg) {
// Log the full message for debugging
console.log('[TM] placeOrder received message:', msg);

const { side, size, symbol, exchange, stopLoss, takeProfit } = msg;
console.log(`[TM] Order details: ${exchange} ${symbol} ${side} Size:${size} SL:${stopLoss} TP:${takeProfit}`);

const { binanceKey, binanceSecret, bybitKey, bybitSecret } = await getKeys();

/* ---- Binance Futures Market -------------------------------- */
if (exchange === 'binance') {
if (!binanceKey||!binanceSecret)
  return broadcast({ type:'orderResult', success:false, info:'missing config' });

try {
  // Get symbol information to determine proper precision
  const { qtyStep, precision } = await getBinanceSymbolInfo(symbol);

  // Round the quantity according to the symbol's precision requirements
  let qty;
  if (qtyStep && qtyStep > 0) {
    // Round down to the nearest step size
    qty = (Math.floor(size / qtyStep) * qtyStep).toFixed(precision);
  } else {
    // Default to 0 decimals if we couldn't get the step size
    qty = Math.floor(size).toString();
  }

  console.log(`[TM] Binance order size: ${size}, rounded to: ${qty}, step: ${qtyStep}, precision: ${precision}`);

  const ts = Date.now();
  const qs = `symbol=${symbol}&side=${side}&type=MARKET&quantity=${qty}`
           + `&timestamp=${ts}&recvWindow=5000`;
  const sig = await hmac(qs, binanceSecret);
  const url = `https://fapi.binance.com/fapi/v1/order?${qs}&signature=${sig}`;

  const res = await fetch(url, { method:'POST', headers:{ 'X-MBX-APIKEY':binanceKey } });
  const txt = await res.text();
  let ok, info, orderId;

  try {
    const j = JSON.parse(txt);
    ok = res.ok && !j.code;
    orderId = j.orderId;
    info = j.orderId ? `OrderId ${j.orderId}` : (j.msg||txt);
  } catch {
    ok = false;
    info = txt.slice(0,140);
  }

  // If the order was successful and we have stop loss or take profit
  if (ok && orderId) {
    let slId, tpId;

    // Place stop loss if provided
    if (stopLoss && stopLoss > 0) {
      console.log(`[TM] Placing Binance SL at ${stopLoss}`);
      slId = await placeBinanceStopOrder(symbol, side, qty, stopLoss, true);
      if (slId) {
        info += `, SL: ${slId}`;
      }
    }

    // Place take profit if provided
    if (takeProfit && takeProfit > 0) {
      console.log(`[TM] Placing Binance TP at ${takeProfit}`);
      tpId = await placeBinanceStopOrder(symbol, side, qty, takeProfit, false);
      if (tpId) {
        info += `, TP: ${tpId}`;
      }
    }
  }

  return broadcast({ type:'orderResult', success:ok, info });
} catch (e) {
  return broadcast({ type:'orderResult', success:false, info:e.message });
}
}

/* ---- Bybit Unified Market ---------------------------------- */
if (exchange === 'bybit') {
if (!bybitKey||!bybitSecret)
  return broadcast({ type:'orderResult', success:false, info:'missing config' });

try {
  // Make sure position mode is established
  await ensurePosIdx();

  // Round size down to valid qtyStep
  const step = await getQtyStep(symbol);
  let qty;

  if (step && step > 0) {
    const precision = (step.toString().split('.')[1] || '').length;
    qty = (Math.floor(size / step) * step).toFixed(precision);
  } else {
    // If we couldn't get the step, or it's 0, try defaults based on common patterns
    if (size >= 1) {
      // For larger quantities (≥1), round to integer
      qty = Math.floor(size).toString();
    } else {
      // For small quantities (<1), keep original
      qty = size.toString();
    }
  }

  console.log(`[TM] Order size: ${size}, rounded to: ${qty}, step: ${step}`);

  // Set proper category based on currentKind
  const category = currentKind === 'spot' ? 'spot' :
                   currentKind === 'inverse' ? 'inverse' : 'linear';

  // Build the order body - DO NOT include positionIdx as it causes issues
  const body = {
    category,
    symbol,
    side: side === 'BUY' ? 'Buy' : 'Sell',
    orderType: 'Market',
    qty
  };

  // For non-spot trading, add the correct positionIdx parameter
  if (category !== 'spot') {
    if (side === 'BUY') {
      body.positionIdx = 1;  // Long position
    } else {
      body.positionIdx = 2;  // Short position
    }
  }

  // Sign & send
  const ts = Date.now().toString();
  const rw = '5000';
  const btxt = JSON.stringify(body);
  const sig = await hmac(ts + bybitKey + rw + btxt, bybitSecret);

  console.log(`[TM] Sending Bybit order:`, body);

  const res = await fetch('https://api.bybit.com/v5/order/create', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-BAPI-API-KEY': bybitKey,
      'X-BAPI-TIMESTAMP': ts,
      'X-BAPI-RECV-WINDOW': rw,
      'X-BAPI-SIGN': sig,
      'X-BAPI-SIGN-TYPE': '2'
    },
    body: btxt
  });

  const j = await res.json();
  console.log(`[TM] Bybit order response:`, j);

  // If we get a position mode error, we need to retry without positionIdx
  let orderSuccess = false;
  let orderInfo = '';
  let orderId = null;

  if (j.retCode === 0) {
    orderSuccess = true;
    orderId = j.result?.orderId;
    orderInfo = `OrderId ${orderId}`;
  } else if (j.retCode === 10001 && j.retMsg.includes('position idx not match position mode')) {
    console.log('[TM] Retrying order with positionIdx=0 (one-way mode)');

    // Try with positionIdx=0 (for one-way mode)
    body.positionIdx = 0;

    const retryTs = Date.now().toString();
    const retryBtxt = JSON.stringify(body);
    const retrySig = await hmac(retryTs + bybitKey + rw + retryBtxt, bybitSecret);

    const retryRes = await fetch('https://api.bybit.com/v5/order/create', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-BAPI-API-KEY': bybitKey,
        'X-BAPI-TIMESTAMP': retryTs,
        'X-BAPI-RECV-WINDOW': rw,
        'X-BAPI-SIGN': retrySig,
        'X-BAPI-SIGN-TYPE': '2'
      },
      body: retryBtxt
    });

    const retryJ = await retryRes.json();
    console.log(`[TM] Bybit retry order response:`, retryJ);

    orderSuccess = retryJ.retCode === 0;
    if (orderSuccess) {
      orderId = retryJ.result?.orderId;
      orderInfo = `OrderId ${orderId}`;
      // Update cache for future orders - we now know we're in one-way mode
      cachedPosIdxBuy = cachedPosIdxSell = 0;
    } else {
      orderInfo = retryJ.retMsg || JSON.stringify(retryJ);
    }
  } else {
    orderInfo = j.retMsg || JSON.stringify(j);
  }

  // If the order was successful and we have stop loss or take profit
  if (orderSuccess && orderId) {
    // Wait a short time for the order to be processed
    await new Promise(resolve => setTimeout(resolve, 1000));

    let slId, tpId;

    // Place stop loss if provided
    if (stopLoss && stopLoss > 0) {
      console.log(`[TM] Placing Bybit SL at ${stopLoss}`);
      slId = await placeBybitStopOrder(symbol, side, qty, stopLoss, true);
      if (slId) {
        orderInfo += `, SL: ${slId}`;
      }
    }

    // Place take profit if provided
    if (takeProfit && takeProfit > 0) {
      console.log(`[TM] Placing Bybit TP at ${takeProfit}`);
      tpId = await placeBybitStopOrder(symbol, side, qty, takeProfit, false);
      if (tpId) {
        orderInfo += `, TP: ${tpId}`;
      }
    }
  }

  return broadcast({ type: 'orderResult', success: orderSuccess, info: orderInfo });
} catch (e) {
  console.error('[TM] Bybit order error:', e);
  return broadcast({ type: 'orderResult', success: false, info: e.message });
}
}

broadcast({ type:'orderResult', success:false, info:'unsupported exchange' });
}


// In your message listener, add the handler for passphrase responses:
chrome.runtime.onMessage.addListener(msg => {
  console.log('[TM] got message', msg);

  if (msg.type === 'passphraseResponse') {
    handlePassphrase(msg.passphrase);
    return;
  }

  if (msg.type === 'subscribe') {
    // content script should now send: {type:'subscribe',symbol,exchange,kind}
    currentSymbol = msg.symbol;
    currentExchange = msg.exchange;
    currentKind = msg.kind || 'linear'; // Default to linear if not specified

    // Reset position idx cache when changing symbols/exchange
    cachedPosIdxBuy = null;
    cachedPosIdxSell = null;

    if (msg.exchange === 'binance') startPriceStream(msg.symbol);
  }

  if (msg.type === 'getBalance') {
    fetchBalance(msg.exchange);
  }

  if (msg.type === 'placeOrder') {
    placeOrder(msg);
  }
});

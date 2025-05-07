// options/options.js
console.log('[Options] options.js loaded');

import { encryptManagerConfig } from '../background/crypto-util.js';

document.addEventListener('DOMContentLoaded', () => {
  console.log('[Options] DOMContentLoaded event');

  const passEl   = document.getElementById('pass');
  const binKeyEl = document.getElementById('binKey');
  const binSecEl = document.getElementById('binSec');
  const byKeyEl  = document.getElementById('byKey');
  const bySecEl  = document.getElementById('bySec');
  const saveBtn  = document.getElementById('save');

  if (!passEl || !binKeyEl || !binSecEl || !byKeyEl || !bySecEl || !saveBtn) {
    console.error('[Options] Missing one or more form elements');
    return;
  }

  saveBtn.addEventListener('click', async () => {
    console.log('[Options] Save button clicked');

    const pass = passEl.value.trim();
    if (!pass) {
      alert('You must enter a passphrase');
      return;
    }

    const cfg = {
      binanceKey:    binKeyEl.value.trim(),
      binanceSecret: binSecEl.value.trim(),
      bybitKey:      byKeyEl.value.trim(),
      bybitSecret:   bySecEl.value.trim()
    };

    try {
      console.log('[Options] encrypting config with passphrase', pass);
      await encryptManagerConfig(cfg, pass);
      console.log('[Options] encryption successful');

      // Save the raw keys as well so the background script can still read them
      await new Promise(resolve => {
        chrome.storage.local.set({
          binanceKey:    cfg.binanceKey,
          binanceSecret: cfg.binanceSecret,
          bybitKey:      cfg.bybitKey,
          bybitSecret:   cfg.bybitSecret
        }, resolve);
      });
      console.log('[Options] plaintext keys saved for background');

      // Kick off an immediate balance refresh for both exchanges
      chrome.runtime.sendMessage({ type:'getBalance', exchange:'binance' });
      chrome.runtime.sendMessage({ type:'getBalance', exchange:'bybit' });
      console.log('[Options] requested balance refresh from background');

      alert('🔒 Keys encrypted and saved! Balances will load shortly.');

      // Clear input fields for safety
      passEl.value   = '';
      binKeyEl.value = '';
      binSecEl.value = '';
      byKeyEl.value  = '';
      bySecEl.value  = '';
    } catch (err) {
      console.error('[Options] encryption error', err);
      alert('❌ Failed to save keys: ' + err.message);
    }
  });
});

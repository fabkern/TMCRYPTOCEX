// background/crypto-util.js

// Helpers to convert between ArrayBuffer and base64
function bufToBase64(buf) {
  const bytes = new Uint8Array(buf);
  let binary = '';
  for (let b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}
function base64ToBuf(b64) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

// Derive an AES-GCM key from passphrase + salt via PBKDF2
async function deriveKey(passphrase, salt) {
  const pwUtf8 = new TextEncoder().encode(passphrase);
  const saltBuf = base64ToBuf(salt);
  const keyMaterial = await crypto.subtle.importKey(
    'raw', pwUtf8, { name: 'PBKDF2' }, false, ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: saltBuf,
      iterations: 100000,
      hash: 'SHA-256'
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

/**
 * Encrypts the given config object and stores it to chrome.storage.local
 * under the key 'encryptedConfig'. The user must provide a passphrase.
 *
 * @param {{binanceKey:string,binanceSecret:string,bybitKey:string,bybitSecret:string}} cfg
 * @param {string} passphrase
 */
export async function encryptManagerConfig(cfg, passphrase) {
  // 1) Generate a random salt & iv
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv   = crypto.getRandomValues(new Uint8Array(12));

  // 2) Derive an AES-GCM key
  const key = await deriveKey(passphrase, bufToBase64(salt));

  // 3) Serialize and encrypt
  const plainTxt = JSON.stringify(cfg);
  const plainBuf = new TextEncoder().encode(plainTxt);
  const cipherBuf = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    plainBuf
  );

  // 4) Store salt, iv, and ciphertext (all base64) in chrome.storage
  const payload = {
    salt: bufToBase64(salt),
    iv:   bufToBase64(iv),
    data: bufToBase64(cipherBuf)
  };
  return new Promise((resolve, reject) => {
    chrome.storage.local.set({ encryptedConfig: payload }, () =>
      chrome.runtime.lastError ? reject(chrome.runtime.lastError) : resolve()
    );
  });
}

/**
 * Retrieves and decrypts the stored config. Prompts will be thrown
 * if the passphrase is wrong or if there’s no config saved.
 *
 * @param {string} passphrase
 * @returns {Promise<{binanceKey:string,binanceSecret:string,bybitKey:string,bybitSecret:string}>}
 */
export async function decryptManagerConfig(passphrase) {
  const { encryptedConfig } = await new Promise(resolve =>
    chrome.storage.local.get('encryptedConfig', resolve)
  );

  if (!encryptedConfig) {
    throw new Error('No encrypted configuration found');
  }
  const { salt, iv, data } = encryptedConfig;
  if (!salt || !iv || !data) {
    throw new Error('Corrupted encrypted configuration');
  }

  // Derive the same key, then decrypt
  const key = await deriveKey(passphrase, salt);
  let plainBuf;
  try {
    plainBuf = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: base64ToBuf(iv) },
      key,
      base64ToBuf(data)
    );
  } catch {
    throw new Error('Incorrect passphrase or data corrupted');
  }

  const plainTxt = new TextDecoder().decode(plainBuf);
  return JSON.parse(plainTxt);
}

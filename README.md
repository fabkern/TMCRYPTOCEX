# TradeManager

A lightweight Chrome extension that injects a draggable, dark-themed risk-management panel on Binance and Bybit. Define your risk in % or fixed dollars, set stop-loss and take-profit (or use **Auto-RR**), see estimated fees, and place one-click market orders right from the page.

---

## Features

- **Draggable Panel**  
  Pin it anywhere on the exchange page. Position is saved between sessions.

- **Auto-Detect Market**  
  Supports Binance futures/spot and Bybit spot/perpetual (USDT & inverse).

- **Real-Time Price Feed**  
  • Binance: WebSocket `@markPrice` or `@trade`  
  • Bybit: WebSocket `publicTrade` or DOM/title fallback

- **Risk & Size Calculation**  
  • Risk by percentage of balance or fixed dollar amount  
  • Enter stop-loss and take-profit levels  
  • **Auto-RR™**: tick to auto-set TP to your target **Risk-Reward** (default 1.1×, editable)  
  • Computes position size = Risk ÷ |Entry − SL|  
  • Shows **Risk-Reward Ratio** (RR)

- **Fees Predictor**  
  Estimates round-trip fees (in & out) based on exchange rates.

- **Auto-TP**  
  Automatically places your stop-loss and take-profit orders immediately after your market fill.

- **One-Click Market Orders**  
  HMAC-signed REST calls to Binance Futures and Bybit Unified  
  Automatically rounds to valid lot step and handles position mode

- **Secure Key Storage**  
  Encrypt your API keys with a passphrase. Decrypted only in the background worker.

- **Auto-Refresh Balance**  
  Fetches USDT balance every 30 seconds and immediately after any successful order.

---

## Prerequisites

- Chrome (v90+) or any Chromium-based browser  
- A Binance Futures API key/secret  
- A Bybit Unified API key/secret  

---

## Installation

1. Clone or download the `TradeManager` folder to your machine.  
2. In Chrome, open `chrome://extensions`, enable **Developer mode**, click **Load unpacked**, and select your `TradeManager` folder.  
3. Click the extension icon → **Options**, enter a passphrase and your API keys, then **Save encrypted**.

---

## Usage

1. Navigate to a trading page on Binance or Bybit (spot, futures, or perpetual).  
2. The **Risk Manager** panel appears (top-left by default).  
3. **Select risk mode**: % of balance or fixed $. Enter your risk amount.  
4. **Enter Stop-Loss** level.  
5. **Enter Take-Profit** manually, or tick **Auto RR** and set your **Target RR** to have TP auto-calculated.  
6. See real-time **Size**, **RR**, and **Est. Fee** before you trade.  
7. Click **Buy** or **Sell** to place your market order; SL/TP will be placed automatically.

---

## Development

```bash
# Clone the repository
git clone https://github.com/fabkern/TradeManager.git
cd TradeManager

# Install dependencies
npm install

# Start the dev server
npm run dev

```



![License](https://img.shields.io/badge/license-MIT-blue)
![Version](https://img.shields.io/badge/version-1.0.0-green)


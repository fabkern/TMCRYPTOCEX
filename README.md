# TradeManager

A lightweight Chrome extension that injects a draggable, dark-themed risk-management panel on Binance and Bybit. Define your risk in % or fixed dollars, set stop-loss and take-profit, and get position-size and risk-reward automatically. Place one-click market orders right from the page.

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
  • Computes position size = Risk ÷ |Entry − SL|  
  • Shows risk-reward ratio (RR)

- **One-Click Market Orders**  
  Sends HMAC-signed REST calls to Binance Futures and Bybit Unified  
  Automatically rounds to valid lot step and handles position mode

- **Secure Key Storage**  
  Encrypt your API keys with a passphrase. Decrypted only in the background.

- **Auto-Refresh Balance**  
  Fetches USDT balance every 30 seconds or immediately after an order.

---

## Prerequisites

- Chrome (v90+) or any Chromium-based browser  
- A Binance Futures API key/secret  
- A Bybit Unified API key/secret  

---

## Installation

1. Clone or download the `TradeManager` folder to your machine.
2. In Chrome, open `chrome://extensions`, enable **Developer mode**, click **Load unpacked**, and select your `TradeManager` folder.
3. Click the extension icon, go to **Options**, enter a passphrase plus your API keys, then “Save encrypted”.

---

## Usage

1. Navigate to a trading page on Binance or Bybit (spot or futures/perpetual).  
2. The Risk Manager panel appears in the top-left by default.  
3. Choose risk mode (`% bal` or `fixed $`), enter your risk amount.  
4. Enter Stop-Loss and Take-Profit.  
5. Panel updates **Size** and **RR** in real time.  
6. Click **Buy** or **Sell** to place a market order.  

---

## Development

```bash
# Clone your own fork, install dependencies if any:
git clone https://github.com/<your-username>/TradeManager.git
cd TradeManager






![License](https://img.shields.io/badge/license-MIT-blue)
![Version](https://img.shields.io/badge/version-1.0.0-green)


# Chess.com Bot Move Coach — v1.1.0

Chrome / Brave / Edge extension for real-time Stockfish best-move hints on **Chess.com computer/bot games only**.

## What changed in 1.1.0

- New custom knight icon.
- Clicking the toolbar icon now opens a real control popup.
- The popup clearly shows **BOT GAME — ACTIVE** or **HUMAN GAME — DISABLED**.
- Popup controls for Stockfish depth, Auto mode, Analyze Now, and Show/Hide board panel.
- Quick button to open Chess.com Play Computer.
- The in-page trainer panel now has an × hide button.

## Install / update

1. Extract the ZIP.
2. Open `chrome://extensions/` or `brave://extensions/`.
3. Remove the old version, or click **Reload** after replacing its folder.
4. Click **Load unpacked** and select this extension folder.
5. Open `https://www.chess.com/play/computer`.
6. If the bot page was already open before installation, reload it once.

## Supported routes

- `https://www.chess.com/play/computer`
- `https://www.chess.com/game/computer/...`

The extension does not inject the engine trainer on normal human-vs-human game pages.

## Engine

The current build sends only the FEN position to StockfishOnline for analysis. No Chess.com password, cookies, or chat data are sent by the extension.

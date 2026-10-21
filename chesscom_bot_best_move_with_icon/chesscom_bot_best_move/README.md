# Chess.com Bot Best-Move Trainer

A Chrome/Brave/Edge Manifest V3 extension that shows the next Stockfish move in real time **only on Chess.com computer/bot games**.

## Supported pages

- `https://www.chess.com/play/computer`
- `https://www.chess.com/game/computer/...`

It is intentionally not injected on normal human-vs-human Chess.com game pages.

## Install

1. Unzip the folder.
2. Open `chrome://extensions/` (or `brave://extensions/`).
3. Turn on **Developer mode**.
4. Click **Load unpacked**.
5. Select the `chesscom_bot_best_move` folder.
6. Open Chess.com → **Play → Computer** and start a bot game.

## How it works

- Reads piece locations from Chess.com's board DOM.
- Detects whose turn it is using the active clock and board orientation.
- Builds a FEN position.
- Sends the FEN to the StockfishOnline REST API at depth 8–15.
- Displays the best UCI move and draws an arrow directly on the board.
- Automatically refreshes after each move.

Only the chess position (FEN) is sent to the engine service; the extension does not send your Chess.com username, chat, cookies, or password.

## Controls

- **Depth**: 8–15. Higher is stronger but normally slower.
- **Auto**: update automatically after moves.
- **Analyze now**: force an analysis immediately.
- **Clear**: remove the arrow.

## Notes

Chess.com can change its page HTML/CSS. If the board stops being detected after a site update, the selectors in `content.js` may need a small update.


## Extension icon
Version 1.0.1 includes a custom green chess-knight icon in 16, 32, 48, and 128 px sizes for the Chrome/Brave toolbar and extension manager.

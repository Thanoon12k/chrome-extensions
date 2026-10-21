const API_URL = "https://stockfish.online/api/s/v2.php";

function validFen(fen) {
  return typeof fen === "string" && fen.length >= 15 && fen.length <= 120 && /^[prnbqkPRNBQK1-8\/]+\s[wb]\s/.test(fen);
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.type !== "analyzeFen") return;

  (async () => {
    try {
      const fen = message.fen;
      const depth = Math.max(6, Math.min(15, Number(message.depth) || 12));
      if (!validFen(fen)) throw new Error("Invalid FEN");

      const url = new URL(API_URL);
      url.searchParams.set("fen", fen);
      url.searchParams.set("depth", String(depth));

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 12000);
      const response = await fetch(url.toString(), {
        method: "GET",
        cache: "no-store",
        signal: controller.signal
      });
      clearTimeout(timeout);

      if (!response.ok) throw new Error(`Engine HTTP ${response.status}`);
      const data = await response.json();
      if (!data || data.success !== true) {
        throw new Error((data && (data.data || data.error)) || "Engine returned no result");
      }

      const rawBest = String(data.bestmove || "").trim();
      const match = rawBest.match(/bestmove\s+([a-h][1-8][a-h][1-8][qrbn]?)/i);
      if (!match) throw new Error("No best move returned");

      sendResponse({
        ok: true,
        bestMove: match[1].toLowerCase(),
        evaluation: typeof data.evaluation === "number" ? data.evaluation : (typeof data.eval === "number" ? data.eval : null),
        mate: Number.isInteger(data.mate) ? data.mate : null,
        continuation: typeof data.continuation === "string" ? data.continuation.trim() : "",
        depth
      });
    } catch (err) {
      sendResponse({ ok: false, error: err && err.message ? err.message : String(err) });
    }
  })();

  return true;
});

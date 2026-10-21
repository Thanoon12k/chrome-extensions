// Settings shared by the popup, background worker and content script.
const SWB_DEFAULTS = {
  bridgeUrl: "http://127.0.0.1:8765",
  delaySeconds: 6,          // pause between chunks
  timeoutSeconds: 180,      // max wait for StealthWriter output
  stableSeconds: 3,         // output must stop changing for this long
  mismatch: "per-paragraph", // "per-paragraph" | "skip" | "stop"
  maxErrors: 3,             // consecutive failures before auto-stop
  inputSelector: "",
  buttonSelector: "",
  outputSelector: "",
  buttonText: "humani[sz]e|rewrite|rephrase|bypass"
};

async function swbGetSettings() {
  const s = await chrome.storage.sync.get(SWB_DEFAULTS);
  return { ...SWB_DEFAULTS, ...s };
}

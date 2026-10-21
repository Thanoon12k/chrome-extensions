const FIELDS = ["bridgeUrl", "delaySeconds", "timeoutSeconds", "stableSeconds", "mismatch", "maxErrors",
  "buttonText", "inputSelector", "buttonSelector", "outputSelector"];
const NUMERIC = new Set(["delaySeconds", "timeoutSeconds", "stableSeconds", "maxErrors"]);
const SW_URL = "https://app.stealthwriter.ai/";
const $ = (id) => document.getElementById(id);

async function swTab(create) {
  const tabs = await chrome.tabs.query({ url: ["https://stealthwriter.ai/*", "https://*.stealthwriter.ai/*"] });
  const active = tabs.find((t) => t.active) || tabs[0];
  if (active || !create) return active || null;
  return chrome.tabs.create({ url: SW_URL });
}

async function sendToTab(msg) {
  const tab = await swTab(false);
  if (!tab) {
    $("report").textContent = "Open StealthWriter first (button above).";
    return null;
  }
  try {
    return await chrome.tabs.sendMessage(tab.id, msg);
  } catch (e) {
    $("report").textContent = "Reload the StealthWriter tab so the extension can attach.";
    return null;
  }
}

async function refreshStatus() {
  const st = await chrome.runtime.sendMessage({ type: "bridge", method: "GET", path: "/api/status" });
  const card = $("wb");
  card.className = "card " + (st.ok ? "ok" : "bad");
  if (!st.ok) $("wbText").textContent = st.error || "Workbench not reachable";
  else if (!st.loaded) $("wbText").textContent = "Workbench connected — load a DOCX there.";
  else {
    $("wbText").textContent = `${st.file}: ${st.replaced} replaced · ${st.skipped} skipped · ${st.pending} pending` +
      (st.enabled ? "" : " (extension access disabled)");
  }
}

async function loadSettings() {
  const s = await swbGetSettings();
  for (const f of FIELDS) $(f).value = s[f];
}

async function saveSettings() {
  const out = {};
  for (const f of FIELDS) {
    const v = $(f).value.trim();
    out[f] = NUMERIC.has(f) ? Math.max(1, Number(v) || SWB_DEFAULTS[f]) : v;
  }
  if (!out.bridgeUrl) out.bridgeUrl = SWB_DEFAULTS.bridgeUrl;
  if (!out.buttonText) out.buttonText = SWB_DEFAULTS.buttonText;
  await chrome.storage.sync.set(out);
  $("report").textContent = "Settings saved.";
  refreshStatus();
}

$("start").onclick = async () => {
  const tab = await swTab(false);
  if (!tab) {
    await swTab(true);
    $("report").textContent = "StealthWriter opened — log in, then press Start again.";
    return;
  }
  const r = await sendToTab({ type: "swb-start" });
  if (r) $("report").textContent = "Running — watch the panel on the StealthWriter page.";
};
$("stop").onclick = async () => {
  const r = await sendToTab({ type: "swb-stop" });
  if (r) $("report").textContent = "Stopped.";
};
$("open").onclick = async () => {
  const tab = await swTab(true);
  chrome.tabs.update(tab.id, { active: true });
};
$("detect").onclick = async () => {
  const r = await sendToTab({ type: "swb-detect" });
  if (r && r.report) {
    const x = r.report;
    $("report").textContent =
      `Input:  ${x.input || "NOT FOUND"}\nButton: ${x.button || "NOT FOUND"}\nOutput: ${x.output}`;
  }
};
$("save").onclick = saveSettings;
$("reset").onclick = async () => {
  await chrome.storage.sync.set({ inputSelector: "", buttonSelector: "", outputSelector: "" });
  await loadSettings();
  $("report").textContent = "Selectors reset to auto-detect.";
};

loadSettings();
refreshStatus();

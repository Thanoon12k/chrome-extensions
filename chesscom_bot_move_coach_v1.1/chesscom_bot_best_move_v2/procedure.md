Great question! Let me show you how the code detects if you're playing against a bot:

## 🔍 **Bot Detection in the Code**

There are **3 layers** of detection:

---

### **1. URL Check (First Line of Defense)**
In **manifest.json**, the extension only runs on specific Chess.com URLs:

````json
"content_scripts": [
  {
    "matches": [
      "https://www.chess.com/play/computer*",
      "https://www.chess.com/game/computer/*"
    ],
    "js": ["content.js"]
  }
]
````

**Translation:** The extension only injects itself if the URL contains `/play/computer` or `/game/computer`. Human games have different URLs like `/play/online`.

---

### **2. Route Validation (In content.js)**

````javascript
const isAllowedBotRoute = () => {
  const path = window.location.pathname;
  // Checks if pathname matches bot game patterns
  return path.includes('/play/computer') || 
  path.includes('/game/computer/');
};

if (!isAllowedBotRoute())
  return; // EXIT if not a bot game
````

**Translation:** Before running ANY code, it checks the page URL path. If it's NOT a bot game URL, it stops immediately.

---

### **3. Double Check (Prevent Loading Twice)**

````javascript
if (window.__CHESS_BOT_TRAINER_LOADED__)
  return; // Already loaded, exit
  
window.__CHESS_BOT_TRAINER_LOADED__ = true;
````

**Translation:** If the extension already ran once on this page, don't run again.

---

### **4. Popup Status Check (popup.js)**

When you click the extension icon, it also shows status:

````javascript
function isBotUrl(url) {
  try {
    const u = new URL(url);
    if (u.hostname !== 'www.chess.com' && u.hostname !== 'chess.com')
      return false;
    const p = u.pathname;
    return p.includes('/play/computer') || p.includes('/game/computer/');
  } catch (_) { return false; }
}

if (tab && isBotUrl(url)) {
  // Show "BOT GAME — ACTIVE"
  setCard('ok', 'BOT GAME — ACTIVE', '...');
} else {
  // Show "HUMAN GAME — DISABLED"
  setCard('locked', 'HUMAN GAME — DISABLED', '...');
}
````

**Translation:** It checks the URL of the active tab. If it's a bot URL, show green status. If it's a human game, show orange "disabled" status.

---

## 📊 **Summary Table**

| Detection Layer | How It Works | Example |
|---|---|---|
| **Manifest** | Restricts extension to bot URLs only | Only runs on `/play/computer` |
| **Route Check** | Validates URL path at runtime | Exits if path doesn't have `/computer` |
| **De-duplication** | Prevents multiple loads | Flag: `__CHESS_BOT_TRAINER_LOADED__` |
| **Popup Status** | Shows user current page status | "BOT GAME — ACTIVE" or "HUMAN GAME — DISABLED" |

**Result:** ✅ **It's impossible to accidentally run on human games!**
// Background service worker (MV3)
// Fetches IMDb Technical Specs and extracts aspect ratio. Caches results.
//
// IMDb Fetching Strategy:
// - Cache-first: 30-day TTL means ~1 request per film per user per month
// - Respectful rate limiting: Min 1s between requests to same domain
// - Graceful degradation: Handles network errors and markup changes
// - Non-commercial personal use: Fetches public pages only when user visits Letterboxd

const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const MIN_REQUEST_INTERVAL_MS = 1000; // 1 second between IMDb requests

// Track per-tab aspect ratios (persisted to session storage)
const TAB_DATA = new Map(); // tabId -> { imdbId, aspectRatio, filmTitle }

// Rate limiting
let lastImdbRequestTime = 0;

// Track current status for popup (persisted to session storage)
let STATUS = {
  lastImdbId: null,
  lastStatus: "idle", // idle, fetching, success, error
  lastAspectRatio: null,
  lastError: null,
  lastUpdate: null,
  totalFetches: 0,
  cacheHits: 0,
  imdbRequests: 0, // Actual network requests to IMDb (vs cache hits)
};

// Restore status and tab data from session storage on startup
chrome.storage.session.get(["status", "tabData"], (result) => {
  if (result.status) {
    STATUS = { ...STATUS, ...result.status };
    console.log("[LB-AR BG] Restored status from session:", STATUS);
  }
  if (result.tabData) {
    Object.entries(result.tabData).forEach(([tabId, data]) => {
      TAB_DATA.set(parseInt(tabId), data);
    });
    console.log("[LB-AR BG] Restored tab data:", TAB_DATA);
  }
});

function saveStatus() {
  chrome.storage.session.set({ status: STATUS });
}

function saveTabData() {
  const obj = {};
  TAB_DATA.forEach((value, key) => {
    obj[key] = value;
  });
  chrome.storage.session.set({ tabData: obj });
}

function updateBadgeForTab(tabId) {
  const data = TAB_DATA.get(tabId);
  if (data && data.aspectRatio) {
    chrome.action.setBadgeText({ text: data.aspectRatio, tabId });
    chrome.action.setBadgeBackgroundColor({ color: "#4CAF50", tabId });
    chrome.action.setTitle({ 
      title: `${data.filmTitle || "Film"}: ${data.aspectRatio}`, 
      tabId 
    });
  } else {
    chrome.action.setBadgeText({ text: "", tabId });
    chrome.action.setTitle({ title: "Letterboxd Aspect Ratio", tabId });
  }
}

function cacheKey(imdbId) {
  return `ar:${imdbId}`;
}

async function getCached(imdbId) {
  const key = cacheKey(imdbId);
  return new Promise((resolve) => {
    chrome.storage.local.get([key], (res) => {
      if (!res || !res[key]) return resolve(null);
      resolve(res[key]);
    });
  });
}

async function setCached(imdbId, value) {
  const key = cacheKey(imdbId);
  return new Promise((resolve) => {
    chrome.storage.local.set({ [key]: value }, () => resolve());
  });
}

function normalizeAspectRatioText(text) {
  if (!text) return null;
  let v = text.trim();
  // Normalize common spacing variants like "1.85 : 1" -> "1.85:1"
  v = v.replace(/\s*:\s*/g, ":");
  v = v.replace(/\s+/g, " ");
  // Remove trailing label fragments like 'Camera', 'Runtime' if accidentally captured
  v = v
    .replace(
      /\s*(Camera|Runtime|Sound mix|Color|Negative Format|Cinematographic Process|Printed Film Format).*$/i,
      ""
    )
    .trim();
  return v;
}

function parseAllAspectRatiosFromImdb(html) {
  // Very tolerant parser that looks for the label 'Aspect ratio' and then captures the following text chunk.
  // IMDb markup changes occasionally; this aims to survive by working on raw text.
  const results = [];
  if (!html) return results;
  const stripped = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "");
  const lower = stripped.toLowerCase();
  let idx = 0;
  while ((idx = lower.indexOf("aspect ratio", idx)) !== -1) {
    const sliceHtml = stripped.slice(idx, idx + 800); // look ahead a bit
    const text = sliceHtml
      .replace(/<[^>]*>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    // Find label and take the next chunk
    const m = text.match(
      /aspect\s*ratio\s*([^|\n\r]+?)(?:\s{2,}|\s+(Camera|Runtime|Sound mix|Color|Negative|Cinematographic|Printed|Contribute)\b|$)/i
    );
    if (m && m[1]) {
      const v = normalizeAspectRatioText(m[1]);
      if (v) results.push(v);
    }
    idx += 12; // move past label to find more
  }
  return results;
}

async function fetchImdbAspectRatio(imdbId) {
  // Rate limiting: ensure minimum interval between requests
  const now = Date.now();
  const timeSinceLastRequest = now - lastImdbRequestTime;
  if (timeSinceLastRequest < MIN_REQUEST_INTERVAL_MS) {
    const delay = MIN_REQUEST_INTERVAL_MS - timeSinceLastRequest;
    console.log(`[LB-AR BG] Rate limiting: waiting ${delay}ms before IMDb request`);
    await new Promise((resolve) => setTimeout(resolve, delay));
  }
  
  const url = `https://www.imdb.com/title/${imdbId}/technical/`;
  console.log(`[LB-AR BG] Fetching from IMDb: ${url}`);
  
  lastImdbRequestTime = Date.now();
  STATUS.imdbRequests++;
  
  const res = await fetch(url, { 
    method: "GET", 
    credentials: "omit",
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    }
  });
  
  if (!res.ok) {
    throw new Error(`IMDb fetch failed: ${res.status}`);
  }
  
  const html = await res.text();
  console.log(`[LB-AR BG] Received ${html.length} bytes from IMDb`);
  
  const list = parseAllAspectRatiosFromImdb(html);
  if (!list || list.length === 0) {
    throw new Error("Aspect ratio not found on IMDb");
  }
  
  console.log(`[LB-AR BG] Parsed aspect ratios:`, list);
  
  // Prefer entries that look like a ratio (n.nn:1, n.nn:1 (desc), etc.)
  // Otherwise just return the first.
  const ratioLike = list.find((v) => /\d+(?:\.\d+)?\s*:\s*\d+/.test(v));
  const aspectRatio = normalizeAspectRatioText(ratioLike || list[0]);
  
  console.log(`[LB-AR BG] Selected aspect ratio: ${aspectRatio}`);
  
  return { aspectRatio, source: "imdb", sourceUrl: url };
}

// Listen for tab activation to update badge
chrome.tabs.onActivated.addListener((activeInfo) => {
  updateBadgeForTab(activeInfo.tabId);
});

// Listen for tab updates (URL changes)
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.url) {
    // URL changed, clear badge for this tab
    TAB_DATA.delete(tabId);
    saveTabData();
    updateBadgeForTab(tabId);
  }
});

// Clean up when tabs are closed
chrome.tabs.onRemoved.addListener((tabId) => {
  TAB_DATA.delete(tabId);
  saveTabData();
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === "getAspectRatio" && msg.imdbId) {
    (async () => {
      try {
        const imdbId = msg.imdbId;
        const tabId = sender.tab?.id;
        
        STATUS.totalFetches++;
        STATUS.lastImdbId = imdbId;
        STATUS.lastStatus = "fetching";
        STATUS.lastUpdate = new Date().toISOString();
        saveStatus();
        
        const now = Date.now();
        const cached = await getCached(imdbId);
        if (
          cached &&
          cached.fetchedAt &&
          now - cached.fetchedAt < CACHE_TTL_MS
        ) {
          STATUS.cacheHits++;
          STATUS.lastStatus = "success";
          STATUS.lastAspectRatio = cached.aspectRatio;
          saveStatus();
          
          // Update tab data and badge
          if (tabId) {
            TAB_DATA.set(tabId, {
              imdbId,
              aspectRatio: cached.aspectRatio,
              filmTitle: msg.filmTitle || null,
            });
            saveTabData();
            updateBadgeForTab(tabId);
          }
          
          sendResponse({ ok: true, data: cached });
          return;
        }
        const data = await fetchImdbAspectRatio(imdbId);
        const record = { ...data, fetchedAt: Date.now() };
        await setCached(imdbId, record);
        STATUS.lastStatus = "success";
        STATUS.lastAspectRatio = record.aspectRatio;
        saveStatus();
        
        // Update tab data and badge
        if (tabId) {
          TAB_DATA.set(tabId, {
            imdbId,
            aspectRatio: record.aspectRatio,
            filmTitle: msg.filmTitle || null,
          });
          saveTabData();
          updateBadgeForTab(tabId);
        }
        
        sendResponse({ ok: true, data: record });
      } catch (err) {
        STATUS.lastStatus = "error";
        STATUS.lastError = String(err && err.message ? err.message : err);
        saveStatus();
        sendResponse({
          ok: false,
          error: STATUS.lastError,
        });
      }
    })();
    return true; // async response
  }
  
  if (msg && msg.type === "updateStatus") {
    // Content script updating status
    const tabId = sender.tab?.id;
    if (msg.imdbId) STATUS.lastImdbId = msg.imdbId;
    if (msg.status) STATUS.lastStatus = msg.status;
    if (msg.aspectRatio) STATUS.lastAspectRatio = msg.aspectRatio;
    if (msg.error) STATUS.lastError = msg.error;
    STATUS.lastUpdate = new Date().toISOString();
    saveStatus();
    
    // Update tab-specific data
    if (tabId && msg.aspectRatio) {
      TAB_DATA.set(tabId, {
        imdbId: msg.imdbId || STATUS.lastImdbId,
        aspectRatio: msg.aspectRatio,
        filmTitle: msg.filmTitle || null,
      });
      saveTabData();
      updateBadgeForTab(tabId);
    }
    return;
  }
  
  if (msg && msg.type === "getStatus") {
    sendResponse(STATUS);
    return true;
  }
  // not handled
});
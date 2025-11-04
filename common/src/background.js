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
// aspectRatio is the primary (for icon), displayText is all ratios for page badge
const TAB_DATA = new Map(); // tabId -> { imdbId, aspectRatio, displayText, filmTitle }

// Rate limiting
let lastImdbRequestTime = 0;

// Track current status for popup (persisted to session storage)
let STATUS = {
  lastImdbId: null,
  lastStatus: "idle", // idle, fetching, success, error
  lastAspectRatio: null,
  lastFilmTitle: null,
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
    // Keep icon badge short (e.g., 2.39 instead of 2.39:1)
    const shortText = formatBadgeTextForIcon(data.aspectRatio);
    chrome.action.setBadgeText({ text: shortText, tabId });
    chrome.action.setBadgeBackgroundColor({ color: "#4CAF50", tabId });
    chrome.action.setTitle({
      title: `${data.filmTitle || "Film"}: ${data.aspectRatio}${
        data.mappedTypeShort ? ` (${data.mappedTypeShort})` : ""
      }${
        data.displayText && data.displayText !== data.aspectRatio
          ? `\nAll: ${data.displayText}`
          : ""
      }`,
      tabId,
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

// Extract the nearest self-contained block (tr/li/div) that holds the "Aspect ratio" label
function findAspectRatioBlocks(html) {
  const blocks = [];
  if (!html) return blocks;
  const cleaned = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "");

  // Common structures to support:
  // - <tr>...<td>Aspect ratio</td><td>...</td></tr>
  // - <li ...>...Aspect ratio...</li>
  // - <div ... data-testid="title-techspecs-aspectratio" ...>...</div>

  const patterns = [
    /<tr[\s\S]*?>[\s\S]*?Aspect\s*ratio[\s\S]*?<\/tr>/gi,
    /<li[\s\S]*?>[\s\S]*?Aspect\s*ratio[\s\S]*?<\/li>/gi,
    /<div[^>]*?data-testid=["']title-techspecs-aspectratio["'][\s\S]*?<\/div>/gi,
    /<section[\s\S]*?>[\s\S]*?Aspect\s*ratio[\s\S]*?<\/section>/gi,
  ];
  for (const re of patterns) {
    const m = cleaned.match(re);
    if (m && m.length) blocks.push(...m);
  }

  // Fallback: find around the first occurrence and capture limited range until a closing tag boundary
  if (blocks.length === 0) {
    const lower = cleaned.toLowerCase();
    const idx = lower.indexOf("aspect ratio");
    if (idx !== -1) {
      const slice = cleaned.slice(Math.max(0, idx - 200), idx + 800);
      blocks.push(slice);
    }
  }
  return blocks;
}

// Pull individual ratio tokens out of a block; support variants and notes
function parseRatiosFromBlock(blockHtml) {
  if (!blockHtml) return [];

  // First, aggressively remove all HTML tags and attributes
  let text = blockHtml
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<a\b[^>]*>/gi, " ")
    .replace(/<\/a>/gi, " ")
    .replace(/<li\b[^>]*>/gi, " ")
    .replace(/<\/li>/gi, " ")
    .replace(/<ul\b[^>]*>/gi, " ")
    .replace(/<\/ul>/gi, " ")
    .replace(/<div\b[^>]*>/gi, " ")
    .replace(/<\/div>/gi, " ")
    .replace(/<span\b[^>]*>/gi, " ")
    .replace(/<\/span>/gi, " ")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  // After the label, keep only the part STRICTLY before next known field label
  const afterLabel = text.replace(/^[\s\S]*?aspect\s*ratio\s*/i, "");
  const clipped = afterLabel
    .replace(
      /\b(Camera|Runtime|Sound mix|Color|Negative|Cinematographic|Printed|Laboratory|Film length|Contribute to this page)\b[\s\S]*$/i,
      ""
    )
    .trim();

  // Also clip if we see HTML artifacts like "class=" or "role=" which indicate unparsed markup
  const cleaned = clipped
    .replace(/\b(class|role|data-testid)\s*=[\s\S]*$/i, "")
    .trim();

  // Split by common separators, but also preserve parenthetical notes
  // Pattern: split on periods NOT inside parens, or explicit separators
  const parts = [];
  let current = "";
  let parenDepth = 0;

  for (let i = 0; i < cleaned.length; i++) {
    const c = cleaned[i];
    if (c === "(") parenDepth++;
    else if (c === ")") parenDepth--;

    // Split on certain chars only when not inside parens
    if (parenDepth === 0 && /[•·|;]/.test(c)) {
      if (current.trim()) parts.push(current.trim());
      current = "";
      continue;
    }

    current += c;
  }
  if (current.trim()) parts.push(current.trim());

  const out = [];
  for (const p of parts) {
    // Extract first ratio-like pattern (handles "2.39 : 1", "1.43:1", etc.)
    const m = p.match(/(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)/);
    if (m) {
      const num = parseFloat(m[1]);
      const den = parseFloat(m[2]);
      if (den !== 0 && num > 0) {
        const normalized = `${(Math.round((num / den) * 100) / 100).toFixed(
          2
        )}:1`;
        // Extract any parenthetical note that follows the ratio
        const afterRatio = p.slice(p.indexOf(m[0]) + m[0].length).trim();
        const noteMatch = afterRatio.match(/^\s*\(([^)]+)\)/);
        const note = noteMatch ? noteMatch[1].trim() : null;

        out.push({
          ratio: normalized,
          raw: m[0].replace(/\s*/g, ""),
          note: note,
        });
      }
      continue;
    }

    // Handle common labels that imply a ratio
    const lowered = p.toLowerCase();
    if (/academy/.test(lowered))
      out.push({ ratio: "1.37:1", raw: "1.37:1", note: null });
    else if (/4\s*:?\s*3|\bfull\s*screen\b/.test(lowered))
      out.push({ ratio: "1.33:1", raw: "1.33:1", note: null });
    else if (/16\s*:?\s*9|hdtv|1\.78/.test(lowered))
      out.push({ ratio: "1.78:1", raw: "1.78:1", note: null });
  }

  return out;
}

function uniqueRatios(entries) {
  const seen = new Set();
  const uniq = [];
  for (const e of entries) {
    if (!e || !e.ratio) continue;
    if (seen.has(e.ratio)) continue;
    seen.add(e.ratio);
    uniq.push(e);
  }
  return uniq;
}

function ratioToNumber(ratio) {
  const m = String(ratio).match(/(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)/);
  if (!m) return null;
  const num = parseFloat(m[1]);
  const den = parseFloat(m[2]);
  if (!isFinite(num) || !isFinite(den) || den === 0) return null;
  return num / den;
}

function mapRatioToType(ratio) {
  const val = ratioToNumber(ratio);
  if (val == null) return { short: null, long: null };
  const within = (t, d = 0.02) => Math.abs(val - t) <= d;

  // Ultra-wide and specialty formats
  if (within(4.0)) return { short: "Polyvision", long: "Polyvision" };
  if (within(2.76))
    return {
      short: "Ultra Panavision 70",
      long: "Ultra Panavision 70, MGM Camera 65",
    };
  if (within(2.59)) return { short: "Cinerama", long: "Cinerama" };

  // Modern widescreen formats
  if (within(2.4) || within(2.39) || within(2.35))
    return { short: "Scope", long: "Anamorphic widescreen, Scope" };
  if (within(2.2))
    return { short: "Todd-AO", long: "Todd-AO, Super Panavision 70" };
  if (within(2.11)) return { short: "IMAX 2.11:1", long: "IMAX 2.11:1" };
  if (within(2.0)) return { short: "Univisium", long: "Univisium, 18:9" };
  if (within(1.9)) return { short: "Digital IMAX", long: "Digital IMAX" };
  if (within(1.85))
    return {
      short: "Widescreen",
      long: "Widescreen (flat), Standard American Widescreen",
    };

  // TV and HDTV formats
  if (within(1.78) || within(16 / 9))
    return { short: "16:9", long: "16:9, HDTV, Widescreen TV" };
  if (within(1.66))
    return { short: "European Widescreen", long: "5:3, European Widescreen" };

  // IMAX film formats
  if (within(1.43) || within(1.44))
    return { short: "IMAX 70mm", long: "IMAX (70mm), True IMAX" };

  // Classic formats
  if (within(1.37))
    return { short: "Academy Ratio", long: "Academy Ratio, Academy Standard" };
  if (within(1.33) || within(4 / 3))
    return { short: "4:3", long: "4:3, Full screen, Standard ratio" };
  if (within(1.19)) return { short: "Silent film", long: "Silent film" };

  return { short: null, long: null };
}

function scoreForPrimary(ratio) {
  const val = ratioToNumber(ratio);
  if (val == null) return 0;
  const within = (t, d = 0.02) => Math.abs(val - t) <= d;
  // Ranking preference: Scope > 1.85 > 2.20 > 1.90 > 2.11 > 1.78 > 1.66 > 2.00 > 1.43 > specialty wide formats > others
  if (within(2.4) || within(2.39) || within(2.35)) return 100;
  if (within(1.85)) return 95;
  if (within(2.2)) return 90;
  if (within(1.9)) return 85;
  if (within(2.11)) return 83;
  if (within(1.78)) return 80;
  if (within(1.66)) return 70;
  if (within(2.0)) return 60;
  if (within(1.43) || within(1.44)) return 50;
  if (within(2.76)) return 45;
  if (within(2.59)) return 43;
  if (within(1.37)) return 40;
  if (within(1.33)) return 35;
  if (within(1.19)) return 30;
  if (within(4.0)) return 25;
  return 10; // default
}

function choosePrimaryRatio(ratios) {
  if (!ratios || ratios.length === 0) return null;
  let best = ratios[0];
  let bestScore = scoreForPrimary(best);
  for (let i = 1; i < ratios.length; i++) {
    const r = ratios[i];
    const s = scoreForPrimary(r);
    if (s > bestScore) {
      best = r;
      bestScore = s;
    }
  }
  return best;
}

function formatBadgeTextForIcon(ratio) {
  // Show just the numeric part before ":1", up to 4 chars if possible
  if (!ratio) return "";
  const m = String(ratio).match(/^(\d+(?:\.\d+)?):1$/);
  if (m) return m[1].slice(0, 4);
  const n = ratioToNumber(ratio);
  return n
    ? String(Math.round(n * 100) / 100).slice(0, 4)
    : String(ratio).slice(0, 4);
}

function parseAllAspectRatiosFromImdb(html) {
  const blocks = findAspectRatioBlocks(html);
  const entries = blocks.flatMap((b) => parseRatiosFromBlock(b));
  const uniq = uniqueRatios(entries);
  return uniq.map((e) => e.ratio);
}

async function fetchImdbAspectRatio(imdbId) {
  // Rate limiting: ensure minimum interval between requests
  const now = Date.now();
  const timeSinceLastRequest = now - lastImdbRequestTime;
  if (timeSinceLastRequest < MIN_REQUEST_INTERVAL_MS) {
    const delay = MIN_REQUEST_INTERVAL_MS - timeSinceLastRequest;
    console.log(
      `[LB-AR BG] Rate limiting: waiting ${delay}ms before IMDb request`
    );
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
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    },
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

  // Normalize and unique already handled; choose primary and compute display text
  const primary = choosePrimaryRatio(list) || list[0];
  const aspectRatio = normalizeAspectRatioText(primary);

  // Build display text with friendly names for each ratio
  const displayParts = list.map((r) => {
    const typeMap = mapRatioToType(r);
    if (typeMap.long) {
      return `${r} (${typeMap.long})`;
    }
    return r;
  });
  const displayText = displayParts.join(" • ");

  const typeMap = mapRatioToType(aspectRatio);

  console.log(`[LB-AR BG] Selected primary aspect ratio: ${aspectRatio}`);
  console.log(`[LB-AR BG] Display text with names: ${displayText}`);

  return {
    aspectRatio,
    displayText,
    allAspectRatios: list,
    mappedTypeShort: typeMap.short,
    mappedTypeLong: typeMap.long,
    source: "imdb",
    sourceUrl: url,
  };
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
        const isIncognito = !!sender.tab?.incognito; // true if request originated in a private window

        // Update transient status (do NOT persist status for incognito)
        STATUS.totalFetches++;
        STATUS.lastImdbId = imdbId;
        STATUS.lastFilmTitle = msg.filmTitle || null;
        STATUS.lastStatus = "fetching";
        STATUS.lastUpdate = new Date().toISOString();
        if (!isIncognito) saveStatus(); // persist only for normal windows

        const now = Date.now();

        // If incognito: do not use persistent cache or storage
        let cached = null;
        if (!isIncognito) {
          cached = await getCached(imdbId);
        }

        if (
          cached &&
          cached.fetchedAt &&
          now - cached.fetchedAt < CACHE_TTL_MS
        ) {
          if (!isIncognito) {
            STATUS.cacheHits++;
            STATUS.lastStatus = "success";
            STATUS.lastAspectRatio = cached.aspectRatio;
            STATUS.lastFilmTitle = msg.filmTitle || null;
            saveStatus();
          }

          // For normal tabs, persist tab data; for incognito, keep in-memory only
          if (tabId && !isIncognito) {
            TAB_DATA.set(tabId, {
              imdbId,
              aspectRatio: cached.aspectRatio,
              displayText: cached.displayText || cached.aspectRatio,
              mappedTypeShort: cached.mappedTypeShort || null,
              filmTitle: msg.filmTitle || null,
            });
            saveTabData();
            updateBadgeForTab(tabId);
          } else if (tabId && isIncognito) {
            // incognito: update badge in memory only
            TAB_DATA.set(tabId, {
              imdbId,
              aspectRatio: cached.aspectRatio,
              displayText: cached.displayText || cached.aspectRatio,
              mappedTypeShort: cached.mappedTypeShort || null,
              filmTitle: msg.filmTitle || null,
            });
            updateBadgeForTab(tabId);
          }

          sendResponse({ ok: true, data: cached });
          return;
        }

        // Make network request and DO NOT cache to persistent storage if incognito
        const data = await fetchImdbAspectRatio(imdbId);
        const record = { ...data, fetchedAt: Date.now() };

        if (!isIncognito) {
          await setCached(imdbId, record);
          STATUS.lastStatus = "success";
          STATUS.lastAspectRatio = record.aspectRatio;
          STATUS.lastFilmTitle = msg.filmTitle || null;
          saveStatus();

          if (tabId) {
            TAB_DATA.set(tabId, {
              imdbId,
              aspectRatio: record.aspectRatio,
              displayText: record.displayText || record.aspectRatio,
              mappedTypeShort: record.mappedTypeShort || null,
              filmTitle: msg.filmTitle || null,
            });
            saveTabData();
            updateBadgeForTab(tabId);
          }
        } else {
          // incognito: do not persist. Update only in-memory badge for tab
          STATUS.lastStatus = "success";
          STATUS.lastAspectRatio = record.aspectRatio;
          STATUS.lastFilmTitle = msg.filmTitle || null;
          // do NOT call saveStatus(), setCached(), or saveTabData()
          if (tabId) {
            TAB_DATA.set(tabId, {
              imdbId,
              aspectRatio: record.aspectRatio,
              displayText: record.displayText || record.aspectRatio,
              mappedTypeShort: record.mappedTypeShort || null,
              filmTitle: msg.filmTitle || null,
            });
            updateBadgeForTab(tabId);
          }
        }

        sendResponse({ ok: true, data: record });
      } catch (err) {
        STATUS.lastStatus = "error";
        STATUS.lastError = String(err && err.message ? err.message : err);
        if (!sender.tab?.incognito) saveStatus(); // persist error only for normal sessions
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
    if (msg.filmTitle) STATUS.lastFilmTitle = msg.filmTitle;
    if (msg.error) STATUS.lastError = msg.error;
    STATUS.lastUpdate = new Date().toISOString();
    saveStatus();

    // Update tab-specific data
    if (tabId && msg.aspectRatio) {
      TAB_DATA.set(tabId, {
        imdbId: msg.imdbId || STATUS.lastImdbId,
        aspectRatio: msg.aspectRatio,
        // content doesn't pass displayText; keep previous if any
        displayText: TAB_DATA.get(tabId)?.displayText || msg.aspectRatio,
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

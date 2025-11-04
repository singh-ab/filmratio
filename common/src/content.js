// Content script for Letterboxd film pages
// - Finds IMDb ID from the "More at IMDB" link
// - Injects an AR badge next to the runtime (preferred), with fallback next to the IMDb link
// - Requests aspect ratio from background and renders it

(function () {
  const STATE = {
    initializedForPath: null,
    runtimeBadgeEl: null,
  };

  function log(...args) {
    // Enable logs for debugging
    console.log("[LB-AR]", ...args);
  }

  function findImdbLink() {
    // Prefer explicit anchors that link to IMDb title page
    const anchors = Array.from(
      document.querySelectorAll(
        'a[href*="imdb.com/title/tt"], a[href^="http://www.imdb.com/title/tt"], a[href^="https://www.imdb.com/title/tt"]'
      )
    );
    if (anchors.length > 0) return anchors[0];
    return null;
  }

  function extractImdbIdFromHref(href) {
    if (!href) return null;
    const m = href.match(/tt\d{5,10}/);
    return m ? m[0] : null;
  }

  function textLooksLikeRuntime(text) {
    if (!text) return false;
    const t = text.trim();
    // Accept patterns like "156 mins", "167 min"
    return /\b\d{2,3}\s*min(?:s)?\b/i.test(t);
  }

  function isVisible(el) {
    if (!el) return false;
    const style = window.getComputedStyle(el);
    if (
      style.display === "none" ||
      style.visibility === "hidden" ||
      style.opacity === "0"
    )
      return false;
    // offsetParent is null for fixed/absolute sometimes; also allow if has bounding rect
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function getFilmTitle() {
    // Try multiple selectors for the film title
    const selectors = [
      "h1.headline-1",
      "h1",
      ".film-title",
      "meta[property='og:title']",
    ];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el) {
        const text = el.getAttribute("content") || el.textContent;
        if (text) return text.trim();
      }
    }
    return null;
  }

  function findRuntimeElement() {
    // First, try the most direct approach: find text nodes containing "NNN mins"
    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT,
      null
    );

    let node;
    while ((node = walker.nextNode())) {
      const text = node.textContent || "";
      if (textLooksLikeRuntime(text)) {
        const parent = node.parentElement;
        if (!parent) continue;

        // Skip if in wrong sections
        const container = parent.closest("section, footer, nav, aside");
        if (
          container &&
          /reviews|popular|lists|ratings|where-to-watch|similar|mentioned|journal/i.test(
            container.id || container.className || ""
          )
        ) {
          continue;
        }

        // Check if visible and near top
        if (isVisible(parent)) {
          const y = parent.getBoundingClientRect().top;
          if (y < 1200) {
            log("Found runtime via text node:", node, "parent:", parent);
            return parent;
          }
        }
      }
    }

    // Fallback: element-based search
    const selectors = [
      "header *, .film-header *, .headline *",
      "time, .runtime, .text-link, .meta, p, span, small, dd, li, div",
    ];
    const scanned = new Set();
    for (const sel of selectors) {
      const nodes = document.querySelectorAll(sel);
      for (const el of nodes) {
        if (scanned.has(el)) continue;
        scanned.add(el);
        const txt = el.textContent || "";
        if (!txt) continue;
        if (!textLooksLikeRuntime(txt)) continue;
        // Filter out obvious non-header sections
        const container = el.closest("section, footer, nav, aside");
        if (
          container &&
          /reviews|popular|lists|ratings|where-to-watch|similar|mentioned|journal/i.test(
            container.id || container.className || ""
          )
        ) {
          continue;
        }
        if (!isVisible(el)) continue;
        // Prefer elements closer to the top of the page
        const y = el.getBoundingClientRect().top;
        if (y > 1200) continue; // too low; likely not the header
        return el;
      }
    }
    return null;
  }

  function ensureBadgeContainerNearImdbLink(imdbAnchor) {
    if (!imdbAnchor) {
      log("ensureBadgeContainerNearImdbLink: imdbAnchor is null");
      return null;
    }
    // Insert a span right after the IMDb link
    let badge = imdbAnchor.parentElement.querySelector(".lb-ar-badge");
    if (badge) {
      log("ensureBadgeContainerNearImdbLink: badge already exists", badge);
      return badge;
    }
    badge = document.createElement("span");
    badge.className = "lb-ar-badge lb-ar-loading";
    badge.title = "Aspect ratio";
    badge.textContent = "Aspect Ratio: …";
    badge.style.display = "inline-flex"; // Force display
    log("ensureBadgeContainerNearImdbLink: created badge", badge);
    log(
      "ensureBadgeContainerNearImdbLink: IMDb anchor",
      imdbAnchor,
      "parent:",
      imdbAnchor.parentElement
    );
    imdbAnchor.insertAdjacentElement("afterend", badge);
    imdbAnchor.insertAdjacentText("afterend", " ");
    log("ensureBadgeContainerNearImdbLink: badge inserted into DOM");
    const verification = document.querySelector(".lb-ar-badge");
    log(
      "ensureBadgeContainerNearImdbLink: verification query result:",
      verification
    );
    return badge;
  }

  function ensureBadgeContainerNearRuntime(runtimeEl) {
    if (!runtimeEl) {
      log("ensureBadgeContainerNearRuntime: runtimeEl is null");
      return null;
    }
    // Avoid duplicating if already inserted
    const existing =
      runtimeEl.parentElement &&
      runtimeEl.parentElement.querySelector(".lb-ar-badge");
    if (existing) {
      log("ensureBadgeContainerNearRuntime: badge already exists", existing);
      return existing;
    }
    const badge = document.createElement("span");
    badge.className = "lb-ar-badge lb-ar-loading";
    badge.title = "Aspect ratio";
    badge.textContent = "Aspect Ratio: …";
    badge.style.display = "inline-flex"; // Force display
    log("ensureBadgeContainerNearRuntime: created badge", badge);
    log(
      "ensureBadgeContainerNearRuntime: runtime element",
      runtimeEl,
      "parent:",
      runtimeEl.parentElement
    );
    runtimeEl.insertAdjacentText("afterend", " ");
    runtimeEl.insertAdjacentElement("afterend", badge);
    log("ensureBadgeContainerNearRuntime: badge inserted into DOM");
    // Verify it's in the DOM
    const verification = document.querySelector(".lb-ar-badge");
    log(
      "ensureBadgeContainerNearRuntime: verification query result:",
      verification
    );
    return badge;
  }

  function updateBadge(badgeEl, text, source, sourceUrl) {
    if (!badgeEl) {
      log("updateBadge: badgeEl is null!");
      return;
    }
    log("updateBadge called with:", { text, source, sourceUrl, badgeEl });
    badgeEl.classList.remove("lb-ar-loading");
    if (text) {
      badgeEl.textContent = `Aspect Ratio: ${text}`;
      if (source) {
        badgeEl.setAttribute("data-source", source);
        badgeEl.title = `Aspect ratio from ${source.toUpperCase()}${
          sourceUrl ? "\n" + sourceUrl : ""
        }`;
      }
      if (sourceUrl) {
        // Make the badge clickable
        const link = document.createElement("a");
        link.href = sourceUrl;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.className = "lb-ar-badge-link";
        link.textContent = badgeEl.textContent;
        badgeEl.replaceChildren(link);
      }
    } else {
      badgeEl.textContent = "AR: N/A";
      badgeEl.title = "Aspect ratio not found";
      badgeEl.classList.add("lb-ar-na");
    }
    log("updateBadge: badge updated, innerHTML:", badgeEl.innerHTML);
  }

  function requestAspectRatio(imdbId, filmTitle) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(
        { type: "getAspectRatio", imdbId, filmTitle },
        (resp) => {
          if (!resp) return resolve({ ok: false, error: "No response" });
          resolve(resp);
        }
      );
    });
  }

  function initWithAnchor(anchor, path) {
    const id = extractImdbIdFromHref(anchor.href);
    log("Extracted IMDb ID:", id);
    if (!id) return;

    const filmTitle = getFilmTitle();
    log("Film title:", filmTitle);

    // If we don't have a runtime badge yet, try to find runtime now
    if (!STATE.runtimeBadgeEl) {
      const runtimeEl = findRuntimeElement();
      log("Retry: Runtime element found:", runtimeEl);
      if (runtimeEl) {
        STATE.runtimeBadgeEl = ensureBadgeContainerNearRuntime(runtimeEl);
        log("Retry: Runtime badge created:", STATE.runtimeBadgeEl);
      }
    }

    // Prefer the runtime badge if available; fallback to IMDb link location
    const badge =
      STATE.runtimeBadgeEl || ensureBadgeContainerNearImdbLink(anchor);
    log("Badge element to update:", badge);

    if (!badge) {
      log("ERROR: Could not create badge element!");
      return;
    }

    STATE.initializedForPath = path;

    // Update extension status
    chrome.runtime.sendMessage({
      type: "updateStatus",
      imdbId: id,
      status: "fetching",
      filmTitle: filmTitle,
    });

    requestAspectRatio(id, filmTitle).then((resp) => {
      log("Got aspect ratio response:", resp);
      if (resp && resp.ok && resp.data) {
        const display = resp.data.displayText || resp.data.aspectRatio;

        updateBadge(badge, display, resp.data.source, resp.data.sourceUrl);
        chrome.runtime.sendMessage({
          type: "updateStatus",
          imdbId: id,
          status: "success",
          aspectRatio: resp.data.aspectRatio,
          filmTitle: filmTitle,
        });
      } else {
        updateBadge(badge, null);
        chrome.runtime.sendMessage({
          type: "updateStatus",
          imdbId: id,
          status: "error",
          error: resp?.error || "Not found",
          filmTitle: filmTitle,
        });
      }
    });
  }

  async function runOncePerPage() {
    const path = location.pathname;
    log("runOncePerPage called for:", path);
    if (STATE.initializedForPath === path) {
      log("Already initialized for", path);
      return;
    }

    // 1) Try to find runtime element early (but don't fail if not found)
    const runtimeEl = findRuntimeElement();
    log("Runtime element found:", runtimeEl);
    if (runtimeEl) {
      STATE.runtimeBadgeEl = ensureBadgeContainerNearRuntime(runtimeEl);
      log("Runtime badge created:", STATE.runtimeBadgeEl);
    } else {
      STATE.runtimeBadgeEl = null;
    }

    const imdbAnchor = findImdbLink();
    log("IMDb anchor found:", imdbAnchor);
    if (!imdbAnchor) {
      // Retry a few times as Letterboxd may hydrate late
      log("IMDb link not found, will retry...");
      let attempts = 0;
      const interval = setInterval(() => {
        attempts++;
        log(`Retry attempt ${attempts}/15`);
        const a = findImdbLink();
        if (a || attempts > 15) {
          clearInterval(interval);
          if (a) {
            log("IMDb link found on retry!");
            initWithAnchor(a, path);
          } else {
            log("IMDb link not found after 15 retries");
            // Update any existing badge to show no IMDb link available
            const badge = STATE.runtimeBadgeEl || document.querySelector(".lb-ar-badge");
            if (badge) {
              updateBadge(badge, null, null, null);
              badge.textContent = "No IMDb link";
              badge.title = "No IMDb link found on this page";
              badge.classList.add("lb-ar-na");
            }
            STATE.initializedForPath = path; // Mark as processed
          }
        }
      }, 400);
      return;
    }
    initWithAnchor(imdbAnchor, path);
  }

  function observeUrlChanges() {
    let last = location.href;
    const obs = new MutationObserver(() => {
      const now = location.href;
      if (now !== last) {
        last = now;
        STATE.initializedForPath = null;
        // Small delay to let content load
        setTimeout(runOncePerPage, 300);
      }
    });
    obs.observe(document, { subtree: true, childList: true });
  }

  // Kick off
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", runOncePerPage);
  } else {
    runOncePerPage();
  }
  observeUrlChanges();
})();

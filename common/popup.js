// Popup script - fetches and displays status from background worker

function updateUI(status) {
  const statusEl = document.getElementById("status");
  const filmTitleEl = document.getElementById("last-film-title");
  const aspectRatioEl = document.getElementById("last-ar");
  const fetchCountEl = document.getElementById("fetch-count");
  const cacheCountEl = document.getElementById("cache-count");
  const errorEl = document.getElementById("error-message");

  // Status indicator
  let statusText = status.lastStatus || "idle";
  statusEl.textContent =
    statusText.charAt(0).toUpperCase() + statusText.slice(1);

  // Add status-specific styling
  statusEl.className = "";
  if (statusText === "success") {
    statusEl.style.color = "var(--pico-color-green)";
  } else if (statusText === "error") {
    statusEl.style.color = "var(--pico-color-red)";
  } else if (statusText === "fetching") {
    statusEl.style.color = "var(--pico-color-orange)";
  } else {
    statusEl.style.color = "inherit";
  }

  // Film title (extract from current tab data if available, or use IMDb ID)
  if (status.lastFilmTitle) {
    filmTitleEl.textContent = status.lastFilmTitle;
  } else if (status.lastImdbId) {
    filmTitleEl.textContent = status.lastImdbId;
    filmTitleEl.style.fontFamily = "monospace";
    filmTitleEl.style.fontSize = "0.9em";
  } else {
    filmTitleEl.textContent = "N/A";
    filmTitleEl.style.fontFamily = "inherit";
    filmTitleEl.style.fontSize = "inherit";
  }

  // Aspect ratio
  if (status.lastAspectRatio) {
    aspectRatioEl.textContent = status.lastAspectRatio;
    aspectRatioEl.style.fontWeight = "bold";
    aspectRatioEl.style.color = "var(--pico-color-green)";
  } else {
    aspectRatioEl.textContent = "N/A";
    aspectRatioEl.style.fontWeight = "normal";
    aspectRatioEl.style.color = "inherit";
  }

  // Stats
  fetchCountEl.textContent = status.totalFetches || 0;
  cacheCountEl.textContent = status.cacheHits || 0;

  const imdbRequestsEl = document.getElementById("imdb-requests");
  if (imdbRequestsEl) {
    imdbRequestsEl.textContent = status.imdbRequests || 0;
  }

  // Error handling
  if (status.lastStatus === "error" && status.lastError) {
    errorEl.textContent = `Error: ${status.lastError}`;
    errorEl.style.display = "block";
  } else {
    errorEl.style.display = "none";
  }
}

// Wait for DOM to be fully loaded before initializing
document.addEventListener("DOMContentLoaded", () => {
  // Request initial status from background
  chrome.runtime.sendMessage({ type: "getStatus" }, (status) => {
    if (status) {
      updateUI(status);
    } else {
      document.getElementById("status").textContent = "Not available";
    }
  });

  // Refresh every 2 seconds while popup is open
  setInterval(() => {
    chrome.runtime.sendMessage({ type: "getStatus" }, (status) => {
      if (status) updateUI(status);
    });
  }, 2000);
});

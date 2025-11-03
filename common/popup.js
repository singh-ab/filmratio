// Popup script - fetches and displays status from background worker

function updateUI(status) {
  const statusEl = document.getElementById("status");
  const imdbIdEl = document.getElementById("imdbId");
  const aspectRatioEl = document.getElementById("aspectRatio");
  const totalFetchesEl = document.getElementById("totalFetches");
  const cacheHitsEl = document.getElementById("cacheHits");
  const errorEl = document.getElementById("error");
  const errorRowEl = document.getElementById("errorRow");

  // Status indicator
  let statusText = status.lastStatus || "idle";
  let statusClass = `status-${statusText}`;
  statusEl.textContent =
    statusText.charAt(0).toUpperCase() + statusText.slice(1);
  statusEl.className = `value ${statusClass}`;

  // Last IMDb ID
  if (status.lastImdbId) {
    imdbIdEl.textContent = status.lastImdbId;
    imdbIdEl.title = `IMDb: ${status.lastImdbId}`;
  } else {
    imdbIdEl.textContent = "—";
  }

  // Aspect ratio
  if (status.lastAspectRatio) {
    aspectRatioEl.textContent = status.lastAspectRatio;
  } else {
    aspectRatioEl.textContent = "—";
  }

  // Stats
  totalFetchesEl.textContent = status.totalFetches || 0;
  cacheHitsEl.textContent = status.cacheHits || 0;
  
  const imdbRequestsEl = document.getElementById("imdbRequests");
  if (imdbRequestsEl) {
    imdbRequestsEl.textContent = status.imdbRequests || 0;
  }

  // Error
  if (status.lastStatus === "error" && status.lastError) {
    errorRowEl.style.display = "flex";
    errorEl.textContent = status.lastError;
    errorEl.title = status.lastError;
  } else {
    errorRowEl.style.display = "none";
  }
}

// Request status from background
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

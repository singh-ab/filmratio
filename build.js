#!/usr/bin/env node

/**
 * Build script for cross-browser extension
 * Usage: node build.js [chrome|firefox|both]
 *
 * Copies common files to dist/chrome and dist/firefox directories
 * that can be loaded directly via "Load unpacked" or "Load Temporary Add-on"
 */

const fs = require("fs");
const path = require("path");
const https = require("https");

const POLYFILL_URL =
  "https://unpkg.com/webextension-polyfill@0.10.0/dist/browser-polyfill.min.js";

/**
 * Recursively copy directory
 */
function copyRecursive(src, dest) {
  if (!fs.existsSync(src)) {
    console.error(`Source not found: ${src}`);
    return;
  }

  const stat = fs.statSync(src);

  if (stat.isDirectory()) {
    // Create directory if it doesn't exist
    if (!fs.existsSync(dest)) {
      fs.mkdirSync(dest, { recursive: true });
    }

    // Copy all files in directory
    const files = fs.readdirSync(src);
    files.forEach((file) => {
      const srcPath = path.join(src, file);
      const destPath = path.join(dest, file);
      copyRecursive(srcPath, destPath);
    });
  } else {
    // Copy file
    fs.copyFileSync(src, dest);
  }
}

/**
 * Download polyfill if not already present
 */
function downloadPolyfill(destPath) {
  return new Promise((resolve, reject) => {
    // Check if already exists
    if (fs.existsSync(destPath)) {
      console.log("   Polyfill already exists, skipping download");
      resolve();
      return;
    }

    console.log("   Downloading webextension-polyfill...");

    // Create directory if needed
    const dir = path.dirname(destPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const file = fs.createWriteStream(destPath);

    https
      .get(POLYFILL_URL, (response) => {
        if (response.statusCode === 200) {
          response.pipe(file);
          file.on("finish", () => {
            file.close();
            console.log("   Polyfill downloaded");
            resolve();
          });
        } else {
          reject(
            new Error(`Failed to download polyfill: ${response.statusCode}`)
          );
        }
      })
      .on("error", (err) => {
        fs.unlink(destPath, () => {}); // Delete incomplete file
        reject(err);
      });
  });
}

/**
 * Create Firefox-specific manifest
 */
function createFirefoxManifest(destPath) {
  const manifest = {
    manifest_version: 3,
    name: "FilmRatio for Letterboxd",
    version: "1.0.0",
    description:
      "Displays film aspect ratios on Letterboxd using IMDb Technical Specs.",
    icons: {
      16: "common/icons/ar_lookup.png",
      32: "common/icons/ar_lookup.png",
      48: "common/icons/ar_lookup.png",
      128: "common/icons/ar_lookup.png",
    },
    browser_specific_settings: {
      gecko: {
        id: "letterboxd-aspect-ratio@example.com",
        strict_min_version: "109.0",
      },
    },
    permissions: ["storage"],
    host_permissions: ["https://www.imdb.com/*"],
    content_scripts: [
      {
        matches: ["https://letterboxd.com/film/*/"],
        js: ["common/src/lib/browser-polyfill.min.js", "common/src/content.js"],
        css: ["common/styles/badge.css"],
        run_at: "document_idle",
      },
    ],
    background: {
      scripts: [
        "common/src/lib/browser-polyfill.min.js",
        "common/src/background.js",
      ],
      type: "module",
    },
    action: {
      default_title: "FilmRatio for Letterboxd",
      default_popup: "common/popup.html",
      default_icon: {
        16: "common/icons/ar_lookup.png",
        32: "common/icons/ar_lookup.png",
        48: "common/icons/ar_lookup.png",
        128: "common/icons/ar_lookup.png",
      },
    },
  };

  fs.writeFileSync(destPath, JSON.stringify(manifest, null, 2));
  console.log("   Firefox manifest created");
}

/**
 * Create Chrome-specific manifest
 */
function createChromeManifest(destPath) {
  const manifest = {
    manifest_version: 3,
    name: "FilmRatio for Letterboxd",
    version: "1.0.0",
    description:
      "Displays film aspect ratios on Letterboxd using IMDb Technical Specs.",
    icons: {
      16: "common/icons/ar_lookup.png",
      32: "common/icons/ar_lookup.png",
      48: "common/icons/ar_lookup.png",
      128: "common/icons/ar_lookup.png",
    },
    permissions: ["storage"],
    host_permissions: ["https://www.imdb.com/*"],
    content_scripts: [
      {
        matches: ["https://letterboxd.com/film/*/"],
        js: ["common/src/content.js"],
        css: ["common/styles/badge.css"],
        run_at: "document_idle",
      },
    ],
    background: {
      service_worker: "common/src/background.js",
    },
    action: {
      default_title: "Letterboxd Aspect Ratio",
      default_popup: "common/popup.html",
      default_icon: {
        16: "common/icons/ar_lookup.png",
        32: "common/icons/ar_lookup.png",
        48: "common/icons/ar_lookup.png",
        128: "common/icons/ar_lookup.png",
      },
    },
  };

  fs.writeFileSync(destPath, JSON.stringify(manifest, null, 2));
  console.log("   Chrome manifest created");
}

/**
 * Build Chrome extension
 */
async function buildChrome() {
  console.log("\nBuilding Chrome extension...");

  const distDir = "dist/chrome";

  // Clean and create dist directory
  if (fs.existsSync(distDir)) {
    fs.rmSync(distDir, { recursive: true });
    console.log("   Cleaned existing build");
  }
  fs.mkdirSync(distDir, { recursive: true });

  // Copy common files
  console.log("   Copying common files...");
  copyRecursive("common", path.join(distDir, "common"));

  // Create Chrome manifest
  createChromeManifest(path.join(distDir, "manifest.json"));

  console.log("Chrome extension built in dist/chrome/");
  console.log(
    '   Load: chrome://extensions → Load unpacked → Select "dist/chrome"'
  );
}

/**
 * Create zip using Node.js's built-in zlib (Deflate compression)
 */
function createZip(sourceDir, outputFile) {
  return new Promise((resolve, reject) => {
    const archiver = require("stream").Transform;
    const zlib = require("zlib");
    const output = fs.createWriteStream(outputFile);

    // For Firefox compatibility, we need to use the 'zip' command or similar
    // Node.js doesn't have built-in zip creation, so we'll provide instructions
    console.log(`\nTo create zip file compatible with Firefox:`);
    console.log(`   cd ${sourceDir}`);
    console.log(
      `   PowerShell: Compress-Archive -Path * -DestinationPath "../${path.basename(
        outputFile
      )}" -CompressionLevel Optimal -Force`
    );
    console.log(`   Or use 7-Zip with "Store" compression level`);
    resolve();
  });
}

/**
 * Build Firefox extension
 */
async function buildFirefox() {
  console.log("\nBuilding Firefox extension...");

  const distDir = "dist/firefox";

  // Clean and create dist directory
  if (fs.existsSync(distDir)) {
    fs.rmSync(distDir, { recursive: true });
    console.log("   Cleaned existing build");
  }
  fs.mkdirSync(distDir, { recursive: true });

  // Download polyfill first (to common/src/lib)
  const polyfillPath = path.join(
    "common",
    "src",
    "lib",
    "browser-polyfill.min.js"
  );
  try {
    await downloadPolyfill(polyfillPath);
  } catch (err) {
    console.error("Failed to download polyfill:", err.message);
    return;
  }

  // Copy common files
  console.log("   Copying common files...");
  copyRecursive("common", path.join(distDir, "common"));

  // Create Firefox manifest
  createFirefoxManifest(path.join(distDir, "manifest.json"));

  console.log("Firefox extension built in dist/firefox/");
  console.log(
    '   Load: about:debugging → Load Temporary Add-on → Select "dist/firefox/manifest.json"'
  );
}

/**
 * Main entry point
 */
async function main() {
  const target = process.argv[2] || "both";
  const shouldZip = process.argv.includes("--zip");

  console.log("FilmRatio for Letterboxd - Build Script");
  console.log("==========================================");

  // Check if common directory exists
  if (!fs.existsSync("common")) {
    console.error('\nError: "common" directory not found');
    console.error(
      '   Please ensure common files are in the "common/" directory'
    );
    process.exit(1);
  }

  try {
    if (target === "chrome" || target === "both") {
      await buildChrome();
    }

    if (target === "firefox" || target === "both") {
      await buildFirefox();
    }

    if (target !== "chrome" && target !== "firefox" && target !== "both") {
      console.error(`\nInvalid target: ${target}`);
      console.error("   Usage: node build.js [chrome|firefox|both] [--zip]");
      process.exit(1);
    }

    console.log("\nBuild complete!");

    if (shouldZip) {
      console.log("\nCreating zip archives...");
      console.log("   Use PowerShell to zip:");
      console.log(
        '   cd dist/firefox; Compress-Archive -Path * -DestinationPath "../letterboxd-aspect-ratio-firefox.zip" -Force'
      );
      console.log(
        '   cd dist/chrome; Compress-Archive -Path * -DestinationPath "../letterboxd-aspect-ratio-chrome.zip" -Force'
      );
    }
  } catch (err) {
    console.error("\nBuild failed:", err.message);
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  main();
}

module.exports = { buildChrome, buildFirefox };

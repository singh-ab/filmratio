# FilmRatio for Letterboxd

A browser extension that displays film aspect ratios on Letterboxd by fetching technical specifications from IMDb.

## Features

- **On-Page Badge** - Displays aspect ratio next to the film's runtime
- **Extension Icon Badge** - Shows the current film's aspect ratio on the toolbar icon
- **Per-Tab Tracking** - Maintains separate data for each open film tab
- **Smart Caching** - Caches results for 30 days to minimize IMDb requests
- **Multiple Ratio Support** - Displays all available aspect ratios with type names (e.g., "2.39:1 (Scope)")
- **Clickable Badge** - Links directly to IMDb Technical Specs page
- **Clean UI** - Modern popup interface with real-time status and statistics

## Installation

### Prerequisites

Node.js installed (uses built-in modules only, no npm dependencies required)

### Build Instructions

**Chrome:**

```bash
node build.js chrome
```

Then load the extension: Chrome → Extensions → Developer Mode → Load unpacked → Select `dist/chrome/`

**Firefox:**

```bash
node build.js firefox
```

Then load the extension: Firefox → about:debugging → Load Temporary Add-on → Select `dist/firefox/manifest.json`

**Build both browsers:** `node build.js both`

### Usage

Visit any Letterboxd film page (e.g., [The Dark Knight](https://letterboxd.com/film/the-dark-knight/)) to see:

- Aspect ratio badge next to the runtime
- Ratio displayed on the extension toolbar icon
- Popup showing current film, aspect ratio, and statistics

## How It Works

### Architecture

Built with Manifest V3 for Chrome and Firefox compatibility.

**Flow:**

1. Content script detects Letterboxd film page and extracts IMDb ID
2. Background worker fetches technical specs from IMDb
3. Parser extracts and categorizes aspect ratios
4. Results cached for 30 days
5. Badge injected on page and icon updated

**Project Structure:**

```
filmratio/
├── common/             # Shared source files
│   ├── src/            # Scripts
│   ├── styles/         # CSS
│   ├── icons/          # Extension icon
│   └── popup.*         # Popup interface
├── build.js            # Build script
└── dist/               # Build outputs
    ├── chrome/
    └── firefox/
```

### Data Fetching

- Fetches from IMDb technical specs page via standard GET requests
- 30-day cache minimizes requests (~1 per film per user per month)
- Only fetches when user visits a Letterboxd page
- No automated bulk scraping or crawling

## Technical Details

### IMDb Data Usage

This extension fetches publicly available data from IMDb technical specification pages:

- Uses 30-day caching to minimize requests
- Only fetches when user visits a film page
- No bulk scraping or automated crawling
- Gracefully handles parsing failures

For commercial use or publication to extension stores, consider using the official IMDb API or alternative services like TMDB/OMDb with free tiers.

### Privacy

- No tracking, analytics, or user data collection
- All data stored locally in browser storage
- Direct communication with IMDb (no intermediary servers)
- Open source and auditable

## Development

### Workflow

1. Edit files in `common/` directory
2. Build: `node build.js chrome` (or `firefox`, or `both`)
3. Load extension in browser
4. Test on Letterboxd film pages
5. Reload extension after changes

### Debugging

Console logs are prefixed with `[FilmRatio]`.

**Chrome:**

- Content script: F12 on Letterboxd page
- Background: `chrome://extensions/` → Service Worker → Inspect

**Firefox:**

- Content script: F12 on Letterboxd page
- Background: `about:debugging` → Inspect

### Test Films

- [The Dark Knight](https://letterboxd.com/film/the-dark-knight/) - Multiple ratios (IMAX + Scope)
- [Harakiri](https://letterboxd.com/film/harakiri/) - 1.37:1 (Academy)
- [Grave of the Fireflies](https://letterboxd.com/film/grave-of-the-fireflies/) - 1.85:1

## Contributing

Contributions welcome! Please:

1. Edit files in `common/` directory only (not `dist/`)
2. Test on both browsers: `node build.js both`
3. Test on multiple films including edge cases
4. Maintain console logging for debugging
5. Update documentation for new features

## License

GNU General Public License v3.0 (GPL-3.0). See [LICENSE](LICENSE) for details.

## Disclaimer

This is an independent project not affiliated with Letterboxd or IMDb. It fetches publicly available data for personal, non-commercial use. Users are responsible for ensuring compliance with IMDb's Terms of Use.

# TabOrganizer (Chrome Extension, MV3)

A pink-forward tab manager extension that lets you group real Chrome tabs into Projects, sort tabs, and organize each window with visual divider tabs.

## Features
- Manifest V3 + service worker architecture.
- Popup and full Manager page with matching functionality.
- Window Scope selector:
  - This window
  - All windows (organized per-window, no cross-window moves)
  - Specific window IDs
- Websites list grouped by hostname with close-all per host.
- Projects list with drag/drop assignment of tabs.
- Unassigned section always visible.
- Real tab operations:
  - Sort Tabs: host, then title.
  - Organize Projects: project-by-project layout with hostname clustering and divider tabs between sections.
- Divider tabs are minimal blank pages with a colored circle favicon.
- Project operations:
  - Organize project scope
  - Close all tabs in project (scope-aware)
  - Delete project record (without closing tabs)
- Tab row actions:
  - Activate tab (title or ↗)
  - Remove from project (− in project cards)
  - Close tab (✕)

## Install in Chrome
1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select this folder (`TabOrganizer`).
5. Open the extension popup from the toolbar.

## Manual verification checklist
1. Open many tabs across at least 2 windows.
2. Create 2 projects with different colors.
3. Drag tabs into projects from Unassigned.
4. Run **Organize** in **This window** scope.
5. Run **Organize** in **All windows** scope.
6. Verify divider tabs appear between sections and are not pinned.
7. Verify tabs are clustered by host in each section and Unassigned is final.
8. Verify website/project close-all actions and project deletion.

## Files
- `manifest.json`
- `background.js`
- `popup.html`, `popup.css`, `popup.js`
- `manager.html`, `manager.css`, `manager.js`
- `app.js` (shared UI logic)
- `divider.html`, `divider.css`, `divider.js`
- No binary icon assets are included (repository stays text-only).

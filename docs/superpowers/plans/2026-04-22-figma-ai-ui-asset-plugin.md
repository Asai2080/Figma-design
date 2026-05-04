# Figma AI UI Asset Plugin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Figma plugin MVP that generates a mock full-screen app UI preview, creates an AI-style asset manifest, and places transparent PNG assets back onto the canvas by manifest placement coordinates.

**Architecture:** The plugin uses a no-build Figma setup: `manifest.json` loads `code.js` as the plugin main thread and `ui.html` as the plugin iframe. The UI owns prompt input, mock generation, and future third-party API integration; the main thread owns Figma node creation, image insertion, and canvas layout.

**Tech Stack:** Figma Plugin API, plain JavaScript, HTML/CSS, browser canvas for mock PNG generation.

---

### Task 1: Plugin Shell

**Files:**
- Create: `manifest.json`
- Create: `code.js`
- Create: `ui.html`

- [ ] Create a Figma plugin manifest named "AI UI Asset Generator" that points to `code.js` and `ui.html`.
- [ ] Add a main-thread message handler in `code.js`.
- [ ] Add a plugin UI with a prompt textarea and generation button.

### Task 2: Mock Generation Flow

**Files:**
- Modify: `ui.html`
- Modify: `code.js`

- [ ] In `ui.html`, generate a mock `asset_manifest` with screen metadata, preview image data URL, and transparent PNG asset data URLs.
- [ ] In `code.js`, receive the manifest and create a Figma frame sized to the manifest screen.
- [ ] Insert the preview image as a locked/reference rectangle.
- [ ] Insert transparent PNG asset rectangles using each asset's `placement`.

### Task 3: User Controls and Export Readiness

**Files:**
- Modify: `ui.html`
- Modify: `code.js`

- [ ] Let the user preview and select which generated assets to place.
- [ ] Set node names from manifest asset names.
- [ ] Set PNG export settings on each asset node.

### Task 4: Documentation and Verification

**Files:**
- Create: `README.md`

- [ ] Document how to import the plugin into Figma.
- [ ] Document where to replace mock generation with the third-party image API.
- [ ] Run syntax checks for JSON and JavaScript.

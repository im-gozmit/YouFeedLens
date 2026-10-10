# FeedLens YouTube Focus implementation status

## Phase 1 — Repository audit and implementation foundation

**Status: complete.** The initial run was limited to the repository audit and plan.

### Repository audit

- The workspace contains `manifest.json` and `content.js` only. It has no `.git` directory, so current Git changes and history cannot be inspected.
- The extension uses Manifest V3 and injects `content.js` on `https://www.youtube.com/*`. It currently requests no explicit permissions or host permissions.
- There is no popup, service worker, stylesheet, asset set, backend, package/build configuration, test framework, README, or existing `docs/` directory.
- `content.js` watches all body subtree additions with a `MutationObserver`, then looks for `a.ytLockupMetadataViewModelTitle` on each added element or below it and logs matching title text. It does not identify card boundaries, IDs, channels, URLs, or supported recommendation surfaces; it also has no deduplication, batching, navigation handling, or styling behavior.
- The current selector may match a title link in a lockup view, but the repository and current browser DOM were not sufficient to verify the exact YouTube card markup at runtime. Candidate card selectors (`ytd-rich-item-renderer`, `ytd-rich-grid-media`, `ytd-video-renderer`, `ytd-compact-video-renderer`, `yt-lockup-view-model`) need validation against representative homepage and watch-page DOM fixtures or a live browser in a later implementation phase.
- The title-only lookup does not itself classify generic elements as videos. Its broad mutation scan can encounter arbitrary added elements, but it only logs an element when it or a descendant matches the title-link selector. Card-root-based extraction and validation are needed to prevent nested/duplicate card processing.
- No existing product functionality beyond this YouTube title logging prototype was found to preserve. There is no backend or API key handling in the project.

### Implementation plan

1. Phase 2: add a focused popup and persist only the active flag and target domain using extension storage; wire popup commands to the active YouTube tab through the existing MV3 architecture.
2. Phase 3: identify eligible homepage and watch-sidebar video cards, extract validated stable video IDs and visible metadata, and handle duplicates, dynamic additions, and YouTube SPA navigation.
3. Phase 4: add a minimal backend with validation, limits, rate controls, timeout handling, explicit mock mode, and Decisions API batch classification; keep the API key server-side.
4. Phase 5: apply FeedLens-owned blur/indicator classes only for confidently off-topic cards, preserve layout and native controls, and restore cards when results become stale or focus stops.
5. Phase 6: add tests and representative DOM fixtures consistent with the project tooling introduced in earlier phases, document manual browser checks, and run available verification commands.

The implementation should stay YouTube-only, avoid unrelated page surfaces, use fail-open behavior for uncertain or unavailable classifications, and never persist full video metadata by default. The Decisions API model, SDK support, schema, and response semantics must be checked against the official documentation before Phase 4 implementation.

## Progress

- Phases completed: 1 of 6.
- Phases remaining: 2–6.
- Files created: `docs/IMPLEMENTATION_STATUS.md`.
- Files modified: none.
- Tests run: none; the repository has no test or build configuration.
- Blockers: Git state/history cannot be inspected because this directory is not a Git repository. Live YouTube DOM validation is also not available from the repository files alone.
- Next step: on the user's instruction to continue, implement Phase 2 only and update this document with its actual results.

## Phase 2 — YouTube popup and focus-session state

**Status: complete.** Added the popup and minimal session persistence/message plumbing. Video classification and card styling are intentionally left for later phases.

### Changes

- Added `popup.html`, `popup.css`, and `popup.js` with FeedLens branding, natural-language domain entry (500-character limit), Start/Update Focus, active-domain display, Pause/Resume, and Stop controls. The popup has light/dark styling and shows actionable errors for non-YouTube tabs or an unavailable content script.
- Updated `manifest.json` with the popup action and the `storage` permission. Existing YouTube-only content-script match is retained; no broad host access was added.
- Updated `content.js` to accept validated focus-session messages and restore lightweight state from `chrome.storage.local` on page load / storage changes. This is state plumbing only; it does not yet extract or classify recommendation cards.
- The stored object is limited to `{ active, domain, paused }`; video titles and browsing activity are not stored.

### Progress

- Phases completed: 2 of 6.
- Phases remaining: 3–6.
- Files created: `popup.html`, `popup.css`, `popup.js`.
- Files modified: `manifest.json`, `content.js`, `docs/IMPLEMENTATION_STATUS.md`.
- Tests run: none. The repository has no configured test/build tooling, and the requested phase workflow reserves full feature verification for Phase 6.
- Validation: manifest JSON and JavaScript syntax are checked in the current workspace before closing this phase.
- Blockers: none for Phase 2. The popup currently reports YouTube/content-script connection errors directly; classification progress and analyzed/blurred/clear counts await later phases.
- Next step: on the user's instruction to continue, implement Phase 3 only: validated recommendation-card extraction, deduplication, dynamic feed handling, and SPA navigation support.

## Phase 3 — YouTube video detection

**Status: complete.** Replaced the prototype title logger with validated card extraction. No API calls, classification, blur, or card styling were added in this phase.

### Changes

- `content.js` now considers the supported YouTube card roots `ytd-rich-item-renderer`, `ytd-rich-grid-media`, `ytd-video-renderer`, `ytd-compact-video-renderer`, and `yt-lockup-view-model`, then de-duplicates nested roots before extraction.
- Each accepted card must contain a canonical same-origin `/watch?v=` link with a validated video ID and a non-empty visible title. Channel text is collected when available and bounded before being emitted. Ads, playlist cards, Shorts/reels, and `/results` search pages are excluded.
- Cards are keyed by stable video ID and metadata fingerprints, so repeated mutation scans and duplicate card instances do not emit repeated work. A metadata change causes a fresh detection event.
- A debounced `MutationObserver` handles dynamically inserted recommendation cards while an active, unpaused focus session is present. A `feedlens:videos-detected` event carries only extracted metadata to the next phase.
- YouTube client-side navigation is handled through `pushState`, `replaceState`, `popstate`, and a lightweight URL safety check. Navigation clears the known-video cache and schedules a fresh scan.
- The existing session message/storage behavior remains intact. Changing the domain clears detection fingerprints so later phases can re-evaluate cards for the new topic.

### Progress

- Phases completed: 3 of 6.
- Phases remaining: 4–6.
- Files modified: `content.js`, `docs/IMPLEMENTATION_STATUS.md`.
- Tests run: `node --check content.js` and `node --check popup.js`; both passed. No automated DOM tests exist yet.
- Blockers: live YouTube markup could not be exercised from this repository-only environment, so selector coverage should be checked manually during Phase 6.
- Next step: on the user's instruction to continue, implement Phase 4 only: the secure backend and Decisions API batch classification with normalized, fail-safe responses.

## Phase 4 — Decisions API integration

**Status: complete.** Added a small local backend and connected detected batches to it. The backend keeps the OpenAI key server-side and provides deterministic mock mode when no key is configured.

### Changes

- Added `server.js`, using the official OpenAI JavaScript SDK and `client.decisions.create()` with the requested `gpt-6-luna` default model. The request uses shared compact JSON input and one named `choice` question per video with the four required values: `directly_relevant`, `closely_related`, `off_topic`, and `uncertain`.
- Added `POST /api/youtube/focus` and `GET /health`. Inputs are bounded to a 500-character domain, 24 videos per request, 500-character titles, and 200-character channels. Duplicate video IDs are collapsed, malformed records are discarded, request rate is limited in memory, and API calls time out after 20 seconds.
- Added predictable normalized results keyed by `videoId`. Missing, refused, malformed, or failed answers become `uncertain` with zero confidence; API failures return a 502 response with fail-open uncertain results.
- Added deterministic mock classifications when `OPENAI_API_KEY` is absent or `MOCK_DECISIONS=true`. Health responses identify mock mode clearly.
- Added `content.js` batching with a debounced queue, one in-flight request at a time, bounded batches, domain/session version checks, and `feedlens:classification-results` / `feedlens:classification-error` events. Results are not styled yet; later phases will apply fail-open blur rules.
- Added `package.json`, `.env.example`, and `.gitignore`. Added the narrow `http://localhost:8787/*` host permission for the configured local backend.

### Progress

- Phases completed: 4 of 6.
- Phases remaining: 5–6.
- Files created: `server.js`, `package.json`, `.env.example`, `.gitignore`.
- Files modified: `manifest.json`, `content.js`, `docs/IMPLEMENTATION_STATUS.md`.
- Tests run: `node --check content.js`, `node --check server.js`, and `node --check popup.js`; all passed. Dependencies were not installed in this phase, so a live backend request was not run.
- Official API reference checked: OpenAI Decisions API reference for `client.decisions.create`, shared input, named questions, choice answers, and confidence/probability fields.
- Blockers: install dependencies with `npm install` before running the backend. A real API key is optional because mock mode is available.
- Next step: on the user's instruction to continue, implement Phase 5 only: apply classification results to owned blur classes and restore cards reliably.

### Phase 4 follow-up fix

The Decisions API choice schema was corrected after live verification. Choice options are now sent as `{ value, description }` objects, as required by the official API reference, instead of plain strings. Restart the backend after pulling this change.

### Browser connectivity fix

The browser console showed a cross-origin block because the YouTube content script was calling `localhost` directly from the page origin. Backend requests now go through the MV3 `background.js` service worker, which uses the explicit localhost host permission and returns the normalized response to the content script.

## Phase 5 — Focus-mode blurring

**Status: complete.** Classification results now control reversible, card-scoped blur treatment.

### Changes

- `content.js` tracks extracted card elements by stable video ID and applies FeedLens-owned classes only to matching cards.
- `off_topic` results blur at the configurable `0.75` confidence heuristic. Directly relevant, closely related, uncertain, low-confidence, malformed, and failed results remain clear.
- Blurred cards receive a small `Outside your focus` indicator. The CSS keeps card dimensions and native links intact while reducing opacity and applying a transition.
- Stopping or pausing focus, changing the domain, invalidating a session, and stale navigation state remove FeedLens classes and indicators. Stale API responses are rejected using the session version.
- API failures continue to fail open: cards remain visible and a classification error event is emitted.

### Progress

- Phases completed: 5 of 6.
- Phases remaining: 6.
- Files modified: `content.js`, `docs/IMPLEMENTATION_STATUS.md`.
- Tests run: `node --check content.js`, `node --check server.js`, and `node --check popup.js`; all passed.
- Blockers: visual browser verification remains for Phase 6. The local backend must be running for live classification.
- Next step: on the user's instruction to continue, implement Phase 6: verification, tests/fixtures where practical, manual browser checks, and final documentation.

## Product polish update

- Added glass-style popup presentation with dark-mode support, confidence slider, API-key field, saved focus profiles, live session statistics, and a manual Recheck action.
- Added analyzed, blurred, clear, and pending counters backed by lightweight session state.
- Added configurable per-session confidence threshold and manual recheck messaging.
- Added optional request-scoped API-key support. A key entered in the popup is stored in extension local storage and forwarded to the configured local backend for the request; it is not persisted by the backend. This is convenient for personal use but is less secure than keeping the key only in the server `.env` file.
- Added service-worker routing for backend requests so YouTube’s page-origin CORS policy cannot block classification.

## Fly.io deployment preparation

- Added `Dockerfile` and `fly.toml` for the Express backend. The app listens on port 8787, uses the Mumbai region by default, forces HTTPS, and exposes `/health` for Fly checks.

# YouFeedlens
Project Live : https://youfeedlens.vercel.app/
YouFeedlens is a YouTube learning-feed focus mode. Describe what you want to learn today, and the extension evaluates visible recommendation cards against that domain. Relevant videos stay clear; confidently unrelated videos fade into the background.

> Built for DevDay Community Event Bengaluru 2026  
> Play against OpenAI's new Decisions API — beta released October 6.

## Product overview

YouFeedlens is a semantic domain-matching tool. It is not a misinformation detector, AI slop detector, content-quality scorer, or general social-media scanner.

Example focus:

    React, frontend engineering, browser performance and modern web architecture

The extension:

- Works on YouTube recommendation surfaces.
- Accepts natural-language learning domains.
- Extracts stable video IDs, visible titles, and visible channel names.
- Processes cards in bounded batches.
- Detects newly loaded recommendations while scrolling.
- Handles YouTube client-side navigation.
- Keeps directly relevant and closely related videos visible.
- Blurs only confidently off-topic videos.
- Leaves uncertain, malformed, low-confidence, and failed classifications visible.
- Restores card appearance when focus is paused or stopped.
- Does not change YouTube subscriptions, recommendations history, watch history, or account settings.

## Popup features

The premium glass popup includes:

- Natural-language focus input.
- Start Focus and Update Focus.
- Pause, Resume, Stop, and Recheck controls.
- Configurable confidence threshold.
- Saved focus profiles.
- Optional personal API-key field.
- Analyzed, blurred, clear, and pending counters.
- Dark glass styling and the YouFeedlens logo.

## Classification model

The extension sends a compact payload containing the selected domain and bounded video metadata to the backend. The backend asks the Decisions API one named choice question per video.

Allowed classifications:

- directly_relevant
- closely_related
- off_topic
- uncertain

Application rules:

    directly_relevant → clear
    closely_related   → clear
    off_topic + confidence >= threshold → blur
    uncertain         → clear
    API failure       → clear

The initial confidence threshold is 0.75. This is an application heuristic, not a scientifically calibrated probability.

## Repository layout

    assets/youfeedlens-logo.png     Extension and site logo
    background.js                   MV3 backend-request proxy
    content.js                      YouTube extraction and focus treatment
    manifest.json                   Chromium extension manifest
    popup.html / popup.css          Popup structure and glass UI
    popup.js                        Popup state and controls
    server.js                       Express Decisions API backend
    site/index.html                 Static landing page
    Dockerfile                      Container deployment
    fly.toml                        Fly.io deployment configuration
    package.json                    Backend dependencies
    .env.example                    Local environment template
    docs/IMPLEMENTATION_STATUS.md   Phase implementation notes

## Requirements

- Node.js 20 or later.
- A Chromium browser such as Chrome or Edge.
- An OpenAI API key for real classification.
- The official OpenAI JavaScript SDK from package.json.

Hosting may be free, but OpenAI API usage is billed separately.

## Run locally

Install dependencies:

    npm install
    Copy-Item .env.example .env

Configure .env:

    OPENAI_API_KEY=your_key_here
    OPENAI_MODEL=gpt-6-luna
    MOCK_DECISIONS=false
    PORT=8787

Start the backend:

    npm start

Check it:

    Invoke-WebRequest http://localhost:8787/health

Real mode should report ok true, mock false, and model gpt-6-luna. If the key is absent or MOCK_DECISIONS=true, deterministic mock mode is used.

## Load the extension

1. Start the backend with npm start.
2. Open chrome://extensions.
3. Enable Developer mode.
4. Select Load unpacked.
5. Choose the repository root.
6. Open YouTube and refresh the tab.
7. Open YouFeedlens, enter a focus domain, and select Start Focus.

After changing extension files, click Reload in chrome://extensions and refresh YouTube.

Backend requests go through background.js. This is required because a content script running on YouTube cannot directly fetch a localhost or external API without running into page-origin CORS restrictions.

## Diagnostics

On YouTube DevTools, listen for the detection and classification events:

    window.addEventListener("feedlens:videos-detected", event => console.table(event.detail.videos));
    window.addEventListener("feedlens:classification-results", event => console.table(event.detail.results));
    window.addEventListener("feedlens:classification-error", event => console.error(event.detail));

Count blurred cards:

    document.querySelectorAll(".feedlens-focus-blurred").length

## Backend API

GET /health reports availability, model name, and mock mode.

POST /api/youtube/focus accepts a domain and a bounded list of video metadata. The backend validates input, limits batches to 24 videos, removes duplicate IDs, rate-limits requests in memory, and times out Decisions API calls after 20 seconds.

Missing, refused, malformed, or failed answers become uncertain results so the extension fails open.

## API-key handling

The safest production setup keeps OPENAI_API_KEY only in the backend environment.

The popup also supports a personal API key:

- It is stored in Chrome local storage.
- It is forwarded only to the configured backend request.
- The backend does not persist it.

This is convenient for personal use but less secure than a server-only key. Never commit an API key, paste it into chat, or include it in screenshots.

## Static site deployment

The landing page is in site/. For Vercel:

1. Import the GitHub repository.
2. Set Root Directory to site.
3. Set Framework Preset to Other.
4. Leave Build Command blank.
5. Set Output Directory to .
6. Deploy.

The page includes the extension download, logo, DevDay event callout, privacy explanation, email contact, X/Twitter link, and LinkedIn link.

The static page is separate from the classification backend. Publishing the landing page does not make the API endpoint public.

## Backend deployment

The extension needs a public HTTPS backend before other users can classify videos.

Supported approaches include:

- Render Web Service.
- Vercel Functions after converting the Express routes into serverless handlers.
- Fly.io using the included Dockerfile and fly.toml.

After deployment, replace the localhost URL in background.js:

    const BACKEND_URL = "https://your-api-domain.example/api/youtube/focus";

Replace the localhost host permission in manifest.json with the public HTTPS host, then reload the extension and create a new release ZIP.

## Privacy

Only the selected domain and bounded visible recommendation metadata are evaluated: video ID, title, and channel name. The extension does not send raw page HTML, comments, search terms, account data, subscriptions, watch history, or playback data.

The extension stores lightweight session settings and counters. It does not intentionally create a browsing-history database or full video archive.

Before public release, publish a privacy policy describing metadata transmission, API-key options, retention, and the OpenAI API dependency.

## Scope and limitations

- Homepage recommendations and compatible watch-page recommendation cards are supported first.
- Search results are excluded.
- Shorts, ads, playlists, and non-video cards are excluded.
- YouTube DOM changes may require selector maintenance.
- Real classification requires a reachable backend.
- Free hosting tiers may sleep, rate-limit, or suspend a service.
- OpenAI API usage can cost money even when hosting is free.

## Verification

    node --check content.js
    node --check background.js
    node --check popup.js
    node --check server.js

The manifest can be checked by parsing manifest.json in a JSON-capable shell or by loading the unpacked extension in chrome://extensions.

## Credits and contact

Built by Mayank for the DevDay Community Event Bengaluru 2026.

- X/Twitter: https://x.com/im_gozmit
- LinkedIn: https://www.linkedin.com/in/gozmit/
- Join the project: imgozmit@gmail.com

const BACKEND_URL = "http://localhost:8787/api/youtube/focus";

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "FEEDLENS_CLASSIFY_BATCH") return;
  fetch(BACKEND_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ domain: message.domain, videos: message.videos, apiKey: message.apiKey }),
  })
    .then(async (response) => {
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(`Backend returned ${response.status}`);
      sendResponse({ ok: true, payload });
    })
    .catch((error) => sendResponse({ ok: false, error: error.message }));
  return true;
});

const STORAGE_KEY = "feedLensFocusSession";
const CARD_SELECTORS = "ytd-rich-item-renderer,ytd-rich-grid-media,ytd-video-renderer,ytd-compact-video-renderer,yt-lockup-view-model";
const TITLE_SELECTORS = "a#video-title,a#video-title-link,a.ytLockupMetadataViewModelTitle,yt-formatted-string#video-title,.ytLockupMetadataViewModelTitle";
const CHANNEL_SELECTORS = "ytd-channel-name a,#channel-name a,.yt-content-metadata-view-model__metadata-row a,.yt-lockup-metadata-view-model__metadata-row a";
const BACKEND_URL = "http://localhost:8787/api/youtube/focus";
let focusSession = { active: false, domain: "", paused: false, confidenceThreshold: 0.75, apiKey: "", stats: {} };
let sessionStats = { analyzed: 0, blurred: 0, clear: 0, pending: 0 };
let scanTimer = 0;
let navigationTimer = 0;
let lastUrl = location.href;
const knownVideos = new Map();
const videoCards = new Map();
const queuedVideos = new Map();
let classificationTimer = 0;
let classificationInFlight = false;
let sessionVersion = 0;

function textOf(element) { return element?.textContent?.replace(/\s+/g, " ").trim() || ""; }
function videoIdFromUrl(url) {
  try {
    const parsed = new URL(url, location.origin);
    if (parsed.origin !== location.origin || parsed.pathname !== "/watch") return "";
    const id = parsed.searchParams.get("v") || "";
    return /^[A-Za-z0-9_-]{6,20}$/.test(id) ? id : "";
  } catch { return ""; }
}
function isWatchUrl(url) {
  return Boolean(videoIdFromUrl(url));
}
function titleElement(card) { return card.matches(TITLE_SELECTORS) ? card : card.querySelector(TITLE_SELECTORS); }
function videoLink(card) {
  const links = card.matches("a[href]") ? [card] : [...card.querySelectorAll("a[href]")];
  return links.find((link) => isWatchUrl(link.href)) || null;
}
function isExcludedCard(card) {
  if (location.pathname === "/results" || location.pathname.startsWith("/shorts")) return true;
  if (card.closest("ytd-ad-slot-renderer,ytd-promoted-sparkles-web-renderer,ytd-display-ad-renderer")) return true;
  if (card.matches("ytd-reel-item-renderer,ytd-rich-shelf-renderer")) return true;
  if (!videoLink(card)) return true;
  return Boolean(card.querySelector("ytd-playlist-panel-video-renderer,ytd-playlist-video-renderer"));
}
function extractCard(card) {
  if (!(card instanceof Element) || isExcludedCard(card)) return null;
  const link = videoLink(card);
  const id = videoIdFromUrl(link?.href);
  const title = textOf(titleElement(card));
  if (!id || !title) return null;
  const channel = textOf(card.querySelector(CHANNEL_SELECTORS));
  const result = { videoId: id, url: `https://www.youtube.com/watch?v=${encodeURIComponent(id)}`, title: title.slice(0, 500), channel: channel.slice(0, 200) };
  result.fingerprint = `${result.title}\u0000${result.channel}`;
  return result;
}
function clearCardTreatment(card) {
  card.classList.remove("feedlens-focus-blurred");
  card.querySelectorAll(".feedlens-focus-indicator").forEach((indicator) => indicator.remove());
}
function clearAllTreatments() {
  document.querySelectorAll(".feedlens-focus-blurred,.feedlens-focus-indicator").forEach((element) => {
    if (element.classList.contains("feedlens-focus-blurred")) element.classList.remove("feedlens-focus-blurred");
    else element.remove();
  });
}
function applyClassification(result) {
  const cards = videoCards.get(result.videoId) || [];
  const shouldBlur = result.choice === "off_topic" && Number(result.confidence) >= Number(focusSession.confidenceThreshold || 0.75);
  sessionStats.analyzed += 1;
  sessionStats.pending = Math.max(0, sessionStats.pending - 1);
  if (shouldBlur) sessionStats.blurred += 1;
  else sessionStats.clear += 1;
  for (const card of cards) {
    clearCardTreatment(card);
    if (!shouldBlur) continue;
    card.classList.add("feedlens-focus-blurred");
    const indicator = document.createElement("span");
    indicator.className = "feedlens-focus-indicator";
    indicator.textContent = "Outside your focus";
    indicator.setAttribute("aria-label", "Outside your focus");
    card.append(indicator);
  }
  chrome.storage.local.set({ [STORAGE_KEY]: { ...focusSession, stats: sessionStats } });
}
function installFocusStyles() {
  if (document.getElementById("feedlens-focus-styles")) return;
  const style = document.createElement("style");
  style.id = "feedlens-focus-styles";
  style.textContent = `.feedlens-focus-blurred { filter: blur(6px); opacity: .58; transition: filter .18s ease, opacity .18s ease; } .feedlens-focus-indicator { display: block; width: max-content; margin: 4px 0 0; padding: 3px 6px; border-radius: 4px; background: rgba(20, 24, 36, .78); color: #fff; font: 10px/1.2 Arial, sans-serif; pointer-events: none; }`;
  (document.head || document.documentElement).append(style);
}
function cardRoots(root = document) {
  const candidates = root.matches?.(CARD_SELECTORS) ? [root] : [...root.querySelectorAll(CARD_SELECTORS)];
  const seen = new Set();
  return candidates.filter((card) => {
    if (seen.has(card) || card.parentElement?.closest(CARD_SELECTORS)) return false;
    seen.add(card);
    return true;
  });
}
function scanVideoCards(reason = "scan") {
  const discovered = [];
  for (const card of cardRoots()) {
    const video = extractCard(card);
    if (!video) continue;
    if (!videoCards.has(video.videoId)) videoCards.set(video.videoId, new Set());
    videoCards.get(video.videoId).add(card);
    const previous = knownVideos.get(video.videoId);
    knownVideos.set(video.videoId, video);
    if (!previous || previous.fingerprint !== video.fingerprint) discovered.push(video);
  }
  if (discovered.length) {
    window.dispatchEvent(new CustomEvent("feedlens:videos-detected", { detail: { reason, videos: discovered } }));
    console.debug("FeedLens detected YouTube videos", { reason, count: discovered.length });
    queueClassifications(discovered);
  }
  return discovered;
}
function scheduleScan(reason = "mutation") {
  clearTimeout(scanTimer);
  scanTimer = window.setTimeout(() => scanVideoCards(reason), 150);
}
function queueClassifications(videos) {
  if (!focusSession.active || focusSession.paused) return;
  for (const video of videos) queuedVideos.set(video.videoId, video);
  sessionStats.pending += videos.length;
  chrome.storage.local.set({ [STORAGE_KEY]: { ...focusSession, stats: sessionStats } });
  clearTimeout(classificationTimer);
  classificationTimer = window.setTimeout(flushClassifications, 100);
}
async function flushClassifications() {
  if (classificationInFlight || !focusSession.active || focusSession.paused || !queuedVideos.size) return;
  classificationInFlight = true;
  const version = sessionVersion;
  const batch = [...queuedVideos.values()].slice(0, 24);
  batch.forEach((video) => queuedVideos.delete(video.videoId));
  try {
    const response = await chrome.runtime.sendMessage({ type: "FEEDLENS_CLASSIFY_BATCH", domain: focusSession.domain, apiKey: focusSession.apiKey, videos: batch.map(({ videoId, title, channel }) => ({ videoId, title, channel })) });
    if (!response?.ok) throw new Error(response?.error || "Classification request failed");
    const payload = response.payload || {};
    if (version === sessionVersion && focusSession.active && !focusSession.paused) {
      for (const result of payload.results || []) applyClassification(result);
      window.dispatchEvent(new CustomEvent("feedlens:classification-results", { detail: payload }));
    }
  } catch (error) {
    window.dispatchEvent(new CustomEvent("feedlens:classification-error", { detail: { message: error.message, videoIds: batch.map((video) => video.videoId) } }));
    console.warn("FeedLens classification unavailable; leaving videos visible.", error.message);
  } finally {
    classificationInFlight = false;
    if (queuedVideos.size) classificationTimer = window.setTimeout(flushClassifications, 100);
  }
}
function handleNavigation() {
  if (location.href === lastUrl) return;
  lastUrl = location.href;
  knownVideos.clear();
  videoCards.clear();
  queuedVideos.clear();
  sessionVersion += 1;
  clearAllTreatments();
  clearTimeout(navigationTimer);
  navigationTimer = window.setTimeout(() => scanVideoCards("navigation"), 400);
}
function patchHistory(method) {
  const original = history[method];
  history[method] = function (...args) {
    const result = original.apply(this, args);
    window.dispatchEvent(new Event("feedlens:navigation"));
    return result;
  };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "FEEDLENS_SET_FOCUS") return;
  const next = message.session;
  if (!next || typeof next.active !== "boolean" || typeof next.domain !== "string") { sendResponse({ ok: false, error: "Invalid focus session." }); return; }
  if (next.domain.trim() !== focusSession.domain) { knownVideos.clear(); videoCards.clear(); queuedVideos.clear(); clearAllTreatments(); sessionStats = { analyzed: 0, blurred: 0, clear: 0, pending: 0 }; sessionVersion += 1; }
  focusSession = { ...focusSession, active: next.active, domain: next.domain.slice(0, 500), paused: Boolean(next.paused), confidenceThreshold: Number(next.confidenceThreshold || 0.75), apiKey: typeof next.apiKey === "string" ? next.apiKey.slice(0, 300) : "", stats: sessionStats };
  if (focusSession.active && !focusSession.paused) scheduleScan("focus-session");
  if (!focusSession.active || focusSession.paused) { queuedVideos.clear(); clearAllTreatments(); }
  chrome.storage.local.set({ [STORAGE_KEY]: { ...focusSession, stats: sessionStats } });
  sendResponse({ ok: true });
});
chrome.storage.local.get(STORAGE_KEY, (stored) => {
  const saved = stored[STORAGE_KEY];
  if (saved && typeof saved.active === "boolean" && typeof saved.domain === "string") { focusSession = { ...focusSession, ...saved, domain: saved.domain.slice(0, 500) }; sessionStats = { ...sessionStats, ...(saved.stats || {}) }; }
  scheduleScan("initial");
});
installFocusStyles();
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local" || !changes[STORAGE_KEY]) return;
  const saved = changes[STORAGE_KEY].newValue;
  if (saved && typeof saved.active === "boolean" && typeof saved.domain === "string") {
    if (saved.domain !== focusSession.domain) { knownVideos.clear(); videoCards.clear(); queuedVideos.clear(); clearAllTreatments(); sessionVersion += 1; }
    focusSession = { ...focusSession, ...saved, domain: saved.domain.slice(0, 500) }; sessionStats = { ...sessionStats, ...(saved.stats || {}) };
    if (focusSession.active && !focusSession.paused) scheduleScan("storage-session");
    if (!focusSession.active || focusSession.paused) { queuedVideos.clear(); clearAllTreatments(); }
  }
});
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "FEEDLENS_RECHECK") return;
  knownVideos.clear();
  queuedVideos.clear();
  clearAllTreatments();
  sessionStats = { analyzed: 0, blurred: 0, clear: 0, pending: 0 };
  if (focusSession.active && !focusSession.paused) scheduleScan("manual-recheck");
  chrome.storage.local.set({ [STORAGE_KEY]: { ...focusSession, stats: sessionStats } });
  sendResponse({ ok: true });
});
const observer = new MutationObserver((mutations) => {
  if (!focusSession.active || focusSession.paused) return;
  if (mutations.some((mutation) => [...mutation.addedNodes].some((node) => node.nodeType === Node.ELEMENT_NODE))) scheduleScan();
});
if (document.body) observer.observe(document.body, { childList: true, subtree: true });
window.addEventListener("feedlens:navigation", handleNavigation);
window.addEventListener("popstate", handleNavigation);
patchHistory("pushState");
patchHistory("replaceState");
setInterval(handleNavigation, 1000);

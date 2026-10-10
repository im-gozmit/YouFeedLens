const STORAGE_KEY = "feedLensFocusSession";
const PROFILES_KEY = "feedLensFocusProfiles";
const form = document.querySelector("#focus-form");
const domainInput = document.querySelector("#domain");
const startButton = document.querySelector("#start");
const sessionPanel = document.querySelector("#session");
const activeDomain = document.querySelector("#active-domain");
const pauseButton = document.querySelector("#pause");
const recheckButton = document.querySelector("#recheck");
const stopButton = document.querySelector("#stop");
const message = document.querySelector("#message");
const counter = document.querySelector("#count");
const threshold = document.querySelector("#threshold");
const thresholdValue = document.querySelector("#threshold-value");
const apiKey = document.querySelector("#api-key");
const profileSelect = document.querySelector("#profile");
const saveProfileButton = document.querySelector("#save-profile");
const statAnalyzed = document.querySelector("#stat-analyzed");
const statBlurred = document.querySelector("#stat-blurred");
const statClear = document.querySelector("#stat-clear");
const statPending = document.querySelector("#stat-pending");
let session = { active: false, domain: "", paused: false, confidenceThreshold: 0.75, apiKey: "", stats: {} };
let profiles = {};

function renderStats() {
  const stats = session.stats || {};
  statAnalyzed.textContent = stats.analyzed || 0;
  statBlurred.textContent = stats.blurred || 0;
  statClear.textContent = stats.clear || 0;
  statPending.textContent = stats.pending || 0;
}
function render() {
  domainInput.value = session.domain;
  counter.textContent = `${domainInput.value.length} / 500`;
  threshold.value = Math.round((session.confidenceThreshold || 0.75) * 100);
  thresholdValue.textContent = `${threshold.value}%`;
  apiKey.value = session.apiKey || "";
  startButton.innerHTML = session.active ? 'Update Focus <span aria-hidden="true">→</span>' : 'Start Focus <span aria-hidden="true">→</span>';
  sessionPanel.hidden = !session.active;
  activeDomain.textContent = session.domain;
  pauseButton.textContent = session.paused ? "Resume Focus" : "Pause Focus";
  renderStats();
}
function showMessage(text) { message.textContent = text; message.hidden = !text; }
function populateProfiles() {
  profileSelect.replaceChildren(new Option("Saved profiles", ""));
  Object.keys(profiles).sort().forEach((name) => profileSelect.append(new Option(name, name)));
}
async function getYouTubeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !tab.url || !/^https:\/\/(www\.)?youtube\.com\//i.test(tab.url)) throw new Error("Open a YouTube page to start Focus Mode.");
  return tab;
}
async function getActiveTab() { const [tab] = await chrome.tabs.query({ active: true, currentWindow: true }); return tab; }
async function sendSession(tab, nextSession) {
  try {
    const response = await chrome.tabs.sendMessage(tab.id, { type: "FEEDLENS_SET_FOCUS", session: nextSession });
    if (!response?.ok) throw new Error("The YouTube page rejected the focus setting.");
  } catch { throw new Error("FeedLens could not connect to this YouTube page. Reload YouTube and try again."); }
}
async function saveAndApply(nextSession) {
  const tab = nextSession.active ? await getYouTubeTab() : await getActiveTab();
  if (tab?.id && tab.url && /^https:\/\/(www\.)?youtube\.com\//i.test(tab.url)) await sendSession(tab, nextSession);
  await chrome.storage.local.set({ [STORAGE_KEY]: nextSession });
  session = nextSession;
  render();
}
threshold.addEventListener("input", () => { thresholdValue.textContent = `${threshold.value}%`; });
domainInput.addEventListener("input", () => { counter.textContent = `${domainInput.value.length} / 500`; });
form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const domain = domainInput.value.trim();
  if (!domain) return;
  showMessage(""); startButton.disabled = true; startButton.textContent = session.active ? "Updating…" : "Starting…";
  try { await saveAndApply({ ...session, active: true, domain, paused: false, confidenceThreshold: Number(threshold.value) / 100, apiKey: apiKey.value.trim(), stats: domain === session.domain ? session.stats : {} }); }
  catch (error) { showMessage(error.message || "Could not start Focus Mode."); render(); }
  finally { startButton.disabled = false; }
});
pauseButton.addEventListener("click", async () => { try { await saveAndApply({ ...session, paused: !session.paused }); } catch (error) { showMessage(error.message); } });
stopButton.addEventListener("click", async () => { try { await saveAndApply({ ...session, active: false, paused: false }); } catch (error) { showMessage(error.message); } });
recheckButton.addEventListener("click", async () => {
  try {
    const tab = await getYouTubeTab();
    await chrome.tabs.sendMessage(tab.id, { type: "FEEDLENS_RECHECK" });
    showMessage("Recommendations queued for recheck.");
  } catch (error) { showMessage(error.message); }
});
saveProfileButton.addEventListener("click", async () => {
  const name = window.prompt("Name this focus profile", session.domain.slice(0, 40));
  if (!name?.trim() || !domainInput.value.trim()) return;
  profiles[name.trim()] = { domain: domainInput.value.trim(), confidenceThreshold: Number(threshold.value) / 100 };
  await chrome.storage.local.set({ [PROFILES_KEY]: profiles }); populateProfiles(); profileSelect.value = name.trim(); showMessage("Profile saved.");
});
profileSelect.addEventListener("change", () => {
  const profile = profiles[profileSelect.value];
  if (!profile) return;
  domainInput.value = profile.domain; threshold.value = Math.round(profile.confidenceThreshold * 100); threshold.dispatchEvent(new Event("input")); domainInput.dispatchEvent(new Event("input"));
});
(async () => {
  const stored = await chrome.storage.local.get([STORAGE_KEY, PROFILES_KEY]);
  if (stored[STORAGE_KEY] && typeof stored[STORAGE_KEY] === "object") session = { ...session, ...stored[STORAGE_KEY] };
  profiles = stored[PROFILES_KEY] && typeof stored[PROFILES_KEY] === "object" ? stored[PROFILES_KEY] : {};
  populateProfiles(); render();
})();

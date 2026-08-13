import { backendApi } from "../background/api.js";

const statusDot = document.getElementById("backend-status");
const statusEl = document.getElementById("status");
const domSection = document.getElementById("dom-media-section");
const domList = document.getElementById("dom-media-list");
const resultsSection = document.getElementById("results-section");
const resultsList = document.getElementById("results-list");

function sendMessage(message) {
  return new Promise((resolve) => chrome.runtime.sendMessage(message, resolve));
}

document.getElementById("settings-btn").addEventListener("click", () => chrome.runtime.openOptionsPage());

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function refreshBackendStatus() {
  try {
    await backendApi.health();
    statusDot.classList.add("ok");
    statusDot.classList.remove("down");
    statusDot.title = "Backend connected";
  } catch {
    statusDot.classList.add("down");
    statusDot.classList.remove("ok");
    statusDot.title = "Backend unreachable at 127.0.0.1:8787";
  }
}

async function renderDomMedia(tabId) {
  const res = await sendMessage({ type: "GET_TAB_MEDIA", tabId });
  const items = res.ok ? res.media : [];
  if (items.length === 0) {
    domSection.hidden = true;
    return;
  }
  domSection.hidden = false;
  domList.innerHTML = "";
  for (const item of items) {
    const btn = document.createElement("button");
    btn.className = "btn";
    btn.textContent = item.url.length > 60 ? item.url.slice(0, 57) + "..." : item.url;
    btn.title = item.url;
    btn.addEventListener("click", async () => {
      statusEl.textContent = "Sending to Download Manager...";
      const r = await sendMessage({ type: "DOWNLOAD_DIRECT", url: item.url });
      statusEl.textContent = r.ok ? "Queued." : `Error: ${r.error}`;
    });
    domList.appendChild(btn);
  }
}

function renderStream(stream) {
  const wrap = document.createElement("div");
  wrap.className = "stream";

  const label = document.createElement("div");
  label.className = "muted";
  label.textContent = `${stream.isAudioOnly ? "Audio" : "Video"} · ${stream.container ?? stream.protocol}${
    stream.resolution ? " · " + stream.resolution : ""
  }${stream.bitrateKbps ? " · " + Math.round(stream.bitrateKbps) + "kbps" : ""}`;
  wrap.appendChild(label);

  const downloadBtn = document.createElement("button");
  downloadBtn.className = "btn";
  downloadBtn.textContent = "Download";
  downloadBtn.addEventListener("click", () => grab(stream, null));
  wrap.appendChild(downloadBtn);

  if (!stream.isAudioOnly) {
    const mp3Btn = document.createElement("button");
    mp3Btn.className = "btn";
    mp3Btn.textContent = "Extract audio (MP3)";
    mp3Btn.addEventListener("click", () =>
      grab(stream, { action: "extract-audio", targetContainer: "mp3", tags: { title: stream.title ?? undefined } }),
    );
    wrap.appendChild(mp3Btn);
  }

  return wrap;
}

async function grab(stream, postProcess) {
  const tab = await getActiveTab();
  statusEl.textContent = "Queuing download...";
  const res = await sendMessage({ type: "GRAB_STREAM", url: tab.url, streamId: stream.id, postProcess });
  statusEl.textContent = res.ok ? "Queued." : `Error: ${res.error}`;
}

document.getElementById("sniff-btn").addEventListener("click", async () => {
  const tab = await getActiveTab();
  statusEl.textContent = "Sniffing (this can take a few seconds)...";
  resultsSection.hidden = true;
  resultsList.innerHTML = "";

  const res = await sendMessage({ type: "SNIFF_URL", url: tab.url });
  if (!res.ok) {
    statusEl.textContent = `Error: ${res.error}`;
    return;
  }

  const { streams, warnings } = res.result;
  statusEl.textContent = streams.length ? `Found ${streams.length} stream(s).` : "No media found on this page.";
  resultsSection.hidden = streams.length === 0 && warnings.length === 0;

  for (const w of warnings) {
    const warn = document.createElement("div");
    warn.className = "muted";
    warn.textContent = w;
    resultsList.appendChild(warn);
  }
  for (const stream of streams) {
    resultsList.appendChild(renderStream(stream));
  }
});

(async () => {
  await refreshBackendStatus();
  const tab = await getActiveTab();
  if (tab?.id) await renderDomMedia(tab.id);
})();

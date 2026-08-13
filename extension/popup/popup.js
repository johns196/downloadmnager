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
    const wrap = document.createElement("div");
    wrap.className = "stream";

    const nameEl = document.createElement("div");
    nameEl.textContent = item.url.length > 60 ? item.url.slice(0, 57) + "..." : item.url;
    nameEl.title = item.url;
    wrap.appendChild(nameEl);

    const downloadBtn = document.createElement("button");
    downloadBtn.className = "btn";
    downloadBtn.textContent = "Download";
    downloadBtn.addEventListener("click", () => downloadDetected(item, null));
    wrap.appendChild(downloadBtn);

    const mp3Btn = document.createElement("button");
    mp3Btn.className = "btn";
    mp3Btn.textContent = "Convert to MP3";
    mp3Btn.addEventListener("click", () => downloadDetected(item, { action: "extract-audio", targetContainer: "mp3" }));
    wrap.appendChild(mp3Btn);

    domList.appendChild(wrap);
  }
}

async function downloadDetected(item, postProcess) {
  statusEl.textContent = "Sending to Download Manager...";
  const r = await sendMessage({ type: "DOWNLOAD_DIRECT", url: item.url, postProcess });
  statusEl.textContent = r.ok ? "Queued." : `Error: ${r.error}`;
}

function renderStream(stream) {
  const wrap = document.createElement("div");
  wrap.className = "stream";

  if (stream.title) {
    const titleEl = document.createElement("div");
    titleEl.textContent = stream.title.length > 70 ? stream.title.slice(0, 67) + "..." : stream.title;
    titleEl.title = stream.title;
    wrap.appendChild(titleEl);
  }

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

  // Anything not already mp3 -- a video stream (extract its audio track) or
  // an audio stream in another container like Anghami's m4a -- can go
  // through ffmpeg's extract-audio action; ffmpeg's -vn flag is a no-op
  // when there's no video track, so this is safe for audio-only sources.
  if (stream.container !== "mp3") {
    const mp3Btn = document.createElement("button");
    mp3Btn.className = "btn";
    mp3Btn.textContent = stream.isAudioOnly ? "Convert to MP3" : "Extract audio (MP3)";
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

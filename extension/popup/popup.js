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
  // Newest first -- see content-script.js's renderDetectedMedia for why
  // (accumulates every track played this session on an SPA, so insertion
  // order would put the *first* track played on top, not the current one).
  //
  // No same-title duplicates reach this point -- recordMedia
  // (service-worker.js) already drops any later item sharing a title with
  // one already recorded, per the user's confirmed finding that a repeat
  // under an existing title is Anghami prefetching the next track.
  for (const item of [...items].reverse()) {
    const wrap = document.createElement("div");
    wrap.className = "stream";

    if (item.title) {
      const titleEl = document.createElement("div");
      titleEl.textContent = item.title.length > 60 ? item.title.slice(0, 57) + "..." : item.title;
      titleEl.title = item.title;
      wrap.appendChild(titleEl);
    }
    const nameEl = document.createElement("div");
    nameEl.className = "muted";
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
  const r = await sendMessage({ type: "DOWNLOAD_DIRECT", url: item.url, filename: filenameFor(item), postProcess });
  statusEl.textContent = r.ok ? "Queued." : `Error: ${r.error}`;
}

// Same rule as the backend's own sanitizeFilename (QueueManager.ts), so a
// title-derived name here matches what sniffed-stream downloads already
// produce -- without this, the backend falls back to deriving a filename
// from the CDN URL itself, which for Anghami is an opaque ISRC/MD5 hash.
//
// Hash suffix is load-bearing -- see content-script.js's filenameFor for
// why: a static <title> across tracks would otherwise collide different
// songs onto the same filename, which uniqueOutputPath() would then save
// as indistinguishable "(1)"/"(2)" duplicates.
function shortHash(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

function filenameFor(item) {
  if (!item.title) return undefined;
  const urlExt = (item.url.split("?")[0].split(".").pop() || "").toLowerCase();
  const ext = /^[a-z0-9]{2,5}$/.test(urlExt) ? urlExt : "bin";
  const safeName = item.title.replace(/[/\\?%*:|"<>]/g, "_").trim().slice(0, 150) || "media";
  return `${safeName} [${shortHash(item.url)}].${ext}`;
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

// Plain classic script (no ES module imports -- content scripts can't rely
// on manifest "type":"module" the way the background service worker can).
// Everything the panel needs lives in a Shadow DOM root so injected styles
// can never leak into, or be clobbered by, the host page's CSS.
(() => {
  if (window.__downloadManagerInjected) return;
  window.__downloadManagerInjected = true;

  function findDomMedia() {
    const items = [];
    for (const el of document.querySelectorAll("video, audio")) {
      const src = el.currentSrc || el.src;
      if (!src) continue;
      if (src.startsWith("blob:")) continue; // not fetchable outside the page's own JS context
      items.push({ url: src, contentType: el.tagName === "VIDEO" ? "video/*" : "audio/*" });
    }
    return items;
  }

  function reportDomMedia() {
    const items = findDomMedia();
    if (items.length > 0) {
      chrome.runtime.sendMessage({ type: "PANEL_DETECTED_MEDIA", items });
    }
  }

  function sendMessage(message) {
    return new Promise((resolve) => chrome.runtime.sendMessage(message, resolve));
  }

  // ---- Floating launcher + panel, isolated in a Shadow DOM ----

  const host = document.createElement("div");
  host.style.all = "initial";
  host.style.position = "fixed";
  host.style.zIndex = "2147483647";
  host.style.bottom = "20px";
  host.style.right = "20px";
  document.documentElement.appendChild(host);
  const root = host.attachShadow({ mode: "open" });

  root.innerHTML = `
    <style>
      :host { all: initial; }
      .launcher {
        width: 48px; height: 48px; border-radius: 50%;
        background: #2563eb; color: #fff; border: none; cursor: pointer;
        box-shadow: 0 2px 8px rgba(0,0,0,0.3); font-size: 20px;
        display: flex; align-items: center; justify-content: center;
        font-family: system-ui, sans-serif;
      }
      .launcher:hover { background: #1d4ed8; }
      .panel {
        position: absolute; bottom: 58px; right: 0; width: 320px;
        max-height: 420px; overflow-y: auto; background: #111827; color: #e5e7eb;
        border-radius: 10px; box-shadow: 0 8px 24px rgba(0,0,0,0.4);
        font-family: system-ui, sans-serif; font-size: 13px; padding: 12px;
        display: none;
      }
      .panel.open { display: block; }
      .panel h3 { margin: 0 0 8px; font-size: 14px; }
      .btn {
        display: block; width: 100%; text-align: left; background: #1f2937;
        color: #e5e7eb; border: 1px solid #374151; border-radius: 6px;
        padding: 8px; margin-bottom: 6px; cursor: pointer; font-size: 12px;
      }
      .btn:hover { background: #374151; }
      .btn-primary { background: #2563eb; border-color: #2563eb; color: #fff; }
      .btn-primary:hover { background: #1d4ed8; }
      .stream { border-top: 1px solid #374151; padding-top: 8px; margin-top: 8px; }
      .muted { color: #9ca3af; font-size: 11px; }
      .status { margin-top: 8px; min-height: 16px; }
    </style>
    <button class="launcher" title="Download Manager">&#8681;</button>
    <div class="panel">
      <h3>Download Manager</h3>
      <button class="btn btn-primary" id="sniff-btn">Sniff this page for media</button>
      <div id="dom-media"></div>
      <div id="sniff-results"></div>
      <div class="status" id="status"></div>
    </div>
  `;

  const launcher = root.querySelector(".launcher");
  const panel = root.querySelector(".panel");
  const domMediaEl = root.querySelector("#dom-media");
  const resultsEl = root.querySelector("#sniff-results");
  const statusEl = root.querySelector("#status");

  launcher.addEventListener("click", () => {
    panel.classList.toggle("open");
    if (panel.classList.contains("open")) refreshDetectedMedia();
  });

  // Sourced from the background's passive chrome.webRequest watcher
  // (recordMedia in service-worker.js), NOT the local <video>/<audio> DOM
  // scan below -- that scan can only see a real src attribute, but many
  // players (Anghami included) route playback through a blob: URL that
  // isn't fetchable outside the page's own JS context, so it never shows
  // anything there. The network watcher sees the real underlying fetch
  // regardless of how the player wraps it, and -- critically -- keeps
  // accumulating as the user plays different tracks in an SPA that never
  // navigates, which a fresh page-reload sniff structurally cannot do.
  let detectedMedia = [];

  function renderDetectedMedia() {
    domMediaEl.innerHTML = "";
    const label = document.createElement("div");
    label.className = "muted";
    if (detectedMedia.length === 0) {
      label.textContent = "Detected on page: nothing yet -- play something.";
      domMediaEl.appendChild(label);
      return;
    }
    // Newest first, and said plainly: recordMedia only clears on a full
    // page navigation, so on an SPA that never navigates (Anghami) this
    // list accumulates every track played this session in insertion
    // order. Without reversing, the top (and easiest to click) entry
    // would always be the *first* thing played, not the current track --
    // exactly the "still getting the old one" bug this whole feature
    // exists to fix. The Anghami sniff test earlier also showed it
    // preloads the *next* queued track alongside the current one, so
    // "last couple" is the honest framing, not "last one is definitely it".
    label.textContent = "Detected on page (last one or two are most likely current/next):";
    domMediaEl.appendChild(label);
    // Confirmed by the user actually downloading and listening: when two
    // entries share an identical title, one of them can genuinely be a
    // *different* track (Anghami appears to prefetch an upcoming queued
    // song's audio before its own title has taken over the tab), so the
    // repeated title is not corroboration -- it's the exact case where the
    // title-capture in recordMedia (service-worker.js) is caught mid-
    // transition and wrong. No reliable signal here for *which* of a
    // group is the stale/wrong one, so every member of a repeated-title
    // group gets flagged rather than silently trusting any of them.
    const titleCounts = new Map();
    for (const m of detectedMedia) if (m.title) titleCounts.set(m.title, (titleCounts.get(m.title) || 0) + 1);
    for (const item of [...detectedMedia].reverse()) {
      const wrap = document.createElement("div");
      wrap.className = "stream";

      const filename = item.url.split("/").pop().split("?")[0] || item.url;
      if (item.title) {
        const ambiguous = titleCounts.get(item.title) > 1;
        const titleEl = document.createElement("div");
        const shortTitle = item.title.length > 60 ? item.title.slice(0, 57) + "..." : item.title;
        titleEl.textContent = ambiguous ? `${shortTitle} (unconfirmed)` : shortTitle;
        titleEl.title = ambiguous
          ? `${item.title}\n\nThis title is shared by more than one detected file -- could be a different, prefetched track under the same label. Check the downloaded file before trusting the name.`
          : item.title;
        wrap.appendChild(titleEl);
      }
      const nameEl = document.createElement("div");
      nameEl.className = "muted";
      nameEl.textContent = filename.length > 45 ? filename.slice(0, 42) + "..." : filename;
      nameEl.title = item.url;
      wrap.appendChild(nameEl);

      const downloadBtn = document.createElement("button");
      downloadBtn.className = "btn";
      downloadBtn.textContent = `Download ${item.contentType.startsWith("audio") ? "audio" : "video"}`;
      downloadBtn.addEventListener("click", () => downloadDetected(item, null));
      wrap.appendChild(downloadBtn);

      const mp3Btn = document.createElement("button");
      mp3Btn.className = "btn";
      mp3Btn.textContent = "Convert to MP3";
      mp3Btn.addEventListener("click", () =>
        downloadDetected(item, { action: "extract-audio", targetContainer: "mp3" }),
      );
      wrap.appendChild(mp3Btn);

      domMediaEl.appendChild(wrap);
    }
  }

  // Without this, the backend derives a filename straight from the CDN
  // URL's own path -- fine for a normal file server, but Anghami's audio
  // URLs are opaque ISRC/MD5 hashes with no readable name in them at all,
  // which is exactly what was cluttering the Library screen. Same
  // sanitize rule as the backend's own sanitizeFilename (QueueManager.ts)
  // so results match what sniffed-stream downloads already produce.
  //
  // The hash suffix is load-bearing, not decoration: if the site's <title>
  // turns out to be static across tracks (unconfirmed either way for
  // Anghami -- see recordMedia's comment in service-worker.js), every
  // detected item would otherwise resolve to the *same* filename, and
  // uniqueOutputPath() would silently save different songs as "name
  // (1).m4a", "name (2).m4a" -- indistinguishable duplicates, which is
  // worse than the ugly-but-unique hash names this is meant to replace.
  function shortHash(str) {
    let h = 0;
    for (let i = 0; i < str.length; i++) h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
    return (h >>> 0).toString(36);
  }

  function filenameFor(item) {
    if (!item.title) return undefined; // no title captured -- let the backend derive one from the URL, as before
    const urlExt = (item.url.split("?")[0].split(".").pop() || "").toLowerCase();
    const ext = /^[a-z0-9]{2,5}$/.test(urlExt) ? urlExt : "bin";
    // Same ambiguity check as renderDetectedMedia -- a repeated title can
    // be a genuinely different (prefetched) track, confirmed by the user
    // downloading one and checking. The hash already guarantees the file
    // won't collide with the other one sharing this title; this just keeps
    // the saved filename from asserting a name that later turns out wrong.
    const ambiguous = detectedMedia.filter((m) => m.title === item.title).length > 1;
    const safeName = item.title.replace(/[/\\?%*:|"<>]/g, "_").trim().slice(0, 150) || "media";
    return `${safeName}${ambiguous ? " (unconfirmed)" : ""} [${shortHash(item.url)}].${ext}`;
  }

  async function downloadDetected(item, postProcess) {
    statusEl.textContent = "Sending to Download Manager...";
    const res = await sendMessage({
      type: "DOWNLOAD_DIRECT",
      url: item.url,
      filename: filenameFor(item),
      postProcess,
    });
    statusEl.textContent = res.ok ? "Queued." : `Error: ${res.error}`;
  }

  async function refreshDetectedMedia() {
    const res = await sendMessage({ type: "GET_TAB_MEDIA" });
    detectedMedia = res.ok ? res.media : [];
    renderDetectedMedia();
  }

  // Live push from the background whenever a new item is recorded for this
  // tab -- means the panel updates the instant a new track's request comes
  // through, with no need to close/reopen it or click anything.
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === "TAB_MEDIA_UPDATED") {
      detectedMedia = message.media ?? [];
      if (panel.classList.contains("open")) renderDetectedMedia();
    }
  });

  root.querySelector("#sniff-btn").addEventListener("click", async () => {
    statusEl.textContent = "Sniffing (this can take a few seconds)...";
    resultsEl.innerHTML = "";
    const res = await sendMessage({ type: "SNIFF_URL", url: location.href });
    if (!res.ok) {
      statusEl.textContent = `Error: ${res.error}. Is the Download Manager backend running?`;
      return;
    }
    const { streams, warnings } = res.result;
    statusEl.textContent = streams.length
      ? `Found ${streams.length} stream(s).`
      : "No media found on this page.";
    for (const w of warnings) {
      const warn = document.createElement("div");
      warn.className = "muted";
      warn.textContent = w;
      resultsEl.appendChild(warn);
    }
    for (const stream of streams) {
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
      label.textContent = `${stream.isAudioOnly ? "Audio" : "Video"} · ${stream.container ?? stream.protocol} ${stream.resolution ? "· " + stream.resolution : ""} ${stream.bitrateKbps ? "· " + Math.round(stream.bitrateKbps) + "kbps" : ""}`;
      wrap.appendChild(label);

      const grabBtn = document.createElement("button");
      grabBtn.className = "btn";
      grabBtn.textContent = "Download";
      grabBtn.addEventListener("click", () => grab(stream, null));
      wrap.appendChild(grabBtn);

      // See popup.js's renderStream for why this checks container, not
      // isAudioOnly: ffmpeg's -vn is a safe no-op on audio-only sources, so
      // an m4a stream (e.g. Anghami) can go straight to mp3 too.
      if (stream.container !== "mp3") {
        const mp3Btn = document.createElement("button");
        mp3Btn.className = "btn";
        mp3Btn.textContent = stream.isAudioOnly ? "Convert to MP3" : "Extract audio (MP3)";
        mp3Btn.addEventListener("click", () =>
          grab(stream, { action: "extract-audio", targetContainer: "mp3", tags: { title: stream.title ?? undefined } }),
        );
        wrap.appendChild(mp3Btn);
      }
      resultsEl.appendChild(wrap);
    }

    async function grab(stream, postProcess) {
      statusEl.textContent = "Queuing download...";
      const grabRes = await sendMessage({
        type: "GRAB_STREAM",
        url: location.href,
        streamId: stream.id,
        postProcess,
      });
      statusEl.textContent = grabRes.ok ? "Queued." : `Error: ${grabRes.error}`;
    }
  });

  // Passive DOM scan for the badge count -- cheap, runs once on load and
  // again if the page mutates (SPA route changes, lazily-mounted players).
  reportDomMedia();
  const observer = new MutationObserver(() => reportDomMedia());
  observer.observe(document.documentElement, { childList: true, subtree: true });
})();

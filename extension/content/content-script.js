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
    if (panel.classList.contains("open")) renderDomMedia();
  });

  function renderDomMedia() {
    const items = findDomMedia();
    domMediaEl.innerHTML = "";
    if (items.length === 0) return;
    const label = document.createElement("div");
    label.className = "muted";
    label.textContent = "Detected on page:";
    domMediaEl.appendChild(label);
    for (const item of items) {
      const btn = document.createElement("button");
      btn.className = "btn";
      btn.textContent = `Download ${item.contentType.startsWith("audio") ? "audio" : "video"}`;
      btn.addEventListener("click", async () => {
        statusEl.textContent = "Sending to Download Manager...";
        const res = await sendMessage({ type: "DOWNLOAD_DIRECT", url: item.url });
        statusEl.textContent = res.ok ? "Queued." : `Error: ${res.error}`;
      });
      domMediaEl.appendChild(btn);
    }
  }

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
      const label = document.createElement("div");
      label.className = "muted";
      label.textContent = `${stream.isAudioOnly ? "Audio" : "Video"} · ${stream.container ?? stream.protocol} ${stream.resolution ? "· " + stream.resolution : ""} ${stream.bitrateKbps ? "· " + Math.round(stream.bitrateKbps) + "kbps" : ""}`;
      wrap.appendChild(label);

      const grabBtn = document.createElement("button");
      grabBtn.className = "btn";
      grabBtn.textContent = "Download";
      grabBtn.addEventListener("click", () => grab(stream, null));
      wrap.appendChild(grabBtn);

      if (!stream.isAudioOnly) {
        const mp3Btn = document.createElement("button");
        mp3Btn.className = "btn";
        mp3Btn.textContent = "Extract audio (MP3)";
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

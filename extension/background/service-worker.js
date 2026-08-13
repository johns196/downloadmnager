import { backendApi } from "./api.js";

// Per-tab set of URLs that look like grabbable media, built up passively
// from network traffic. This is only used to decide "should we show the
// grabber panel / badge count for this tab" -- the *authoritative*
// extraction (with real titles, bitrates, DRM checks) always goes through
// backend POST /api/sniff, never this heuristic list.
//
// Backed by chrome.storage.session rather than a module-level Map: MV3
// service workers unload after ~30s idle and re-run this whole module from
// scratch on the next event, which would silently wipe a plain in-memory
// Map. session storage survives worker restarts (clearing only when the
// browser itself closes), so badge counts don't randomly reset.
const MEDIA_EXTENSIONS = [".m3u8", ".mpd", ".mp4", ".m4a", ".mp3", ".webm", ".aac", ".flac", ".wav", ".ogg"];

function storageKey(tabId) {
  return `tabMedia:${tabId}`;
}

async function getTabMediaMap(tabId) {
  const data = await chrome.storage.session.get(storageKey(tabId));
  return new Map(Object.entries(data[storageKey(tabId)] ?? {}));
}

async function setTabMediaMap(tabId, map) {
  await chrome.storage.session.set({ [storageKey(tabId)]: Object.fromEntries(map) });
}

function looksLikeMedia(url, contentType) {
  const path = (() => {
    try {
      return new URL(url).pathname.toLowerCase();
    } catch {
      return "";
    }
  })();
  if (MEDIA_EXTENSIONS.some((ext) => path.endsWith(ext))) return true;
  if (contentType && (contentType.startsWith("video/") || contentType.startsWith("audio/"))) return true;
  if (contentType && (contentType.includes("mpegurl") || contentType.includes("dash+xml"))) return true;
  return false;
}

async function recordMedia(tabId, url, contentType) {
  if (tabId < 0) return; // not associated with a tab (e.g. service worker's own requests)
  const map = await getTabMediaMap(tabId);
  if (map.has(url)) return;
  // Read fresh, right now, rather than once at page load -- chrome.tabs.get
  // always reflects the tab's current title. Whether that's a per-track
  // name depends entirely on whether the site updates <title> on in-place
  // playback changes (unconfirmed for Anghami specifically -- the earlier
  // network-sniff test only ever saw the page's title on cold load, never
  // after a live track switch). Worst case every entry shares one title,
  // identical to the old sniff-based behavior the user asked to match;
  // best case it's actually correct per track. Either way, not a regression.
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  map.set(url, { url, contentType, title: tab?.title ?? null });
  await setTabMediaMap(tabId, map);
  chrome.action.setBadgeText({ tabId, text: String(map.size) });
  chrome.action.setBadgeBackgroundColor({ tabId, color: "#2563eb" });
  // Push to the tab's own content script too, not just the toolbar popup --
  // the floating in-page panel has no other way to learn about a new
  // detection while it's already open (unlike the popup, which re-reads on
  // every open). Fails silently on tabs with no content script injected
  // (e.g. a chrome:// page triggering this via an unrelated request).
  chrome.tabs.sendMessage(tabId, { type: "TAB_MEDIA_UPDATED", media: [...map.values()] }).catch(() => {});
}

// Plain observation, not blocking -- MV3 removed blocking webRequest for
// most extensions. This is exactly what's needed here: we only ever want
// to *notice* media responses, never intercept/modify them.
chrome.webRequest.onCompleted.addListener(
  (details) => {
    const contentType = details.responseHeaders?.find((h) => h.name.toLowerCase() === "content-type")?.value ?? "";
    if (looksLikeMedia(details.url, contentType)) {
      void recordMedia(details.tabId, details.url, contentType);
    }
  },
  { urls: ["<all_urls>"], types: ["media", "xmlhttprequest", "object", "other"] },
  ["responseHeaders"],
);

chrome.tabs.onRemoved.addListener((tabId) => chrome.storage.session.remove(storageKey(tabId)));
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === "loading") {
    chrome.storage.session.remove(storageKey(tabId));
    chrome.action.setBadgeText({ tabId, text: "" });
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const tabId = sender.tab?.id ?? message.tabId;

  (async () => {
    try {
      switch (message.type) {
        case "GET_TAB_MEDIA": {
          const map = await getTabMediaMap(tabId);
          sendResponse({ ok: true, media: [...map.values()] });
          break;
        }
        case "SNIFF_URL": {
          const result = await backendApi.sniff(message.url);
          sendResponse({ ok: true, result });
          break;
        }
        case "GRAB_STREAM": {
          const job = await backendApi.grab(message.url, message.streamId, message.postProcess ?? null);
          sendResponse({ ok: true, job });
          break;
        }
        case "DOWNLOAD_DIRECT": {
          const job = await backendApi.createJob(message.url, message.filename, message.postProcess ?? null);
          sendResponse({ ok: true, job });
          break;
        }
        case "PANEL_DETECTED_MEDIA": {
          // Content script found <video>/<audio> elements directly (more
          // reliable than webRequest sniffing for same-origin blob: URLs).
          // Awaited sequentially, not fired in parallel: recordMedia does a
          // read-modify-write against storage.session, so concurrent calls
          // for the same tab would race and drop items.
          for (const item of message.items ?? []) {
            await recordMedia(tabId, item.url, item.contentType ?? "");
          }
          sendResponse({ ok: true });
          break;
        }
        default:
          sendResponse({ ok: false, error: `Unknown message type: ${message.type}` });
      }
    } catch (err) {
      sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  })();

  return true; // keep the message channel open for the async response
});

// MV3 service workers unload when idle and re-run this module on the next
// event -- creating the menu unconditionally here would throw "duplicate
// id" on every wake after the first. onInstalled only fires once per
// install/update, which is the correct place for one-time setup like this.
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "download-with-manager",
    title: "Download with Download Manager",
    contexts: ["link", "video", "audio", "image"],
  });
});

chrome.contextMenus.onClicked.addListener(async (info) => {
  const url = info.srcUrl ?? info.linkUrl;
  if (!url) return;
  try {
    await backendApi.createJob(url);
  } catch (err) {
    console.error("Download Manager: failed to enqueue from context menu", err);
  }
});

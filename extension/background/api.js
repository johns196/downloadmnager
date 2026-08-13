// Talks to the backend only -- see docs/API.md at the repo root for the
// full contract. Kept as a plain module the service worker imports;
// popup.js and content-script.js never call fetch() on the backend
// directly, they message the background worker instead (avoids each
// context needing its own CORS/host-permission story).
//
// The backend's address is a user setting, not a hardcoded constant --
// see options.html/options.js. Defaults to the localhost dev backend so
// the extension works out of the box, but is meant to be pointed at a
// deployed backend later without needing a code change or a rebuild
// of the unpacked extension.
const DEFAULT_BACKEND_BASE = "http://127.0.0.1:8787/api";

async function getBackendBase() {
  const { backendBaseUrl } = await chrome.storage.local.get("backendBaseUrl");
  return backendBaseUrl ? `${backendBaseUrl.replace(/\/$/, "")}/api` : DEFAULT_BACKEND_BASE;
}

async function request(path, options = {}) {
  const base = await getBackendBase();
  const res = await fetch(`${base}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Backend ${path} -> ${res.status}: ${body.slice(0, 200)}`);
  }
  return res.status === 204 ? null : res.json();
}

export const backendApi = {
  health: () => request("/health"),
  listJobs: () => request("/jobs"),
  createJob: (url, filename) =>
    request("/jobs", { method: "POST", body: JSON.stringify({ url, filename, source: "extension" }) }),
  sniff: (url) => request("/sniff", { method: "POST", body: JSON.stringify({ url }) }),
  grab: (url, streamId, postProcess) =>
    request("/sniff/grab", { method: "POST", body: JSON.stringify({ url, streamId, postProcess }) }),
};

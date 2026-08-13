const DEFAULT_BACKEND_URL = "http://127.0.0.1:8787";

const input = document.getElementById("backend-url");
const statusEl = document.getElementById("status");

async function load() {
  const { backendBaseUrl } = await chrome.storage.local.get("backendBaseUrl");
  input.value = backendBaseUrl || DEFAULT_BACKEND_URL;
}

document.getElementById("save-btn").addEventListener("click", async () => {
  const url = input.value.trim().replace(/\/$/, "");
  if (!url) return;
  await chrome.storage.local.set({ backendBaseUrl: url });
  statusEl.textContent = "Saved.";
});

document.getElementById("test-btn").addEventListener("click", async () => {
  const url = input.value.trim().replace(/\/$/, "") || DEFAULT_BACKEND_URL;
  statusEl.textContent = "Checking...";
  try {
    const res = await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(5000) });
    const body = await res.json();
    statusEl.textContent = res.ok && body.ok ? "Connected." : `Unexpected response (${res.status}).`;
  } catch (err) {
    statusEl.textContent = `Unreachable: ${err.message}`;
  }
});

load();

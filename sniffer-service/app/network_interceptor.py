"""Fallback extraction path for pages yt-dlp has no extractor for: loads
the page in headless Chromium and passively watches network traffic for
anything that looks like media -- HLS/DASH manifests, or direct
audio/video responses. This is the "sniff literally any website" half of
the tool; it trades yt-dlp's per-site precision for generality.

Import this module lazily (inside the function that needs it) so the rest
of the sniffer-service still boots and serves yt-dlp results even before
`setup.sh` has installed Playwright + its browser binary -- see
docs/API.md and PROGRESS.md for the one-time setup step this depends on.
"""

import asyncio
import re
import uuid
from typing import Optional
from urllib.parse import urlparse

from playwright.async_api import async_playwright

from . import config
from .models import StreamDescriptor

MEDIA_EXTENSIONS = {
    ".m3u8": "hls",
    ".mpd": "dash",
    ".mp4": "direct",
    ".m4a": "direct",
    ".mp3": "direct",
    ".webm": "direct",
    ".aac": "direct",
    ".flac": "direct",
    ".ogg": "direct",
    ".wav": "direct",
}

MEDIA_CONTENT_TYPES = (
    "video/",
    "audio/",
    "application/vnd.apple.mpegurl",
    "application/x-mpegurl",
    "application/dash+xml",
)

DRM_MARKERS = ("SAMPLE-AES", "urn:mpeg:dash:mp4protection", "widevine", "playready", "fairplay")


def _classify(url: str, content_type: str) -> Optional[str]:
    path = urlparse(url).path.lower()
    for ext, protocol in MEDIA_EXTENSIONS.items():
        if path.endswith(ext):
            return protocol
    if any(ct in content_type for ct in MEDIA_CONTENT_TYPES):
        if "mpegurl" in content_type:
            return "hls"
        if "dash+xml" in content_type:
            return "dash"
        return "direct"
    return None


async def _looks_drm_protected(body_text: str) -> bool:
    return any(marker.lower() in body_text.lower() for marker in DRM_MARKERS)


async def sniff_network(page_url: str) -> tuple[list[StreamDescriptor], list[str], Optional[str]]:
    warnings: list[str] = []
    found: dict[str, dict] = {}  # keyed by url to dedupe

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        context = await browser.new_context(
            user_agent="Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/124.0 Safari/537.36 DownloadManagerSniffer/0.1"
        )
        page = await context.new_page()

        async def on_response(response):
            try:
                content_type = response.headers.get("content-type", "")
                protocol = _classify(response.url, content_type)
                if not protocol or response.url in found:
                    return
                if protocol in ("hls", "dash"):
                    # Manifests are small text files -- worth reading the
                    # body to catch DRM signaling before surfacing them as
                    # grabbable streams (see docs/API.md scope line).
                    try:
                        body_text = await response.text()
                    except Exception:
                        body_text = ""
                    if body_text and await _looks_drm_protected(body_text):
                        warnings.append(f"DRM-protected stream skipped: {response.url}")
                        return
                found[response.url] = {"protocol": protocol, "contentType": content_type}
            except Exception:
                pass  # a single bad response shouldn't abort the whole sniff

        page.on("response", on_response)

        page_title: Optional[str] = None
        try:
            await page.goto(page_url, wait_until="networkidle", timeout=config.NETWORK_SNIFF_TIMEOUT_SECONDS * 1000)
            page_title = await page.title()
            # Media often only starts requesting segments once a player
            # mounts / autoplay kicks in; give it a short extra window.
            await asyncio.sleep(config.NETWORK_SNIFF_IDLE_WAIT_SECONDS)
        except Exception as err:
            warnings.append(f"Page load did not fully settle: {err}")
        finally:
            await browser.close()

    streams: list[StreamDescriptor] = []
    for url, meta in found.items():
        protocol = meta["protocol"]
        is_audio_only = protocol == "direct" and meta["contentType"].startswith("audio/")
        ext = urlparse(url).path.rsplit(".", 1)[-1] if "." in urlparse(url).path else None
        streams.append(
            StreamDescriptor(
                id=str(uuid.uuid4()),
                url=url,
                protocol=protocol,
                container=ext,
                codec=None,
                bitrateKbps=None,
                resolution=None,
                durationSeconds=None,
                isAudioOnly=is_audio_only,
                title=page_title,
                thumbnailUrl=None,
                extractor="network-sniff",
            )
        )

    if not streams:
        warnings.append("No media requests observed -- the page may require interaction (e.g. clicking play), lazy-load media after a longer delay, or use DRM this tool intentionally does not support.")

    return streams, warnings, page_title

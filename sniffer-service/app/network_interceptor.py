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


def _base_domain(page_url: str) -> str:
    host = urlparse(page_url).hostname or ""
    parts = host.split(".")
    return ".".join(parts[-2:]) if len(parts) >= 2 else host


def _extract_cookies_for_domain(page_url: str) -> tuple[list[dict], Optional[str]]:
    """Returns (playwright_cookies, warning). A cookie-less context can
    never get past a login wall even when the user is logged in in their
    own real browser -- see config.py NETWORK_SNIFF_COOKIES_FROM_BROWSER.
    Reuses yt-dlp's own cookie-extraction/decryption rather than adding a
    separate dependency."""
    if not config.NETWORK_SNIFF_COOKIES_FROM_BROWSER:
        return [], None
    try:
        import yt_dlp.cookies as ytdlp_cookies
    except ImportError:
        return [], None

    base_domain = _base_domain(page_url)
    if not base_domain:
        return [], None

    try:
        jar = ytdlp_cookies.extract_cookies_from_browser(config.NETWORK_SNIFF_COOKIES_FROM_BROWSER)
    except Exception as err:
        return [], f"Could not read cookies from {config.NETWORK_SNIFF_COOKIES_FROM_BROWSER}: {err}"

    cookies = []
    for cookie in jar:
        domain = cookie.domain.lstrip(".")
        if domain != base_domain and not domain.endswith(f".{base_domain}"):
            continue
        entry = {
            "name": cookie.name,
            "value": cookie.value or "",
            "domain": cookie.domain,
            "path": cookie.path or "/",
            "secure": bool(cookie.secure),
        }
        # Playwright rejects anything but -1 or a positive Unix timestamp
        # in *seconds*. Some cookies come back from yt-dlp's extraction
        # with `expires` still in Chrome's internal epoch (microseconds
        # since 1601-01-01) rather than converted Unix seconds -- e.g.
        # 13465644362561492, which is ~17 digits and would place the
        # cookie's expiry somewhere around the 15th century as a literal
        # Unix timestamp. A sane upper bound (year 2100) catches these;
        # omitting `expires` entirely just makes Playwright treat the
        # cookie as session-only, which is harmless here since these live
        # only for the duration of one sniff, not a persisted session.
        _MAX_SANE_EXPIRES = 4102444800  # 2100-01-01 UTC
        if isinstance(cookie.expires, (int, float)) and 0 < cookie.expires <= _MAX_SANE_EXPIRES:
            entry["expires"] = cookie.expires
        cookies.append(entry)
    return cookies, None


async def _try_trigger_playback(page) -> None:
    """Best-effort: many sites don't request audio/video segments until
    playback is actually triggered by user interaction -- this fallback
    exists for arbitrary sites, not just one, so these are generic
    heuristics rather than a site-specific selector. Every failure here
    is silently swallowed; this is a bonus attempt, not a requirement."""
    try:
        await page.evaluate(
            "document.querySelectorAll('video,audio').forEach(el => el.play().catch(() => {}))"
        )
    except Exception:
        pass

    for selector in (
        'button[aria-label="Play" i]',
        '[aria-label*="play" i]:not([aria-label*="playlist" i])',
        'button:has-text("Play")',
    ):
        try:
            locator = page.locator(selector).first
            if await locator.count() > 0:
                await locator.click(timeout=3000)
                break
        except Exception:
            continue


async def sniff_network(page_url: str) -> tuple[list[StreamDescriptor], list[str], Optional[str]]:
    warnings: list[str] = []
    found: dict[str, dict] = {}  # keyed by url to dedupe

    cookies, cookie_warning = _extract_cookies_for_domain(page_url)
    if cookie_warning:
        warnings.append(cookie_warning)

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        context = await browser.new_context(
            user_agent="Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/124.0 Safari/537.36 DownloadManagerSniffer/0.1"
        )
        if cookies:
            await context.add_cookies(cookies)
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
            await _try_trigger_playback(page)
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

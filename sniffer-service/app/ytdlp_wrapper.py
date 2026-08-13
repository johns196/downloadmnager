"""Primary extraction path: shells out to yt-dlp's JSON dump mode. yt-dlp
maintains extractors for 1800+ sites, so this covers the overwhelming
majority of "grab the audio/video from this page" requests without ever
touching a browser. The Playwright-based network_interceptor is only the
fallback for pages yt-dlp doesn't recognize.

Runs a `yt-dlp` binary via subprocess rather than importing the Python
package as a library, since yt-dlp updates itself (and its site
extractors -- this matters a lot in practice, e.g. YouTube's anti-bot
checks) far more often than this codebase does, and shelling out means an
upgrade is just `pip install --upgrade yt-dlp` with no code change.

Prefers the copy installed in *this* venv (see requirements.txt) over
whatever's on PATH: `pip install --upgrade` inside a user-owned venv
needs no elevated privileges, whereas a system-wide install often does --
see PROGRESS.md for the exact issue this caused.
"""

import asyncio
import json
import shutil
import sys
import uuid
from pathlib import Path
from typing import Optional

from . import config
from .models import StreamDescriptor

_venv_ytdlp = Path(sys.executable).parent / "yt-dlp"
YTDLP_BIN = str(_venv_ytdlp) if _venv_ytdlp.exists() else (shutil.which("yt-dlp") or "yt-dlp")


def _protocol_for(fmt: dict) -> str:
    proto = (fmt.get("protocol") or "").lower()
    if "m3u8" in proto:
        return "hls"
    if "dash" in proto:
        return "dash"
    return "direct"


def _resolution_for(fmt: dict) -> Optional[str]:
    w, h = fmt.get("width"), fmt.get("height")
    return f"{w}x{h}" if w and h else None


def _format_to_stream(fmt: dict, title: Optional[str], thumbnail: Optional[str]) -> Optional[StreamDescriptor]:
    url = fmt.get("url")
    if not url:
        return None
    if fmt.get("format_note") == "storyboard" or fmt.get("protocol") == "mhtml":
        # Storyboards are the thumbnail grids YouTube (and others) use for
        # scrubbing preview -- not downloadable content. They also have
        # vcodec == "none" like real audio-only formats, so without this
        # check they'd get misclassified as audio streams below.
        return None
    is_audio_only = fmt.get("vcodec") == "none"
    codec = fmt.get("acodec") if is_audio_only else fmt.get("vcodec")
    bitrate = fmt.get("tbr") or fmt.get("abr") or fmt.get("vbr")
    return StreamDescriptor(
        id=str(uuid.uuid4()),
        url=url,
        protocol=_protocol_for(fmt),
        container=fmt.get("ext"),
        codec=codec if codec and codec != "none" else None,
        bitrateKbps=float(bitrate) if bitrate else None,
        resolution=_resolution_for(fmt),
        durationSeconds=fmt.get("duration"),
        isAudioOnly=is_audio_only,
        title=title,
        thumbnailUrl=thumbnail,
        extractor="yt-dlp",
    )


def _extra_args() -> list[str]:
    """YouTube-specific flags (see config.py for why each exists) --
    applied unconditionally rather than only for youtube.com URLs, since
    yt-dlp simply ignores flags an extractor doesn't need and detecting
    "is this YouTube" ourselves ahead of extraction would just duplicate
    yt-dlp's own URL matching."""
    args: list[str] = []
    if config.YTDLP_COOKIES_FROM_BROWSER:
        args += ["--cookies-from-browser", config.YTDLP_COOKIES_FROM_BROWSER]
    if config.YTDLP_NODE_PATH:
        args += ["--js-runtimes", f"node:{config.YTDLP_NODE_PATH}"]
    if config.YTDLP_POT_SERVER_BASE_URL:
        args += ["--extractor-args", f"youtubepot-bgutilhttp:base_url={config.YTDLP_POT_SERVER_BASE_URL}"]
    return args


async def extract(page_url: str) -> tuple[list[StreamDescriptor], list[str], Optional[str]]:
    """Returns (streams, warnings, pageTitle). Never raises for
    "this site isn't supported" -- that's a normal, expected outcome that
    the caller treats as "fall back to network sniffing", not an error."""
    proc = await asyncio.create_subprocess_exec(
        YTDLP_BIN,
        "--dump-json",
        "--no-warnings",
        "--no-playlist",
        "--skip-download",
        *_extra_args(),
        page_url,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    try:
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=config.YTDLP_TIMEOUT_SECONDS)
    except asyncio.TimeoutError:
        proc.kill()
        return [], [], None

    if proc.returncode != 0 or not stdout.strip():
        return [], [], None

    try:
        info = json.loads(stdout.decode("utf-8", errors="replace").splitlines()[0])
    except (json.JSONDecodeError, IndexError):
        return [], [], None

    title = info.get("title")
    thumbnail = info.get("thumbnail")
    warnings: list[str] = []
    streams: list[StreamDescriptor] = []

    raw_formats = info.get("formats") or ([info] if info.get("url") else [])
    for fmt in raw_formats:
        if fmt.get("has_drm"):
            warnings.append(f"DRM-protected stream skipped: {fmt.get('format_id', '?')}")
            continue
        stream = _format_to_stream(fmt, title, thumbnail)
        if stream:
            streams.append(stream)

    return streams, warnings, title

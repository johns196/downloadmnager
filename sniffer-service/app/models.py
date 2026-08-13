"""Mirrors the StreamDescriptor / SniffResult shapes frozen in
docs/API.md at the repo root. Keep field names identical -- this is the
Python side of a contract also implemented in backend/src/core/types.ts
and client/lib/models/."""

from typing import Literal, Optional

from pydantic import BaseModel

Protocol = Literal["hls", "dash", "direct", "progressive"]
# "yt-dlp-merge" marks the synthetic "best quality, merged" entry
# ytdlp_wrapper.extract() adds when a site only offers separate silent
# video-only + audio-only formats (near-universal on modern YouTube) --
# its `url` is the *page* url, not a fetchable stream, and grabbing it
# routes to QueueManager.createYtdlpMergeJob instead of a normal download.
Extractor = Literal["yt-dlp", "yt-dlp-merge", "network-sniff"]


class StreamDescriptor(BaseModel):
    id: str
    url: str
    protocol: Protocol
    container: Optional[str] = None
    codec: Optional[str] = None
    bitrateKbps: Optional[float] = None
    resolution: Optional[str] = None
    durationSeconds: Optional[float] = None
    isAudioOnly: bool
    # Distinguishes a real playable audio+video mp4 from a silent
    # video-only DASH stream -- both look identical as isAudioOnly=false
    # without this. Defaults True for network-sniff results: that path
    # doesn't have per-format codec info to determine this accurately, and
    # the sniffed URLs there are generally either pure audio (isAudioOnly
    # already true) or a manifest/mp4 assumed playable as-is, matching
    # this field's pre-existing behavior before it was added.
    hasAudio: bool = True
    title: Optional[str] = None
    thumbnailUrl: Optional[str] = None
    extractor: Extractor


class SniffResult(BaseModel):
    pageUrl: str
    pageTitle: Optional[str] = None
    streams: list[StreamDescriptor]
    warnings: list[str] = []


class SniffRequest(BaseModel):
    url: str


class DownloadMergedRequest(BaseModel):
    url: str
    outputPath: str


class DownloadMergedResult(BaseModel):
    ok: bool
    error: Optional[str] = None

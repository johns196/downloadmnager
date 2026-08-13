"""Mirrors the StreamDescriptor / SniffResult shapes frozen in
docs/API.md at the repo root. Keep field names identical -- this is the
Python side of a contract also implemented in backend/src/core/types.ts
and client/lib/models/."""

from typing import Literal, Optional

from pydantic import BaseModel

Protocol = Literal["hls", "dash", "direct", "progressive"]
Extractor = Literal["yt-dlp", "network-sniff"]


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

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from . import config, ytdlp_wrapper
from .models import SniffRequest, SniffResult

app = FastAPI(title="Download Manager Sniffer Service", version="0.1.0")

# Internal service: only the backend (127.0.0.1:8787) ever calls this.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://127.0.0.1:8787", "http://localhost:8787"],
    allow_methods=["POST"],
    allow_headers=["*"],
)


@app.get("/health")
async def health():
    return {"ok": True}


@app.post("/sniff", response_model=SniffResult)
async def sniff(req: SniffRequest) -> SniffResult:
    if not req.url or not req.url.strip():
        raise HTTPException(status_code=400, detail="url is required")

    streams, warnings, title = await ytdlp_wrapper.extract(req.url)

    if not streams:
        # yt-dlp has no extractor for this page (or it genuinely has no
        # media) -- fall back to passively watching network traffic.
        # Playwright is an optional install (see setup.sh); degrade
        # gracefully with a clear warning instead of a 500 if it's absent.
        try:
            from . import network_interceptor

            streams, network_warnings, network_title = await network_interceptor.sniff_network(req.url)
            warnings += network_warnings
            title = title or network_title
        except ImportError:
            warnings.append(
                "yt-dlp found nothing for this URL and the generic network-sniffing "
                "fallback (Playwright) is not installed yet -- run sniffer-service/setup.sh."
            )

    return SniffResult(pageUrl=req.url, pageTitle=title, streams=streams, warnings=warnings)

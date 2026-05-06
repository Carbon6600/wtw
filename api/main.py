import re
from pathlib import Path
from typing import Any

import httpx
from bs4 import BeautifulSoup
from fastapi import FastAPI, Header, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel, HttpUrl
from playwright.async_api import async_playwright


app = FastAPI(title="w2w extractor")
INDEX_HTML_PATH = Path("/app/index.html")


class ExtractRequest(BaseModel):
    url: HttpUrl


class ExtractResponse(BaseModel):
    inputUrl: HttpUrl
    directUrl: str
    kind: str  # "m3u8" | "mp4" | "embed" | "unknown"
    note: str | None = None


_URL_RE = re.compile(r"""https?://[^\s"'<>]+""", re.IGNORECASE)


def _looks_like_media(url: str) -> str | None:
    u = url.lower()
    if ".m3u8" in u:
        return "m3u8"
    if any(ext in u for ext in [".mp4", ".webm", ".mkv", ".mov"]):
        return "mp4"
    return None


def _is_youtube(url: str) -> bool:
    u = url.lower()
    return "youtube.com" in u or "youtu.be" in u


def _extract_candidates_from_html(html: str, base_url: str) -> list[str]:
    soup = BeautifulSoup(html, "html.parser")

    candidates: list[str] = []

    for v in soup.select("video"):
        src = v.get("src")
        if src:
            candidates.append(src)
        for s in v.select("source"):
            s_src = s.get("src")
            if s_src:
                candidates.append(s_src)

    for iframe in soup.select("iframe"):
        src = iframe.get("src")
        if src:
            candidates.append(src)

    for tag in soup.select("script"):
        txt = tag.string or ""
        if txt:
            candidates.extend(_URL_RE.findall(txt))

    for tag in soup.select("[data-src],[data-file],[data-video],[data-hls],[data-url]"):
        for attr in ["data-src", "data-file", "data-video", "data-hls", "data-url"]:
            v = tag.get(attr)
            if v:
                candidates.append(v)

    # Dedup (keep order)
    seen = set()
    out: list[str] = []
    for c in candidates:
        c = c.strip()
        if not c or c in seen:
            continue
        seen.add(c)
        out.append(c)
    return out


async def _fetch(client: httpx.AsyncClient, url: str) -> str:
    r = await client.get(url, follow_redirects=True)
    r.raise_for_status()
    return r.text


async def _extract_with_browser(page_url: str) -> str | None:
    """
    Some sites expose the HLS playlist only after user interaction (Play).
    We emulate this in a headless browser and capture the first .m3u8 request.
    """
    m3u8_url: str | None = None

    async with async_playwright() as p:
        browser = await p.chromium.launch(
            headless=True,
            args=[
                "--no-sandbox",
                "--disable-dev-shm-usage",
                "--disable-blink-features=AutomationControlled",
            ],
        )
        context = await browser.new_context(
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36"
        )
        page = await context.new_page()

        async def on_request(req):
            nonlocal m3u8_url
            u = req.url
            if m3u8_url is None and ".m3u8" in u.lower():
                m3u8_url = u

        page.on("request", on_request)
        page.on("response", lambda resp: None)  # keep hook for future debugging

        try:
            await page.goto(page_url, wait_until="domcontentloaded", timeout=45000)
            # Give the page some time to load scripts/iframes
            try:
                await page.wait_for_load_state("networkidle", timeout=15000)
            except Exception:
                pass
            await page.wait_for_timeout(1500)

            # Try clicking typical "Play" controls on page or within iframes
            selectors = [
                "button[aria-label*='Play' i]",
                ".jw-icon-play",
                ".jw-display-icon-container",
                ".vjs-big-play-button",
                ".plyr__control--overlaid",
                ".play",
                "[data-play]",
                "video",
            ]

            async def try_click_in_frame(f):
                for sel in selectors:
                    try:
                        await f.click(sel, timeout=1500)
                        await page.wait_for_timeout(800)
                        if m3u8_url:
                            return True
                    except Exception:
                        continue
                return False

            # main frame
            await try_click_in_frame(page)
            if not m3u8_url:
                for frame in page.frames:
                    if frame == page.main_frame:
                        continue
                    ok = await try_click_in_frame(frame)
                    if ok:
                        break

            # keyboard fallback (space = play)
            if not m3u8_url:
                try:
                    await page.keyboard.press("Space")
                except Exception:
                    pass

            # Wait a bit for network after clicks
            for _ in range(20):
                if m3u8_url:
                    break
                await page.wait_for_timeout(500)

            # Last fallback: check rendered HTML for m3u8
            if not m3u8_url:
                try:
                    content = await page.content()
                    m = re.search(r"https?://[^\\s\"'<>]+\\.m3u8[^\\s\"'<>]*", content, flags=re.I)
                    if m:
                        m3u8_url = m.group(0)
                except Exception:
                    pass

            return m3u8_url
        finally:
            await context.close()
            await browser.close()


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/", include_in_schema=False)
async def serve_index() -> FileResponse:
    return FileResponse(INDEX_HTML_PATH)


@app.post("/extract", response_model=ExtractResponse)
@app.post("/api/extract", response_model=ExtractResponse)  # backwards compatible if hit directly
async def extract(req: ExtractRequest, x_w2w_legal_ack: str | None = Header(default=None)) -> Any:
    if x_w2w_legal_ack != "1":
        raise HTTPException(
            status_code=403,
            detail="Legal acknowledgement required. Confirm lawful use before extracting media.",
        )

    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "uk,en;q=0.9",
    }

    timeout = httpx.Timeout(20.0, connect=10.0)
    async with httpx.AsyncClient(headers=headers, timeout=timeout) as client:
        try:
            html = await _fetch(client, str(req.url))
        except httpx.HTTPError as e:
            raise HTTPException(status_code=502, detail=f"Fetch failed: {e}") from e

        candidates = _extract_candidates_from_html(html, str(req.url))

        # Prefer direct media links first
        for c in candidates:
            if _is_youtube(c):
                continue
            kind = _looks_like_media(c)
            if kind:
                return ExtractResponse(inputUrl=req.url, directUrl=c, kind=kind, note="Found direct media URL in page HTML")

        # If not found, try fetching one iframe that looks like player/embed
        embed_candidates = [c for c in candidates if c.lower().startswith("http") and not _is_youtube(c)]

        # Heuristic: pick iframe/embed-like URLs
        likely_embed = []
        for u in embed_candidates:
            ul = u.lower()
            if any(k in ul for k in ["player", "embed", "iframe", "video", "stream"]):
                likely_embed.append(u)

        for u in likely_embed[:2]:
            try:
                html2 = await _fetch(client, u)
            except httpx.HTTPError:
                continue
            candidates2 = _extract_candidates_from_html(html2, u)
            for c in candidates2:
                if _is_youtube(c):
                    continue
                kind = _looks_like_media(c)
                if kind:
                    return ExtractResponse(inputUrl=req.url, directUrl=c, kind=kind, note=f"Found media after following embed: {u}")

        # Last resort: emulate "Play" in a headless browser and capture .m3u8
        # (works for sites where playlist URL appears only after user interaction)
        try:
            m3u8 = await _extract_with_browser(str(req.url))
        except Exception:
            m3u8 = None
        if m3u8:
            return ExtractResponse(inputUrl=req.url, directUrl=m3u8, kind="m3u8", note="Captured HLS playlist from browser network after Play")

        if likely_embed:
            return ExtractResponse(inputUrl=req.url, directUrl=likely_embed[0], kind="embed", note="No direct media found; returning likely embed/player URL")

        raise HTTPException(status_code=404, detail="No media URL candidates found")


@app.get("/{full_path:path}", include_in_schema=False)
async def spa_fallback(full_path: str) -> FileResponse:
    if full_path.startswith("api/") or full_path == "health" or full_path == "extract":
        raise HTTPException(status_code=404, detail="Not found")
    return FileResponse(INDEX_HTML_PATH)


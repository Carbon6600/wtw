import re
from pathlib import Path
from typing import Any
from urllib.parse import urljoin

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
    sources: list[dict[str, str]] | None = None


_URL_RE = re.compile(r"""https?://[^\s"'<>]+""", re.IGNORECASE)
_MEDIA_IN_TEXT_RE = re.compile(
    r"""(?:
        https?:\/\/[^\s"'<>\\]+(?:\.m3u8|\.mp4|\.webm|\.mkv|\.mov)[^\s"'<>\\]*|
        https?:\/\/[^\s"'<>\\]+\.m3u8[^\s"'<>\\]*
    )""",
    re.IGNORECASE | re.VERBOSE,
)
_BROWSER_FIRST_HINTS = ("uakino", "uaserials", "rezka", "hdrezka", "kinogo")
_TRAILER_HINTS = ("trailer", "trailer_", "trailers", "трейлер", "тизер", "teaser")


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


def _normalize_url(candidate: str, base_url: str) -> str | None:
    c = (candidate or "").strip().strip("'\"")
    if not c:
        return None
    if c.startswith(("javascript:", "data:", "blob:", "#")):
        return None
    if c.startswith("\\/\\/"):
        c = "https:" + c
    c = c.replace("\\/", "/")
    return urljoin(base_url, c)


def _extract_media_urls_from_text(text: str, base_url: str) -> list[str]:
    out: list[str] = []
    for raw in _MEDIA_IN_TEXT_RE.findall(text or ""):
        normalized = _normalize_url(raw, base_url)
        if normalized:
            out.append(normalized)
    return out


def _should_try_browser_first(url: str) -> bool:
    u = url.lower()
    return any(h in u for h in _BROWSER_FIRST_HINTS)


def _infer_role(url: str, context: str = "") -> str:
    text = f"{url} {context}".lower()
    if any(h in text for h in _TRAILER_HINTS):
        return "trailer"
    return "movie"


def _pick_primary_source(sources: list[dict[str, str]]) -> dict[str, str]:
    movie = next((s for s in sources if s.get("role") == "movie"), None)
    if movie:
        return movie
    return sources[0]


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
            candidates.extend(_extract_media_urls_from_text(txt, base_url))
        script_src = tag.get("src")
        if script_src:
            candidates.append(script_src)

    for tag in soup.select("[data-src],[data-file],[data-video],[data-hls],[data-url]"):
        for attr in ["data-src", "data-file", "data-video", "data-hls", "data-url"]:
            v = tag.get(attr)
            if v:
                candidates.append(v)

    # Dedup (keep order)
    seen = set()
    out: list[str] = []
    for c in candidates:
        normalized = _normalize_url(c, base_url)
        if not normalized or normalized in seen:
            continue
        seen.add(normalized)
        out.append(normalized)
    return out


async def _fetch(client: httpx.AsyncClient, url: str) -> str:
    r = await client.get(url, follow_redirects=True)
    r.raise_for_status()
    return r.text


async def _extract_from_external_scripts(client: httpx.AsyncClient, html: str, base_url: str) -> list[str]:
    soup = BeautifulSoup(html, "html.parser")
    script_urls: list[str] = []
    for tag in soup.select("script[src]"):
        src = tag.get("src")
        if not src:
            continue
        normalized = _normalize_url(src, base_url)
        if normalized:
            script_urls.append(normalized)

    seen = set()
    candidates: list[str] = []
    for script_url in script_urls[:8]:
        if script_url in seen:
            continue
        seen.add(script_url)
        try:
            js_text = await _fetch(client, script_url)
        except httpx.HTTPError:
            continue
        candidates.extend(_extract_media_urls_from_text(js_text, script_url))

    deduped: list[str] = []
    seen2 = set()
    for c in candidates:
        if c in seen2:
            continue
        seen2.add(c)
        deduped.append(c)
    return deduped


async def _extract_with_browser(page_url: str) -> str | None:
    """
    Some sites expose the HLS playlist only after user interaction (Play).
    We emulate this in a headless browser and capture the first .m3u8 request.
    """
    media_url: str | None = None

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
            nonlocal media_url
            u = req.url
            if media_url is None and _looks_like_media(u):
                media_url = u

        async def on_response(resp):
            nonlocal media_url
            if media_url is not None:
                return
            u = resp.url
            ct = (resp.headers.get("content-type") or "").lower()
            if _looks_like_media(u):
                media_url = u
                return
            if any(x in ct for x in ["application/vnd.apple.mpegurl", "application/x-mpegurl", "video/", "application/octet-stream"]):
                normalized = _normalize_url(u, page_url)
                if normalized:
                    media_url = normalized

        page.on("request", on_request)
        page.on("response", on_response)

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
                        if media_url:
                            return True
                    except Exception:
                        continue
                return False

            # main frame
            await try_click_in_frame(page)
            if not media_url:
                for frame in page.frames:
                    if frame == page.main_frame:
                        continue
                    ok = await try_click_in_frame(frame)
                    if ok:
                        break

            # keyboard fallback (space = play)
            if not media_url:
                try:
                    await page.keyboard.press("Space")
                except Exception:
                    pass

            # Wait a bit for network after clicks
            for _ in range(20):
                if media_url:
                    break
                await page.wait_for_timeout(500)

            # Last fallback: check rendered HTML for media URLs
            if not media_url:
                try:
                    content = await page.content()
                    m = re.search(r"https?://[^\\s\"'<>]+\\.(?:m3u8|mp4|webm|mkv|mov)[^\\s\"'<>]*", content, flags=re.I)
                    if m:
                        media_url = m.group(0)
                except Exception:
                    pass

            return media_url
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
    sources: list[dict[str, str]] = []
    seen_urls: set[str] = set()

    def add_source(url: str, kind: str, role: str, label: str) -> None:
        if url in seen_urls:
            return
        seen_urls.add(url)
        sources.append({"url": url, "kind": kind, "role": role, "label": label})

    async with httpx.AsyncClient(headers=headers, timeout=timeout) as client:
        # Browser-first for domains that frequently hide media behind JS/anti-bot flows.
        if _should_try_browser_first(str(req.url)):
            try:
                browser_media = await _extract_with_browser(str(req.url))
            except Exception:
                browser_media = None
            if browser_media:
                kind = _looks_like_media(browser_media) or "m3u8"
                add_source(browser_media, kind, "movie", "Фільм")

        try:
            html = await _fetch(client, str(req.url))
        except httpx.HTTPError as e:
            # Common bot-protected pages reject direct HTTP client calls.
            status = getattr(getattr(e, "response", None), "status_code", None)
            if status in (401, 403, 429):
                try:
                    browser_media = await _extract_with_browser(str(req.url))
                except Exception:
                    browser_media = None
                if browser_media:
                    kind = _looks_like_media(browser_media) or "m3u8"
                    add_source(browser_media, kind, "movie", "Фільм")
            else:
                raise HTTPException(status_code=502, detail=f"Fetch failed: {e}") from e
            html = ""

        candidates: list[str] = []
        likely_embed: list[str] = []
        if html:
            candidates = _extract_candidates_from_html(html, str(req.url))
            candidates.extend(await _extract_from_external_scripts(client, html, str(req.url)))
            # Dedup after enriching from external scripts
            candidates = list(dict.fromkeys(candidates))

            for c in candidates:
                if _is_youtube(c):
                    continue
                kind = _looks_like_media(c)
                if kind:
                    role = _infer_role(c, str(req.url))
                    label = "Трейлер" if role == "trailer" else "Фільм"
                    add_source(c, kind, role, label)

            # If not found, try fetching one iframe that looks like player/embed
            embed_candidates = [c for c in candidates if c.lower().startswith("http") and not _is_youtube(c)]

            # Heuristic: pick iframe/embed-like URLs
            for u in embed_candidates:
                ul = u.lower()
                if any(k in ul for k in ["player", "embed", "iframe", "video", "stream", "trailer"]):
                    likely_embed.append(u)

            for u in likely_embed[:5]:
                try:
                    html2 = await _fetch(client, u)
                except httpx.HTTPError:
                    continue
                candidates2 = _extract_candidates_from_html(html2, u)
                candidates2.extend(await _extract_from_external_scripts(client, html2, u))
                candidates2 = list(dict.fromkeys(candidates2))
                for c in candidates2:
                    if _is_youtube(c):
                        continue
                    kind = _looks_like_media(c)
                    if kind:
                        role = _infer_role(c, u)
                        label = "Трейлер" if role == "trailer" else "Фільм"
                        add_source(c, kind, role, label)

        # Last resort: emulate "Play" in a headless browser and capture media URL.
        if not sources:
            try:
                browser_media = await _extract_with_browser(str(req.url))
            except Exception:
                browser_media = None
            if browser_media:
                kind = _looks_like_media(browser_media) or "m3u8"
                add_source(browser_media, kind, "movie", "Фільм")

        if sources:
            primary = _pick_primary_source(sources)
            return ExtractResponse(
                inputUrl=req.url,
                directUrl=primary["url"],
                kind=primary["kind"],
                note="Found media candidates with role detection for movie/trailer",
                sources=sources,
            )

        if likely_embed:
            fallback = likely_embed[0]
            return ExtractResponse(
                inputUrl=req.url,
                directUrl=fallback,
                kind="embed",
                note="No direct media found; returning likely embed/player URL",
                sources=[{"url": fallback, "kind": "embed", "role": _infer_role(fallback, str(req.url)), "label": "Плеєр"}],
            )

        raise HTTPException(status_code=404, detail="No media URL candidates found")


@app.get("/{full_path:path}", include_in_schema=False)
async def spa_fallback(full_path: str) -> FileResponse:
    if full_path.startswith("api/") or full_path == "health" or full_path == "extract":
        raise HTTPException(status_code=404, detail="Not found")
    return FileResponse(INDEX_HTML_PATH)


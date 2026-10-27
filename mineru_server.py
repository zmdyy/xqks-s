#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
xqksh-zxxq MinerU proxy.

Production:
    Deploy as a public HTTPS web service (Render blueprint: render.yaml).

Local debugging:
    python -m pip install -r requirements-mineru.txt
    python mineru_server.py
    open http://127.0.0.1:5500/index.html

The browser calls this proxy instead of mineru.net directly, avoiding CORS.
User-supplied MinerU tokens are used only for the current request and are not
persisted by this service.
"""
from __future__ import annotations

import base64
import io
import json
import mimetypes
import os
import re
import time
import zipfile
from pathlib import Path
from urllib.parse import urljoin, urlparse

import requests
from flask import Flask, Response, jsonify, request, send_from_directory

ROOT = Path(__file__).resolve().parent
app = Flask(__name__, static_folder=None)

AGENT = "https://mineru.net/api/v1/agent"
V4 = "https://mineru.net/api/v4"
TIMEOUT = 60
PORT = int(os.environ.get("PORT") or os.environ.get("MINERU_PORT", "5500"))
SERVE_APP = os.environ.get("MINERU_SERVE_APP", "1") != "0"
MAX_UPLOAD_MB = int(os.environ.get("MAX_UPLOAD_MB", "210"))
app.config["MAX_CONTENT_LENGTH"] = MAX_UPLOAD_MB * 1024 * 1024

DEFAULT_ALLOWED_ORIGINS = (
    "https://zmdyy.github.io,"
    "http://127.0.0.1:5500,"
    "http://localhost:5500,"
    "http://127.0.0.1:8765,"
    "http://localhost:8765"
)
ALLOWED_ORIGINS = {
    x.strip().rstrip("/")
    for x in os.environ.get("ALLOWED_ORIGINS", DEFAULT_ALLOWED_ORIGINS).split(",")
    if x.strip()
}


def origin_allowed(origin: str) -> bool:
    if not origin:
        return True
    origin = origin.rstrip("/")
    return "*" in ALLOWED_ORIGINS or origin in ALLOWED_ORIGINS


@app.after_request
def add_headers(resp):
    # Allow the GitHub Pages frontend and local debugging origins.
    # Do not use a wildcard in production: the browser sends a user-provided
    # MinerU token to this proxy for precise parsing.
    origin = (request.headers.get("Origin") or "").rstrip("/")
    if origin and origin_allowed(origin):
        resp.headers["Access-Control-Allow-Origin"] = origin
        resp.headers["Vary"] = "Origin"
    resp.headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization"
    resp.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
    resp.headers["Cache-Control"] = "no-store"
    return resp


@app.route("/health", methods=["GET", "OPTIONS"])
def health():
    return jsonify(
        ok=True,
        service="xqksh-mineru-proxy",
        same_origin=SERVE_APP,
        port=PORT,
        mode="web+proxy" if SERVE_APP else "proxy-only",
    )


def fail(message, status=500, stage=None):
    payload = {"ok": False, "error": str(message)}
    if stage:
        payload["stage"] = stage
    return jsonify(payload), status


def request_json(method, url, *, headers=None, json=None, data=None, timeout=TIMEOUT):
    try:
        r = requests.request(method, url, headers=headers, json=json, data=data, timeout=timeout)
    except requests.RequestException as exc:
        raise RuntimeError(f"连接 MinerU 失败: {exc}") from exc

    body = None
    try:
        body = r.json()
    except Exception:
        body = None

    if not r.ok:
        msg = ""
        if isinstance(body, dict):
            msg = body.get("msg") or body.get("message") or body.get("error") or ""
        if not msg:
            msg = (r.text or "").strip()[:500]
        raise RuntimeError(f"MinerU HTTP {r.status_code}: {msg or r.reason}")
    return r, body


def poll_agent(task_id, timeout=240):
    started = time.time()
    while time.time() - started < timeout:
        _, data = request_json("GET", f"{AGENT}/parse/{task_id}")
        if not isinstance(data, dict) or data.get("code") != 0:
            raise RuntimeError((data or {}).get("msg") or "MinerU Agent query failed")
        item = data.get("data") or {}
        state = item.get("state")
        if state == "done":
            return item
        if state == "failed":
            raise RuntimeError(item.get("err_msg") or "MinerU Agent parse failed")
        time.sleep(1.8)
    raise TimeoutError("MinerU Agent parse timeout")


def get_precise_row(batch_id, token, file_name="", data_id=""):
    headers = {"Authorization": f"Bearer {token}", "Accept": "*/*"}
    _, data = request_json(
        "GET",
        f"{V4}/extract-results/batch/{batch_id}",
        headers=headers,
    )
    if not isinstance(data, dict) or data.get("code") != 0:
        raise RuntimeError((data or {}).get("msg") or "MinerU precise query failed")
    rows = (data.get("data") or {}).get("extract_result") or []
    row = next((x for x in rows if data_id and x.get("data_id") == data_id), None)
    if row is None:
        row = next((x for x in rows if file_name and x.get("file_name") == file_name), None)
    if row is None and rows:
        row = rows[0]
    return row


def poll_precise(batch_id, token, file_name, data_id, timeout=1200):
    started = time.time()
    while time.time() - started < timeout:
        row = get_precise_row(batch_id, token, file_name, data_id)
        if row:
            state = row.get("state")
            if state == "done":
                return row
            if state == "failed":
                raise RuntimeError(row.get("err_msg") or "MinerU precise parse failed")
        time.sleep(2.2)
    raise TimeoutError("MinerU precise parse timeout")


def extract_precise_result(zip_url):
    zip_resp = requests.get(zip_url, timeout=TIMEOUT)
    zip_resp.raise_for_status()
    with zipfile.ZipFile(io.BytesIO(zip_resp.content)) as zf:
        md_names = [n for n in zf.namelist() if re.search(r"(^|/)full\.md$", n, re.I)]
        if not md_names:
            md_names = [n for n in zf.namelist() if n.lower().endswith(".md")]
        if not md_names:
            raise RuntimeError("No Markdown file found in MinerU result ZIP")
        md_name = md_names[0]
        markdown = zf.read(md_name).decode("utf-8", errors="replace")
        # Prefer middle JSON: it carries page dimensions and native geometry.
        names = zf.namelist()
        candidates = [(n, "middle_json", None) for n in names if n.lower().endswith(("_middle.json", "middle_json.json"))]
        candidates += [(n, "content_list", "1000") for n in names if n.lower().endswith(("_content_list.json", "content_list.json"))]
        def has_coordinates(value):
            if isinstance(value, dict):
                if isinstance(value.get("bbox"), list) and len(value["bbox"]) == 4:
                    return True
                return any(has_coordinates(v) for v in value.values())
            if isinstance(value, list):
                return any(has_coordinates(v) for v in value)
            return False

        layout = None
        for name, fmt, coordinates in candidates:
            try:
                data = json.loads(zf.read(name).decode("utf-8"))
                if not has_coordinates(data):
                    continue
                layout = {"format": fmt, "coordinate_system": coordinates, "data": data}
                break
            except (ValueError, UnicodeDecodeError):
                app.logger.warning("MinerU layout JSON could not be read")
        return embed_zip_assets(markdown, zf, md_name), layout

def normalize_remote_markdown_assets(markdown, markdown_url):
    base = urljoin(markdown_url, ".")

    def md_repl(match):
        src = match.group(2).strip()
        if re.match(r"^(?:data:|https?:|blob:)", src, re.I):
            return match.group(0)
        return f"![{match.group(1)}]({urljoin(base, src)})"

    markdown = re.sub(r"!\[([^\]]*)\]\(([^)]+)\)", md_repl, markdown)

    def html_repl(match):
        src = match.group(2).strip()
        if re.match(r"^(?:data:|https?:|blob:)", src, re.I):
            return match.group(0)
        return match.group(1) + urljoin(base, src) + match.group(3)

    return re.sub(
        r"(<img\b[^>]*\bsrc=[\"'])([^\"']+)([\"'][^>]*>)",
        html_repl,
        markdown,
        flags=re.I,
    )


def zip_find(zf, md_name, rel):
    rel = rel.split("#", 1)[0].split("?", 1)[0].lstrip("./")
    md_dir = md_name.rsplit("/", 1)[0] + "/" if "/" in md_name else ""
    candidates = [md_dir + rel, rel]
    names = zf.namelist()
    for name in candidates:
        if name in names:
            return name
    base = rel.rsplit("/", 1)[-1]
    matches = [n for n in names if not n.endswith("/") and n.rsplit("/", 1)[-1] == base]
    return matches[0] if len(matches) == 1 else None


def embed_zip_assets(markdown, zf, md_name):
    refs = []
    pattern = r"!\[[^\]]*\]\(([^)]+)\)|<img\b[^>]*\bsrc=[\"']([^\"']+)[\"'][^>]*>"
    for match in re.finditer(pattern, markdown, re.I):
        src = (match.group(1) or match.group(2) or "").strip()
        if src and not re.match(r"^(?:data:|https?:|blob:)", src, re.I) and src not in refs:
            refs.append(src)

    for src in refs:
        name = zip_find(zf, md_name, src)
        if not name:
            continue
        raw = zf.read(name)
        mime = mimetypes.guess_type(name)[0] or "image/png"
        data_uri = f"data:{mime};base64," + base64.b64encode(raw).decode("ascii")
        markdown = markdown.replace(src, data_uri)
    return markdown


@app.route("/mineru/fetch-asset", methods=["GET", "OPTIONS"])
def fetch_mineru_asset():
    if request.method == "OPTIONS":
        return ("", 204)
    try:
        url = (request.args.get("url") or "").strip()
        if not url:
            return fail("missing url", 400, "asset")
        parsed = urlparse(url)
        allowed_hosts = {
            "cdn-mineru.openxlab.org.cn",
            "mineru.net",
            "www.mineru.net",
        }
        if parsed.scheme != "https" or parsed.hostname not in allowed_hosts:
            return fail("asset host not allowed", 403, "asset")

        r = requests.get(url, timeout=TIMEOUT, allow_redirects=True)
        if not r.ok:
            return fail(f"asset HTTP {r.status_code}", 502, "asset")
        final_host = urlparse(r.url).hostname
        if final_host not in allowed_hosts:
            return fail("asset redirect host not allowed", 403, "asset")

        content_type = r.headers.get("content-type") or mimetypes.guess_type(parsed.path)[0] or "application/octet-stream"
        resp = Response(r.content, status=200, content_type=content_type)
        resp.headers["Content-Length"] = str(len(r.content))
        resp.headers["X-Content-Type-Options"] = "nosniff"
        return resp
    except Exception as exc:
        app.logger.exception("MinerU asset proxy failed")
        return fail(exc, 500, "asset")


@app.route("/mineru/parse-file", methods=["POST", "OPTIONS"])
def parse_file_light():
    if request.method == "OPTIONS":
        return ("", 204)
    try:
        file_obj = request.files.get("file")
        if not file_obj:
            return fail("missing file", 400, "input")
        content = file_obj.read()
        if len(content) > 10 * 1024 * 1024:
            return fail("MinerU light mode file must be <= 10MB", 400, "input")

        _, payload = request_json(
            "POST",
            f"{AGENT}/parse/file",
            headers={"Content-Type": "application/json", "Accept": "*/*"},
            json={
                "file_name": file_obj.filename,
                "language": request.form.get("language", "ch"),
                "enable_table": True,
                "is_ocr": False,
                "enable_formula": True,
            },
        )
        if not isinstance(payload, dict) or payload.get("code") != 0:
            raise RuntimeError((payload or {}).get("msg") or "MinerU upload request failed")

        data = payload.get("data") or {}
        task_id = data.get("task_id")
        upload_url = data.get("file_url")
        if not task_id or not upload_url:
            raise RuntimeError("MinerU did not return task_id/file_url")

        put = requests.put(upload_url, data=content, timeout=TIMEOUT)
        put.raise_for_status()

        result = poll_agent(task_id)
        md_url = result.get("markdown_url")
        if not md_url:
            raise RuntimeError("MinerU did not return markdown_url")
        md_resp = requests.get(md_url, timeout=TIMEOUT)
        md_resp.raise_for_status()
        markdown = normalize_remote_markdown_assets(md_resp.text, md_url)

        return jsonify(
            ok=True,
            markdown=markdown,
            task_id=task_id,
            markdown_url=md_url,
            source="mineru",
        )
    except Exception as exc:
        return fail(exc, 500, "mineru_light")


@app.route("/mineru/precise/start", methods=["POST", "OPTIONS"])
def precise_start():
    if request.method == "OPTIONS":
        return ("", 204)
    try:
        file_obj = request.files.get("file")
        if not file_obj:
            return fail("missing file", 400, "input")
        content = file_obj.read()
        if len(content) > 200 * 1024 * 1024:
            return fail("MinerU precise mode file must be <= 200MB", 400, "input")

        token = (request.form.get("mineru_token") or os.environ.get("MINERU_TOKEN") or "").strip()
        if not token:
            return fail("MinerU precise mode requires mineru_token or MINERU_TOKEN", 400, "auth")

        headers = {
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
            "Accept": "*/*",
        }
        model_version = (request.form.get("model_version") or "vlm").strip()
        if model_version not in {"pipeline", "vlm"}:
            return fail("model_version must be pipeline or vlm", 400, "input")

        data_id = f"xq_{int(time.time() * 1000)}"
        _, payload = request_json(
            "POST",
            f"{V4}/file-urls/batch",
            headers=headers,
            json={
                "files": [{"name": file_obj.filename, "data_id": data_id}],
                "model_version": model_version,
                "language": request.form.get("language", "ch"),
                "enable_table": True,
                "enable_formula": True,
            },
        )
        if not isinstance(payload, dict) or payload.get("code") != 0:
            raise RuntimeError((payload or {}).get("msg") or "MinerU precise upload request failed")

        data = payload.get("data") or {}
        batch_id = data.get("batch_id")
        file_urls = data.get("file_urls") or []
        if not batch_id or not file_urls:
            raise RuntimeError("MinerU did not return batch_id/file_urls")

        put = requests.put(file_urls[0], data=content, timeout=TIMEOUT)
        put.raise_for_status()
        app.logger.info(
            "MinerU precise submitted batch=%s model=%s file=%s",
            batch_id,
            model_version,
            file_obj.filename,
        )

        return jsonify(
            ok=True,
            state="submitted",
            batch_id=batch_id,
            data_id=data_id,
            file_name=file_obj.filename,
            model_version=model_version,
            source="mineru_precise",
        )
    except Exception as exc:
        app.logger.exception("MinerU precise start failed")
        return fail(exc, 500, "mineru_precise_start")


@app.route("/mineru/precise/status", methods=["POST", "OPTIONS"])
def precise_status():
    if request.method == "OPTIONS":
        return ("", 204)
    try:
        token = (request.form.get("mineru_token") or os.environ.get("MINERU_TOKEN") or "").strip()
        batch_id = (request.form.get("batch_id") or "").strip()
        data_id = (request.form.get("data_id") or "").strip()
        file_name = (request.form.get("file_name") or "").strip()
        if not token:
            return fail("missing mineru_token", 400, "auth")
        if not batch_id:
            return fail("missing batch_id", 400, "input")

        row = get_precise_row(batch_id, token, file_name, data_id)
        if not row:
            return jsonify(ok=True, state="waiting", batch_id=batch_id)

        state = row.get("state") or "waiting"
        progress = row.get("extract_progress") or {}
        if state == "failed":
            return fail(row.get("err_msg") or "MinerU precise parse failed", 502, "mineru_precise_status")

        if state != "done":
            return jsonify(
                ok=True,
                state=state,
                batch_id=batch_id,
                extract_progress=progress,
            )

        zip_url = row.get("full_zip_url")
        if not zip_url:
            raise RuntimeError("MinerU did not return full_zip_url")

        markdown, layout = extract_precise_result(zip_url)
        app.logger.info("MinerU precise completed batch=%s", batch_id)
        return jsonify(
            ok=True,
            state="done",
            markdown=markdown,
            layout=layout,
            batch_id=batch_id,
            full_zip_url=zip_url,
            extract_progress=progress,
            source="mineru_precise",
        )
    except Exception as exc:
        app.logger.exception("MinerU precise status failed")
        return fail(exc, 500, "mineru_precise_status")


@app.route("/mineru/parse-file-precise", methods=["POST", "OPTIONS"])
def parse_file_precise():
    if request.method == "OPTIONS":
        return ("", 204)
    try:
        file_obj = request.files.get("file")
        if not file_obj:
            return fail("missing file", 400, "input")
        content = file_obj.read()
        if len(content) > 200 * 1024 * 1024:
            return fail("MinerU precise mode file must be <= 200MB", 400, "input")

        token = (request.form.get("mineru_token") or os.environ.get("MINERU_TOKEN") or "").strip()
        if not token:
            return fail("MinerU precise mode requires mineru_token or MINERU_TOKEN", 400, "auth")

        headers = {
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
            "Accept": "*/*",
        }
        data_id = f"xq_{int(time.time() * 1000)}"

        _, payload = request_json(
            "POST",
            f"{V4}/file-urls/batch",
            headers=headers,
            json={
                "files": [{"name": file_obj.filename, "data_id": data_id}],
                "model_version": "vlm",
                "language": request.form.get("language", "ch"),
                "enable_table": True,
                "enable_formula": True,
            },
        )
        if not isinstance(payload, dict) or payload.get("code") != 0:
            raise RuntimeError((payload or {}).get("msg") or "MinerU precise upload request failed")

        data = payload.get("data") or {}
        batch_id = data.get("batch_id")
        file_urls = data.get("file_urls") or []
        if not batch_id or not file_urls:
            raise RuntimeError("MinerU did not return batch_id/file_urls")

        put = requests.put(file_urls[0], data=content, timeout=TIMEOUT)
        put.raise_for_status()

        result = poll_precise(batch_id, token, file_obj.filename, data_id)
        zip_url = result.get("full_zip_url")
        if not zip_url:
            raise RuntimeError("MinerU did not return full_zip_url")

        markdown, layout = extract_precise_result(zip_url)

        return jsonify(
            ok=True,
            markdown=markdown,
            layout=layout,
            batch_id=batch_id,
            full_zip_url=zip_url,
            source="mineru_precise",
        )
    except Exception as exc:
        return fail(exc, 500, "mineru_precise")


if SERVE_APP:
    @app.route("/", defaults={"path": "index.html"})
    @app.route("/<path:path>")
    def serve_app(path):
        # API routes above remain more specific and win route matching.
        target = ROOT / path
        if target.is_file():
            return send_from_directory(ROOT, path)
        return send_from_directory(ROOT, "index.html")


if __name__ == "__main__":
    mode = "web + MinerU proxy" if SERVE_APP else "MinerU proxy only"
    print(f"xqksh-zxxq {mode}: http://127.0.0.1:{PORT}")
    print(f"Health check: http://127.0.0.1:{PORT}/health")
    app.run(host=os.environ.get("HOST", "127.0.0.1"), port=PORT, debug=False, threaded=True)

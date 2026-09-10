"""
Web UI парсера криптообменников Telegram.
FastAPI + статический фронт. Запуск: uvicorn app:app --port 8000
"""
import asyncio
import json
import os
import time
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from core import discovery, scanner

BASE_DIR = Path(__file__).resolve().parent
load_dotenv(BASE_DIR / ".env")

app = FastAPI(title="Crypto TG Scanner", version="1.0")

# ---------------------------------------------------------------------------
# Состояние
# ---------------------------------------------------------------------------
SCAN_STATE = {
    "running": False,
    "progress": 0,
    "total": 0,
    "current": "",
    "started_at": None,
    "log": [],
    "results": [],
}


def _log(msg: str):
    SCAN_STATE["log"].append({"ts": time.time(), "msg": msg})
    SCAN_STATE["log"] = SCAN_STATE["log"][-200:]


# ---------------------------------------------------------------------------
# API
# ---------------------------------------------------------------------------
@app.get("/", response_class=HTMLResponse)
async def index():
    return (BASE_DIR / "static" / "index.html").read_text(encoding="utf-8")


@app.get("/api/status")
async def status():
    return {
        "state": SCAN_STATE,
        "api_configured": bool(os.getenv("TG_API_ID") and os.getenv("TG_API_HASH")),
        "bots": discovery.load_bots(),
        "results": discovery.load_results(),
    }


@app.post("/api/discover")
async def api_discover():
    """Запускает поиск новых ботов в вебе."""
    loop = asyncio.get_running_loop()
    res = await loop.run_in_executor(None, discovery.run_discovery)
    return res


@app.post("/api/scan")
async def api_scan(body: dict):
    """Запускает скан ботов. body: {amount: "5000", usernames: [...] | null}"""
    if SCAN_STATE["running"]:
        raise HTTPException(400, "Scan already running")

    api_id = int(os.getenv("TG_API_ID", "0"))
    api_hash = os.getenv("TG_API_HASH", "")
    if not api_id or not api_hash:
        raise HTTPException(400, "TG_API_ID/TG_API_HASH не настроены в .env")

    usernames = body.get("usernames") or [b["username"] for b in discovery.load_bots()]
    amount = str(body.get("amount", "5000"))

    if not usernames:
        raise HTTPException(400, "Нет ботов для скана")

    SCAN_STATE.update({
        "running": True,
        "progress": 0,
        "total": len(usernames),
        "current": "",
        "started_at": time.time(),
        "log": [],
        "results": [],
    })
    _log(f"Старт скана: {len(usernames)} ботов, сумма {amount}")

    async def worker():
        try:
            scanner_obj = scanner.TelegramBotScanner(api_id, api_hash)
            await scanner_obj.start()
            for i, u in enumerate(usernames):
                if not SCAN_STATE["running"]:
                    break
                SCAN_STATE["current"] = u
                SCAN_STATE["progress"] = i
                _log(f"[{i+1}/{len(usernames)}] {u}")
                try:
                    r = await scanner_obj.scan_bot(u, amount=amount)
                except Exception as e:
                    r = scanner.BotResult(username=u, status="error", error=str(e))
                SCAN_STATE["results"].append(r.to_dict())
                _log(f"  -> {r.status} | manual={r.has_manual_payment} | pdf={r.has_pdf_check}")
                # сохраняем результаты инкрементально
                results = discovery.load_results()
                results[u] = r.to_dict()
                discovery.save_results(results)
            await scanner_obj.stop()
        except Exception as e:
            _log(f"FATAL: {e}")
        finally:
            SCAN_STATE["running"] = False
            SCAN_STATE["progress"] = SCAN_STATE["total"]
            _log("Скан завершён")

    asyncio.create_task(worker())
    return {"started": True, "total": len(usernames)}


@app.post("/api/stop")
async def api_stop():
    SCAN_STATE["running"] = False
    return {"stopped": True}


@app.get("/api/results")
async def api_results():
    return discovery.load_results()


@app.post("/api/bots/add")
async def api_add_bot(body: dict):
    username = str(body.get("username", "")).strip().lstrip("@").lower()
    if not username:
        raise HTTPException(400, "empty username")
    added = discovery.merge_bots([username])
    return {"added": added, "total": len(discovery.load_bots())}


@app.post("/api/bots/remove")
async def api_remove_bot(body: dict):
    username = str(body.get("username", "")).strip()
    bots = [b for b in discovery.load_bots() if b["username"] != username]
    discovery.save_bots(bots)
    return {"ok": True, "total": len(bots)}


@app.get("/api/bots")
async def api_bots():
    return discovery.load_bots()


# статика
app.mount("/static", StaticFiles(directory=str(BASE_DIR / "static")), name="static")
"""
Ядро парсера: ходит в Telegram-ботов криптообменников через Telethon,
проходит сценарий покупки BTC (ввод суммы + адреса), собирает текст
интерфейса и определяет, есть ли ручной способ оплаты (СБП/карта + PDF-чек).
"""
import asyncio
import json
import re
import time
from dataclasses import dataclass, field, asdict
from pathlib import Path

from telethon import TelegramClient

# ---------------------------------------------------------------------------
# Конфиг
# ---------------------------------------------------------------------------
API_ID = 0          # заполняется из .env
API_HASH = ""       # заполняется из .env
SESSION_DIR = Path(__file__).resolve().parent.parent / "sessions"
SESSION_DIR.mkdir(exist_ok=True)

BTC_ADDR = "bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh"  # тестовый адрес

# Ключевые слова, указывающие на РУЧНУЮ оплату с чеком
MANUAL_SIGNALS = [
    "ручн", "вручн", "manual", "реквизит", "по реквизитам", "перевод на карту",
    "на карту", "сбер", "сбербанк", "тинькофф", "т-банк", "альфа", "сбп",
    "система быстрых", "по номеру телефона", "чек", "скриншот", "квитанц",
    "подтверждени", "приложите", "прикрепите", "pdf", "файл", "оператор",
    "менеджер", "в ручную", "ручная обработка", "ручное подтверждение",
    "ожидает подтверждения", "перевод на счёт", "перевод по сбп",
    "реквизиты для перевода", "платёж", "платеж", "оплатить переводом",
]

# Ключевые слова, указывающие на АВТОМАТИЧЕСКИЙ способ (не наш случай)
AUTO_SIGNALS = [
    "автоматическ", "auto", "мгновен", "instant", "криптобот", "cryptobot",
    "wallet", "кошелёк telegram", "tonkeeper", "по балансу", "внутренний баланс",
    "оплата из баланса", "списание с баланса",
]

# Триггер-фразы, после которых бот обычно показывает способы оплаты
PAYMENT_TRIGGERS = [
    "способы оплаты", "способ оплаты", "методы оплаты", "метод оплаты",
    "выберите способ", "выберите метод", "оплатите", "оплата", "перевод",
    "реквизиты", "выберите вариант", "варианты оплаты", "доступные способы",
]


@dataclass
class BotResult:
    username: str
    status: str = "pending"          # pending|ok|error|no_buy_flow|blocked
    title: str = ""
    has_manual_payment: bool = False
    has_pdf_check: bool = False
    payment_methods: list = field(default_factory=list)
    flow_log: list = field(default_factory=list)   # (шаг, текст) что бот отвечал
    error: str = ""
    scanned_at: float = field(default_factory=time.time)

    def to_dict(self):
        return asdict(self)


class TelegramBotScanner:
    """Обходит список ботов, гоняет сценарий покупки, собирает ответы."""

    def __init__(self, api_id: int, api_hash: str, session_name: str = "scanner"):
        self.api_id = api_id
        self.api_hash = api_hash
        self.client = TelegramClient(str(SESSION_DIR / session_name), api_id, api_hash)

    async def start(self):
        await self.client.start()

    async def stop(self):
        await self.client.disconnect()

    # ------------------------------------------------------------------
    # Сценарий: /start -> /buy -> сумма -> адрес -> собрать способы оплаты
    # ------------------------------------------------------------------
    async def scan_bot(self, username: str, amount: str = "5000", timeout: int = 90) -> BotResult:
        res = BotResult(username=username)
        try:
            entity = await asyncio.wait_for(self.client.get_entity(username), timeout=30)
            res.title = getattr(entity, "title", "") or username
        except Exception as e:
            res.status = "error"
            res.error = f"get_entity: {e}"
            return res

        try:
            async with asyncio.timeout(timeout):
                # 1) /start
                await self._send_and_log(res, "/start", wait=1.5)
                # 2) пробуем /buy или кнопку купить
                await self._send_and_log(res, "/buy", wait=1.5)
                # 3) если бот не понял /buy, попробуем "Купить"
                if not self._looks_like_flow(res):
                    await self._send_and_log(res, "Купить", wait=1.5)
                # 4) сумма
                await self._send_and_log(res, amount, wait=1.5)
                # 5) адрес (если спросит)
                await self._send_and_log(res, BTC_ADDR, wait=2.0)
                # 6) пробуем нажать кнопки "Далее/Продолжить/Оплатить"
                await self._press_buttons(res, max_presses=3)
                # 7) финальный сбор
                await self._collect_payment_methods(res)
        except asyncio.TimeoutError:
            res.status = "error"
            res.error = "timeout"
        except Exception as e:
            res.status = "error"
            res.error = str(e)

        if res.status != "error":
            res.status = "ok" if res.has_manual_payment else "no_buy_flow"
        return res

    async def _send_and_log(self, res: BotResult, text: str, wait: float = 1.0):
        try:
            await self.client.send_message(res.username, text)
            await asyncio.sleep(wait)
            msgs = await self._get_recent_messages(res.username)
            for m in msgs:
                res.flow_log.append({"step": text, "text": m[:500]})
        except Exception as e:
            res.flow_log.append({"step": text, "error": str(e)})

    async def _get_recent_messages(self, username: str, limit: int = 8):
        out = []
        try:
            async for msg in self.client.iter_messages(username, limit=limit):
                if msg.out:
                    continue
                txt = msg.text or ""
                if txt:
                    out.append(txt)
                if msg.buttons:
                    for row in msg.buttons:
                        for btn in row:
                            out.append(f"[BUTTON] {btn.text}")
        except Exception:
            pass
        return out

    async def _press_buttons(self, res: BotResult, max_presses: int = 3):
        """Ищем кнопки Далее/Продолжить/Оплатить/Подтвердить и жмём."""
        for _ in range(max_presses):
            try:
                msgs = await self._get_recent_messages(res.username, limit=3)
                pressed = False
                for m in msgs:
                    if m.startswith("[BUTTON]") and re.search(
                        r"далее|продолж|оплат|подтверд|купить|обменять|выбрать", m, re.I
                    ):
                        btn_text = m.replace("[BUTTON] ", "")
                        await self.client.send_message(res.username, btn_text)
                        await asyncio.sleep(1.5)
                        pressed = True
                        res.flow_log.append({"step": f"press_button:{btn_text}", "text": "pressed"})
                if not pressed:
                    break
            except Exception:
                break

    def _looks_like_flow(self, res: BotResult) -> bool:
        joined = " ".join(x.get("text", "") for x in res.flow_log).lower()
        return any(k in joined for k in ["сумм", "адрес", "btc", "биткоин", "купить", "обмен"])

    # ------------------------------------------------------------------
    # Анализ собранного текста
    # ------------------------------------------------------------------
    async def _collect_payment_methods(self, res: BotResult):
        joined = " ".join(x.get("text", "") for x in res.flow_log).lower()
        # ищем способы оплаты
        methods = set()
        for kw in ["сбп", "карта", "сбер", "тинькофф", "альфа", "реквизит",
                   "баланс", "криптобот", "ton", "usdt", "автоматическ", "ручн"]:
            if kw in joined:
                methods.add(kw)
        res.payment_methods = sorted(methods)

        # ручная оплата?
        manual_hits = [s for s in MANUAL_SIGNALS if s in joined]
        res.has_manual_payment = len(manual_hits) >= 2 or any(
            s in joined for s in ["ручн", "реквизит", "на карту", "сбп", "приложите", "чек"]
        )
        # PDF-чек?
        res.has_pdf_check = any(s in joined for s in ["pdf", "чек", "скриншот", "квитанц", "файл"])

        # лог для отладки
        res.flow_log.append({
            "step": "ANALYSIS",
            "text": f"manual={res.has_manual_payment} pdf={res.has_pdf_check} methods={res.payment_methods}"
        })


async def scan_list(api_id: int, api_hash: str, usernames: list, amount: str = "5000") -> list:
    scanner = TelegramBotScanner(api_id, api_hash)
    await scanner.start()
    results = []
    for u in usernames:
        print(f"[SCAN] {u} ...")
        r = await scanner.scan_bot(u, amount=amount)
        results.append(r.to_dict())
        print(f"  -> {r.status} | manual={r.has_manual_payment} | pdf={r.has_pdf_check} | methods={r.payment_methods}")
    await scanner.stop()
    return results


if __name__ == "__main__":
    import os
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).resolve().parent.parent.parent / ".env")
    api_id = int(os.getenv("TG_API_ID", "0"))
    api_hash = os.getenv("TG_API_HASH", "")
    bots = [b.strip() for b in os.getenv("BOTS", "").split(",") if b.strip()]
    if not api_id or not api_hash:
        print("Нет TG_API_ID/TG_API_HASH в .env")
    elif not bots:
        print("Нет BOTS в .env")
    else:
        asyncio.run(scan_list(api_id, api_hash, bots))
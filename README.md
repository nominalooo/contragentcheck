# ContragentCheck — проверка бизнеса по ИНН

Telegram бот проверяет компании и ИП по ИНН через открытые государственные источники. Полный отчёт за 10 секунд.

## Что проверяет

| Источник | Данные |
|----------|--------|
| ЕГРЮЛ/ЕГРИП (nalog.ru) | Реквизиты, статус, директор, дата регистрации |
| ФНС | Налоговые долги свыше 1 000 ₽ |
| КАД Арбитр | Арбитражные дела, суммы исков |
| Федресурс | Процедуры банкротства |

## Тарифы

| | Бесплатно | Разовая | Подписка |
|--|-----------|---------|----------|
| Цена | 0 ₽ | 199 ₽ | 990 ₽/мес |
| Проверок | 1 | 1 | Безлимит |

## Стек

- Telegraf (Node.js 20)
- Supabase (PostgreSQL)
- YooKassa
- Render.com / Railway

## Быстрый старт

```bash
git clone https://github.com/nominalooo/contragentcheck.git
cd contragentcheck
npm install
cp .env.example .env
# Заполнить .env
```

Выполнить `src/db/schema.sql` в Supabase SQL Editor, затем:

```bash
npm run dev
```

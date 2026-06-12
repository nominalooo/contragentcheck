require('dotenv').config();
const express = require('express');
const bot = require('./bot');
const webhookRouter = require('./api/routes/webhook');
const logger = require('./logger');

const app = express();
const PORT = process.env.PORT || 8080;

app.get('/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

app.get('/payment/success', (req, res) => {
  res.send(`<!DOCTYPE html><html lang="ru"><head><meta charset="UTF-8"><title>Оплата прошла</title>
  <style>body{font-family:sans-serif;display:flex;align-items:center;justify-content:center;
  min-height:100vh;margin:0;background:#f0fdf4;}
  .card{background:white;padding:40px;border-radius:16px;box-shadow:0 4px 24px rgba(0,0,0,.08);max-width:400px;text-align:center;}
  h1{color:#16a34a;}p{color:#374151;line-height:1.6;}a{color:#16a34a;font-weight:bold;}</style>
  </head><body><div class="card"><h1>✅ Оплата прошла!</h1>
  <p>Вернитесь в Telegram — доступ активирован.</p>
  <p><a href="https://t.me/${process.env.BOT_USERNAME || 'ContragentCheckBot'}">← Открыть бота</a></p>
  </div></body></html>`);
});

app.use('/', webhookRouter);

app.listen(PORT, () => logger.info(`Server running on port ${PORT}`));

bot.launch({ dropPendingUpdates: true });
logger.info('Bot launched in polling mode');

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

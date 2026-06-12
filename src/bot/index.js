require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');
const {
  getOrCreateUser, getUser, canCheck, incrementFreeChecks,
  saveCheck, getUserChecks, hasPaidForInn
} = require('../db/queries');
const { quickCheck, fullCheck, formatPreview, formatFullReport } = require('../checkers');
const { createYookassaPayment } = require('../payments');
const logger = require('../logger');

const bot = new Telegraf(process.env.BOT_TOKEN);

function isValidInn(inn) {
  return /^\d{10}$|^\d{12}$/.test(inn.trim());
}

// ─── /start ───────────────────────────────────────────────────────────────
bot.start(async (ctx) => {
  await getOrCreateUser(ctx.from.id, ctx.from.username);
  await ctx.replyWithMarkdown(
    `🔍 *ContragentCheck*\n\n` +
    `Проверяю компании и ИП по ИНН.\n\n` +
    `*Бесплатно:* название, статус, дата регистрации\n` +
    `*300 ₽:* полный отчёт — налоги, суды, банкротство, госконтракты, риск-скор\n\n` +
    `Введите ИНН (10 или 12 цифр):`,
    Markup.inlineKeyboard([
      [Markup.button.callback('📋 Мои проверки', 'my_checks')]
    ])
  );
});

// ─── Мои проверки ─────────────────────────────────────────────────────────
bot.action('my_checks', async (ctx) => {
  await ctx.answerCbQuery();
  const user = await getUser(ctx.from.id);
  if (!user) return ctx.reply('Напишите /start');
  const checks = await getUserChecks(user.id);
  if (checks.length === 0) return ctx.reply('Проверок пока нет. Введите ИНН.');

  let text = '📋 *Последние проверки:*\n\n';
  for (const c of checks) {
    const date = new Date(c.created_at).toLocaleDateString('ru-RU');
    text += `• ИНН ${c.inn} — ${c.company_name || '—'}\n`;
    text += `  ${date} · Риск: ${c.risk_level || '—'}\n\n`;
  }
  await ctx.replyWithMarkdown(text);
});

// ─── Обработка ИНН ────────────────────────────────────────────────────────
bot.on('text', async (ctx) => {
  const text = ctx.message.text.trim();
  if (text.startsWith('/')) return;

  const inn = text.replace(/\s/g, '');

  if (!isValidInn(inn)) {
    return ctx.replyWithMarkdown(
      `❌ Не похоже на ИНН.\n\n` +
      `ИНН компании: 10 цифр\n` +
      `ИНН ИП: 12 цифр\n\n` +
      `Пример: \`7707083893\``
    );
  }

  const user = await getOrCreateUser(ctx.from.id, ctx.from.username);

  // Check if user already paid for this INN
  const alreadyPaid = await hasPaidForInn(user.id, inn);
  if (alreadyPaid) {
    const loading = await ctx.reply('🔍 Загружаю полный отчёт...');
    const result = await fullCheck(inn);
    await ctx.telegram.deleteMessage(ctx.chat.id, loading.message_id).catch(() => {});
    return ctx.replyWithMarkdown(formatFullReport(result));
  }

  // Free preview
  const loading = await ctx.reply('🔍 Ищу по ЕГРЮЛ...');
  try {
    const { company } = await quickCheck(inn);
    await ctx.telegram.deleteMessage(ctx.chat.id, loading.message_id).catch(() => {});

    if (!company) {
      return ctx.replyWithMarkdown(`❌ ИНН *${inn}* не найден в ЕГРЮЛ/ЕГРИП`);
    }

    await ctx.replyWithMarkdown(
      formatPreview(inn, company),
      Markup.inlineKeyboard([
        [Markup.button.callback(`🔓 Получить полный отчёт — 300 ₽`, `pay_${inn}`)]
      ])
    );
  } catch (e) {
    await ctx.telegram.deleteMessage(ctx.chat.id, loading.message_id).catch(() => {});
    logger.error('Quick check failed', { inn, error: e.message });
    await ctx.reply(`Ошибка: ${e.message}`);
  }
});

// ─── Оплата за конкретный ИНН ─────────────────────────────────────────────
bot.action(/^pay_(\d+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const inn = ctx.match[1];
  const user = await getUser(ctx.from.id);
  if (!user) return ctx.reply('Напишите /start');

  try {
    const url = await createYookassaPayment(user.id, inn, ctx.from.id);
    await ctx.replyWithMarkdown(
      `💳 Оплата полного отчёта по ИНН *${inn}*\nСтоимость: *300 ₽*`,
      Markup.inlineKeyboard([[Markup.button.url('Оплатить 300 ₽', url)]])
    );
  } catch (e) {
    logger.error('Payment error', { error: e.message });
    await ctx.reply('Ошибка создания платежа. Попробуйте позже.');
  }
});

module.exports = bot;

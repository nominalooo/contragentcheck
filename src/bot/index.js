require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');
const {
  getOrCreateUser, getUser,
  saveCheck, getUserChecks, hasPaidForInn, createPayment
} = require('../db/queries');
const { quickCheck, fullCheck, formatPreview, formatFullReport } = require('../checkers');
const logger = require('../logger');

// 300 RUB = 300 Telegram Stars (1 Star ≈ 1 RUB in Russia)
const PRICE_STARS = 300;

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

// ─── Оплата через Telegram Stars ─────────────────────────────────────────
bot.action(/^pay_(\d+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const inn = ctx.match[1];

  await ctx.replyWithInvoice({
    title: `Отчёт по ИНН ${inn}`,
    description: 'Полный отчёт: налоги, суды, банкротство, госконтракты, риск-скор',
    payload: `report_${inn}`,
    currency: 'XTR',
    prices: [{ label: 'Полный отчёт', amount: PRICE_STARS }],
    provider_token: ''  // empty = Telegram Stars
  });
});

// ─── Pre-checkout (обязательно отвечать OK) ───────────────────────────────
bot.on('pre_checkout_query', async (ctx) => {
  await ctx.answerPreCheckoutQuery(true);
});

// ─── Успешная оплата ──────────────────────────────────────────────────────
bot.on('successful_payment', async (ctx) => {
  const payload = ctx.message.successful_payment.invoice_payload;
  const inn = payload.replace('report_', '');
  const user = await getOrCreateUser(ctx.from.id, ctx.from.username);

  // Save payment to DB
  await createPayment({
    user_id: user.id,
    inn,
    amount: PRICE_STARS,
    status: 'succeeded',
    yookassa_payment_id: `stars_${ctx.message.successful_payment.telegram_payment_charge_id}`
  }).catch(() => {});

  const loading = await ctx.reply('✅ Оплата получена! Генерирую полный отчёт...');

  try {
    const result = await fullCheck(inn);
    const report = formatFullReport(result);

    const risks = [
      !result.company?.isActive,
      result.taxDebt?.hasDebt === true,
      result.bankruptcy?.isBankrupt,
      (result.arbitr?.total || 0) > 20
    ].filter(Boolean).length;
    const riskLevel = risks === 0 ? '🟢 Низкий' : risks === 1 ? '🟡 Средний' : '🔴 Высокий';

    await saveCheck({
      user_id: user.id,
      inn,
      company_name: result.company?.name || null,
      result,
      risk_level: riskLevel
    }).catch(() => {});

    await ctx.telegram.deleteMessage(ctx.chat.id, loading.message_id).catch(() => {});

    if (report.length > 4000) {
      await ctx.replyWithMarkdown(report.slice(0, 4000));
      await ctx.replyWithMarkdown(report.slice(4000));
    } else {
      await ctx.replyWithMarkdown(report);
    }
  } catch (e) {
    await ctx.telegram.deleteMessage(ctx.chat.id, loading.message_id).catch(() => {});
    logger.error('Full check after payment failed', { inn, error: e.message });
    await ctx.reply(`Ошибка при генерации отчёта: ${e.message}`);
  }
});

module.exports = bot;

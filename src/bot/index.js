require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');
const { getOrCreateUser, getUser, canCheck, incrementFreeChecks, saveCheck, getUserChecks } = require('../db/queries');
const { fullCheck, formatReport } = require('../checkers');
const { createYookassaPayment } = require('../payments');
const logger = require('../logger');

const bot = new Telegraf(process.env.BOT_TOKEN);

function isValidInn(inn) {
  return /^\d{10}$|^\d{12}$/.test(inn.trim());
}

// ─── /start ───────────────────────────────────────────────────────────────
bot.start(async (ctx) => {
  const user = await getOrCreateUser(ctx.from.id, ctx.from.username);
  const hasFree = user.free_checks_used < 1;

  await ctx.replyWithMarkdown(
    `🔍 *ContragentCheck* — проверка бизнеса по ИНН\n\n` +
    `Проверяю по 4 источникам:\n` +
    `• ЕГРЮЛ/ЕГРИП — реквизиты и статус\n` +
    `• ФНС — налоговые долги\n` +
    `• КАД Арбитр — судебные дела\n` +
    `• Федресурс — банкротство\n\n` +
    `${hasFree ? '🆓 *Первая проверка бесплатно.*' : '💳 Бесплатная проверка использована.'}\n\n` +
    `Введите ИНН компании или ИП (10 или 12 цифр):`,
    Markup.inlineKeyboard([
      [Markup.button.callback('📋 Мои проверки', 'my_checks')],
      [Markup.button.callback('💰 Тарифы', 'plans')]
    ])
  );
});

// ─── Тарифы ───────────────────────────────────────────────────────────────
bot.action('plans', async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.replyWithMarkdown(
    `💰 *Тарифы ContragentCheck*\n\n` +
    `🆓 *Бесплатно* — 1 проверка\n\n` +
    `🔍 *Разовая проверка* — 199 ₽\n` +
    `  Полный отчёт по одному ИНН\n\n` +
    `📦 *Подписка* — 990 ₽/мес\n` +
    `  Безлимитные проверки\n` +
    `  История всех отчётов\n` +
    `  Мониторинг изменений`,
    Markup.inlineKeyboard([
      [Markup.button.callback('Купить проверку — 199 ₽', 'buy_single')],
      [Markup.button.callback('Подписка — 990 ₽/мес', 'buy_sub')]
    ])
  );
});

bot.action('buy_single', async (ctx) => {
  await ctx.answerCbQuery();
  await handlePayment(ctx, 'single_check');
});

bot.action('buy_sub', async (ctx) => {
  await ctx.answerCbQuery();
  await handlePayment(ctx, 'subscription_month');
});

async function handlePayment(ctx, product) {
  const user = await getUser(ctx.from.id);
  if (!user) return ctx.reply('Напишите /start');
  try {
    const url = await createYookassaPayment(user.id, product, ctx.from.id);
    const labels = { single_check: 'Оплатить 199 ₽', subscription_month: 'Оплатить 990 ₽/мес' };
    await ctx.replyWithMarkdown(
      '💳 Перейдите к оплате:',
      Markup.inlineKeyboard([[Markup.button.url(labels[product], url)]])
    );
  } catch (e) {
    await ctx.reply('Ошибка создания платежа. Попробуйте позже.');
    logger.error('Payment error', { error: e.message });
  }
}

// ─── Мои проверки ─────────────────────────────────────────────────────────
bot.action('my_checks', async (ctx) => {
  await ctx.answerCbQuery();
  const user = await getUser(ctx.from.id);
  if (!user) return ctx.reply('Напишите /start');

  const checks = await getUserChecks(user.id);
  if (checks.length === 0) return ctx.reply('Проверок пока нет. Введите ИНН чтобы начать.');

  let text = '📋 *Последние проверки:*\n\n';
  for (const c of checks) {
    const date = new Date(c.created_at).toLocaleDateString('ru-RU');
    const risk = c.risk_level || '—';
    text += `• ИНН ${c.inn} — ${c.company_name || 'Неизвестно'}\n`;
    text += `  ${date} · Риск: ${risk}\n\n`;
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
      `❌ *${inn}* — не похоже на ИНН.\n\n` +
      `ИНН компании: 10 цифр\n` +
      `ИНН ИП: 12 цифр\n\n` +
      `Пример: \`7707083893\``
    );
  }

  const user = await getOrCreateUser(ctx.from.id, ctx.from.username);
  const allowed = await canCheck(user);

  if (!allowed) {
    return ctx.replyWithMarkdown(
      `❌ *Бесплатная проверка уже использована*\n\nВыберите тариф:`,
      Markup.inlineKeyboard([
        [Markup.button.callback('🔍 Проверка — 199 ₽', 'buy_single')],
        [Markup.button.callback('📦 Подписка — 990 ₽/мес', 'buy_sub')]
      ])
    );
  }

  const loadingMsg = await ctx.replyWithMarkdown(`🔍 Проверяю ИНН *${inn}*...\n_Это займёт 5-10 секунд_`);

  try {
    const result = await fullCheck(inn);

    if (user.free_checks_used < 1) await incrementFreeChecks(user.id);

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
    });

    await ctx.telegram.deleteMessage(ctx.chat.id, loadingMsg.message_id).catch(() => {});

    const report = formatReport(result);
    await ctx.replyWithMarkdown(report, Markup.inlineKeyboard([
      [Markup.button.callback('🔍 Проверить ещё', 'prompt_inn')],
      [Markup.button.callback('📋 Мои проверки', 'my_checks')]
    ]));

  } catch (e) {
    await ctx.telegram.deleteMessage(ctx.chat.id, loadingMsg.message_id).catch(() => {});
    logger.error('Check failed', { inn, error: e.message });
    await ctx.reply(`Ошибка при проверке: ${e.message}`);
  }
});

bot.action('prompt_inn', async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.reply('Введите ИНН для проверки:');
});

module.exports = bot;

const express = require('express');
const { updatePaymentStatus, createPayment, getUserByTelegramId } = require('../../db/queries');
const { fullCheck, formatFullReport } = require('../../checkers');
const { saveCheck } = require('../../db/queries');
const { verifyRobokassaResult } = require('../../payments');
const bot = require('../../bot');
const logger = require('../../logger');

const router = express.Router();
router.use(express.json());
router.use(express.urlencoded({ extended: true }));

// ─── Robokassa result webhook (called when payment confirmed) ─────────────
router.post('/robokassa', async (req, res) => {
  const { OutSum, InvId, SignatureValue, inn, telegram_id, user_id } = req.body;

  const pass2 = process.env.ROBOKASSA_PASS2;
  if (!verifyRobokassaResult(OutSum, InvId, pass2, SignatureValue)) {
    logger.warn('Robokassa: invalid signature', { InvId });
    return res.send('error: bad signature');
  }

  try {
    await updatePaymentStatus(`robokassa_${InvId}`, 'succeeded');

    if (telegram_id && inn) {
      await sendReportToUser(telegram_id, user_id, inn);
    }

    // Robokassa requires this exact response
    res.send(`OK${InvId}`);
  } catch (e) {
    logger.error('Robokassa webhook error', { error: e.message });
    res.send(`error: ${e.message}`);
  }
});

// ─── Helper: send full report to user via bot ─────────────────────────────
async function sendReportToUser(telegramId, userId, inn) {
  await bot.telegram.sendMessage(telegramId, `✅ Оплата подтверждена! Генерирую отчёт по ИНН ${inn}...`);

  const result = await fullCheck(inn);
  const report = formatFullReport(result);

  const risks = [
    !result.company?.isActive,
    result.taxDebt?.hasDebt === true,
    result.bankruptcy?.isBankrupt,
    (result.arbitr?.total || 0) > 20
  ].filter(Boolean).length;

  if (userId) {
    await saveCheck({
      user_id: userId,
      inn,
      company_name: result.company?.name || null,
      result,
      risk_level: risks === 0 ? '🟢 Низкий' : risks === 1 ? '🟡 Средний' : '🔴 Высокий'
    }).catch(() => {});
  }

  if (report.length > 4000) {
    await bot.telegram.sendMessage(telegramId, report.slice(0, 4000), { parse_mode: 'Markdown' });
    await bot.telegram.sendMessage(telegramId, report.slice(4000), { parse_mode: 'Markdown' });
  } else {
    await bot.telegram.sendMessage(telegramId, report, { parse_mode: 'Markdown' });
  }
}

module.exports = router;

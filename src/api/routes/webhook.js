const express = require('express');
const { updatePaymentStatus } = require('../../db/queries');
const { fullCheck, formatFullReport } = require('../../checkers');
const { saveCheck } = require('../../db/queries');
const bot = require('../../bot');
const logger = require('../../logger');

const router = express.Router();
router.use(express.json());

router.post('/yookassa', async (req, res) => {
  const event = req.body;
  if (event.type !== 'payment.succeeded') return res.sendStatus(200);

  const { inn, telegram_id, user_id } = event.object.metadata || {};

  try {
    await updatePaymentStatus(event.object.id, 'succeeded');

    if (telegram_id && inn) {
      await bot.telegram.sendMessage(telegram_id, `✅ Оплата прошла! Генерирую полный отчёт по ИНН ${inn}...`);

      const result = await fullCheck(inn);
      const report = formatFullReport(result);

      const risks = [
        !result.company?.isActive,
        result.taxDebt?.hasDebt === true,
        result.bankruptcy?.isBankrupt,
        (result.arbitr?.total || 0) > 20
      ].filter(Boolean).length;
      const riskLevel = risks === 0 ? '🟢 Низкий' : risks === 1 ? '🟡 Средний' : '🔴 Высокий';

      if (user_id) {
        await saveCheck({
          user_id,
          inn,
          company_name: result.company?.name || null,
          result,
          risk_level: riskLevel
        }).catch(() => {});
      }

      // Split long message if needed
      if (report.length > 4000) {
        await bot.telegram.sendMessage(telegram_id, report.slice(0, 4000), { parse_mode: 'Markdown' });
        await bot.telegram.sendMessage(telegram_id, report.slice(4000), { parse_mode: 'Markdown' });
      } else {
        await bot.telegram.sendMessage(telegram_id, report, { parse_mode: 'Markdown' });
      }
    }

    res.sendStatus(200);
  } catch (e) {
    logger.error('Webhook error', { error: e.message });
    res.sendStatus(500);
  }
});

module.exports = router;

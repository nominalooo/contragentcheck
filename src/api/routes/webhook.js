const express = require('express');
const { updatePaymentStatus, activateSubscription } = require('../../db/queries');
const bot = require('../../bot');
const logger = require('../../logger');

const router = express.Router();
router.use(express.json());

router.post('/yookassa', async (req, res) => {
  const event = req.body;
  if (event.type !== 'payment.succeeded') return res.sendStatus(200);

  const { product, telegram_id, user_id } = event.object.metadata || {};

  try {
    await updatePaymentStatus(event.object.id, 'succeeded');
    if (product === 'subscription_month' && user_id) await activateSubscription(user_id);

    if (telegram_id) {
      const msg = product === 'subscription_month'
        ? '✅ Подписка активирована на месяц! Безлимитные проверки доступны.'
        : '✅ Оплата прошла! Проверка активирована — введите ИНН.';
      await bot.telegram.sendMessage(telegram_id, msg);
    }
    res.sendStatus(200);
  } catch (e) {
    logger.error('Webhook error', { error: e.message });
    res.sendStatus(500);
  }
});

module.exports = router;

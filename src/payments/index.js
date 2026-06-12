const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const { createPayment } = require('../db/queries');

const PRODUCTS = {
  single_check: { amount: 199, label: 'Одна проверка' },
  subscription_month: { amount: 990, label: 'Подписка на 1 месяц' }
};

async function createYookassaPayment(userId, product, telegramId) {
  const p = PRODUCTS[product];
  if (!p) throw new Error('Unknown product');

  const { data } = await axios.post(
    'https://api.yookassa.ru/v3/payments',
    {
      amount: { value: `${p.amount}.00`, currency: 'RUB' },
      confirmation: { type: 'redirect', return_url: `${process.env.APP_URL}/payment/success` },
      capture: true,
      description: `ContragentCheck — ${p.label}`,
      metadata: { product, user_id: userId, telegram_id: String(telegramId) }
    },
    {
      auth: { username: process.env.YOOKASSA_SHOP_ID, password: process.env.YOOKASSA_SECRET_KEY },
      headers: { 'Idempotence-Key': uuidv4() }
    }
  );

  await createPayment({ user_id: userId, yookassa_payment_id: data.id, amount: p.amount, product, status: 'pending' });
  return data.confirmation.confirmation_url;
}

module.exports = { createYookassaPayment };

const axios = require('axios');
const crypto = require('crypto');
const QRCode = require('qrcode');
const { createPayment } = require('../db/queries');

// ─── Robokassa SBP ────────────────────────────────────────────────────────
// Registration (free, works for самозанятый): robokassa.ru
// Settings → Technical Settings → get MerchantLogin, Password1, Password2

function robokassaSign(login, amount, invId, password) {
  return crypto
    .createHash('md5')
    .update(`${login}:${amount}:${invId}:${password}`)
    .digest('hex')
    .toUpperCase();
}

async function createSbpPayment(userId, inn, invId) {
  const login = process.env.ROBOKASSA_LOGIN;
  const pass1 = process.env.ROBOKASSA_PASS1;
  const amount = '300.00';

  const signature = robokassaSign(login, amount, invId, pass1);

  // Robokassa payment link with SBP method
  const params = new URLSearchParams({
    MerchantLogin: login,
    OutSum: amount,
    InvId: invId,
    Description: `Отчёт по ИНН ${inn}`,
    SignatureValue: signature,
    Encoding: 'utf-8',
    IncCurrLabel: 'SBPQR',   // force SBP payment method
    IsTest: process.env.NODE_ENV === 'production' ? '0' : '1'
  });

  const paymentUrl = `https://auth.robokassa.ru/Merchant/Index.aspx?${params.toString()}`;

  await createPayment({
    user_id: userId,
    inn,
    amount: 300,
    status: 'pending',
    yookassa_payment_id: `robokassa_${invId}`
  });

  return paymentUrl;
}

async function generateQrBuffer(url) {
  return QRCode.toBuffer(url, {
    type: 'image/png',
    width: 400,
    margin: 2,
    color: { dark: '#000000', light: '#ffffff' }
  });
}

// Verify Robokassa webhook signature
function verifyRobokassaResult(outSum, invId, pass2, receivedSignature) {
  const expected = crypto
    .createHash('md5')
    .update(`${outSum}:${invId}:${pass2}`)
    .digest('hex')
    .toUpperCase();
  return expected === receivedSignature.toUpperCase();
}

// Check payment status via Robokassa XML API
async function checkRobokassaStatus(invId) {
  const login = process.env.ROBOKASSA_LOGIN;
  const pass2 = process.env.ROBOKASSA_PASS2;
  const signature = crypto.createHash('md5').update(`${login}:${invId}:${pass2}`).digest('hex');

  const { data } = await axios.get('https://merchant.robokassa.ru/Merchant/WebService/Service.asmx/OpStateExt', {
    params: { MerchantLogin: login, InvoiceID: invId, Signature: signature },
    timeout: 10000
  });

  // Response contains <StateCode> — 100 = success
  return String(data).includes('<StateCode>100</StateCode>');
}

module.exports = { createSbpPayment, generateQrBuffer, verifyRobokassaResult, checkRobokassaStatus };

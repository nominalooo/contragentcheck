const axios = require('axios');

// fedresurs.ru — federal bankruptcy registry, open API
async function checkBankruptcy(inn) {
  try {
    const { data } = await axios.get(
      'https://fedresurs.ru/backend/companies',
      {
        params: { searchString: inn, limit: 5, offset: 0 },
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'application/json',
          'Referer': 'https://fedresurs.ru/'
        },
        timeout: 15000
      }
    );

    const companies = data?.data || [];
    if (companies.length === 0) return { isBankrupt: false, details: 'Банкротство не найдено' };

    const company = companies.find(c => c.inn === inn) || companies[0];
    const isBankrupt = company?.statusEn === 'bankrupt' || company?.statusRu?.toLowerCase().includes('банкрот');

    return {
      isBankrupt,
      status: company?.statusRu || 'Неизвестно',
      details: isBankrupt
        ? `⚠️ Компания находится в процедуре банкротства`
        : 'Процедура банкротства не обнаружена'
    };
  } catch {
    return { isBankrupt: false, details: 'Реестр банкротств недоступен' };
  }
}

module.exports = { checkBankruptcy };

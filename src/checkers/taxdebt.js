const axios = require('axios');
const cheerio = require('cheerio');

// nalog.ru public tax debt check — no key needed
// Returns whether company has tax debts over 1000 RUB
async function checkTaxDebt(inn) {
  try {
    const { data } = await axios.get(
      'https://service.nalog.ru/zd.do',
      {
        params: { inn },
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'text/html,application/xhtml+xml',
          'Referer': 'https://service.nalog.ru/zd.do'
        },
        timeout: 15000
      }
    );

    const $ = cheerio.load(data);

    // Look for debt indicator in page
    const text = $.text().toLowerCase();
    const hasDebt = text.includes('имеется') || text.includes('задолженност');
    const noDebt = text.includes('не имеет') || text.includes('отсутствует');

    if (noDebt) return { hasDebt: false, details: 'Налоговая задолженность отсутствует' };
    if (hasDebt) return { hasDebt: true, details: 'Имеется задолженность по налогам свыше 1 000 ₽' };

    return { hasDebt: null, details: 'Данные не найдены' };
  } catch {
    return { hasDebt: null, details: 'Сервис ФНС недоступен' };
  }
}

module.exports = { checkTaxDebt };

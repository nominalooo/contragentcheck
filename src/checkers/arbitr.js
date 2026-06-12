const axios = require('axios');
const cheerio = require('cheerio');

// kad.arbitr.ru — federal arbitration court cases, open search
async function getArbitrCases(inn) {
  try {
    const { data } = await axios.get('https://kad.arbitr.ru/Kad/SearchInstances', {
      params: {
        id: '',
        sides: inn,
        judges: '',
        dateFrom: '',
        dateTo: '',
        _: Date.now()
      },
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json, text/javascript, */*',
        'X-Requested-With': 'XMLHttpRequest',
        'Referer': 'https://kad.arbitr.ru/'
      },
      timeout: 15000
    });

    const cases = data?.Result?.Items || [];
    const total = data?.Result?.TotalCount || 0;

    const recent = cases.slice(0, 5).map(c => ({
      number: c.CaseNumber || '',
      court: c.Court?.ShortName || '',
      date: c.Date ? new Date(c.Date).toLocaleDateString('ru-RU') : '',
      plaintiff: c.Plaintiff?.Name || '',
      defendant: c.Defendant?.Name || '',
      amount: c.ClaimSum ? Math.round(c.ClaimSum).toLocaleString('ru-RU') + ' ₽' : 'не указана'
    }));

    return { total, recent };
  } catch {
    return { total: 0, recent: [], error: 'Сервис недоступен' };
  }
}

module.exports = { getArbitrCases };

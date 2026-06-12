const axios = require('axios');

// nalog.ru public EGRUL/EGRIP API — no key needed
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  'Accept': 'application/json',
  'Referer': 'https://egrul.nalog.ru/'
};

async function getCompanyInfo(inn) {
  // Step 1: search by INN
  const { data: searchData } = await axios.post(
    'https://egrul.nalog.ru/',
    `query=${inn}&region=&PreventChromeAutocomplete=`,
    {
      headers: { ...HEADERS, 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: 15000
    }
  );

  const token = searchData?.t;
  if (!token) return null;

  // Step 2: get result by token
  await sleep(1500);
  const { data: resultData } = await axios.get(
    `https://egrul.nalog.ru/search-result/${token}`,
    { headers: HEADERS, timeout: 15000 }
  );

  const rows = resultData?.rows;
  if (!rows || rows.length === 0) return null;

  const c = rows[0];
  return {
    name: c.n || c.np || 'Не указано',
    shortName: c.np || c.n || '',
    inn: c.i || inn,
    ogrn: c.o || '',
    kpp: c.p || '',
    type: c.k === 'fl' ? 'ИП' : 'ООО/АО',
    address: c.a || '',
    registrationDate: c.r || '',
    status: c.e ? `Ликвидировано (${c.e})` : 'Действует',
    isActive: !c.e,
    director: c.g || '',
    okved: c.v || '',
    region: c.ra || ''
  };
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

module.exports = { getCompanyInfo };

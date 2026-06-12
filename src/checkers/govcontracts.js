const axios = require('axios');

// zakupki.gov.ru (ЕИС) — open API, no key needed
async function getGovContracts(inn) {
  try {
    const { data } = await axios.get(
      'https://zakupki.gov.ru/epz/contract/search/results.json',
      {
        params: {
          searchString: inn,
          morphology: 'on',
          pageNumber: 1,
          sortDirection: 'false',
          recordsPerPage: '_10',
          showLotsInfoHidden: 'false',
          contractStageList_0: 'on',
          contractStageList_1: 'on',
          contractStageList_2: 'on',
          contractStageList_3: 'on',
          currencyIdGeneral: 'RUB'
        },
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'application/json',
          'Referer': 'https://zakupki.gov.ru/'
        },
        timeout: 15000
      }
    );

    const contracts = data?.data?.contracts || [];
    const total = data?.data?.totalCount || 0;
    const totalAmount = contracts.reduce((s, c) => s + (parseFloat(c.price) || 0), 0);

    return { total, totalAmount };
  } catch {
    return { total: 0, totalAmount: 0 };
  }
}

module.exports = { getGovContracts };

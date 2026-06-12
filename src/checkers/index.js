const { getCompanyInfo } = require('./egrul');
const { checkTaxDebt } = require('./taxdebt');
const { getArbitrCases } = require('./arbitr');
const { checkBankruptcy } = require('./bankruptcy');

async function fullCheck(inn) {
  // Run all checks in parallel
  const [company, taxDebt, arbitr, bankruptcy] = await Promise.allSettled([
    getCompanyInfo(inn),
    checkTaxDebt(inn),
    getArbitrCases(inn),
    checkBankruptcy(inn)
  ]);

  return {
    inn,
    company: company.status === 'fulfilled' ? company.value : null,
    taxDebt: taxDebt.status === 'fulfilled' ? taxDebt.value : { hasDebt: null, details: 'Ошибка' },
    arbitr: arbitr.status === 'fulfilled' ? arbitr.value : { total: 0, recent: [] },
    bankruptcy: bankruptcy.status === 'fulfilled' ? bankruptcy.value : { isBankrupt: false, details: 'Ошибка' },
    checkedAt: new Date().toISOString()
  };
}

function formatReport(result) {
  const { inn, company, taxDebt, arbitr, bankruptcy } = result;

  if (!company) {
    return `❌ Компания с ИНН *${inn}* не найдена в ЕГРЮЛ/ЕГРИП`;
  }

  const statusIcon = company.isActive ? '✅' : '🔴';
  const debtIcon = taxDebt.hasDebt ? '🔴' : taxDebt.hasDebt === false ? '✅' : '⚪';
  const bankruptIcon = bankruptcy.isBankrupt ? '🔴' : '✅';
  const arbitrIcon = arbitr.total > 10 ? '🟡' : arbitr.total > 0 ? '⚪' : '✅';

  let text = `📋 *Отчёт по ИНН ${inn}*\n\n`;

  // Company info
  text += `*${company.name}*\n`;
  text += `Тип: ${company.type}\n`;
  text += `ОГРН: ${company.ogrn || '—'}\n`;
  if (company.director) text += `Руководитель: ${company.director}\n`;
  text += `Регистрация: ${company.registrationDate || '—'}\n`;
  text += `${statusIcon} Статус: *${company.status}*\n\n`;

  // Tax debt
  text += `${debtIcon} *Налоговые долги*\n${taxDebt.details}\n\n`;

  // Bankruptcy
  text += `${bankruptIcon} *Банкротство*\n${bankruptcy.details}\n\n`;

  // Arbitration
  text += `${arbitrIcon} *Арбитражные дела*: ${arbitr.total}\n`;
  if (arbitr.recent?.length > 0) {
    for (const c of arbitr.recent.slice(0, 3)) {
      text += `  • ${c.number} (${c.date}) — ${c.amount}\n`;
    }
    if (arbitr.total > 3) text += `  _...и ещё ${arbitr.total - 3}_\n`;
  }

  // Risk score
  const risks = [
    !company.isActive,
    taxDebt.hasDebt === true,
    bankruptcy.isBankrupt,
    arbitr.total > 20
  ].filter(Boolean).length;

  const riskLabel = risks === 0 ? '🟢 Низкий' : risks === 1 ? '🟡 Средний' : '🔴 Высокий';
  text += `\n*Риск*: ${riskLabel}`;
  text += `\n\n_Данные: ЕГРЮЛ, ФНС, КАД Арбитр, Федресурс_`;

  return text;
}

module.exports = { fullCheck, formatReport };

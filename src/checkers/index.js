const { getCompanyInfo } = require('./egrul');
const { checkTaxDebt } = require('./taxdebt');
const { getArbitrCases } = require('./arbitr');
const { checkBankruptcy } = require('./bankruptcy');
const { getGovContracts } = require('./govcontracts');

// Free: basic info only
async function quickCheck(inn) {
  const company = await getCompanyInfo(inn);
  return { inn, company };
}

// Paid: full report from all sources
async function fullCheck(inn) {
  const [company, taxDebt, arbitr, bankruptcy, govContracts] = await Promise.allSettled([
    getCompanyInfo(inn),
    checkTaxDebt(inn),
    getArbitrCases(inn),
    checkBankruptcy(inn),
    getGovContracts(inn)
  ]);

  return {
    inn,
    company:      company.status      === 'fulfilled' ? company.value      : null,
    taxDebt:      taxDebt.status      === 'fulfilled' ? taxDebt.value      : { hasDebt: null, details: 'Недоступно' },
    arbitr:       arbitr.status       === 'fulfilled' ? arbitr.value       : { total: 0, recent: [] },
    bankruptcy:   bankruptcy.status   === 'fulfilled' ? bankruptcy.value   : { isBankrupt: false, details: 'Недоступно' },
    govContracts: govContracts.status === 'fulfilled' ? govContracts.value : { total: 0, totalAmount: 0 },
    checkedAt: new Date().toISOString()
  };
}

// Short preview shown for free
function formatPreview(inn, company) {
  if (!company) {
    return `❌ Компания с ИНН *${inn}* не найдена в ЕГРЮЛ/ЕГРИП`;
  }

  const statusIcon = company.isActive ? '✅' : '🔴';

  return (
    `🔍 *Найдено по ИНН ${inn}*\n\n` +
    `*${company.name}*\n` +
    `Тип: ${company.type}\n` +
    `ИНН: ${company.inn} · ОГРН: ${company.ogrn || '—'}\n` +
    `Регистрация: ${company.registrationDate || '—'}\n` +
    `${statusIcon} Статус: *${company.status}*\n\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `🔒 *Полный отчёт — 300 ₽:*\n` +
    `• Налоговые долги (ФНС)\n` +
    `• Арбитражные дела и суммы\n` +
    `• Банкротство (Федресурс)\n` +
    `• Госконтракты и обороты\n` +
    `• Адрес, директор, ОКВЭД\n` +
    `• Риск-скор 🟢/🟡/🔴`
  );
}

// Full paid report
function formatFullReport(result) {
  const { inn, company, taxDebt, arbitr, bankruptcy, govContracts } = result;

  if (!company) return `❌ Компания с ИНН *${inn}* не найдена`;

  const risks = [
    !company.isActive,
    taxDebt?.hasDebt === true,
    bankruptcy?.isBankrupt,
    (arbitr?.total || 0) > 20
  ].filter(Boolean).length;

  const riskLabel = risks === 0 ? '🟢 Низкий' : risks === 1 ? '🟡 Средний' : '🔴 Высокий';
  const debtIcon = taxDebt?.hasDebt ? '🔴' : taxDebt?.hasDebt === false ? '✅' : '⚪';
  const bankruptIcon = bankruptcy?.isBankrupt ? '🔴' : '✅';
  const arbitrIcon = (arbitr?.total || 0) > 10 ? '🟡' : '✅';

  let text = `📋 *Полный отчёт — ИНН ${inn}*\n\n`;

  // Company block
  text += `🏢 *${company.name}*\n`;
  text += `Тип: ${company.type}\n`;
  text += `ИНН: ${company.inn} · ОГРН: ${company.ogrn || '—'}\n`;
  if (company.kpp) text += `КПП: ${company.kpp}\n`;
  if (company.director) text += `Руководитель: ${company.director}\n`;
  if (company.address) text += `Адрес: ${company.address}\n`;
  if (company.okved) text += `ОКВЭД: ${company.okved}\n`;
  text += `Регистрация: ${company.registrationDate || '—'}\n`;
  text += `${company.isActive ? '✅' : '🔴'} Статус: *${company.status}*\n\n`;

  // Tax debt
  text += `${debtIcon} *Налоговые долги*\n${taxDebt?.details || '—'}\n\n`;

  // Bankruptcy
  text += `${bankruptIcon} *Банкротство*\n${bankruptcy?.details || '—'}\n\n`;

  // Arbitration
  text += `${arbitrIcon} *Арбитражные дела*: ${arbitr?.total || 0}\n`;
  if (arbitr?.recent?.length > 0) {
    for (const c of arbitr.recent.slice(0, 3)) {
      text += `  • ${c.number} (${c.date}) — ${c.amount}\n`;
    }
    if ((arbitr?.total || 0) > 3) text += `  _...ещё ${arbitr.total - 3} дел_\n`;
  }
  text += '\n';

  // Gov contracts
  if (govContracts?.total > 0) {
    text += `📑 *Госконтракты*: ${govContracts.total} шт.\n`;
    text += `Сумма: ${govContracts.totalAmount?.toLocaleString('ru-RU')} ₽\n\n`;
  } else {
    text += `📑 *Госконтракты*: не найдены\n\n`;
  }

  // Risk score
  text += `━━━━━━━━━━━━━━━━━━━━\n`;
  text += `*Риск-скор: ${riskLabel}*\n`;
  text += `_Данные: ЕГРЮЛ, ФНС, КАД Арбитр, Федресурс, ЕИС Закупки_`;

  return text;
}

module.exports = { quickCheck, fullCheck, formatPreview, formatFullReport };

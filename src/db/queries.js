const supabase = require('./client');

async function getOrCreateUser(telegramId, username) {
  let { data } = await supabase.from('users').select('*').eq('telegram_id', telegramId).single();
  if (!data) {
    const { data: created } = await supabase.from('users')
      .insert({ telegram_id: telegramId, username }).select().single();
    data = created;
  }
  return data;
}

async function getUser(telegramId) {
  const { data } = await supabase.from('users').select('*').eq('telegram_id', telegramId).single();
  return data;
}

async function hasPaidForInn(userId, inn) {
  const { data } = await supabase.from('payments')
    .select('id')
    .eq('user_id', userId)
    .eq('inn', inn)
    .eq('status', 'succeeded')
    .limit(1)
    .single();
  return !!data;
}

async function saveCheck(data) {
  const { data: check, error } = await supabase.from('checks').insert(data).select().single();
  if (error) throw error;
  return check;
}

async function getUserChecks(userId, limit = 5) {
  const { data } = await supabase.from('checks').select('*')
    .eq('user_id', userId).order('created_at', { ascending: false }).limit(limit);
  return data || [];
}

async function createPayment(data) {
  const { data: p, error } = await supabase.from('payments').insert(data).select().single();
  if (error) throw error;
  return p;
}

async function updatePaymentStatus(yookassaId, status) {
  const { data, error } = await supabase.from('payments').update({ status })
    .eq('yookassa_payment_id', yookassaId).select('*, users(*)').single();
  if (error) throw error;
  return data;
}

module.exports = {
  getOrCreateUser, getUser, hasPaidForInn,
  saveCheck, getUserChecks, createPayment, updatePaymentStatus
};

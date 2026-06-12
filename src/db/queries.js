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

async function canCheck(user) {
  if (user.free_checks_used < 1) return true;
  if (user.plan === 'subscription') {
    const expires = user.subscription_expires_at;
    if (expires && new Date(expires) > new Date()) return true;
  }
  return false;
}

async function incrementFreeChecks(userId) {
  await supabase.from('users').update({ free_checks_used: supabase.rpc('increment', { row_id: userId }) }).eq('id', userId);
  // simple increment fallback
  const { data: u } = await supabase.from('users').select('free_checks_used').eq('id', userId).single();
  await supabase.from('users').update({ free_checks_used: (u?.free_checks_used || 0) + 1 }).eq('id', userId);
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

async function activateSubscription(userId) {
  const expires = new Date();
  expires.setMonth(expires.getMonth() + 1);
  await supabase.from('users')
    .update({ plan: 'subscription', subscription_expires_at: expires.toISOString() })
    .eq('id', userId);
}

module.exports = {
  getOrCreateUser, getUser, canCheck, incrementFreeChecks,
  saveCheck, getUserChecks, createPayment, updatePaymentStatus, activateSubscription
};

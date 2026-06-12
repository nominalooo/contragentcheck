-- ContragentCheck schema
-- Run in Supabase SQL Editor

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  telegram_id bigint unique not null,
  username text,
  free_checks_used int not null default 0,
  plan text not null default 'free',
  subscription_expires_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists checks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  inn text not null,
  company_name text,
  result jsonb,
  risk_level text,
  created_at timestamptz not null default now()
);

create table if not exists payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id),
  yookassa_payment_id text unique,
  amount int not null,
  product text not null,
  status text not null default 'pending',
  created_at timestamptz not null default now()
);

create index if not exists checks_user_id_idx on checks(user_id);
create index if not exists checks_inn_idx on checks(inn);

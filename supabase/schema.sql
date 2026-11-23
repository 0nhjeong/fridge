-- =====================================================================
-- 냉털집사: 하루 1회 소비기한 임박 요약 웹 푸시 (Supabase)
-- Supabase 대시보드 → SQL Editor 에 이 파일 전체를 붙여 넣고 실행하세요.
-- 맨 아래 [3] 의 <CRON_SECRET> 자리는 본인 값으로 바꾼 뒤 실행해야 해요. (프로젝트 주소는 이미 채워 둠)
-- =====================================================================

-- ---------------------------------------------------------------------
-- [1] 테이블
-- ---------------------------------------------------------------------
create extension if not exists pgcrypto with schema extensions;

create table if not exists public.fridge_push_devices (
  device_id          uuid primary key,                       -- 브라우저마다 자동 발급되는 UUID (로그인 없음)
  secret_hash        text not null,                          -- 기기 비밀값의 sha256 (본인 기기만 수정 가능하게)
  subscription       jsonb,                                  -- 브라우저 PushSubscription (endpoint, keys)
  enabled            boolean not null default true,
  notify_hour        smallint not null default 8  check (notify_hour between 0 and 23),
  notify_minute      smallint not null default 30 check (notify_minute in (0, 30)), -- 오전 8:30 선택지용
  days_before        smallint not null default 3  check (days_before between 1 and 3),
  items_summary_json jsonb not null default '[]'::jsonb,     -- [{ "n": 재료명, "d": "YYYY-MM-DD"(실제 기한) }, ...]
  last_notified_date date,                                   -- 한국 날짜 기준 마지막 발송일 (하루 중복 발송 방지)
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index if not exists fridge_push_devices_due_idx
  on public.fridge_push_devices (notify_hour, notify_minute)
  where enabled;

-- RLS 켜고 정책은 만들지 않음 → anon/authenticated 키로는 테이블을 직접 읽거나 쓸 수 없음.
-- 프론트는 아래 RPC(security definer)만 쓸 수 있고, Edge Function은 service_role(서버 전용)로 접근.
alter table public.fridge_push_devices enable row level security;
revoke all on table public.fridge_push_devices from anon, authenticated;
-- Edge Function(service_role)이 읽고 쓸 수 있게 (새 프로젝트는 자동 권한이 없을 수 있음)
grant select, insert, update, delete on table public.fridge_push_devices to service_role;

-- ---------------------------------------------------------------------
-- [2] 프론트에서 부르는 RPC (anon 키로 호출, 본인 device_id만 수정 가능)
-- ---------------------------------------------------------------------
-- 처음 호출한 기기가 비밀값을 등록하고, 이후에는 같은 비밀값을 보낸 경우에만 수정됨.
create or replace function public.upsert_push_device(
  p_device_id     uuid,
  p_secret        text,
  p_subscription  jsonb,
  p_notify_hour   int,
  p_notify_minute int,
  p_days_before   int,
  p_items_summary jsonb
) returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_hash     text;
  v_existing text;
begin
  if p_device_id is null or p_secret is null or length(p_secret) < 32 or length(p_secret) > 128 then
    raise exception 'invalid device credentials' using errcode = '22023';
  end if;
  if p_subscription is null
     or coalesce(p_subscription->>'endpoint', '') not like 'https://%'
     or p_subscription->'keys'->>'p256dh' is null
     or p_subscription->'keys'->>'auth' is null
     or octet_length(p_subscription::text) > 4096 then
    raise exception 'invalid subscription' using errcode = '22023';
  end if;
  if p_notify_hour not between 0 and 23 or p_notify_minute not in (0, 30) or p_days_before not between 1 and 3 then
    raise exception 'invalid schedule' using errcode = '22023';
  end if;
  if jsonb_typeof(p_items_summary) is distinct from 'array'
     or jsonb_array_length(p_items_summary) > 300
     or octet_length(p_items_summary::text) > 60000 then
    raise exception 'invalid items summary' using errcode = '22023';
  end if;

  v_hash := encode(extensions.digest(p_secret, 'sha256'), 'hex');

  select secret_hash into v_existing
    from public.fridge_push_devices
   where device_id = p_device_id
   for update;

  if found and v_existing <> v_hash then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  insert into public.fridge_push_devices as d
    (device_id, secret_hash, subscription, enabled, notify_hour, notify_minute, days_before, items_summary_json, updated_at)
  values
    (p_device_id, v_hash, p_subscription, true, p_notify_hour, p_notify_minute, p_days_before, p_items_summary, now())
  on conflict (device_id) do update
    set subscription       = excluded.subscription,
        enabled            = true,
        notify_hour        = excluded.notify_hour,
        notify_minute      = excluded.notify_minute,
        days_before        = excluded.days_before,
        items_summary_json = excluded.items_summary_json,
        updated_at         = now()
    where d.secret_hash = v_hash;
end;
$$;

-- 알림 끄기: 본인 기기 행 삭제
create or replace function public.disable_push_device(
  p_device_id uuid,
  p_secret    text
) returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  delete from public.fridge_push_devices
   where device_id = p_device_id
     and secret_hash = encode(extensions.digest(coalesce(p_secret, ''), 'sha256'), 'hex');
end;
$$;

revoke all on function public.upsert_push_device(uuid, text, jsonb, int, int, int, jsonb) from public;
revoke all on function public.disable_push_device(uuid, text) from public;
grant execute on function public.upsert_push_device(uuid, text, jsonb, int, int, int, jsonb) to anon, authenticated;
grant execute on function public.disable_push_device(uuid, text) to anon, authenticated;

-- ---------------------------------------------------------------------
-- [3] 30분마다(정각·30분) Edge Function 호출 — pg_cron + pg_net
--     (오전 8:30 선택지가 있어서 정각과 30분에 모두 깨워요. 함수가 시각이 맞는 기기에만 보냄)
--     아래 <CRON_SECRET> 한 곳을 바꾼 뒤 실행하세요.
--     비밀값은 Vault에 저장해서 cron 작업 목록에 그대로 노출되지 않게 해요.
-- ---------------------------------------------------------------------
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

do $$
begin
  if not exists (select 1 from vault.secrets where name = 'fridge_push_fn_url') then
    perform vault.create_secret('https://tktqesjgxxgupzxkdton.supabase.co/functions/v1/send-daily-push', 'fridge_push_fn_url');
  end if;
  if not exists (select 1 from vault.secrets where name = 'fridge_cron_secret') then
    perform vault.create_secret('<CRON_SECRET>', 'fridge_cron_secret');
  end if;
end $$;

-- 같은 이름으로 다시 실행하면 기존 작업을 덮어써요.
select cron.schedule(
  'fridge-daily-push',
  '0,30 * * * *',
  $cron$
  select net.http_post(
    url     := (select decrypted_secret from vault.decrypted_secrets where name = 'fridge_push_fn_url'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'fridge_cron_secret')
    ),
    body    := jsonb_build_object('mode', 'cron'),
    timeout_milliseconds := 30000
  );
  $cron$
);

-- 확인용:   select * from cron.job;
-- 실행 기록: select * from cron.job_run_details order by start_time desc limit 20;
-- 값 바꾸기: select vault.update_secret((select id from vault.secrets where name = 'fridge_cron_secret'), '새 값');
-- 끄기:     select cron.unschedule('fridge-daily-push');

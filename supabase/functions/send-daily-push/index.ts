// 냉털집사 — 하루 1회 소비기한 임박 요약 웹 푸시 (Supabase Edge Function, Deno)
//
// 호출 방식
//  1) cron (pg_cron + pg_net, 30분마다): POST { "mode": "cron" } + 헤더 x-cron-secret
//     → 한국 시간 기준 지금 시각(시·30분 단위)이 notify 시각과 같고, 오늘 아직 안 보낸 기기 중
//       임박 재료가 1개 이상인 곳에만 요약 푸시 1건. 성공했을 때만 last_notified_date 갱신.
//  2) 테스트 (앱의 '테스트 알림 바로 보내기'): POST { "mode": "test", "device_id", "secret" }
//     → 그 기기에 테스트 푸시 1건 즉시 발송 (기기 비밀값이 맞을 때만)
//
// 필요한 Secrets (supabase secrets set ...):
//   VAPID_KEYS     : {"publicKey":{JWK},"privateKey":{JWK}} JSON 한 줄
//   VAPID_SUBJECT  : mailto:본인메일@example.com
//   CRON_SECRET    : schema.sql 의 <CRON_SECRET> 과 같은 값
// SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY 는 Supabase가 자동으로 넣어 줘요.
//
// 배포: supabase functions deploy send-daily-push --no-verify-jwt
//   (로그인 없는 앱이라 JWT 대신 x-cron-secret / 기기 비밀값으로 직접 검증)

import { createClient } from "jsr:@supabase/supabase-js@2";
import * as webpush from "jsr:@negrel/webpush@0.5.0";

type Item = { n: string; d: string }; // 재료명, 실제 기한(YYYY-MM-DD)
type Device = {
  device_id: string;
  secret_hash: string;
  subscription: webpush.PushSubscription | null;
  enabled: boolean;
  notify_hour: number;
  notify_minute: number;
  days_before: number;
  items_summary_json: Item[];
  last_notified_date: string | null;
};

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json; charset=utf-8" } });

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

// ---------- VAPID / 푸시 서버 (한 번만 준비) ----------
let appServerPromise: Promise<webpush.ApplicationServer> | null = null;
function appServer() {
  if (!appServerPromise) {
    appServerPromise = (async () => {
      const raw = Deno.env.get("VAPID_KEYS");
      if (!raw) throw new Error("VAPID_KEYS secret is missing");
      const vapidKeys = await webpush.importVapidKeys(JSON.parse(raw), { extractable: false });
      return await webpush.ApplicationServer.new({
        contactInformation: Deno.env.get("VAPID_SUBJECT") ?? "mailto:admin@example.com",
        vapidKeys,
      });
    })();
  }
  return appServerPromise;
}

// ---------- 날짜 (Asia/Seoul) ----------
function kstNow() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date());
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  return { date: `${get("year")}-${get("month")}-${get("day")}`, hour: Number(get("hour")), minute: Number(get("minute")) };
}
function daysBetween(fromYmd: string, toYmd: string) {
  const a = Date.UTC(+fromYmd.slice(0, 4), +fromYmd.slice(5, 7) - 1, +fromYmd.slice(8, 10));
  const b = Date.UTC(+toYmd.slice(0, 4), +toYmd.slice(5, 7) - 1, +toYmd.slice(8, 10));
  return Math.round((b - a) / 86400000);
}

// ---------- 요약 문구 ----------
// 예) "오늘 만료 1건 · 3일 내 임박 2건" / "부대찌개 밀키트 외 2건"
function summarize(items: Item[], daysBefore: number, today: string) {
  const list = (Array.isArray(items) ? items : [])
    .filter((x) => x && typeof x.n === "string" && /^\d{4}-\d{2}-\d{2}$/.test(x.d ?? ""))
    .map((x) => ({ name: x.n.slice(0, 40), left: daysBetween(today, x.d) }))
    .filter((x) => x.left <= daysBefore)
    .sort((a, b) => a.left - b.left);
  const over = list.filter((x) => x.left < 0).length;
  const todayCnt = list.filter((x) => x.left === 0).length;
  const soon = list.filter((x) => x.left > 0).length;
  const parts: string[] = [];
  if (over) parts.push(`기한 지남 ${over}건`);
  if (todayCnt) parts.push(`오늘 만료 ${todayCnt}건`);
  if (soon) parts.push(`${daysBefore}일 내 임박 ${soon}건`);
  const names = list.length ? `${list[0].name}${list.length > 1 ? ` 외 ${list.length - 1}건` : ""}` : "";
  return { count: list.length, title: parts.join(" · "), body: names };
}

// ---------- 발송 ----------
type SendResult = "ok" | "gone" | "error";
async function send(dev: Device, payload: Record<string, unknown>): Promise<SendResult> {
  if (!dev.subscription?.endpoint) return "gone";
  try {
    const server = await appServer();
    const subscriber = server.subscribe(dev.subscription);
    await subscriber.pushTextMessage(JSON.stringify(payload), { ttl: 60 * 60 * 6 } as webpush.PushMessageOptions);
    return "ok";
  } catch (err) {
    if (err instanceof webpush.PushMessageError) {
      const status = err.response?.status;
      if (err.isGone() || status === 404 || status === 410) return "gone";
      console.error("push failed", dev.device_id, status, await err.response?.text?.().catch(() => ""));
    } else {
      console.error("push error", dev.device_id, err);
    }
    return "error";
  }
}
async function markGone(deviceId: string) {
  // 만료된 구독: 비활성화하고 구독 정보 비우기 (앱에서 다시 켜면 새 구독으로 되살아남)
  await supabase.from("fridge_push_devices").update({ enabled: false, subscription: null }).eq("device_id", deviceId);
}

async function sha256Hex(text: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

// ---------- 모드: 테스트 ----------
async function handleTest(body: { device_id?: string; secret?: string }) {
  const id = String(body.device_id ?? "");
  const secret = String(body.secret ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(id) || secret.length < 32) return json({ ok: false, error: "bad_request" }, 400);

  const { data: dev, error } = await supabase.from("fridge_push_devices").select("*").eq("device_id", id).maybeSingle<Device>();
  if (error) return json({ ok: false, error: "db_error" }, 500);
  if (!dev || !safeEqual(dev.secret_hash, await sha256Hex(secret))) return json({ ok: false, error: "not_registered" }, 404);
  if (!dev.enabled || !dev.subscription) return json({ ok: false, error: "disabled" }, 409);

  const s = summarize(dev.items_summary_json, dev.days_before, kstNow().date);
  const result = await send(dev, {
    title: "냉털집사 테스트 알림",
    body: s.count ? `${s.title}${s.body ? ` (${s.body})` : ""}` : `알림이 잘 와요! 지금은 ${dev.days_before}일 내 임박 재료가 없어요.`,
    tag: "fridge-test",
    url: "./",
  });
  if (result === "gone") { await markGone(id); return json({ ok: false, error: "subscription_gone" }, 410); }
  return result === "ok" ? json({ ok: true }) : json({ ok: false, error: "push_failed" }, 502);
}

// ---------- 모드: cron (하루 1회 요약) ----------
async function handleCron(req: Request) {
  const expected = Deno.env.get("CRON_SECRET") ?? "";
  const got = req.headers.get("x-cron-secret") ?? "";
  if (!expected || !safeEqual(expected, got)) return json({ ok: false, error: "unauthorized" }, 401);

  const now = kstNow();
  const bucket = now.minute < 30 ? 0 : 30; // cron이 1~2분 늦게 돌아도 같은 칸으로 계산
  const { data: devices, error } = await supabase
    .from("fridge_push_devices")
    .select("*")
    .eq("enabled", true)
    .eq("notify_hour", now.hour)
    .eq("notify_minute", bucket)
    .or(`last_notified_date.is.null,last_notified_date.neq.${now.date}`)
    .limit(1000);
  if (error) return json({ ok: false, error: "db_error" }, 500);

  let sent = 0, skipped = 0, gone = 0, failed = 0;
  for (const dev of (devices ?? []) as Device[]) {
    const s = summarize(dev.items_summary_json, dev.days_before, now.date);
    if (!s.count) { skipped++; continue; } // 임박 재료 없으면 보내지 않음
    const result = await send(dev, { title: s.title, body: s.body, tag: "fridge-daily", url: "./" });
    if (result === "ok") {
      sent++;
      await supabase.from("fridge_push_devices").update({ last_notified_date: now.date }).eq("device_id", dev.device_id);
    } else if (result === "gone") { gone++; await markGone(dev.device_id); }
    else failed++;
  }
  return json({ ok: true, kst: `${now.date} ${now.hour}:${String(bucket).padStart(2, "0")}`, checked: devices?.length ?? 0, sent, skipped, gone, failed });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);
  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* 빈 본문 */ }
  try {
    if (body.mode === "test") return await handleTest(body as { device_id?: string; secret?: string });
    if (body.mode === "cron") return await handleCron(req);
    return json({ ok: false, error: "unknown_mode" }, 400);
  } catch (err) {
    console.error(err);
    return json({ ok: false, error: "server_error" }, 500);
  }
});

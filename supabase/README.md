# 냉털집사 푸시 알림 설정 순서 (Supabase + Web Push)

하루 1번, 정해 둔 시각에 "오늘 만료 1건 · 3일 내 임박 2건 (부대찌개 밀키트 외 2건)" 같은 요약 알림이 오게 하는 설정이에요.
아래 순서대로 한 번만 하면 돼요. ⚠️ 표시는 **절대 깃허브·프론트 코드에 넣으면 안 되는 비밀값**이에요.

## 0. 준비물
- Supabase 무료 계정 → 새 프로젝트 만들기 (Region: Northeast Asia (Seoul) 추천)
- 대시보드 → **Project Settings → API** 에서 확인
  - `Project URL` (예: `https://abcdefgh.supabase.co`) → 여기서 `abcdefgh` 가 **PROJECT_REF**
  - `anon` public 키 (또는 publishable 키) → 프론트에 넣어도 되는 공개 키
  - ⚠️ `service_role` 키는 쓰지 않아요. Edge Function 안에서 Supabase가 자동으로 넣어 줘요.

## 1. VAPID 키 만들기
1. `tools/vapid-keygen.html` 파일을 크롬으로 열고 **키 만들기**를 누르세요.
   (배포 후에는 `https://0nhjeong.github.io/fridge/tools/vapid-keygen.html` 에서도 열려요. 키는 브라우저 안에서만 만들어져요.)
2. 나온 두 값을 메모장에 따로 보관하세요.
   - ① ⚠️ `VAPID_KEYS` (JSON 한 줄, 비밀) → 3단계 Secrets에 넣음
   - ② `VAPID_PUBLIC_KEY` (공개) → 5단계 `js/config.js` 에 넣음
3. 키를 다시 만들면 이미 켜 둔 알림을 모두 다시 켜야 하니, 한 번 만든 키를 계속 쓰세요.

## 2. CRON 비밀값 만들기
PowerShell에서 아래를 실행해 나온 긴 문자열을 ⚠️ `CRON_SECRET` 으로 보관하세요.
```powershell
[guid]::NewGuid().ToString('N') + [guid]::NewGuid().ToString('N')
```

## 3. Edge Function 배포 + Secrets 등록
**방법 A — 대시보드 (설치 없이)**
1. 대시보드 → **Edge Functions → Deploy a new function → Via Editor**
2. 함수 이름을 정확히 `send-daily-push` 로 하고, `supabase/functions/send-daily-push/index.ts` 내용을 통째로 붙여 넣은 뒤 Deploy
3. 함수 상세 → **Details(설정)** 에서 **Verify JWT(Enforce JWT verification) 끄기**
   (로그인 없는 앱이라, 함수가 `x-cron-secret` 과 기기 비밀값으로 직접 검사해요)
4. **Edge Functions → Secrets** 에 3개 추가
   | 이름 | 값 |
   |---|---|
   | `VAPID_KEYS` | 1단계 ① JSON 한 줄 |
   | `VAPID_SUBJECT` | `mailto:본인메일주소` |
   | `CRON_SECRET` | 2단계 값 |

**방법 B — Supabase CLI** (설치돼 있다면)
```bash
supabase login
supabase link --project-ref <PROJECT_REF>
supabase secrets set CRON_SECRET=<값> VAPID_SUBJECT=mailto:<메일> VAPID_KEYS='<JSON 한 줄>'
supabase functions deploy send-daily-push --no-verify-jwt
```

## 4. SQL 실행 (테이블·RPC·30분 간격 cron)
1. `supabase/schema.sql` 을 열어 맨 아래 [3]의 두 곳을 바꾸세요.
   - `<PROJECT_REF>` → 0단계의 PROJECT_REF
   - `<CRON_SECRET>` → 2단계 값 (3단계에 넣은 값과 **똑같아야** 해요)
2. 대시보드 → **SQL Editor** 에 전체를 붙여 넣고 **Run**
   - `pg_cron`/`pg_net` 오류가 나면: **Database → Extensions** 에서 두 확장을 켠 뒤 다시 실행
3. 바꾼 schema.sql 은 비밀값이 들어갔으니 **깃허브에 올리지 마세요** (원본 그대로 두고 SQL Editor에만 붙여 넣기 추천)

## 5. 프론트에 공개 키 넣기
`js/config.js` 를 열어 채우고 다시 배포(커밋·푸시)하세요.
```js
window.FRIDGE_CONFIG = {
  SUPABASE_URL: 'https://<PROJECT_REF>.supabase.co',
  SUPABASE_ANON_KEY: '<anon public 키>',
  VAPID_PUBLIC_KEY: '<1단계 ② 값>'
};
```
⚠️ 여기에 `service_role`, `VAPID_KEYS`, `CRON_SECRET` 은 절대 넣지 마세요.

## 6. 폰에서 켜기
1. 앱을 열고 설정 맨 아래 버전이 최신인지 확인 → **설정 → 소비기한 알림** 토글 켜기 → 알림 권한 **허용**
2. 알림 시간(오전 8:30 / 오후 5:00 / 직접 정시)과 임박 기준(1~3일)을 고르세요.
3. **테스트 알림 바로 보내기** → 몇 초 안에 알림이 오면 완료
4. 아이폰: Safari 공유 버튼 → '홈 화면에 추가'로 설치한 앱에서 켜야 해요 (iOS 16.4 이상)

## 동작 방식 요약
- 앱이 브라우저마다 `device_id`(UUID)와 기기 비밀값을 자동 발급해요 (백업 JSON에는 안 들어가요).
- 알림이 켜져 있으면 재료·알림 설정이 바뀔 때 `upsert_push_device` RPC로 "재료명 + 실제 기한"만 올려요.
  테이블은 RLS로 막혀 있고, 같은 기기 비밀값을 보낸 경우에만 그 `device_id` 행이 바뀌어요.
- cron이 매시 정각·30분에 함수를 부르고, 함수는 한국 시간 기준 그 시각을 고른 기기 중
  오늘 아직 안 보냈고 임박 재료가 1개 이상인 곳에만 1건 보내요. 성공했을 때만 `last_notified_date` 를 기록해요.
- 구독이 만료되면(404/410) 그 기기는 자동으로 꺼지고, 앱에서 다시 켜면 살아나요.

## 문제 확인
```sql
select * from cron.job_run_details order by start_time desc limit 10;   -- cron 실행 기록
select device_id, enabled, notify_hour, notify_minute, days_before, last_notified_date, updated_at
  from public.fridge_push_devices order by updated_at desc;           -- 등록된 기기
```
함수 로그: 대시보드 → Edge Functions → send-daily-push → Logs

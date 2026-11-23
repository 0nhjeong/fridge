/* 냉털집사 — 푸시 알림 연결 설정 (공개해도 되는 값만 넣는 곳)
 *
 * 1) SUPABASE_URL      : Supabase 대시보드 → Project Settings → API → Project URL
 * 2) SUPABASE_ANON_KEY : 같은 화면의 anon public 키 (또는 publishable 키)
 *                        ⚠️ service_role / secret 키는 절대 여기에 넣지 마세요. (깃허브에 공개됨)
 * 3) VAPID_PUBLIC_KEY  : tools/vapid-keygen.html 에서 만든 '프론트용 공개키' (base64url 한 줄)
 *
 * 셋 중 하나라도 비어 있으면 설정 탭의 알림 켜기가 '관리자 설정 필요'로 안내돼요.
 */
window.FRIDGE_CONFIG = {
  SUPABASE_URL: 'https://tktqesjgxxgupzxkdton.supabase.co',
  SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRrdHFlc2pneHhndXB6eGtkdG9uIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTUzODYwNTcsImV4cCI6MjExMDk2MjA1N30.b_KwLYUnGihrjyfnd34RZc7h6pQh6I-8HEGZitMNV6k',
  VAPID_PUBLIC_KEY: 'BKm5Utjpqj4Fq957OfAMYuZKLKwZOVe7GGgei4Ne_Ge4ZRwq-OOVg-GLl0I33r1pcbudRO5MokGRucAzxNBHODA'
};

/* 냉장고 소분·재고 관리 PWA - 메인 로직 (Vanilla JS)
 * 데이터는 localStorage('fridge-pwa-v1')에 자동 저장됩니다.
 */
'use strict';

/* =========================================================
 * 1. 상수 · 기본값
 * ========================================================= */
const STORE_KEY = 'fridge-pwa-v1';

const CATEGORIES = [
  { id: 'meat', name: '육류·생선', emoji: '🥩' },
  { id: 'veg', name: '채소·두부·반찬', emoji: '🥬' },
  { id: 'root', name: '뿌리채소', emoji: '🥔' },
  { id: 'egg', name: '달걀', emoji: '🥚' },
  { id: 'dairy', name: '유제품', emoji: '🥛' },
  { id: 'sauce', name: '소스·양념', emoji: '🧂' },
  { id: 'drink', name: '음료', emoji: '🧃' },
  { id: 'grain', name: '곡물·면·가공', emoji: '🍚' },
  { id: 'fruit', name: '과일', emoji: '🍎' },
  { id: 'etc', name: '기타', emoji: '📦' }
];

// 단위 선택 목록과 카테고리별 기본 단위 (선택 후 직접 바꿀 수 있음)
const UNITS = ['팩', '개', '봉', '병', '통', '모', '단'];
const DEFAULT_UNIT_BY_CAT = { fruit: '개', egg: '개', root: '개' };
const defaultUnit = (cat) => DEFAULT_UNIT_BY_CAT[cat] || '팩';
const CAT = Object.fromEntries(CATEGORIES.map((c) => [c.id, c]));

const ZONE_TYPES = {
  fridge: { name: '냉장', emoji: '🧊' },
  freezer: { name: '냉동', emoji: '❄️' },
  room: { name: '실온', emoji: '🗄️' }
};

// 보관 구역 × 카테고리 → 권장 소비기한(오늘 + N일)
const DEFAULT_RULES = {
  fridge: { meat: 3, veg: 5, root: 14, egg: 21, dairy: 7, sauce: 60, drink: 7, grain: 7, fruit: 7, etc: 7 },
  freezer: { meat: 30, veg: 30, root: 30, egg: 30, dairy: 30, sauce: 30, drink: 30, grain: 30, fruit: 30, etc: 30 },
  room: { meat: 1, veg: 3, root: 14, egg: 14, dairy: 3, sauce: 180, drink: 90, grain: 90, fruit: 5, etc: 30 }
};
// 개봉 후 권장 사용 일수 (개봉일 + N일)
const DEFAULT_OPEN_RULES = { meat: 2, veg: 3, root: 7, egg: 7, dairy: 5, sauce: 60, drink: 7, grain: 14, fruit: 3, etc: 30 };
// 냉동 → 냉장 해동 시 최대 일수
const THAW_MAX = { meat: 2, veg: 2, etc: 3 };

const DEFAULT_FREQ = [
  { name: '계란', cat: 'egg', zoneType: 'fridge', slotHint: '상칸', size: '', count: 10, unit: '개' },
  { name: '두부', cat: 'veg', zoneType: 'fridge', slotHint: '중칸', size: '300g', count: 1, unit: '모' },
  { name: '대파', cat: 'veg', zoneType: 'fridge', slotHint: '야채칸', size: '', count: 1, unit: '단' },
  { name: '우유', cat: 'dairy', zoneType: 'fridge', slotHint: '문쪽', size: '900ml', count: 1, unit: '팩' },
  { name: '돼지고기', cat: 'meat', zoneType: 'freezer', slotHint: '상칸', size: '120g', count: 4, unit: '팩' },
  { name: '소고기 다짐육', cat: 'meat', zoneType: 'freezer', slotHint: '상칸', size: '100g', count: 4, unit: '팩' },
  { name: '닭가슴살', cat: 'meat', zoneType: 'freezer', slotHint: '중칸', size: '100g', count: 4, unit: '팩' },
  { name: '양파', cat: 'root', zoneType: 'fridge', slotHint: '야채칸', size: '', count: 3, unit: '개' },
  { name: '당근', cat: 'root', zoneType: 'fridge', slotHint: '야채칸', size: '', count: 2, unit: '개' },
  { name: '애호박', cat: 'veg', zoneType: 'fridge', slotHint: '야채칸', size: '', count: 1, unit: '개' },
  { name: '감자', cat: 'root', zoneType: 'room', slotHint: '', size: '', count: 4, unit: '개' },
  { name: '김치', cat: 'veg', zoneType: 'fridge', slotHint: '하칸', size: '', count: 1, unit: '통', days: 30 }
];

function defaultSlotsFor(type) {
  const n = (name, door = false) => ({ id: uid(), name, door });
  if (type === 'freezer') return [n('상칸'), n('중칸'), n('하칸'), n('서랍칸'), n('문쪽', true)];
  if (type === 'room') return [n('선반'), n('바구니')];
  return [n('상칸'), n('중칸'), n('하칸'), n('야채칸'), n('문쪽(소스·음료)', true)];
}
function defaultZones() {
  return [
    { id: 'z_fridge', name: '냉장실', type: 'fridge', slots: defaultSlotsFor('fridge') },
    { id: 'z_freezer', name: '냉동실', type: 'freezer', slots: defaultSlotsFor('freezer') },
    { id: 'z_room', name: '실온(팬트리)', type: 'room', slots: defaultSlotsFor('room') }
  ];
}

/* =========================================================
 * 2. 유틸
 * ========================================================= */
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clone = (o) => JSON.parse(JSON.stringify(o));
const fmtNum = (n) => (Number.isInteger(n) ? String(n) : String(Math.round(n * 10) / 10));

function ymd(d) { const z = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`; }
function todayStr() { return ymd(new Date()); }
function parseYmd(s) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }
function addDays(s, n) { const d = parseYmd(s); d.setDate(d.getDate() + n); return ymd(d); }
function daysBetween(a, b) { return Math.round((parseYmd(b) - parseYmd(a)) / 86400000); } // b - a
function isYmd(s) { return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s); }
function shortDate(s) { if (!isYmd(s)) return ''; const [, m, d] = s.split('-'); return `${+m}/${+d}`; }

/* =========================================================
 * 3. 상태 저장/불러오기
 * ========================================================= */
function defaultState() {
  return {
    version: 1,
    zones: defaultZones(),
    items: [],
    shopping: [],
    freq: DEFAULT_FREQ.map((f) => ({ ...f, id: uid() })),
    rules: clone(DEFAULT_RULES),
    openRules: { ...DEFAULT_OPEN_RULES },
    ui: { tab: 'fridge', zoneId: 'z_fridge', mode: 'slot', open: {}, recipeTag: 'all', recipeOwned: true, addMode: 'single', combo: [], lastZoneId: '', lastSlotId: '' },
    lastBackup: null
  };
}

function normalize(d) {
  const base = defaultState();
  const s = { ...base, ...d };
  s.ui = { ...base.ui, ...(d.ui || {}) };
  if (!Array.isArray(s.ui.combo)) s.ui.combo = [];
  s.rules = {};
  for (const t in base.rules) s.rules[t] = { ...base.rules[t], ...((d.rules || {})[t] || {}) };
  s.openRules = { ...base.openRules, ...(d.openRules || {}) };

  if (!Array.isArray(s.zones) || !s.zones.length) s.zones = base.zones;
  s.zones = s.zones.map((z) => {
    const zone = { id: z.id || uid(), name: String(z.name || '구역'), type: ZONE_TYPES[z.type] ? z.type : 'fridge' };
    zone.slots = (Array.isArray(z.slots) ? z.slots : []).map((sl) => ({ id: sl.id || uid(), name: String(sl.name || '칸'), door: !!sl.door }));
    if (!zone.slots.length) zone.slots = [{ id: uid(), name: '기본 칸', door: false }];
    return zone;
  });

  s.items = (Array.isArray(s.items) ? s.items : []).filter((i) => i && i.name).map((i) => {
    const it = { id: i.id || uid(), name: String(i.name), cat: CAT[i.cat] ? i.cat : 'etc', zoneId: i.zoneId, slotId: i.slotId,
      size: i.size || '', count: Number(i.count) || 0, unit: i.unit || '팩', expiry: isYmd(i.expiry) ? i.expiry : '',
      opened: isYmd(i.opened) ? i.opened : '', memo: i.memo || '', created: i.created || todayStr() };
    const z = s.zones.find((zz) => zz.id === it.zoneId) || s.zones[0];
    it.zoneId = z.id;
    if (!z.slots.find((x) => x.id === it.slotId)) it.slotId = z.slots[0].id;
    return it;
  });
  s.shopping = (Array.isArray(s.shopping) ? s.shopping : []).filter((x) => x && x.name).map((x) => ({ id: x.id || uid(), name: String(x.name), done: !!x.done }));
  s.freq = Array.isArray(d.freq) ? d.freq.filter((f) => f && f.name).map((f) => ({ ...f, id: f.id || uid() })) : base.freq;
  if (!s.zones.find((z) => z.id === s.ui.zoneId)) s.ui.zoneId = s.zones[0].id;
  return s;
}

function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) return normalize(JSON.parse(raw));
  } catch (e) { console.warn('불러오기 실패', e); }
  return defaultState();
}

let S = load();
let saveTimer = null;
function saveNow() {
  clearTimeout(saveTimer);
  try { localStorage.setItem(STORE_KEY, JSON.stringify(S)); }
  catch (e) { toast('저장하지 못했어요. 설정 → 백업 내보내기를 해 두세요.'); }
}
function save() { clearTimeout(saveTimer); saveTimer = setTimeout(saveNow, 120); }
function commit() { save(); render(); }
window.addEventListener('pagehide', saveNow);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) saveNow();
  else render(); // 날짜가 바뀌었을 수 있으니 D-day 다시 계산
});

/* =========================================================
 * 4. 도메인 로직: 구역/칸, 소비기한, 신호등
 * ========================================================= */
const zoneById = (id) => S.zones.find((z) => z.id === id);
const slotOf = (z, id) => (z ? z.slots.find((s) => s.id === id) : null);
const itemById = (id) => S.items.find((i) => i.id === id);
function locText(it) { const z = zoneById(it.zoneId); const s = slotOf(z, it.slotId); return `${z ? z.name : '?'} · ${s ? s.name : '?'}`; }
function firstZoneOfType(t) { return S.zones.find((z) => z.type === t) || S.zones[0]; }
function findSlotByHint(z, hint) {
  if (!hint) return z.slots[0];
  return z.slots.find((s) => s.name === hint) || z.slots.find((s) => s.name.startsWith(hint) || hint.startsWith(s.name)) || z.slots[0];
}
function currentZone() { return zoneById(S.ui.zoneId) || S.zones[0]; }

function ruleDays(zoneType, cat) { const v = (S.rules[zoneType] || {})[cat]; return Number.isFinite(+v) ? +v : 7; }
function openDays(cat) { const v = S.openRules[cat]; return Number.isFinite(+v) ? +v : 30; }

function dueInfo(it) {
  const t = todayStr();
  let left = null; let reason = '';
  if (it.expiry) { left = daysBetween(t, it.expiry); reason = '소비기한'; }
  if (it.opened) {
    const od = openDays(it.cat);
    const l = daysBetween(t, addDays(it.opened, od));
    if (left === null || l < left) { left = l; reason = `개봉 후 ${od}일 기준`; }
  }
  const level = left === null ? 'none' : left <= 3 ? 'red' : left <= 7 ? 'yellow' : 'green';
  return { left, reason, level };
}
function ddayText(l) {
  if (l === null) return '기한 없음';
  if (l > 0) return `D-${l}`;
  if (l === 0) return 'D-day';
  return `${-l}일 지남`;
}
function sortByDue(arr) {
  return [...arr].sort((a, b) => {
    if ((a.count > 0) !== (b.count > 0)) return a.count > 0 ? -1 : 1;
    const da = dueInfo(a).left; const db = dueInfo(b).left;
    if (da === null && db === null) return a.name.localeCompare(b.name, 'ko');
    if (da === null) return 1;
    if (db === null) return -1;
    return da - db;
  });
}

// 이름으로 카테고리 추측 (앞에 있는 분류가 우선)
const CAT_KEYWORDS = [
  ['sauce', ['간장', '고추장', '된장', '쌈장', '소스', '케첩', '케찹', '마요', '드레싱', '식초', '참기름', '들기름', '올리고당', '물엿', '액젓', '젓갈', '새우젓', '맛술', '굴소스', '잼', '머스타드', '고춧가루']],
  ['egg', ['계란', '달걀', '메추리알', '유정란']],
  ['dairy', ['우유', '치즈', '요거트', '요구르트', '버터', '생크림', '두유']],
  ['drink', ['주스', '음료', '콜라', '사이다', '생수', '맥주', '탄산수', '커피', '식혜']],
  ['grain', ['쌀', '햇반', '즉석밥', '국수', '소면', '라면', '파스타', '떡', '빵', '만두', '어묵', '오뎅', '시리얼', '가루', '참치캔', '통조림']],
  ['meat', ['고기', '삼겹', '목살', '앞다리', '항정', '갈비', '닭', '오리', '차돌', '불고기', '베이컨', '햄', '스팸', '소시지', '소세지', '생선', '고등어', '갈치', '삼치', '연어', '오징어', '새우', '조개', '바지락', '홍합', '멸치', '대구', '동태', '명태', '낙지', '주꾸미', '쭈꾸미', '꽃게', '전복', '굴', '참치', '육포']],
  ['root', ['감자', '고구마', '당근', '무', '양파', '마늘', '생강', '연근', '우엉', '비트', '토란']],
  ['fruit', ['과일', '사과', '바나나', '딸기', '포도', '샤인머스캣', '귤', '감귤', '한라봉', '오렌지', '키위', '참외', '수박', '멜론', '복숭아', '자두', '체리', '블루베리', '망고', '파인애플', '레몬', '자몽', '아보카도', '단감', '홍시', '곶감', '석류']],
  ['veg', ['두부', '대파', '쪽파', '부추', '시금치', '상추', '깻잎', '배추', '양배추', '애호박', '호박', '오이', '브로콜리', '콩나물', '숙주', '버섯', '파프리카', '피망', '고추', '가지', '토마토', '미나리', '청경채', '반찬', '김치', '나물', '샐러드', '미역']]
];
// 한 글자 키워드(무·떡·닭 등)는 '단무지', '양파' 같은 오인식을 막으려고 앞/뒤에 붙을 때만 인정
function kwMatch(name, kw) { return kw.length === 1 ? (name.startsWith(kw) || name.endsWith(kw)) : name.includes(kw); }
function guessCategory(name) {
  const n = String(name).replace(/\s/g, '');
  if (!n) return null;
  for (const [cat, kws] of CAT_KEYWORDS) if (kws.some((k) => kwMatch(n, k))) return cat;
  return null;
}

function newItem(data) {
  const it = { id: uid(), name: '', cat: 'etc', zoneId: S.zones[0].id, slotId: S.zones[0].slots[0].id, size: '', count: 1, unit: '팩', expiry: '', opened: '', memo: '', created: todayStr(), ...data };
  S.items.push(it);
  return it;
}

function addToShopping(name) {
  const n = String(name).trim();
  if (!n) return false;
  if (S.shopping.some((x) => !x.done && x.name === n)) return false;
  S.shopping.unshift({ id: uid(), name: n, done: false });
  return true;
}

/* =========================================================
 * 5. 레시피 매칭
 * ========================================================= */
const ALIAS = {
  '계란': ['계란', '달걀', '유정란'],
  '돼지고기': ['돼지', '삼겹', '목살', '앞다리', '뒷다리', '항정', '수육용'],
  '소고기': ['소고기', '쇠고기', '한우', '불고기', '국거리', '차돌', '우둔', '홍두깨', '양지', '사태', '등심', '안심'],
  '닭': ['닭', '닭고기', '닭다리', '닭볶음', '닭봉', '닭날개', '통닭'],
  '닭가슴살': ['닭가슴살', '닭안심'],
  '밥': ['밥', '햇반', '즉석밥', '찬밥'],
  '쌀': ['쌀'],
  '대파': ['대파', '쪽파', '실파', '파채'],
  '버섯': ['버섯', '표고', '팽이', '새송이', '느타리', '양송이'],
  '소면': ['소면', '국수', '중면'],
  '햄': ['햄', '스팸', '런천미트'],
  '소시지': ['소시지', '소세지', '비엔나'],
  '참치': ['참치'],
  '어묵': ['어묵', '오뎅'],
  '떡': ['떡', '떡국떡', '가래떡'],
  '무': ['무', '무우'],
  '새우': ['새우'],
  '멸치': ['멸치'],
  '김치': ['김치', '묵은지'],
  '배추': ['배추', '알배기']
};
const EXCL = { '배추': ['김치'], '두부': ['순두부'], '무': ['단무지'], '닭': ['닭가슴살', '닭안심'] };
function normName(s) { return String(s).replace(/\s/g, ''); }
function nameMatches(name, ing) {
  const n = normName(name);
  if ((EXCL[ing] || []).some((x) => n.includes(x))) return false;
  return (ALIAS[ing] || [ing]).some((a) => kwMatch(n, a));
}
function scoreRecipe(r, owned) {
  const have = []; const miss = []; let urgent = 0;
  r.i.forEach((ing) => {
    const m = owned.filter((it) => nameMatches(it.name, ing));
    if (m.length) {
      const best = sortByDue(m)[0];
      const d = dueInfo(best);
      have.push({ ing, item: best, d });
      if (d.level === 'red') urgent += 2; else if (d.level === 'yellow') urgent += 1;
    } else miss.push(ing);
  });
  const rate = have.length / r.i.length;
  return { r, have, miss, rate, urgent, score: rate * 100 + urgent * 10 };
}

/* =========================================================
 * 6. 일괄 입력 파서  예) "삼겹살 120g 4팩 냉동 상칸"
 * ========================================================= */
const ZONE_WORDS = { '냉동': 'freezer', '냉동실': 'freezer', '냉장': 'fridge', '냉장실': 'fridge', '실온': 'room', '상온': 'room', '팬트리': 'room' };
function parseBulkLine(line) {
  const src = line.replace(/^\s*(?:[-*•·]|\d+[.)])\s*/, '') // "- 삼겹살", "1. 삼겹살" 같은 목록 기호 제거
    .replace(/[,，]/g, ' ')
    .replace(/(\d)\s*[x×*]\s*(\d)/gi, '$1 $2')
    .trim();
  if (!src) return null;
  const tokens = src.split(/\s+/);
  const r = { nameParts: [], size: '', count: null, unit: '', expiry: '', zone: null, slotToken: null };
  const rest = [];
  for (const t of tokens) {
    let m;
    if (/^\d+(\.\d+)?(g|kg|ml|mL|l|L|리터|그램)$/i.test(t)) { r.size = t; continue; }
    if ((m = t.match(/^(\d+(?:\.\d+)?)(팩|개|봉지|봉|모|단|병|통|캔|줄|장|마리|덩이|알|포기|조각)$/))) { r.count = +m[1]; r.unit = m[2]; continue; }
    if ((m = t.match(/^[x×*](\d+)$/i))) { r.count = +m[1]; continue; }
    if (/^\d+$/.test(t) && r.count === null) { r.count = +t; continue; }
    if ((m = t.match(/^(\d{4})[-./](\d{1,2})[-./](\d{1,2})$/))) { r.expiry = `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`; continue; }
    if ((m = t.match(/^(\d{1,2})[/.](\d{1,2})(까지)?$/))) {
      const y = new Date().getFullYear();
      let e = `${y}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
      if (daysBetween(todayStr(), e) < -60) e = `${y + 1}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
      r.expiry = e; continue;
    }
    if ((m = t.match(/^D-?(\d+)$/i)) || (m = t.match(/^\+(\d+)일?$/))) { r.expiry = addDays(todayStr(), +m[1]); continue; }
    rest.push(t);
  }
  // 구역 찾기
  const left = [];
  for (const t of rest) {
    if (!r.zone) {
      const z = S.zones.find((zz) => zz.name === t || zz.name.replace(/\(.*\)/, '') === t)
        || (t === '김냉' ? S.zones.find((zz) => /김치/.test(zz.name)) : null);
      if (z) { r.zone = z; continue; }
      if (ZONE_WORDS[t]) { r.zone = firstZoneOfType(ZONE_WORDS[t]); continue; }
    }
    left.push(t);
  }
  // 칸 찾기 (구역이 없으면 모든 구역에서 검색)
  const slotMatch = (z, t) => z.slots.find((s) => s.name === t) || (t.length >= 2 ? z.slots.find((s) => s.name.startsWith(t)) : null);
  const names = [];
  for (const t of left) {
    if (!r.slotToken) {
      if (r.zone) { const s = slotMatch(r.zone, t); if (s) { r.slot = s; r.slotToken = t; continue; } }
      else {
        for (const z of S.zones) { const s = slotMatch(z, t); if (s) { r.zone = z; r.slot = s; r.slotToken = t; break; } }
        if (r.slotToken) continue;
      }
    }
    names.push(t);
  }
  const name = names.join(' ').trim();
  if (!name) return null;
  const cat = guessCategory(name) || 'etc';
  if (!r.zone) {
    const lz = zoneById(S.ui.lastZoneId);
    r.zone = cat === 'meat' ? firstZoneOfType('freezer') : (lz || firstZoneOfType('fridge'));
  }
  if (!r.slot) r.slot = r.zone.slots[0];
  const expiry = r.expiry || addDays(todayStr(), ruleDays(r.zone.type, cat));
  return { name, cat, zoneId: r.zone.id, slotId: r.slot.id, size: r.size, count: r.count ?? 1, unit: r.unit || defaultUnit(cat), expiry, opened: '', memo: '' };
}

/* =========================================================
 * 7. 바텀시트 · 토스트 · 확인창
 * ========================================================= */
let sheetOpen = false; let sheetOnClose = null;
function openSheet(title, html, mount, onClose) {
  const wasOpen = sheetOpen;
  if (wasOpen && sheetOnClose) { const f = sheetOnClose; sheetOnClose = null; f(); }
  const root = $('#sheetRoot');
  root.innerHTML = `<div class="sheet-backdrop"><div class="sheet" role="dialog" aria-modal="true" aria-label="${esc(title)}"><div class="grab"></div><h3><span>${esc(title)}</span><button class="close" data-m="close" aria-label="닫기">✕</button></h3><div class="sheet-content">${html}</div></div></div>`;
  const bd = root.firstElementChild;
  bd.addEventListener('click', (e) => { if (e.target === bd || e.target.closest('[data-m="close"]')) closeSheet(); });
  sheetOpen = true; sheetOnClose = onClose || null;
  if (!wasOpen) history.pushState({ sheet: 1 }, '');
  if (mount) mount(bd.querySelector('.sheet-content'));
}
function teardownSheet() {
  $('#sheetRoot').innerHTML = '';
  sheetOpen = false;
  const f = sheetOnClose; sheetOnClose = null;
  if (f) f();
}
function closeSheet() {
  if (!sheetOpen) return;
  teardownSheet();
  if (history.state && history.state.sheet) history.back();
}
window.addEventListener('popstate', () => { if (sheetOpen) teardownSheet(); }); // 안드로이드 뒤로가기로 시트 닫기

function ask(title, msg, buttons) {
  openSheet(title, `<p class="sheet-info">${msg}</p><div class="ask-btns">${buttons.map((b, i) => `<button class="btn ${b.cls || ''} block" data-i="${i}">${esc(b.label)}</button>`).join('')}</div>`, (root) => {
    root.querySelectorAll('[data-i]').forEach((el) => el.addEventListener('click', () => {
      const b = buttons[+el.dataset.i];
      closeSheet();
      if (b.fn) b.fn();
    }));
  });
}

let toastTimer = null;
function toast(msg, actionLabel, actionFn) {
  const t = $('#toast');
  t.innerHTML = `<span>${esc(msg)}</span>${actionLabel ? `<button>${esc(actionLabel)}</button>` : ''}`;
  if (actionLabel) t.querySelector('button').onclick = () => { t.classList.remove('show'); actionFn(); };
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), actionLabel ? 4500 : 2200);
}

/* =========================================================
 * 8. 화면 렌더링
 * ========================================================= */
const TITLES = { fridge: '우리집 냉장고', add: '재료 등록', recipe: '오늘 뭐 먹지?', shop: '장보기', settings: '설정' };
let pendingPrefill = null; // 다른 화면에서 등록 화면으로 넘길 값
let bulkDraft = ''; let bulkRows = [];

function render() {
  const tab = S.ui.tab;
  document.querySelectorAll('.tabbar button').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  $('#pageTitle').textContent = TITLES[tab];
  const shopN = S.shopping.filter((x) => !x.done).length;
  const badge = $('#shopBadge'); badge.hidden = !shopN; badge.textContent = shopN;
  const live = S.items.filter((i) => i.count > 0);
  const red = live.filter((i) => dueInfo(i).level === 'red').length;
  $('#appbarInfo').innerHTML = tab === 'fridge' ? `재료 ${live.length}개${red ? ` · <b style="color:var(--red)">임박 ${red}</b>` : ''}` : '';
  const v = $('#view');
  if (tab === 'fridge') v.innerHTML = viewFridge();
  else if (tab === 'add') { v.innerHTML = viewAdd(); mountAdd(v); }
  else if (tab === 'recipe') v.innerHTML = viewRecipe();
  else if (tab === 'shop') { v.innerHTML = viewShop(); mountShop(v); }
  else if (tab === 'settings') { v.innerHTML = viewSettings(); mountSettings(v); }
}

/* ---------- 8-1. 냉장고 탭 ---------- */
function itemRow(it, showLoc) {
  const d = dueInfo(it);
  const unit = it.unit || '팩';
  let openBadge = '';
  if (it.opened) {
    const n = daysBetween(it.opened, todayStr()); const lim = openDays(it.cat);
    openBadge = `<span class="badge ${n >= lim ? 'red' : n >= lim - 7 ? 'yellow' : ''}">개봉 +${Math.max(0, n)}일</span>`;
  }
  const lv = it.count > 0 ? d.level : 'empty';
  const btn = it.count > 0
    ? `<button class="use-btn" data-act="use" data-id="${it.id}" aria-label="${esc(it.name)} 1${esc(unit)} 사용">-1${esc(unit)}</button>`
    : `<button class="use-btn shop" data-act="toShop" data-id="${it.id}">🛒담기</button>`;
  return `<div class="item lv-${lv}">
    <span class="sig"></span>
    <button class="item-main" data-act="itemMenu" data-id="${it.id}">
      <span class="item-name">${CAT[it.cat] ? CAT[it.cat].emoji : ''} ${esc(it.name)}${it.size ? ` <small>${esc(it.size)}</small>` : ''}</span>
      <span class="item-meta"><span class="dday">${it.count > 0 ? ddayText(d.left) : '다 씀'}</span>${it.expiry ? `<span>~${shortDate(it.expiry)}</span>` : ''}${openBadge}${showLoc ? `<span>${esc(locText(it))}</span>` : ''}${it.memo ? `<span>📝${esc(it.memo)}</span>` : ''}</span>
    </button>
    <div class="qty"><b>${fmtNum(it.count)}</b><small>${esc(unit)}</small></div>
    ${btn}
  </div>`;
}

function slotCard(z, sl) {
  const its = sortByDue(S.items.filter((i) => i.zoneId === z.id && i.slotId === sl.id));
  const live = its.filter((i) => i.count > 0);
  const red = live.filter((i) => dueInfo(i).level === 'red').length;
  const yel = live.filter((i) => dueInfo(i).level === 'yellow').length;
  const open = S.ui.open[sl.id] ?? its.length > 0;
  return `<section class="slot ${open ? 'open' : ''}">
    <button class="slot-head" data-act="toggleSlot" data-slot="${sl.id}" data-def="${its.length > 0 ? 1 : 0}" aria-expanded="${open}">
      <span class="slot-name">${sl.door ? '🚪 ' : ''}${esc(sl.name)}</span>
      <span class="pills"><span class="pill">${live.length}개</span>${red ? `<span class="pill red">임박 ${red}</span>` : ''}${yel ? `<span class="pill yellow">주의 ${yel}</span>` : ''}</span>
      <span class="chev">▾</span>
    </button>
    ${open ? `<div class="slot-body">${its.length ? its.map((i) => itemRow(i)).join('') : '<p class="empty-s">비어 있어요</p>'}
      <button class="btn text sm add-here" data-act="addHere" data-zone="${z.id}" data-slot="${sl.id}">+ 이 칸에 재료 등록</button></div>` : ''}
  </section>`;
}

function viewFridge() {
  const live = S.items.filter((i) => i.count > 0);
  const top = sortByDue(live).filter((i) => dueInfo(i).left !== null).slice(0, 3);
  let h = '';
  if (top.length) {
    h += `<h2 class="sec">⏰ 먼저 써야 할 재료 <small>임박순 최대 3개</small></h2><div class="urgent-list">${top.map((it) => {
      const d = dueInfo(it);
      return `<button class="urgent-card lv-${d.level}" data-act="itemMenu" data-id="${it.id}"><b>${esc(it.name)}</b><span class="dday">${ddayText(d.left)}</span><small>${esc(locText(it))}</small><small>남은 ${fmtNum(it.count)}${esc(it.unit)}</small></button>`;
    }).join('')}</div>`;
  } else if (!S.items.length) {
    h += `<div class="empty card"><span class="big">🧊</span>아직 등록된 재료가 없어요.<br>아래 <b>➕ 등록</b> 탭에서 자주 사는 재료를 한 번에 넣어 보세요.<br><br><button class="btn primary" data-act="tab" data-tab="add">재료 등록하러 가기</button></div>`;
  }
  h += `<div class="seg" role="tablist">
    <button data-act="mode" data-mode="slot" class="${S.ui.mode === 'slot' ? 'on' : ''}">칸별 보기</button>
    <button data-act="mode" data-mode="due" class="${S.ui.mode === 'due' ? 'on' : ''}">전체 임박순</button></div>`;

  if (S.ui.mode === 'due') {
    const all = sortByDue(S.items);
    h += all.length ? `<div class="card">${all.map((i) => itemRow(i, true)).join('')}</div>` : '<p class="empty">재료가 없어요.</p>';
    h += '<p class="hint">🔴 D-3 이하 · 🟡 D-7 이하 · 🟢 여유 — 개봉한 재료는 개봉일 기준도 함께 계산해요.</p>';
    return h;
  }
  h += `<div class="chips scroll" style="margin-bottom:10px">${S.zones.map((z) => {
    const its = S.items.filter((i) => i.zoneId === z.id && i.count > 0);
    const red = its.filter((i) => dueInfo(i).level === 'red').length;
    return `<button class="chip ${z.id === S.ui.zoneId ? 'on' : ''} ${red ? 'lv-red' : ''}" data-act="zone" data-zone="${z.id}">${ZONE_TYPES[z.type].emoji} ${esc(z.name)} <span class="n">${its.length}</span></button>`;
  }).join('')}</div>`;
  const z = currentZone();
  h += z.slots.map((sl) => slotCard(z, sl)).join('');
  h += `<div class="zone-actions"><button class="btn ghost" data-act="addSlot" data-zone="${z.id}">+ 칸 추가</button><button class="btn ghost" data-act="manageSlots" data-zone="${z.id}">✏️ 칸 이름·순서</button></div>`;
  return h;
}

/* ---------- 8-2. 품목 메뉴 / 수정 / 이동 / 개봉 ---------- */
function itemMenu(id) {
  const it = itemById(id); if (!it) return;
  const d = dueInfo(it);
  const unit = it.unit || '팩';
  openSheet(it.name, `<div class="sheet-info">${esc(locText(it))} · <b>${it.count > 0 ? ddayText(d.left) : '다 씀'}</b>${d.reason ? ` (${d.reason})` : ''}<br>남은 수량 ${fmtNum(it.count)}${esc(unit)}${it.size ? ` · 1${esc(unit)} ${esc(it.size)}` : ''}${it.opened ? ` · 개봉 ${shortDate(it.opened)}` : ''}</div>
    <div class="menu-grid">
      <button data-m="edit"><span class="e">✏️</span>수정</button>
      <button data-m="move"><span class="e">🔀</span>칸 이동</button>
      <button data-m="open"><span class="e">🫙</span>${it.opened ? '개봉일 변경' : '오늘 개봉'}</button>
      <button data-m="plus"><span class="e">➕</span>+1${esc(unit)}</button>
      <button data-m="shop"><span class="e">🛒</span>장보기 추가</button>
      <button data-m="del" class="danger"><span class="e">🗑️</span>삭제</button>
    </div>`, (root) => {
    root.addEventListener('click', (e) => {
      const b = e.target.closest('[data-m]'); if (!b) return;
      const m = b.dataset.m;
      if (m === 'edit') editSheet(it);
      else if (m === 'move') moveSheet(it);
      else if (m === 'open') {
        if (!it.opened) { it.opened = todayStr(); closeSheet(); commit(); toast(`${it.name} 오늘 개봉으로 기록했어요`); }
        else openedSheet(it);
      } else if (m === 'plus') { it.count += 1; closeSheet(); commit(); toast(`${it.name} ${fmtNum(it.count)}${unit}`); }
      else if (m === 'shop') { const ok = addToShopping(it.name); closeSheet(); commit(); toast(ok ? '장보기 목록에 담았어요' : '이미 장보기 목록에 있어요'); }
      else if (m === 'del') { closeSheet(); deleteItem(it); }
    });
  });
}

function deleteItem(it) {
  const idx = S.items.indexOf(it); if (idx < 0) return;
  S.items.splice(idx, 1); commit();
  toast(`${it.name} 삭제됨`, '되돌리기', () => { S.items.splice(Math.min(idx, S.items.length), 0, it); commit(); });
}

function useOne(id) {
  const it = itemById(id); if (!it || it.count <= 0) return;
  it.count = Math.max(0, Math.round((it.count - 1) * 10) / 10);
  commit();
  if (it.count === 0) {
    ask(`${it.name} 다 썼어요 🎉`, '0이 되었어요. 어떻게 할까요?', [
      { label: '🛒 장보기에 담고 냉장고에서 빼기', cls: 'primary', fn: () => { addToShopping(it.name); S.items = S.items.filter((x) => x !== it); commit(); toast('장보기 목록에 담았어요'); } },
      { label: '냉장고에서 빼기만', fn: () => { S.items = S.items.filter((x) => x !== it); commit(); } },
      { label: '0개로 남겨두기', cls: 'ghost' }
    ]);
  } else {
    toast(`${it.name} 남은 ${fmtNum(it.count)}${it.unit}`, '취소', () => { it.count += 1; commit(); });
  }
}

function editSheet(it) {
  openSheet('재료 수정', itemFormHTML(it, true), (root) => {
    bindItemForm(root.querySelector('form'), it, (data) => { Object.assign(it, data); closeSheet(); commit(); toast('수정했어요'); });
  });
}

function openedSheet(it) {
  openSheet('개봉일', `<div class="form"><label class="fld"><span>개봉한 날짜</span><input type="date" id="od" value="${esc(it.opened || todayStr())}" max="${todayStr()}"></label>
    <p class="hint">${esc(CAT[it.cat].name)}은(는) 개봉 후 ${openDays(it.cat)}일 안에 쓰는 걸 권장해요. (설정에서 변경)</p>
    <div class="btn-row"><button class="btn danger" data-m="clear">미개봉으로</button><button class="btn primary" data-m="ok">저장</button></div></div>`, (root) => {
    root.addEventListener('click', (e) => {
      const b = e.target.closest('[data-m]'); if (!b) return;
      if (b.dataset.m === 'clear') it.opened = '';
      else if (b.dataset.m === 'ok') { const v = $('#od', root).value; it.opened = isYmd(v) ? v : ''; }
      else return;
      closeSheet(); commit();
    });
  });
}

function moveSheet(it) {
  let zid = it.zoneId;
  const fromZone = zoneById(it.zoneId);
  const draw = (root) => {
    const z = zoneById(zid);
    const typeChanged = fromZone && z.type !== fromZone.type;
    const thaw = fromZone && fromZone.type === 'freezer' && z.type === 'fridge';
    let days = ruleDays(z.type, it.cat);
    if (thaw) days = Math.min(days, THAW_MAX[it.cat] ?? THAW_MAX.etc);
    root.innerHTML = `<div class="form">
      <div class="fld"><span>옮길 구역</span><div class="chips">${S.zones.map((zz) => `<button class="chip ${zz.id === zid ? 'on' : ''}" data-z="${zz.id}">${ZONE_TYPES[zz.type].emoji} ${esc(zz.name)}</button>`).join('')}</div></div>
      <label class="check"><input type="checkbox" id="recalc" ${typeChanged ? 'checked' : ''}> 소비기한 새로 계산 → ${shortDate(addDays(todayStr(), days))} (+${days}일${thaw ? ', 해동 기준' : ''})</label>
      <div class="fld"><span>칸 선택 — 누르면 바로 이동해요</span><div class="slot-grid">${z.slots.map((s) => `<button data-s="${s.id}" class="${z.id === it.zoneId && s.id === it.slotId ? 'cur' : ''}">${s.door ? '🚪 ' : ''}${esc(s.name)}</button>`).join('')}</div></div></div>`;
    root.querySelectorAll('[data-z]').forEach((b) => b.addEventListener('click', () => { zid = b.dataset.z; draw(root); }));
    root.querySelectorAll('[data-s]').forEach((b) => b.addEventListener('click', () => {
      const recalc = $('#recalc', root).checked;
      it.zoneId = zid; it.slotId = b.dataset.s;
      if (recalc) it.expiry = addDays(todayStr(), days);
      if (thaw && !/해동/.test(it.memo)) it.memo = (`해동 ${shortDate(todayStr())} ` + it.memo).trim();
      S.ui.zoneId = zid;
      closeSheet(); commit();
      toast(`${locText(it)}(으)로 옮겼어요`);
    }));
  };
  openSheet(`${it.name} 이동`, '', draw);
}

/* ---------- 8-3. 재료 입력 폼 (등록/수정 공용) ---------- */
// 기본 단위 목록 + (일괄 입력 등으로 들어온 '캔', '줄' 같은 다른 단위도 유지)
function unitOptions(selected) {
  const list = UNITS.includes(selected) || !selected ? UNITS : [...UNITS, selected];
  return list.map((u) => `<option value="${esc(u)}" ${u === selected ? 'selected' : ''}>${esc(u)}</option>`).join('');
}

function itemFormHTML(it, isEdit) {
  const z = zoneById(it.zoneId) || S.zones[0];
  return `<form class="form" autocomplete="off" novalidate>
    <label class="fld"><span>재료 이름</span><input name="name" value="${esc(it.name)}" placeholder="예: 삼겹살" enterkeyhint="next"></label>
    <div class="fld"><span>카테고리</span><div class="chips cats">${CATEGORIES.map((c) => `<button type="button" class="chip ${c.id === it.cat ? 'on' : ''}" data-cat="${c.id}">${c.emoji} ${c.name}</button>`).join('')}</div></div>
    <div class="row2">
      <label class="fld"><span>보관 구역</span><select name="zoneId">${S.zones.map((zz) => `<option value="${zz.id}" ${zz.id === z.id ? 'selected' : ''}>${ZONE_TYPES[zz.type].emoji} ${esc(zz.name)}</option>`).join('')}</select></label>
      <label class="fld"><span>칸</span><select name="slotId"></select></label>
    </div>
    <div class="row3">
      <label class="fld"><span>1팩 용량</span><input name="size" value="${esc(it.size)}" placeholder="120g"></label>
      <label class="fld"><span>수량</span><input name="count" type="number" inputmode="decimal" min="0" step="1" value="${esc(it.count)}"></label>
      <label class="fld"><span>단위</span><select name="unit">${unitOptions(it.unit || defaultUnit(it.cat))}</select></label>
    </div>
    <div class="fld"><span>소비기한 <em class="exp-hint"></em></span>
      <div class="inline"><input type="date" name="expiry" value="${esc(it.expiry)}"><button type="button" class="btn ghost sm" data-f="auto">↺ 자동</button></div>
      <div class="quick-days">${[1, 3, 7, 14, 30].map((n) => `<button type="button" data-days="${n}">+${n}일</button>`).join('')}<button type="button" data-days="">기한 없음</button></div>
    </div>
    <div class="fld open-wrap"><span>개봉일 <em class="open-hint"></em></span>
      <div class="inline"><input type="date" name="opened" value="${esc(it.opened)}" max="${todayStr()}"><button type="button" class="btn ghost sm" data-f="openToday">오늘 개봉</button><button type="button" class="btn ghost sm" data-f="openClear">미개봉</button></div>
    </div>
    <label class="fld"><span>메모</span><input name="memo" value="${esc(it.memo)}" placeholder="예: 아기용, 양념됨"></label>
    <button type="submit" class="btn primary block">${isEdit ? '수정 저장' : '냉장고에 넣기'}</button>
    ${isEdit ? '' : '<button type="button" class="btn text sm" data-f="saveFreq">☆ 지금 입력을 \'자주 사는 재료\'로 저장</button>'}
  </form>`;
}

function bindItemForm(form, it, onSave) {
  const f = form.elements;
  let cat = it.cat;
  let catTouched = !!it.name;
  let expTouched = !!it.expiry;
  let unitTouched = !!it.name; // 수정 화면·입고 등 이미 정해진 단위는 건드리지 않음
  const zoneSel = f.zoneId; const slotSel = f.slotId;
  const applyDefaultUnit = () => { if (!unitTouched) f.unit.value = defaultUnit(cat); };
  f.unit.addEventListener('change', () => { unitTouched = true; });
  const fillSlots = (keepId) => {
    const z = zoneById(zoneSel.value);
    slotSel.innerHTML = z.slots.map((s) => `<option value="${s.id}">${s.door ? '🚪 ' : ''}${esc(s.name)}</option>`).join('');
    if (keepId && z.slots.find((s) => s.id === keepId)) slotSel.value = keepId;
  };
  const update = () => {
    const z = zoneById(zoneSel.value); const sl = slotOf(z, slotSel.value);
    const d = ruleDays(z.type, cat);
    form.querySelector('.exp-hint').textContent = `· 추천: ${ZONE_TYPES[z.type].name} ${CAT[cat].name} +${d}일`;
    if (!expTouched) f.expiry.value = addDays(todayStr(), d);
    const showOpen = (sl && sl.door) || ['sauce', 'drink', 'dairy'].includes(cat) || !!f.opened.value;
    form.querySelector('.open-wrap').hidden = !showOpen;
    form.querySelector('.open-hint').textContent = `· 개봉 후 +${openDays(cat)}일 알림`;
    form.querySelectorAll('.cats .chip').forEach((c) => c.classList.toggle('on', c.dataset.cat === cat));
  };
  fillSlots(it.slotId);
  update();

  zoneSel.addEventListener('change', () => { fillSlots(); update(); });
  slotSel.addEventListener('change', update);
  f.expiry.addEventListener('input', () => { expTouched = true; });
  f.name.addEventListener('input', () => {
    if (catTouched) return;
    const g = guessCategory(f.name.value);
    if (g && g !== cat) { cat = g; applyDefaultUnit(); update(); }
  });
  form.addEventListener('click', (e) => {
    const c = e.target.closest('[data-cat]');
    if (c) { cat = c.dataset.cat; catTouched = true; applyDefaultUnit(); update(); return; }
    const dd = e.target.closest('[data-days]');
    if (dd) { expTouched = true; f.expiry.value = dd.dataset.days === '' ? '' : addDays(todayStr(), +dd.dataset.days); return; }
    const b = e.target.closest('[data-f]'); if (!b) return;
    const act = b.dataset.f;
    if (act === 'auto') { expTouched = false; update(); }
    else if (act === 'openToday') { f.opened.value = todayStr(); }
    else if (act === 'openClear') { f.opened.value = ''; }
    else if (act === 'saveFreq') {
      const name = f.name.value.trim(); if (!name) { toast('재료 이름을 먼저 입력해 주세요'); return; }
      const z = zoneById(zoneSel.value); const sl = slotOf(z, slotSel.value);
      S.freq = S.freq.filter((x) => x.name !== name);
      S.freq.push({ id: uid(), name, cat, zoneType: z.type, slotHint: sl ? sl.name : '', size: f.size.value.trim(), count: +f.count.value || 1, unit: f.unit.value.trim() || '팩' });
      saveNow(); toast(`'${name}' 자주 사는 재료에 저장`);
      const box = $('#freqBox'); if (box) box.innerHTML = freqChips();
    }
  });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = f.name.value.trim();
    if (!name) { toast('재료 이름을 입력해 주세요'); f.name.focus(); return; }
    const count = Math.max(0, +f.count.value || 0);
    onSave({
      name, cat, zoneId: zoneSel.value, slotId: slotSel.value,
      size: f.size.value.trim(), count, unit: f.unit.value.trim() || '팩',
      expiry: isYmd(f.expiry.value) ? f.expiry.value : '', opened: isYmd(f.opened.value) ? f.opened.value : '', memo: f.memo.value.trim()
    });
  });
}

/* ---------- 8-4. 등록 탭 ---------- */
function freqChips() {
  if (!S.freq.length) return '<p class="hint">아래 폼에서 ☆ 버튼으로 추가할 수 있어요.</p>';
  return `<div class="chips">${S.freq.map((fq) => `<button class="chip" data-act="quickAdd" data-id="${fq.id}">${CAT[fq.cat] ? CAT[fq.cat].emoji : ''} ${esc(fq.name)}</button>`).join('')}</div>`;
}

function viewAdd() {
  let h = `<div class="seg"><button data-act="addMode" data-mode="single" class="${S.ui.addMode === 'single' ? 'on' : ''}">하나씩 등록</button><button data-act="addMode" data-mode="bulk" class="${S.ui.addMode === 'bulk' ? 'on' : ''}">여러 줄 한 번에</button></div>`;
  if (S.ui.addMode === 'bulk') {
    h += `<div class="card form">
      <div class="fld"><span>한 줄에 하나씩: 이름 용량 수량 구역 칸 (순서 자유)</span>
      <code class="ex">삼겹살 120g 4팩 냉동 상칸
두부 1모 냉장 중칸
우유 900ml 1팩 문쪽 12/1
양파 3개 실온</code></div>
      <textarea id="bulkText" placeholder="메모장처럼 붙여 넣으세요">${esc(bulkDraft)}</textarea>
      <button class="btn ghost block" data-act="bulkParse">미리보기</button>
      <p class="hint">구역을 안 쓰면 육류는 냉동실, 나머지는 냉장실로 들어가요. 소비기한은 자동 계산되며 '11/30', 'D-5', '+5일'처럼 직접 적어도 돼요.</p>
    </div>`;
    if (bulkRows.length) {
      h += `<h2 class="sec">미리보기 <small>${bulkRows.length}개</small></h2><div class="card">${bulkRows.map((r, i) => `<div class="bulk-row"><span>${CAT[r.cat].emoji}</span><div class="grow"><b>${esc(r.name)}</b> ${r.size ? `<small>${esc(r.size)}</small>` : ''}<div class="meta">${fmtNum(r.count)}${esc(r.unit)} · ${esc(locText(r))} · ~${shortDate(r.expiry)}</div></div><button class="x" data-act="bulkDel" data-i="${i}" aria-label="빼기">✕</button></div>`).join('')}
        <button class="btn primary block" style="margin-top:10px" data-act="bulkSave">${bulkRows.length}개 모두 등록</button></div>`;
    }
    return h;
  }
  h += `<h2 class="sec">⚡ 자주 사는 재료 <small>탭하면 바로 등록</small></h2><div id="freqBox">${freqChips()}</div>`;
  h += `<h2 class="sec">✍️ 직접 입력</h2><div class="card" id="addFormBox"></div>`;
  return h;
}

function mountAdd(v) {
  if (S.ui.addMode === 'bulk') {
    const ta = $('#bulkText', v);
    if (ta) ta.addEventListener('input', () => { bulkDraft = ta.value; });
    return;
  }
  const box = $('#addFormBox', v);
  const lz = zoneById(S.ui.lastZoneId) || currentZone();
  const base = { name: '', cat: 'etc', zoneId: lz.id, slotId: slotOf(lz, S.ui.lastSlotId) ? S.ui.lastSlotId : lz.slots[0].id, size: '', count: 1, unit: '팩', expiry: '', opened: '', memo: '' };
  const pre = pendingPrefill; pendingPrefill = null;
  const it = { ...base, ...(pre ? pre.data : {}) };
  if (pre && pre.data.name) it.cat = guessCategory(pre.data.name) || 'etc';
  box.innerHTML = itemFormHTML(it, false);
  const form = box.querySelector('form');
  bindItemForm(form, { ...it, name: '' }, (data) => {
    newItem(data);
    S.ui.lastZoneId = data.zoneId; S.ui.lastSlotId = data.slotId;
    if (pre && pre.shopId) S.shopping = S.shopping.filter((x) => x.id !== pre.shopId);
    commit();
    toast(`${data.name} → ${locText(data)} 등록!`);
    const nameInput = $('#addFormBox input[name=name]'); if (nameInput) nameInput.focus();
  });
  if (it.name) form.elements.name.value = it.name;
  if (it.name) form.elements.name.dispatchEvent(new Event('input'));
}

function quickAdd(id) {
  const fq = S.freq.find((x) => x.id === id); if (!fq) return;
  const z = firstZoneOfType(fq.zoneType || 'fridge');
  const sl = findSlotByHint(z, fq.slotHint);
  const days = fq.days != null && Number.isFinite(+fq.days) ? +fq.days : ruleDays(z.type, fq.cat);
  const it = newItem({ name: fq.name, cat: CAT[fq.cat] ? fq.cat : 'etc', zoneId: z.id, slotId: sl.id, size: fq.size || '', count: +fq.count || 1, unit: fq.unit || '팩', expiry: addDays(todayStr(), days) });
  commit();
  toast(`${it.name} ${fmtNum(it.count)}${it.unit} → ${locText(it)}`, '수정', () => editSheet(it));
}

/* ---------- 8-5. 추천 탭 ---------- */
const TAG_NAMES = { kid: '👶 아이 반찬', adult: '🍲 어른용', bowl: '🍚 간단 한그릇' };
function comboUrl(names) { return 'https://www.10000recipe.com/recipe/list.html?q=' + names.map((n) => encodeURIComponent(n)).join('+'); }

function viewRecipe() {
  const owned = S.items.filter((i) => i.count > 0);
  let h = '';
  // 만개의레시피 조합 검색
  const ownedSorted = sortByDue(owned);
  const uniq = []; const seen = new Set();
  ownedSorted.forEach((it) => { const k = normName(it.name); if (!seen.has(k)) { seen.add(k); uniq.push(it); } });
  S.ui.combo = S.ui.combo.filter((n) => seen.has(normName(n)));
  const combo = S.ui.combo;
  h += `<div class="card combo"><h2 class="sec" style="margin-top:0">🔎 만개의레시피 조합 찾기 <small>1~3개 선택</small></h2>`;
  if (uniq.length) {
    h += `<div class="chips">${uniq.map((it) => { const d = dueInfo(it); const on = combo.includes(it.name); return `<button class="chip ${on ? 'on' : ''} lv-${d.level}" data-act="combo" data-name="${esc(it.name)}">${esc(it.name)}${d.level === 'red' ? ' ⏰' : ''}</button>`; }).join('')}</div>
      <a class="btn primary block ${combo.length ? '' : 'disabled'}" style="margin-top:10px" target="_blank" rel="noopener" href="${combo.length ? esc(comboUrl(combo)) : '#'}">만개의레시피에서 조합 찾기${combo.length ? ` (${combo.map(esc).join('+')})` : ''} ↗</a>`;
  } else h += '<p class="hint">냉장고에 재료를 등록하면 여기서 고를 수 있어요.</p>';
  h += '</div>';

  // 기본 레시피 추천
  h += `<h2 class="sec">🍳 냉장고 맞춤 추천 <small>매칭률·임박 재료 순</small></h2>
    <div class="chips scroll">${['all', 'kid', 'adult', 'bowl'].map((t) => `<button class="chip ${S.ui.recipeTag === t ? 'on' : ''}" data-act="rTag" data-tag="${t}">${t === 'all' ? '전체' : TAG_NAMES[t]}</button>`).join('')}</div>
    <label class="check"><input type="checkbox" data-act="rOwned" ${S.ui.recipeOwned ? 'checked' : ''}> 보유 재료가 1개 이상 들어가는 것만</label>`;
  let list = window.RECIPES.map((r, idx) => ({ ...scoreRecipe(r, owned), idx }));
  if (S.ui.recipeTag !== 'all') list = list.filter((x) => x.r.t.includes(S.ui.recipeTag));
  if (S.ui.recipeOwned) list = list.filter((x) => x.have.length > 0);
  list.sort((a, b) => b.score - a.score || a.miss.length - b.miss.length);
  if (!list.length) {
    h += `<p class="empty"><span class="big">🥕</span>${owned.length ? '조건에 맞는 레시피가 없어요. 체크를 풀면 전체 레시피를 볼 수 있어요.' : '재료를 등록하면 만들 수 있는 요리를 추천해 드려요.'}</p>`;
    return h;
  }
  h += list.slice(0, 50).map((x) => {
    const pct = Math.round(x.rate * 100);
    return `<article class="recipe">
      <div class="recipe-head"><h3>${esc(x.r.n)}</h3>${x.urgent ? '<span class="pill red">임박 재료 활용</span>' : ''}<span class="rate">${pct}%</span></div>
      <div class="bar"><i style="width:${pct}%"></i></div>
      <div class="ing">${x.have.map((hv) => `<span class="have lv-${hv.d.level}" title="${esc(hv.item.name)}">✓ ${esc(hv.ing)}${hv.d.level === 'red' ? ` ${ddayText(hv.d.left)}` : ''}</span>`).join('')}${x.miss.map((m) => `<span class="miss">${esc(m)}</span>`).join('')}</div>
      <div class="tags">${x.r.t.map((t) => `<span class="pill">${TAG_NAMES[t]}</span>`).join('')}</div>
      <details class="steps"><summary>조리 요약 보기</summary><p>${esc(x.r.s)}</p></details>
      <div class="btn-row">${x.miss.length ? `<button class="btn sm ghost" data-act="missToShop" data-i="${x.idx}">🛒 부족 ${x.miss.length}개 담기</button>` : '<span class="pill green" style="align-self:center">재료 다 있어요!</span>'}
      <a class="btn sm ghost" target="_blank" rel="noopener" href="${esc(comboUrl([x.r.n]))}">만개의레시피 ↗</a></div>
    </article>`;
  }).join('');
  return h;
}

/* ---------- 8-6. 장보기 탭 ---------- */
function viewShop() {
  const undone = S.shopping.filter((x) => !x.done); const done = S.shopping.filter((x) => x.done);
  const inList = new Set(S.shopping.filter((x) => !x.done).map((x) => x.name));
  const sugg = [...new Set(S.items.filter((i) => i.count <= 0 || (i.count <= 1 && dueInfo(i).level === 'red')).map((i) => i.name))].filter((n) => !inList.has(n));
  let h = `<form class="card inline" id="shopForm"><input id="shopInput" placeholder="살 것 입력 (예: 대파)" enterkeyhint="done"><button class="btn primary" type="submit">추가</button></form>`;
  if (sugg.length) h += `<h2 class="sec">💡 다 썼거나 거의 없는 재료</h2><div class="chips">${sugg.map((n) => `<button class="chip" data-act="shopAddName" data-name="${esc(n)}">+ ${esc(n)}</button>`).join('')}</div>`;
  h += `<h2 class="sec">🛒 살 것 <small>${undone.length}개</small></h2>`;
  const row = (x) => `<div class="shop-row ${x.done ? 'done' : ''}"><label><input type="checkbox" data-act="shopToggle" data-id="${x.id}" ${x.done ? 'checked' : ''}><span>${esc(x.name)}</span></label>
    <button class="btn sm ghost" data-act="shopIn" data-id="${x.id}">입고</button><button class="x" data-act="shopDel" data-id="${x.id}" aria-label="삭제">✕</button></div>`;
  h += undone.length ? `<div class="card">${undone.map(row).join('')}</div>` : '<p class="empty">살 것이 없어요 👍</p>';
  if (done.length) h += `<h2 class="sec">✅ 산 것 <small>${done.length}개</small></h2><div class="card">${done.map(row).join('')}</div>`;
  h += `<div class="btn-row" style="margin-top:8px"><button class="btn ghost" data-act="shopShare" ${undone.length ? '' : 'disabled'}>📤 목록 공유</button><button class="btn ghost" data-act="shopClear" ${done.length ? '' : 'disabled'}>산 것 지우기</button></div>
    <p class="hint">'입고'를 누르면 재료 등록 화면으로 이동하고, 저장하면 장보기 목록에서 빠져요.</p>`;
  return h;
}
function mountShop(v) {
  $('#shopForm', v).addEventListener('submit', (e) => {
    e.preventDefault();
    const inp = $('#shopInput', v);
    const names = inp.value.split(/[,\n]/).map((s) => s.trim()).filter(Boolean);
    let n = 0; names.forEach((nm) => { if (addToShopping(nm)) n++; });
    commit();
    if (n) toast(`${n}개 추가`); else if (names.length) toast('이미 목록에 있어요');
    const ni = $('#shopInput'); if (ni) ni.focus();
  });
}

/* ---------- 8-7. 설정 탭 ---------- */
let deferredInstall = null;
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferredInstall = e; if (S.ui.tab === 'settings') render(); });
window.addEventListener('appinstalled', () => { deferredInstall = null; toast('홈 화면에 설치됐어요!'); });

function viewSettings() {
  const standalone = window.matchMedia('(display-mode: standalone)').matches;
  let h = `<h2 class="sec">🗂️ 보관 구역 <small>김치냉장고·보조냉동고 추가 가능</small></h2><div class="card">`;
  h += S.zones.map((z, i) => `<div class="zone-row" data-zid="${z.id}">
      <input value="${esc(z.name)}" data-zf="name" aria-label="구역 이름">
      <select data-zf="type" aria-label="구역 종류">${Object.entries(ZONE_TYPES).map(([k, t]) => `<option value="${k}" ${z.type === k ? 'selected' : ''}>${t.emoji} ${t.name}</option>`).join('')}</select>
      <button class="icon-btn" data-zm="up" ${i === 0 ? 'disabled' : ''} aria-label="위로">↑</button>
      <button class="icon-btn" data-zm="down" ${i === S.zones.length - 1 ? 'disabled' : ''} aria-label="아래로">↓</button>
      <button class="icon-btn" data-zm="slots" aria-label="칸 편집">🧩</button>
      <button class="icon-btn" data-zm="del" aria-label="삭제">🗑️</button>
    </div>`).join('');
  h += `<form class="zone-row" id="zoneAdd"><input name="zname" placeholder="새 구역 (예: 김치냉장고)"><select name="ztype">${Object.entries(ZONE_TYPES).map(([k, t]) => `<option value="${k}">${t.emoji} ${t.name}</option>`).join('')}</select><button class="btn primary sm" type="submit">추가</button></form>
    <p class="hint">🧩 버튼으로 칸을 추가·이름 변경·순서 변경·삭제할 수 있어요. '종류'가 소비기한 계산 기준이에요.</p></div>`;

  h += `<h2 class="sec">📅 소비기한 기준표 <small>오늘 + N일</small></h2><div class="card"><table class="rules"><thead><tr><th>카테고리</th>${Object.values(ZONE_TYPES).map((t) => `<th>${t.name}</th>`).join('')}<th>개봉 후</th></tr></thead><tbody>
    ${CATEGORIES.map((c) => `<tr><td>${c.emoji} ${c.name}</td>${Object.keys(ZONE_TYPES).map((t) => `<td><input type="number" inputmode="numeric" min="0" data-rule="${t}.${c.id}" value="${ruleDays(t, c.id)}"></td>`).join('')}<td><input type="number" inputmode="numeric" min="0" data-open="${c.id}" value="${openDays(c.id)}"></td></tr>`).join('')}
    </tbody></table><button class="btn text sm" data-act="rulesReset">기본값으로 되돌리기</button>
    <p class="hint">냉동실에서 냉장실로 옮기면(해동) 육류·채소는 최대 2일로 다시 계산해요.</p></div>`;

  h += `<h2 class="sec">⚡ 자주 사는 재료 <small>탭해서 삭제</small></h2><div class="card"><div class="chips">${S.freq.map((fq) => `<button class="chip" data-act="freqDel" data-id="${fq.id}">${esc(fq.name)} <span class="x">✕</span></button>`).join('') || '<span class="hint">없음</span>'}</div>
    <p class="hint">등록 탭의 '☆ 자주 사는 재료로 저장'으로 추가해요.</p><button class="btn text sm" data-act="freqReset">기본 목록 불러오기</button></div>`;

  h += `<h2 class="sec">💾 백업 <small>마지막 백업: ${S.lastBackup || '없음'}</small></h2><div class="card">
    <div class="btn-row"><button class="btn primary" data-act="export">JSON 내보내기</button><label class="btn ghost">가져오기<input type="file" id="importFile" accept="application/json,.json" hidden></label></div>
    <p class="hint">데이터는 이 기기 브라우저에만 저장돼요. 폰을 바꾸거나 브라우저 데이터를 지우기 전에 꼭 내보내 두세요.</p>
    <button class="btn danger block" data-act="resetAll">모든 데이터 초기화</button></div>`;

  h += `<h2 class="sec">📱 앱 설치</h2><div class="card">${standalone ? '<p class="hint" style="margin:0">✅ 앱으로 실행 중이에요.</p>'
    : deferredInstall ? '<button class="btn primary block" data-act="install">홈 화면에 앱 설치</button>'
      : '<p class="hint" style="margin:0">크롬 오른쪽 위 ⋮ 메뉴 → <b>홈 화면에 추가</b>(또는 <b>앱 설치</b>)를 누르세요. https 주소에서 열어야 설치 메뉴가 떠요.</p>'}</div>
    <p class="hint" style="text-align:center">레시피 ${window.RECIPES.length}종 내장 · 오프라인 사용 가능</p>`;
  return h;
}

function mountSettings(v) {
  // 구역 이름/종류 변경
  v.querySelectorAll('.zone-row[data-zid]').forEach((row) => {
    const z = zoneById(row.dataset.zid);
    row.querySelector('[data-zf=name]').addEventListener('change', (e) => { z.name = e.target.value.trim() || z.name; save(); });
    row.querySelector('[data-zf=type]').addEventListener('change', (e) => { z.type = e.target.value; commit(); });
    row.addEventListener('click', (e) => {
      const b = e.target.closest('[data-zm]'); if (!b) return;
      const i = S.zones.indexOf(z);
      const m = b.dataset.zm;
      if (m === 'up' && i > 0) { [S.zones[i - 1], S.zones[i]] = [S.zones[i], S.zones[i - 1]]; commit(); }
      else if (m === 'down' && i < S.zones.length - 1) { [S.zones[i + 1], S.zones[i]] = [S.zones[i], S.zones[i + 1]]; commit(); }
      else if (m === 'slots') slotManager(z.id);
      else if (m === 'del') {
        if (S.zones.length <= 1) { toast('구역은 최소 1개 필요해요'); return; }
        const its = S.items.filter((it) => it.zoneId === z.id);
        const target = S.zones.find((zz) => zz !== z);
        const msg = its.length ? `'${z.name}' 구역을 삭제할까요?\n안의 재료 ${its.length}개는 '${target.name} · ${target.slots[0].name}'으로 옮겨져요.` : `'${z.name}' 구역을 삭제할까요?`;
        if (!confirm(msg)) return;
        its.forEach((it) => { it.zoneId = target.id; it.slotId = target.slots[0].id; });
        S.zones.splice(i, 1);
        if (S.ui.zoneId === z.id) S.ui.zoneId = S.zones[0].id;
        commit();
      }
    });
  });
  $('#zoneAdd', v).addEventListener('submit', (e) => {
    e.preventDefault();
    const name = e.target.zname.value.trim(); const type = e.target.ztype.value;
    if (!name) { toast('구역 이름을 입력해 주세요'); return; }
    const slots = /김치/.test(name) ? ['상칸', '중칸', '하칸'].map((n) => ({ id: uid(), name: n, door: false })) : defaultSlotsFor(type);
    const z = { id: uid(), name, type, slots };
    S.zones.push(z); S.ui.zoneId = z.id; commit(); toast(`'${name}' 구역 추가! 🧩로 칸을 바꿀 수 있어요`);
  });
  // 기준표
  v.querySelectorAll('[data-rule]').forEach((inp) => inp.addEventListener('change', () => {
    const [t, c] = inp.dataset.rule.split('.'); const n = Math.max(0, parseInt(inp.value, 10) || 0); S.rules[t][c] = n; inp.value = n; save();
  }));
  v.querySelectorAll('[data-open]').forEach((inp) => inp.addEventListener('change', () => {
    const n = Math.max(0, parseInt(inp.value, 10) || 0); S.openRules[inp.dataset.open] = n; inp.value = n; save();
  }));
  // 가져오기
  $('#importFile', v).addEventListener('change', (e) => {
    const file = e.target.files[0]; if (!file) return;
    const rd = new FileReader();
    rd.onload = () => {
      try {
        const d = JSON.parse(rd.result);
        const st = d && d.state ? d.state : d;
        if (!st || !Array.isArray(st.zones) || !Array.isArray(st.items)) throw new Error('형식 오류');
        if (!confirm(`백업 파일의 재료 ${st.items.length}개로 현재 데이터를 덮어쓸까요?`)) return;
        S = normalize(st); S.ui.tab = 'settings'; saveNow(); render(); toast('백업을 불러왔어요');
      } catch (err) { toast('올바른 백업 파일이 아니에요'); }
    };
    rd.readAsText(file);
    e.target.value = '';
  });
}

function slotManager(zid) {
  const z = zoneById(zid); if (!z) return;
  const draw = (root) => {
    root.innerHTML = `${z.slots.map((s, i) => `<div class="slot-edit" data-i="${i}">
      <input value="${esc(s.name)}" aria-label="칸 이름">
      <button class="icon-btn ${s.door ? 'on' : ''}" data-sm="door" title="개봉일 기록 칸(문쪽)" aria-label="개봉일 칸 전환">🚪</button>
      <button class="icon-btn" data-sm="up" ${i === 0 ? 'disabled' : ''} aria-label="위로">↑</button>
      <button class="icon-btn" data-sm="down" ${i === z.slots.length - 1 ? 'disabled' : ''} aria-label="아래로">↓</button>
      <button class="icon-btn" data-sm="del" aria-label="삭제">🗑️</button></div>`).join('')}
      <button class="btn ghost block" data-sm="add">+ 칸 추가</button>
      <p class="hint">🚪 켜진 칸은 등록할 때 개봉일 입력이 기본으로 보이고 '개봉 +N일' 배지가 붙어요.</p>`;
  };
  openSheet(`${z.name} 칸 편집`, '', (root) => {
    draw(root);
    root.addEventListener('input', (e) => {
      const row = e.target.closest('.slot-edit'); if (!row) return;
      const s = z.slots[+row.dataset.i]; if (s) { s.name = e.target.value.trim() || s.name; save(); }
    });
    root.addEventListener('click', (e) => {
      const b = e.target.closest('[data-sm]'); if (!b) return;
      const row = b.closest('.slot-edit'); const i = row ? +row.dataset.i : -1;
      const m = b.dataset.sm;
      if (m === 'add') { z.slots.push({ id: uid(), name: `새 칸 ${z.slots.length + 1}`, door: false }); save(); draw(root); const ins = root.querySelectorAll('.slot-edit input'); const last = ins[ins.length - 1]; last.focus(); last.select(); return; }
      if (m === 'door') { z.slots[i].door = !z.slots[i].door; }
      else if (m === 'up' && i > 0) { [z.slots[i - 1], z.slots[i]] = [z.slots[i], z.slots[i - 1]]; }
      else if (m === 'down' && i < z.slots.length - 1) { [z.slots[i + 1], z.slots[i]] = [z.slots[i], z.slots[i + 1]]; }
      else if (m === 'del') {
        if (z.slots.length <= 1) { toast('칸은 최소 1개 필요해요'); return; }
        const s = z.slots[i]; const its = S.items.filter((it) => it.zoneId === z.id && it.slotId === s.id);
        const target = z.slots[i === 0 ? 1 : 0];
        if (!confirm(its.length ? `'${s.name}' 칸을 삭제할까요?\n안의 재료 ${its.length}개는 '${target.name}'으로 옮겨져요.` : `'${s.name}' 칸을 삭제할까요?`)) return;
        its.forEach((it) => { it.slotId = target.id; });
        z.slots.splice(i, 1);
      }
      save(); draw(root);
    });
  }, () => render());
}

function addSlotPrompt(zid) {
  const z = zoneById(zid); if (!z) return;
  openSheet(`${z.name}에 칸 추가`, `<form class="form"><label class="fld"><span>칸 이름</span><input name="n" placeholder="예: 반찬통 칸, 아기 이유식 칸" enterkeyhint="done"></label>
    <label class="check"><input type="checkbox" name="door"> 🚪 개봉일 기록 칸 (소스·음료 등)</label><button class="btn primary block" type="submit">추가</button></form>`, (root) => {
    const form = root.querySelector('form');
    setTimeout(() => form.n.focus(), 50);
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const n = form.n.value.trim(); if (!n) { toast('칸 이름을 입력해 주세요'); return; }
      const s = { id: uid(), name: n, door: form.door.checked };
      z.slots.push(s); S.ui.open[s.id] = true;
      closeSheet(); commit(); toast(`'${n}' 칸 추가`);
    });
  });
}

/* =========================================================
 * 9. 클릭 이벤트 (이벤트 위임)
 * ========================================================= */
const ACTIONS = {
  tab(el) { S.ui.tab = el.dataset.tab; save(); render(); window.scrollTo(0, 0); },
  zone(el) { S.ui.zoneId = el.dataset.zone; commit(); },
  mode(el) { S.ui.mode = el.dataset.mode; commit(); },
  toggleSlot(el) { const id = el.dataset.slot; const cur = S.ui.open[id] ?? el.dataset.def === '1'; S.ui.open[id] = !cur; commit(); },
  use(el) { useOne(el.dataset.id); },
  toShop(el) { const it = itemById(el.dataset.id); if (!it) return; const ok = addToShopping(it.name); S.items = S.items.filter((x) => x !== it); commit(); toast(ok ? `${it.name} 장보기에 담고 정리했어요` : '이미 장보기 목록에 있어요'); },
  itemMenu(el) { itemMenu(el.dataset.id); },
  addSlot(el) { addSlotPrompt(el.dataset.zone); },
  manageSlots(el) { slotManager(el.dataset.zone); },
  addHere(el) { S.ui.lastZoneId = el.dataset.zone; S.ui.lastSlotId = el.dataset.slot; S.ui.addMode = 'single'; S.ui.tab = 'add'; commit(); window.scrollTo(0, 0); },
  addMode(el) { S.ui.addMode = el.dataset.mode; commit(); },
  quickAdd(el) { quickAdd(el.dataset.id); },
  bulkParse() {
    const ta = $('#bulkText'); bulkDraft = ta ? ta.value : bulkDraft;
    bulkRows = bulkDraft.split('\n').map(parseBulkLine).filter(Boolean);
    if (!bulkRows.length) toast('인식된 재료가 없어요'); render();
  },
  bulkDel(el) { bulkRows.splice(+el.dataset.i, 1); render(); },
  bulkSave() {
    const n = bulkRows.length; if (!n) return;
    bulkRows.forEach((r) => newItem(r));
    const firstZone = bulkRows[0].zoneId;
    bulkRows = []; bulkDraft = '';
    S.ui.zoneId = firstZone; S.ui.tab = 'fridge'; S.ui.mode = 'slot';
    commit(); window.scrollTo(0, 0); toast(`${n}개 재료를 등록했어요`);
  },
  combo(el) {
    const n = el.dataset.name; const c = S.ui.combo;
    if (c.includes(n)) S.ui.combo = c.filter((x) => x !== n);
    else if (c.length >= 3) { toast('최대 3개까지 고를 수 있어요'); return; }
    else c.push(n);
    commit();
  },
  rTag(el) { S.ui.recipeTag = el.dataset.tag; commit(); },
  rOwned(el) { S.ui.recipeOwned = el.checked; commit(); },
  missToShop(el) {
    const r = window.RECIPES[+el.dataset.i]; const owned = S.items.filter((i) => i.count > 0);
    const miss = scoreRecipe(r, owned).miss; let n = 0; miss.forEach((m) => { if (addToShopping(m)) n++; });
    commit(); toast(n ? `${miss.join(', ')} 장보기에 담았어요` : '이미 장보기 목록에 있어요');
  },
  shopToggle(el) { const x = S.shopping.find((s) => s.id === el.dataset.id); if (x) { x.done = el.checked; commit(); } },
  shopDel(el) { S.shopping = S.shopping.filter((s) => s.id !== el.dataset.id); commit(); },
  shopAddName(el) { addToShopping(el.dataset.name); commit(); },
  shopIn(el) { const x = S.shopping.find((s) => s.id === el.dataset.id); if (!x) return; pendingPrefill = { data: { name: x.name }, shopId: x.id }; S.ui.addMode = 'single'; S.ui.tab = 'add'; commit(); window.scrollTo(0, 0); },
  shopClear() { S.shopping = S.shopping.filter((s) => !s.done); commit(); },
  async shopShare() {
    const text = '🛒 장보기 목록\n' + S.shopping.filter((s) => !s.done).map((s) => `- ${s.name}`).join('\n');
    try {
      if (navigator.share) await navigator.share({ text });
      else { await navigator.clipboard.writeText(text); toast('목록을 복사했어요'); }
    } catch (e) { /* 공유 취소 */ }
  },
  freqDel(el) { S.freq = S.freq.filter((f) => f.id !== el.dataset.id); commit(); },
  freqReset() { const names = new Set(S.freq.map((f) => f.name)); DEFAULT_FREQ.forEach((f) => { if (!names.has(f.name)) S.freq.push({ ...f, id: uid() }); }); commit(); },
  rulesReset() { if (!confirm('소비기한 기준을 기본값으로 되돌릴까요?')) return; S.rules = clone(DEFAULT_RULES); S.openRules = { ...DEFAULT_OPEN_RULES }; commit(); },
  export() {
    S.lastBackup = todayStr(); saveNow();
    const data = JSON.stringify({ app: 'fridge-pwa', exportedAt: new Date().toISOString(), state: S }, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = `냉장고백업-${todayStr()}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    render(); toast('백업 파일을 저장했어요 (다운로드 폴더)');
  },
  resetAll() {
    if (!confirm('모든 재료·구역·장보기 데이터를 지울까요? 되돌릴 수 없어요.')) return;
    if (!confirm('정말 초기화할까요? 백업을 먼저 내보내는 걸 추천해요.')) return;
    S = defaultState(); saveNow(); render(); toast('초기화했어요');
  },
  async install() { if (!deferredInstall) return; deferredInstall.prompt(); await deferredInstall.userChoice; deferredInstall = null; render(); }
};

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act], .tabbar [data-tab]');
  if (!el) return;
  const act = el.dataset.act || 'tab';
  if (el.tagName === 'A') return; // 외부 링크는 기본 동작
  if (ACTIONS[act]) ACTIONS[act](el, e);
});

/* =========================================================
 * 10. 시작
 * ========================================================= */
render();
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => { navigator.serviceWorker.register('./sw.js').catch((err) => console.warn('SW 등록 실패', err)); });
}
if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});

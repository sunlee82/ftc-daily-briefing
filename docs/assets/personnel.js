// 인사발령 — data/personnel.json을 읽어 한 줄씩 나열하고 이름으로 찾을 수 있게 한다.
// 줄 형식은 브리핑 상세의 위원회 소식과 같게 맞추고, 발령일만 맨 뒤에 붙인다.
// 자료는 위원회 소식에서 배포 워크플로우가 누적한다. (순수 JS, 빌드 없음)
"use strict";

function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

// 화면에는 연도를 빼고 7/20 형태로 보여준다 (검색은 전체 날짜로 계속 걸린다)
function shortDate(s) {
  const m = /^\d{4}-(\d{2})-(\d{2})$/.exec(String(s || ""));
  return m ? `${+m[1]}/${+m[2]}` : String(s || "");
}

let ALL = [];
let TIER = "all";

// ── 직급 구분 (2026-10) ─────────────────────────────────────────────
// 조직개편 날엔 하루 200건 넘게 쌓여서, 직급으로 걸러 볼 수 있게 했다.
// 직급 칸이 비어 있으면 발령 내용("행정사무관(일반임기제)에 임함" 등)에서 찾는다.
// 순서가 중요하다 — "서기관"이 "서기"보다, "부이사관"이 "이사"보다 먼저 걸려야 한다.
const TIERS = [
  { key: "senior",  label: "국장급 이상", re: /고위공무원|상임위원(?!.*조정원)|위원장|사무처장/ },
  { key: "manager", label: "과장급",      re: /부이사관|서기관|참사관/ },
  { key: "officer", label: "사무관",      re: /사무관/ },
  { key: "staff",   label: "주무관",      re: /주사|서기|전문경력관|임기제|수습/ },
];
function tierOf(r) {
  const rank = String(r.rank || "");
  const text = rank || String(r.action || "");
  // 한국공정거래조정원·소비자원 등 산하기관 임원 임명은 공정위 직급 체계 밖이다
  if (!rank && /조정원|소비자원|이사에 임명/.test(text)) return "etc";
  for (const t of TIERS) if (t.re.test(text)) return t.key;
  return "etc";
}

// 국·과장 등 보직을 새로 맡는 발령 — 실무상 가장 중요한 정보라 표시를 붙인다
const POST_RE = /(국장|과장|심의관|정책관|조사관|관리관|기획관|담당관|단장|팀장|소장|대변인|실장)(에|으로)?\s*보함/;
function isPost(r) {
  return r.type === "보임" || POST_RE.test(String(r.action || ""));
}

function lineHTML(r) {
  const names = (r.names || [])
    .map((n) => `<strong class="person-name">${esc(n)}</strong>`)
    .join("·");
  // 직급이 있으면 이름과 한 칸 띄고, 직급 없이 소속만 있으면 이름에 바로 붙인다
  const org = r.org ? `(${r.org})` : "";
  const rankOrg = r.rank ? ` ${r.rank}${org}` : org;
  const post = isPost(r) ? `<span class="pr-post">보직</span>` : "";
  return `<li class="pr-line${isPost(r) ? " is-post" : ""}">
    <span class="pr-text">${post}${names}${esc(rankOrg)} &ndash; ${esc(r.action)}</span>
  </li>`;
}

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];
function dayLabel(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ""));
  if (!m) return esc(s || "날짜 미상");
  const wd = WEEKDAYS[new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).getUTCDay()];
  return `${+m[1]}.${+m[2]}.${+m[3]}.(${wd})`;
}

// 발령일별로 묶는다. 하루 안에서는 보직 발령을 먼저, 그다음 직급 높은 순.
const TIER_ORDER = { senior: 0, manager: 1, officer: 2, staff: 3, etc: 4 };
function render(list) {
  const el = document.getElementById("records");
  if (!list.length) {
    el.innerHTML = `<p class="empty">찾는 조건에 맞는 발령이 없습니다.</p>`;
    return;
  }
  const byDate = new Map();
  for (const r of list) {
    const k = r.date || "";
    if (!byDate.has(k)) byDate.set(k, []);
    byDate.get(k).push(r);
  }
  const dates = [...byDate.keys()].sort().reverse();
  el.innerHTML = dates.map((d) => {
    const rows = byDate.get(d).slice().sort((a, b) =>
      (isPost(b) - isPost(a)) || (TIER_ORDER[tierOf(a)] - TIER_ORDER[tierOf(b)]));
    const posts = rows.filter(isPost).length;
    return `<section class="pr-day">
      <h2 class="pr-day-title">${dayLabel(d)} <small>${rows.length}건${posts ? ` · 보직 ${posts}건` : ""}</small></h2>
      <div class="pr-panel"><ul class="pr-list">${rows.map(lineHTML).join("")}</ul></div>
    </section>`;
  }).join("");
}

function tabsHTML(base) {
  const count = (k) => base.filter((r) => tierOf(r) === k).length;
  const tabs = [{ key: "all", label: "전체", n: base.length },
    ...TIERS.map((t) => ({ key: t.key, label: t.label, n: count(t.key) })),
    { key: "etc", label: "기타", n: count("etc") }].filter((t) => t.key === "all" || t.n);
  return tabs.map((t) =>
    `<button type="button" class="pr-tab${t.key === TIER ? " on" : ""}" data-tier="${t.key}">${esc(t.label)} <span>${t.n}</span></button>`
  ).join("");
}

function applyFilter() {
  const q = document.getElementById("q").value.trim().toLowerCase();
  // 검색어로 먼저 거르고(탭 숫자도 이 결과 기준), 그다음 직급 탭으로 거른다
  const base = !q ? ALL : ALL.filter((r) => {
    const hay = [(r.names || []).join(" "), r.rank, r.org, r.action, r.type, r.date]
      .join(" ").toLowerCase();
    return hay.includes(q);
  });
  const list = TIER === "all" ? base : base.filter((r) => tierOf(r) === TIER);
  document.getElementById("tabs").innerHTML = tabsHTML(base);
  const people = new Set(list.flatMap((r) => r.names || []));
  document.getElementById("summary").innerHTML =
    `발령 <strong>${list.length}</strong>건 · 인원 <strong>${people.size}</strong>명` +
    (q ? ` · &ldquo;<strong>${esc(q)}</strong>&rdquo; 검색 결과` : "");
  render(list);
}

document.addEventListener("click", (e) => {
  const b = e.target.closest(".pr-tab");
  if (!b) return;
  TIER = b.dataset.tier;
  applyFilter();
});

async function load() {
  const el = document.getElementById("records");
  try {
    const res = await fetch("data/personnel.json", { cache: "no-store" });
    if (!res.ok) throw new Error("personnel.json 응답 오류: " + res.status);
    const d = await res.json();
    ALL = Array.isArray(d.records) ? d.records : [];
    document.getElementById("q").addEventListener("input", applyFilter);
    applyFilter();
  } catch (err) {
    el.innerHTML = `<p class="error">인사발령 자료를 불러오지 못했습니다.<br /><small>${esc(err.message)}</small></p>`;
  }
}

load();

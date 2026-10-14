// 주제별 모아보기 — 모든 브리핑 항목을 topics 태그로 걸러 최신순으로 보여준다. (순수 JS, 빌드 없음)
// 태그는 배포 단계(Claude)가 붙이고, 옛 항목은 tool/pipeline/topics.js가 소급해 매겼다.
"use strict";

function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

// tool/pipeline/topics.js 의 TOPICS와 같은 순서·라벨
const TOPICS = [
  { key: "cartel", label: "담합", desc: "담합·카르텔·리니언시" },
  { key: "subcon", label: "하도급·갑을", desc: "하도급·가맹·대리점·유통" },
  { key: "group", label: "기업집단·내부거래", desc: "총수·사익편취·지주회사·상표권·공시" },
  { key: "consumer", label: "소비자·표시광고", desc: "표시광고·약관·전자상거래·다크패턴" },
  { key: "platform", label: "플랫폼·디지털", desc: "플랫폼·앱마켓·AI·디지털 시장" },
  { key: "merger", label: "기업결합", desc: "M&A 심사·시정조치 이행" },
  { key: "institution", label: "조직·절차·입법", desc: "공정위 조직·절차·국회·입법" },
  { key: "enforce", label: "제재·소송", desc: "과징금·고발·행정소송·판결" },
  { key: "etc", label: "기타", desc: "주제가 붙지 않은 항목" },
];
const LABEL = Object.fromEntries(TOPICS.map((t) => [t.key, t.label]));
const CAT_LABEL = { press: "보도자료", committee: "위원회", news: "뉴스" };
const CAT_CLASS = { press: "press", committee: "cmte", news: "news" };
const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

function fmtDate(id) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(id);
  if (!m) return esc(id);
  const wd = WEEKDAYS[new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).getUTCDay()];
  return `${+m[1]}.${+m[2]}.${+m[3]}.(${wd})`;
}
function rich(s) {
  return esc(s)
    .replace(/##\[(.+?)\]##/g, "<strong>$1</strong>")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\n/g, "<br>");
}
// 보도자료 요약은 "리드 + - 항목" 구조 → 리드만 보여주고 나머지는 상세로
function lead(summary) {
  const lines = String(summary || "").split("\n").map((l) => l.trim()).filter(Boolean);
  const l = lines.find((x) => !x.startsWith("- ")) || lines[0] || "";
  return l.length > 160 ? l.slice(0, 160) + "…" : l;
}

let ALL = [];        // {id, idx, it}
let TOPIC = "cartel";
const PAGE = 30;
let shown = PAGE;

function keysOf(it) {
  const k = Array.isArray(it.topics) ? it.topics.filter((x) => LABEL[x]) : [];
  return k.length ? k : ["etc"];
}

function rowHTML({ id, idx, it }) {
  const cat = it.category || "news";
  const chips = keysOf(it).filter((k) => k !== TOPIC).map((k) => `<span class="tp-chip">${esc(LABEL[k])}</span>`).join("");
  const src = it.source_url
    ? `<a class="src-inline" href="${esc(it.source_url)}" target="_blank" rel="noopener">원문 ↗</a>` : "";
  return `<article class="item tp-item">
    <div class="item-row">
      <h3><span class="sr-cat is-${CAT_CLASS[cat]}">${esc(CAT_LABEL[cat] || "뉴스")}</span>${esc(it.headline)}</h3>
      ${src}
    </div>
    <p>${rich(lead(it.summary))}</p>
    <div class="tp-foot">
      <a class="sk-day" href="briefing.html?date=${encodeURIComponent(id)}#item-${idx}">${fmtDate(id)} 브리핑 →</a>
      ${chips}
    </div>
  </article>`;
}

function render() {
  const el = document.getElementById("list");
  const q = (document.getElementById("q").value || "").trim().toLowerCase();
  const terms = q.split(/\s+/).filter(Boolean);
  const list = ALL.filter((r) => keysOf(r.it).includes(TOPIC))
    .filter((r) => !terms.length || terms.every((t) => `${r.it.headline} ${r.it.summary}`.toLowerCase().includes(t)));

  // 탭 숫자 — 검색어가 있으면 검색 결과 기준
  const base = terms.length
    ? ALL.filter((r) => terms.every((t) => `${r.it.headline} ${r.it.summary}`.toLowerCase().includes(t)))
    : ALL;
  document.getElementById("tabs").innerHTML = TOPICS.map((t) => {
    const n = base.filter((r) => keysOf(r.it).includes(t.key)).length;
    if (!n && t.key !== TOPIC) return "";
    return `<button type="button" class="pr-tab${t.key === TOPIC ? " on" : ""}" data-topic="${t.key}" title="${esc(t.desc)}">${esc(t.label)} <span>${n}</span></button>`;
  }).join("");

  const t = TOPICS.find((x) => x.key === TOPIC);
  document.getElementById("summary").innerHTML =
    `<strong>${esc(t.label)}</strong> <span class="tp-desc">${esc(t.desc)}</span> · <strong>${list.length}</strong>건` +
    (terms.length ? ` · "<strong>${esc(q)}</strong>" 검색` : "");

  if (!list.length) { el.innerHTML = `<p class="empty">해당하는 항목이 없습니다.</p>`; return; }
  const page = list.slice(0, shown);
  const byDay = new Map();
  for (const r of page) { if (!byDay.has(r.id)) byDay.set(r.id, []); byDay.get(r.id).push(r); }
  el.innerHTML = [...byDay.entries()].map(([id, rows]) =>
    `<section class="item-group"><h2 class="group-title">${fmtDate(id)} <small>(${rows.length}건)</small></h2>${rows.map(rowHTML).join("")}</section>`
  ).join("") + (list.length > shown
    ? `<button type="button" class="more-btn" id="more">나머지 ${list.length - shown}건 더 보기 ▾</button>` : "");
}

document.addEventListener("click", (e) => {
  const tab = e.target.closest(".pr-tab");
  if (tab) { TOPIC = tab.dataset.topic; shown = PAGE; render(); history.replaceState(null, "", `?topic=${TOPIC}`); return; }
  if (e.target.id === "more") { shown += PAGE; render(); }
});

async function load() {
  const el = document.getElementById("list");
  try {
    const res = await fetch("data/index.json", { cache: "no-store" });
    if (!res.ok) throw new Error("index.json 응답 오류: " + res.status);
    const ids = (await res.json()).map((c) => c.id).filter((id) => /^\d{4}-\d{2}-\d{2}$/.test(id)).sort().reverse();
    const briefs = await Promise.all(ids.map((id) =>
      fetch(`data/briefings/${id}.json`, { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).catch(() => null)));
    briefs.forEach((b, i) => { if (b) (b.items || []).forEach((it, idx) => ALL.push({ id: ids[i], idx, it })); });
    const t0 = new URLSearchParams(location.search).get("topic");
    if (t0 && LABEL[t0]) TOPIC = t0;
    document.getElementById("q").addEventListener("input", () => { shown = PAGE; render(); });
    render();
  } catch (err) {
    el.innerHTML = `<p class="error">자료를 불러오지 못했습니다.<br /><small>${esc(err.message)}</small></p>`;
  }
}

load();

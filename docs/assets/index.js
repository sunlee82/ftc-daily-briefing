// 카드 인덱스 — data/index.json을 읽어 카드 그리드를 그린다. (순수 JS, 빌드 없음)

const CAT_LABEL = { press: "공정위 보도자료", committee: "위원회 소식", news: "뉴스" };
const CAT_CLASS = { press: "press", committee: "cmte", news: "news" };

function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

// KST(UTC+9) 기준 오늘 날짜 — 해외에서 열어도 한국 날짜로 판단한다
function todayKST() {
  const kst = new Date(Date.now() + 9 * 3600 * 1000);
  return kst.toISOString().slice(0, 10);
}

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];
function weekdayOf(dateStr) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateStr || ""));
  if (!m) return "";
  return WEEKDAYS[new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).getUTCDay()];
}

// 구성 배지 — 0건인 항목은 표시하지 않는다
function countsHTML(counts) {
  if (!counts) return "";
  const order = ["press", "committee", "news"];
  const chips = order
    .filter((k) => counts[k] > 0)
    .map((k) => `<span class="cnt ${CAT_CLASS[k]}">${CAT_LABEL[k]} ${counts[k]}</span>`);
  return chips.length ? `<div class="counts">${chips.join("")}</div>` : "";
}

// 대표 항목 미리보기 — 수집·배포 단계에서 이미 구성해 둔 peek를 그대로 그린다
function peekHTML(peek) {
  if (!Array.isArray(peek) || peek.length === 0) return "";
  const rows = peek.map((p) => {
    const cls = CAT_CLASS[p.cat] || "news";
    return `<li class="is-${cls}"><span class="tick"></span><span class="txt">${esc(p.headline)}</span></li>`;
  });
  return `<ul class="peek">${rows.join("")}</ul>`;
}

// 전체 요약이 "오늘의 핵심" 3줄로 바뀌면서 줄바꿈과 **강조** 표시가 들어온다.
// 목록 카드에서는 한 줄로 눕혀 쓰므로 표시만 걷어내고 가운뎃점으로 잇는다.
function flatSummary(s) {
  return String(s || "")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .split("\n")
    .map((l) => l.trim().replace(/^[-·]\s*/, ""))
    .filter(Boolean)
    .join(" · ");
}

function cardHTML(b, isToday) {
  const wd = weekdayOf(b.date);
  const todayChip = isToday ? `<span class="today">오늘</span>` : "";
  const counts = countsHTML(b.counts);
  const peek = peekHTML(b.peek);
  // counts·peek가 아직 없는 예전 카드는 기존처럼 요약을 보여준다
  const body = counts || peek
    ? counts + peek
    : `<p class="summary">${esc(flatSummary(b.summary))}</p>`;
  return `<a class="card" href="briefing.html?date=${encodeURIComponent(b.id)}">
    <span class="datebar">
      <span class="date">${esc(b.date)}${wd ? `<span class="wd">${wd}</span>` : ""}</span>${todayChip}
    </span>
    <h2>${esc(b.title)}</h2>
    ${body}
  </a>`;
}

// ── 목록: 최근 2주는 펼치고, 그 전은 월별로 접는다 (2026-10) ──
// 48일치가 넘어가며 첫 화면이 세로 7,000px을 넘겼다. 담당자가 보는 건 대개 최근 며칠이다.
const RECENT_DAYS = 14;
let ALL_CARDS = [];

function monthLabel(ym) {
  const [y, m] = ym.split("-");
  return `${y}년 ${+m}월`;
}

function renderCards() {
  const el = document.getElementById("cards");
  const today = todayKST();
  const cutoff = new Date(Date.parse(today) - RECENT_DAYS * 86400000).toISOString().slice(0, 10);
  const recent = ALL_CARDS.filter((b) => b.date >= cutoff);
  const older = ALL_CARDS.filter((b) => b.date < cutoff);

  const byMonth = new Map();
  for (const b of older) {
    const ym = b.date.slice(0, 7);
    if (!byMonth.has(ym)) byMonth.set(ym, []);
    byMonth.get(ym).push(b);
  }
  const months = [...byMonth.keys()].sort().reverse();

  el.innerHTML =
    recent.map((b, i) => cardHTML(b, i === 0 && b.date === today)).join("") +
    months.map((ym) => `
      <section class="month" data-ym="${ym}">
        <button type="button" class="month-btn" aria-expanded="false">
          ${monthLabel(ym)} <small>${byMonth.get(ym).length}일치</small> <span class="arrow">▾</span>
        </button>
        <div class="month-cards cards" hidden>${byMonth.get(ym).map((b) => cardHTML(b, false)).join("")}</div>
      </section>`).join("");
}

document.addEventListener("click", (e) => {
  const btn = e.target.closest(".month-btn");
  if (!btn) return;
  const box = btn.nextElementSibling;
  const open = box.hidden;
  box.hidden = !open;
  btn.setAttribute("aria-expanded", String(open));
  btn.querySelector(".arrow").textContent = open ? "▴" : "▾";
});

// ── 전체 검색 (2026-10) ──
// 브리핑 전체(제목·오늘의 핵심·각 항목의 제목과 요약)를 뒤진다.
// 색인 파일을 따로 만들지 않고, 처음 검색할 때 모든 브리핑 JSON을 한 번에 받아 둔다
// (48일치 약 400KB — 사내망에서 1초 안팎). 1년치가 넘어가면 색인 파일로 바꾼다.
let SEARCH_DOCS = null;
let SEARCH_LOADING = null;
const CAT_SHORT = { press: "보도자료", committee: "위원회", news: "뉴스" };

function plain(s) {
  return String(s || "").replace(/\*\*(.+?)\*\*/g, "$1").replace(/##\[(.+?)\]##/g, "$1").replace(/\s+/g, " ").trim();
}

async function loadSearchDocs() {
  if (SEARCH_DOCS) return SEARCH_DOCS;
  if (SEARCH_LOADING) return SEARCH_LOADING;
  SEARCH_LOADING = (async () => {
    const briefs = await Promise.all(ALL_CARDS.map((c) =>
      fetch(`data/briefings/${c.id}.json`, { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null)).catch(() => null)));
    const docs = [];
    briefs.forEach((b, i) => {
      if (!b) return;
      const id = ALL_CARDS[i].id;
      (b.items || []).forEach((it, idx) => {
        docs.push({
          id, idx, cat: it.category || "news",
          headline: plain(it.headline), summary: plain(it.summary),
          hay: `${plain(it.headline)} ${plain(it.summary)}`.toLowerCase(),
        });
      });
    });
    SEARCH_DOCS = docs;
    return docs;
  })();
  return SEARCH_LOADING;
}

// 띄어쓰기로 나눈 낱말이 모두 들어 있어야 한다 (AND 검색)
function matchDoc(doc, terms) {
  return terms.every((t) => doc.hay.includes(t));
}

function hlText(text, terms) {
  let out = esc(text);
  for (const t of terms) {
    const re = new RegExp(t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
    out = out.replace(re, (m) => `<mark class="hl">${m}</mark>`);
  }
  return out;
}

// 요약에서 검색어 주변 120자만 보여준다
function snippet(summary, terms) {
  const low = summary.toLowerCase();
  let pos = -1;
  for (const t of terms) { pos = low.indexOf(t); if (pos >= 0) break; }
  if (pos < 0) return summary.slice(0, 120) + (summary.length > 120 ? "…" : "");
  const start = Math.max(0, pos - 40);
  const end = Math.min(summary.length, pos + 80);
  return (start ? "…" : "") + summary.slice(start, end) + (end < summary.length ? "…" : "");
}

async function runSearch(q) {
  const el = document.getElementById("search-results");
  const cardsEl = document.getElementById("cards");
  const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) {
    el.hidden = true; el.innerHTML = ""; cardsEl.hidden = false;
    return;
  }
  cardsEl.hidden = true; el.hidden = false;
  el.innerHTML = `<p class="empty">찾는 중…</p>`;
  const docs = await loadSearchDocs();
  const hits = docs.filter((d) => matchDoc(d, terms)).sort((a, b) => (a.id < b.id ? 1 : a.id > b.id ? -1 : a.idx - b.idx));
  if (!hits.length) {
    el.innerHTML = `<p class="empty">"${esc(q)}"에 해당하는 내용이 없습니다. 낱말을 줄여서 다시 찾아보세요.</p>`;
    return;
  }
  const byDay = new Map();
  for (const h of hits) { if (!byDay.has(h.id)) byDay.set(h.id, []); byDay.get(h.id).push(h); }
  const days = hits.length === 1 ? "" : ` · ${byDay.size}일`;
  el.innerHTML = `<p class="search-meta">"<strong>${esc(q)}</strong>" 검색 결과 <strong>${hits.length}</strong>건${days}</p>` +
    [...byDay.entries()].map(([id, rows]) => `
      <section class="sr-day">
        <h2 class="sr-date"><a href="briefing.html?date=${encodeURIComponent(id)}">${esc(id)} ${weekdayOf(id)}</a></h2>
        ${rows.map((h) => `<a class="sr" href="briefing.html?date=${encodeURIComponent(id)}#item-${h.idx}">
          <span class="sr-cat is-${CAT_CLASS[h.cat] || "news"}">${CAT_SHORT[h.cat] || "뉴스"}</span>
          <span class="sr-body"><span class="sr-title">${hlText(h.headline, terms)}</span>
          <span class="sr-snip">${hlText(snippet(h.summary, terms), terms)}</span></span>
        </a>`).join("")}
      </section>`).join("");
}

function wireSearch() {
  const input = document.getElementById("q");
  if (!input) return;
  let timer = null;
  input.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(() => runSearch(input.value.trim()), 250);
  });
  // 주소에 ?q=가 있으면 바로 검색한다 (검색 결과 링크를 공유할 수 있게)
  const q0 = new URLSearchParams(location.search).get("q");
  if (q0) { input.value = q0; runSearch(q0); }
  // 검색어를 주소에도 남긴다 — 뒤로가기·공유용
  input.addEventListener("change", () => {
    const u = new URL(location.href);
    if (input.value.trim()) u.searchParams.set("q", input.value.trim()); else u.searchParams.delete("q");
    history.replaceState(null, "", u);
  });
}

async function load() {
  const el = document.getElementById("cards");
  try {
    const res = await fetch("data/index.json", { cache: "no-store" });
    if (!res.ok) throw new Error("index.json 응답 오류: " + res.status);
    const list = await res.json();
    if (!Array.isArray(list) || list.length === 0) {
      el.innerHTML = `<p class="empty">아직 배포된 브리핑이 없습니다.</p>`;
      return;
    }
    list.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
    ALL_CARDS = list;
    renderCards();
    wireSearch();
  } catch (err) {
    el.innerHTML = `<p class="error">브리핑 목록을 불러오지 못했습니다.<br /><small>${esc(err.message)}</small></p>`;
  }
}

load();

// ── 오늘의 인사이트 ────────────────────────────────────────────────────
// 배포 단계가 매일 insights-daily.json에 한 원소를 덧붙인다(공정위가 집중하는 것 + SK 점검 과제).
// 파란 카드에는 마지막 원소만 보여주고, 지난 것은 insights.html에서 본다.
function richI(s) {
  return esc(s).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
}
async function loadInsight() {
  const box = document.getElementById("insight");
  const intro = document.getElementById("intro");
  if (!box) return;
  try {
    const res = await fetch("data/insights-daily.json", { cache: "no-store" });
    if (!res.ok) return;
    const list = await res.json();
    if (!Array.isArray(list) || !list.length) return;
    const n = list[list.length - 1];
    const stale = (Date.parse(todayKST()) - Date.parse(n.date)) / 86400000 > 3;
    box.innerHTML = `
      <div class="ins-head"><span class="ins-label">오늘의 인사이트</span>
        <span class="ins-date">${esc(n.date)} ${weekdayOf(n.date)}${stale ? " · 최근 인사이트" : ""}</span></div>
      <p class="ins-focus">${richI(n.focus)}</p>
      <div class="ins-watch-label"><b>SK</b> 점검·대비</div>
      <ul class="ins-watch">${(n.watch || []).map((w) => `<li>${richI(w)}</li>`).join("")}</ul>
      ${n.change ? `<p class="ins-change">${richI(n.change)}</p>` : ""}
      <a class="ins-more" href="insights.html">지난 인사이트 보기 →</a>`;
    box.hidden = false;
    if (intro) intro.hidden = true;
  } catch (_) {
    // 조용히 넘어간다 — 안내문이 그대로 남는다
  }
}
loadInsight();

// ── 방문 수 ────────────────────────────────────────────────────────────
// GitHub Pages는 정적 사이트라 서버가 없어 외부 카운터(abacus)를 쓴다.
// 가입·키가 필요 없고, /hit은 1 올리고 값을 돌려주며 /get은 올리지 않고 읽는다.
// 한 번 방문에 한 번만 세도록 sessionStorage로 막는다(새로고침해도 안 오른다).
// 서비스가 죽거나 막히면 아무것도 표시하지 않는다 — 깨진 숫자보다 없는 편이 낫다.
const VISIT_NS = "sunlee82-ftc-briefing";
const VISIT_API = "https://abacus.jasoncameron.dev";

async function countVisit() {
  const el = document.getElementById("visits");
  if (!el) return;

  const today = todayKST();
  let counted = false;
  try {
    counted = sessionStorage.getItem("visited") === today;
  } catch (_) {
    // 사생활 보호 모드 등에서 sessionStorage가 막힐 수 있다 — 그때는 그냥 센다
  }
  const verb = counted ? "get" : "hit";

  try {
    // 오늘 키는 자정에 새로 생기므로, 아직 없는 키를 get으로 읽으면 404가 난다.
    // 그때는 hit으로 한 번 만들어 준다. cache: no-store — 브라우저가 예전 숫자를 물고 있지 않게.
    const ask = async (key) => {
      let res = await fetch(`${VISIT_API}/${verb}/${VISIT_NS}/${key}`, { cache: "no-store" });
      if (!res.ok && verb === "get") {
        res = await fetch(`${VISIT_API}/hit/${VISIT_NS}/${key}`, { cache: "no-store" });
      }
      if (!res.ok) throw new Error(String(res.status));
      return res.json();
    };
    const [total, day] = await Promise.all([ask("total"), ask(today)]);
    if (typeof total.value !== "number" || typeof day.value !== "number") return;

    el.innerHTML =
      `누적 <strong>${total.value.toLocaleString()}</strong>` +
      ` · 오늘 <strong>${day.value.toLocaleString()}</strong>`;
    el.hidden = false;

    try {
      sessionStorage.setItem("visited", today);
    } catch (_) {}
  } catch (_) {
    // 조용히 넘어간다
  }
}

countVisit();

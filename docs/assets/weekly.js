// 주간 요약 — 한 주(월~일)의 브리핑·사건·제도 변화를 한 화면에 모은다. (순수 JS, 빌드 없음)
// 배포 단계가 따로 만드는 파일은 없다. 그 주의 브리핑 JSON과 insight-latest.json을 읽어 그 자리에서 짠다.
// 매일 못 보는 독자가 월요일에 지난주를 따라잡는 용도. ?week=YYYY-MM-DD(월요일)로 특정 주를 연다.
"use strict";

function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}
function rich(s) {
  return esc(s).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
}
function plain(s) { return String(s || "").replace(/\*\*(.+?)\*\*/g, "$1"); }

const DAY = 86400000;
const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];
function todayKST() { return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10); }
function addDays(d, n) { return new Date(Date.parse(d) + n * DAY).toISOString().slice(0, 10); }
function mondayOf(d) {
  const wd = new Date(Date.parse(d)).getUTCDay(); // 0=일
  return addDays(d, wd === 0 ? -6 : 1 - wd);
}
function fmt(d) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d);
  return m ? `${+m[2]}/${+m[3]}(${WEEKDAYS[new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).getUTCDay()]})` : esc(d);
}
function fmtLong(d) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d);
  return m ? `${+m[1]}.${+m[2]}.${+m[3]}.` : esc(d);
}

// SK 판별 — 다른 화면과 같은 기준
const OUR_RE = /(^|[^A-Za-z])SK([^A-Za-z]|$)|SKC|에스케이|11번가|티맵|하이닉스|최태원/;
const isOurs = (t) => OUR_RE.test(String(t || "").replace(/SK증권/g, ""));

const CAT = { press: "보도자료", committee: "위원회", news: "뉴스" };
const CAT_CLASS = { press: "press", committee: "cmte", news: "news" };
const STAGE_ORDER = ["조사", "심의", "소송", "수사", "처분", "종결"];

function lead(summary) {
  const lines = String(summary || "").split("\n").map((l) => l.trim()).filter(Boolean);
  const l = lines.find((x) => !x.startsWith("- ")) || lines[0] || "";
  return l;
}

function itemRow(id, idx, it) {
  const cat = it.category || "news";
  return `<a class="wk-row" href="briefing.html?date=${encodeURIComponent(id)}#item-${idx}">
    <span class="sr-cat is-${CAT_CLASS[cat]}">${CAT[cat] || "뉴스"}</span>
    <span class="wk-body"><span class="wk-title">${esc(it.headline)}</span>
    <span class="wk-sub">${rich(lead(it.summary))} <em>${fmt(id)}</em></span></span>
  </a>`;
}

function section(title, hint, body, n) {
  return `<section class="viz-block">
    <h2>${title}${n != null ? ` <small class="wk-n">${n}건</small>` : ""}</h2>
    ${hint ? `<p class="hint">${hint}</p>` : ""}
    ${body}
  </section>`;
}

async function fetchJSON(u) {
  const r = await fetch(u, { cache: "no-store" });
  return r.ok ? r.json() : null;
}

async function load() {
  const el = document.getElementById("wk");
  try {
    const today = todayKST();
    const q = new URLSearchParams(location.search).get("week");
    // 기본: 월요일이면 지난주, 그 밖엔 이번 주(월~오늘)
    let mon = q && /^\d{4}-\d{2}-\d{2}$/.test(q) ? mondayOf(q) : mondayOf(today);
    if (!q && mon === today) mon = addDays(mon, -7);
    const sun = addDays(mon, 6);
    const end = sun > today ? today : sun;

    const [index, insight] = await Promise.all([fetchJSON("data/index.json"), fetchJSON("data/insight-latest.json")]);
    const ids = (index || []).map((c) => c.id).filter((id) => id >= mon && id <= sun).sort();
    const briefs = await Promise.all(ids.map((id) => fetchJSON(`data/briefings/${id}.json`)));

    const items = [];
    briefs.forEach((b, i) => { if (b) (b.items || []).forEach((it, idx) => items.push({ id: ids[i], idx, it })); });
    const press = items.filter((x) => x.it.category === "press");
    const news = items.filter((x) => x.it.category === "news");
    const ours = items.filter((x) => x.it.category !== "committee" && isOurs(`${x.it.headline} ${x.it.summary}`));
    const titles = briefs.filter(Boolean).map((b, i) => ({ id: ids[briefs.indexOf(b)], title: b.title, summary: b.summary }));

    const cases = (insight?.cases || []).filter((c) => c.last_date >= mon && c.last_date <= sun)
      .sort((a, b) => (isOurs(`${a.title} ${a.parties}`) ? -1 : 0) - (isOurs(`${b.title} ${b.parties}`) ? -1 : 0) || (a.last_date < b.last_date ? 1 : -1));
    const sched = (insight?.schedule || []).filter((s) => s.date >= mon && s.date <= sun)
      .sort((a, b) => (b.sk ? 1 : 0) - (a.sk ? 1 : 0) || (a.date < b.date ? 1 : -1));
    const horizon = addDays(end, 14);
    const upcoming = [...(insight?.cases || []).map((o) => ({ o, type: "사건" })), ...(insight?.schedule || []).map((o) => ({ o, type: "제도" }))]
      .filter(({ o }) => o.next && o.next.date && o.next.date > end && o.next.date <= horizon)
      .sort((a, b) => (a.o.next.date < b.o.next.date ? -1 : 1));

    const nav = `<nav class="wk-nav">
      <a class="wk-arrow" href="?week=${addDays(mon, -7)}">◀ 전주</a>
      <span class="wk-range">${fmtLong(mon)} ~ ${fmtLong(sun)}${sun > today ? " (진행 중)" : ""}</span>
      ${sun < today ? `<a class="wk-arrow" href="?week=${addDays(mon, 7)}">다음 주 ▶</a>` : `<span class="wk-arrow off">다음 주 ▶</span>`}
    </nav>`;

    if (!ids.length) {
      el.innerHTML = nav + `<p class="empty">이 주에는 배포된 브리핑이 없습니다.</p>`;
      return;
    }

    const stat = `<p class="dash-meta">브리핑 <strong>${ids.length}</strong>일 · 보도자료 <strong>${press.length}</strong>건 · 뉴스 <strong>${news.length}</strong>건 ·
      <b class="sk-red">SK</b> 관련 <strong>${ours.length}</strong>건 · 사건 움직임 <strong>${cases.length}</strong>건 · 제도 변화 <strong>${sched.length}</strong>건</p>`;

    // 날짜별 대표 제목 — 한 주의 흐름을 한눈에
    const days = `<ul class="wk-days">${titles.map((t) => `<li><a href="briefing.html?date=${t.id}"><b>${fmt(t.id)}</b> ${esc(t.title)}</a></li>`).join("")}</ul>`;

    const oursHTML = ours.length
      ? ours.map((x) => itemRow(x.id, x.idx, x.it)).join("")
      : `<p class="empty">이번 주 SK그룹 관련 항목은 없었습니다.</p>`;

    const pressHTML = press.length
      ? press.map((x) => itemRow(x.id, x.idx, x.it)).join("")
      : `<p class="empty">보도자료가 없었습니다.</p>`;

    const casesHTML = cases.length
      ? `<ul class="case-list">${cases.map((c) => `<li class="case${isOurs(`${c.title} ${c.parties}`) ? " is-ours" : ""}">
          <div class="case-head"><span class="case-stage" data-stage="${esc(c.stage)}">${esc(c.stage)}</span>
            <span class="case-title">${isOurs(`${c.title} ${c.parties}`) ? '<b class="sk-red">SK</b> ' : ""}${esc(c.title)}</span></div>
          <div class="case-move"><span class="case-date">${fmt(c.last_date)}</span><span>${esc(c.last_move)}</span></div>
          ${c.sk_note ? `<div class="sk-note"><b class="sk-red">SK</b> 시사점 — ${esc(c.sk_note)}</div>` : ""}
        </li>`).join("")}</ul>`
      : `<p class="empty">새 움직임이 기록된 사건이 없습니다.</p>`;

    const schedHTML = sched.length
      ? `<ul class="sched-list">${sched.map((s) => `<li class="sched${s.sk ? " is-sk" : ""}">
          <div class="sched-when"><span class="sched-date">${fmt(s.date)}</span><span class="sched-kind plan">${esc(s.kind)}</span></div>
          <div class="sched-body"><div class="sched-title">${s.sk ? '<b class="sk-red">SK</b> ' : ""}${esc(s.title)}</div>
            ${s.detail ? `<div class="sched-detail">${esc(s.detail)}</div>` : ""}</div>
        </li>`).join("")}</ul>`
      : `<p class="empty">새로 기록된 제도 변화가 없습니다.</p>`;

    const upHTML = upcoming.length
      ? `<ul class="up-list">${upcoming.map(({ o, type }) => `<li class="up">
          <div class="up-when"><span class="up-dday">${fmt(o.next.date)}</span></div>
          <div class="up-body"><div class="up-what">${esc(o.next.what || "")}</div>
            <div class="up-title"><span class="up-type">${type}</span>${esc(o.title)}</div></div>
        </li>`).join("")}</ul>`
      : `<p class="empty">앞으로 2주 안에 날짜가 정해진 일정이 없습니다.</p>`;

    el.innerHTML = nav + stat +
      section("한 주의 흐름", "날짜별 대표 제목입니다. 누르면 그날 브리핑으로 갑니다.", days) +
      section(`<b class="sk-red">SK</b>그룹 관련`, "이번 주 브리핑에 실린 SK 계열사 항목입니다.", oursHTML, ours.length) +
      section("공정위 보도자료", "공식 발표 전부입니다.", pressHTML, press.length) +
      section("사건 움직임", "이번 주에 단계가 바뀌거나 새 소식이 있었던 사건입니다. SK 건이 먼저 옵니다.", casesHTML, cases.length) +
      section("제도 변화", "이번 주에 새로 기록된 법령·고시·지침 움직임입니다.", schedHTML, sched.length) +
      section("다음 2주 일정", "의견제출 마감·시행일·변론기일처럼 날짜가 정해진 것입니다.", upHTML, upcoming.length) +
      `<p class="dash-foot">주간 요약은 그 주의 브리핑과 규제동향 자료에서 자동으로 만들어집니다. 전체 뉴스는 각 날짜 브리핑에서 보실 수 있습니다.</p>`;
    document.title = `주간 요약 ${fmtLong(mon)}~${fmtLong(sun)} — 공정위 동향`;
  } catch (err) {
    el.innerHTML = `<p class="error">주간 요약을 만들지 못했습니다.<br /><small>${esc(err.message)}</small></p>`;
  }
}

load();

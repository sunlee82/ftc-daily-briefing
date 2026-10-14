// 규제동향 대시보드 — data/insight-latest.json을 읽어 사건 파이프라인과 제도 변화 시계를 그린다.
// 인사이트 본문은 배포 워크플로우가 매일 갱신하고, 이 파일은 그리기만 한다. (순수 JS, 빌드 없음)
"use strict";

function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

// 진행 중인 것을 앞에, 마무리된 것을 뒤에 둔다
const STAGES = [
  { key: "조사", label: "조사", desc: "현장조사·자료제출 등 사실관계 확인 단계" },
  { key: "심의", label: "심의", desc: "심사보고서 상정 후 위원회 심의 단계" },
  { key: "소송", label: "소송", desc: "처분에 불복해 법원에서 다투는 중" },
  { key: "수사", label: "수사", desc: "검찰 수사·기소 등 형사 절차" },
  { key: "처분", label: "처분", desc: "과징금·시정명령 등 제재가 내려진 건" },
  { key: "종결", label: "종결", desc: "무혐의·심의절차종료·판결 확정 등으로 끝난 건" },
];

// ── 우리 회사군 ────────────────────────────────────────────────────────
// 이 페이지는 SK텔레콤과 관계사에서 사내용으로 본다. 임원이 열었을 때
// "우리 건이 있나"를 맨 먼저 보게 되므로, 해당 사건은 단계 그룹에서 빼내
// 파이프라인 맨 위에 따로 모은다(대신 카드마다 단계 배지를 달아 어디에 있는지 보인다).
// 사건 데이터에 별도 표시가 없어도 되도록 회사명으로 알아본다.
// "SK"는 앞뒤에 영문자가 붙지 않을 때만 인정한다(TASK 같은 오검출 방지).
// 계열 변동이 있으면 이 목록만 고치면 지난 사건까지 함께 다시 분류된다.
// (2026-06 원스토어는 SK스퀘어가 넥써쓰에 지분을 매각해 계열에서 빠졌다 — 제외)
// (2026-09 독자가 SK그룹 전체로 넓어져 SKC·최태원(동일인)을 추가하고,
//  이름만 SK인 SK증권(2018년 계열 분리)은 뺐다)
const OUR_GROUP_RE =
  /(^|[^A-Za-z])SK([^A-Za-z]|$)|SKC|에스케이|11번가|티맵|하이닉스|최태원/;
const NOT_OUR_GROUP_RE = /SK증권/g;

function isOurGroup(c) {
  const t = `${c.title || ""} ${c.parties || ""} ${c.conduct || ""}`.replace(NOT_OUR_GROUP_RE, "");
  return OUR_GROUP_RE.test(t);
}

const KIND_CLASS = {
  "시행": "done",
  "입법·행정예고": "notice",
  "입법예고": "notice",
  "행정예고": "notice",
  "추진": "plan",
  "검토": "plan",
  "국회 발의": "bill",
};

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];
function fmtDate(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ""));
  if (!m) return esc(s || "");
  const wd = WEEKDAYS[new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).getUTCDay()];
  return `${+m[2]}/${+m[3]}(${wd})`;
}

// 오늘(한국시간) YYYY-MM-DD
function todayKST() {
  return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}
function dday(date, today) {
  const n = Math.round((Date.parse(date) - Date.parse(today)) / 86400000);
  return n === 0 ? "D-day" : `D-${n}`;
}
// 다음 일정 한 줄 (사건·제도 카드 공통). 지난 일정은 보여주지 않는다.
function nextHTML(o, today) {
  const n = o.next;
  if (!n || !n.date || n.date < today) return "";
  return `<div class="next-line"><span class="next-tag">다음</span>
    <span class="next-date">${fmtDate(n.date)} · ${dday(n.date, today)}</span>
    <span>${esc(n.what || "")}</span></div>`;
}

// ---------- 접기 ----------
// 목록마다 위의 SHOW_FIRST건만 보여주고 나머지는 "더 보기"로 연다.
// 항목이 쌓이면서 한 칸이 화면 몇 개를 차지해 아래 칸까지 한참 내려가야 했다(2026-10-01).
const SHOW_FIRST = 3;
function listHTML(cls, lis) {
  const head = `<ul class="${cls}">${lis.slice(0, SHOW_FIRST).join("")}</ul>`;
  const rest = lis.slice(SHOW_FIRST);
  if (!rest.length) return head;
  return head +
    `<ul class="${cls} more-list" hidden>${rest.join("")}</ul>` +
    `<button type="button" class="more-btn" data-n="${rest.length}">나머지 ${rest.length}건 더 보기 ▾</button>`;
}
document.addEventListener("click", (e) => {
  const btn = e.target.closest(".more-btn");
  if (!btn) return;
  const list = btn.previousElementSibling;
  const open = list.hidden;
  list.hidden = !open;
  btn.textContent = open ? "접기 ▴" : `나머지 ${btn.dataset.n}건 더 보기 ▾`;
});

// ---------- 다가오는 일정 ----------
// 의견제출 마감·시행일·변론기일처럼 날짜가 정해진 것만 모아 가까운 순으로 보여준다.
function upcomingHTML(cases, sched, today) {
  const rows = [
    ...cases.map((o) => ({ o, type: "사건" })),
    ...sched.map((o) => ({ o, type: "제도" })),
  ]
    .filter(({ o }) => o.next && o.next.date && o.next.date >= today)
    .sort((a, b) => (a.o.next.date < b.o.next.date ? -1 : 1));
  if (!rows.length) return `<p class="empty">날짜가 정해진 다가오는 일정이 없습니다.</p>`;
  return listHTML("up-list", rows
    .map(({ o, type }) => `<li class="up">
      <div class="up-when"><span class="up-dday">${dday(o.next.date, today)}</span>
        <span class="up-date">${fmtDate(o.next.date)}</span></div>
      <div class="up-body">
        <div class="up-what">${esc(o.next.what || "")}</div>
        <div class="up-title"><span class="up-type">${type}</span>${esc(o.title)}</div>
      </div>
    </li>`));
}

function briefingLink(id, text) {
  if (!id) return esc(text);
  return `<a class="src-link" href="briefing.html?date=${encodeURIComponent(id)}">${esc(text)}</a>`;
}

// 근거 줄.
//
// 예전에는 "2026-09-18 브리핑" 하나만 걸어서, 누르면 그날 브리핑 전체가 열리고
// 관련 기사를 다시 찾아야 했다. 그래서 원문 제목·링크를 함께 담게 바꿨다.
// 원문 링크가 있으면 그쪽을 걸고, 날짜는 브리핑으로 가는 작은 링크로 남긴다.
// 옛 항목에는 source_title·source_url이 없으므로 그때는 예전처럼 보여준다.
function sourceHTML(o) {
  if (!o.source_title) return `근거: ${briefingLink(o.source, o.source + " 브리핑")}`;
  const title = o.source_url
    ? `<a class="src-link" href="${esc(o.source_url)}" target="_blank" rel="noopener">${esc(o.source_title)} ↗</a>`
    : esc(o.source_title);
  const day = o.source ? ` <span class="src-day">(${briefingLink(o.source, o.source + " 브리핑")})</span>` : "";
  return `근거: ${title}${day}`;
}

// ---------- 사건 파이프라인 ----------
function caseHTML(c, showStage = false, today = todayKST()) {
  const scale = c.scale
    ? `<span class="case-scale">${esc(c.scale)}</span>`
    : "";
  // 우리 회사군 블록에서는 단계 그룹 밖에 놓이므로 단계를 배지로 보여준다
  const stage = showStage && c.stage
    ? `<span class="case-stage" data-stage="${esc(c.stage)}">${esc(c.stage)}</span>`
    : "";
  return `<li class="case">
    <div class="case-head">
      ${stage}
      <span class="case-title">${esc(c.title)}</span>
      ${c.conduct ? `<span class="case-conduct">${esc(c.conduct)}</span>` : ""}
    </div>
    ${c.parties ? `<div class="case-parties">${esc(c.parties)}</div>` : ""}
    ${scale}
    <div class="case-move">
      <span class="case-date">${fmtDate(c.last_date)}</span>
      <span>${esc(c.last_move)}</span>
    </div>
    ${nextHTML(c, today)}
    <div class="case-src">${sourceHTML(c)}</div>
  </li>`;
}

// part: "ours" = SK그룹 관련 블록만, "rest" = 나머지 단계 그룹만
function pipelineHTML(allCases, part) {
  const ours = allCases.filter(isOurGroup);
  const cases = allCases.filter((c) => !isOurGroup(c));

  // 우리 회사군 — 0건이어도 블록을 남긴다. "우리 건 없음"도 알아야 할 상태다.
  const ourBlock = `<section class="stage stage-ours" data-stage="우리">
    <h3 class="stage-title">
      <span class="stage-name">SK그룹 관련</span>
      <span class="stage-count">${ours.length}</span>
      <span class="stage-desc">SK그룹 계열사·기업집단 SK가 당사자인 건</span>
    </h3>
    ${
      ours.length
        ? listHTML("case-list", ours
            .slice()
            .sort((a, b) => (a.last_date < b.last_date ? 1 : -1))
            .map((c) => caseHTML(c, true)))
        : `<p class="none">현재 추적 중인 SK 관련 사건이 없습니다.</p>`
    }
  </section>`;

  // 60일 넘게 움직임이 없는 사건은 단계 그룹에서 빼 맨 아래 "장기 미진행"에 모은다
  const STALE_DAYS = 60;
  const today = todayKST();
  const isStale = (c) => c.stage !== "처분" && c.stage !== "종결" &&
    (Date.parse(today) - Date.parse(c.last_date)) / 86400000 > STALE_DAYS;
  const stale = cases.filter(isStale);
  const groups = STAGES.map((st) => {
    const list = cases
      .filter((c) => c.stage === st.key && !isStale(c))
      .sort((a, b) => (a.last_date < b.last_date ? 1 : -1));
    if (!list.length) return "";
    return `<section class="stage" data-stage="${esc(st.key)}">
      <h3 class="stage-title">
        <span class="stage-name">${esc(st.label)}</span>
        <span class="stage-count">${list.length}</span>
        <span class="stage-desc">${esc(st.desc)}</span>
      </h3>
      ${listHTML("case-list", list.map((c) => caseHTML(c)))}
    </section>`;
  });
  const unknown = cases.filter((c) => !STAGES.some((s) => s.key === c.stage));
  if (unknown.length) {
    groups.push(`<section class="stage"><h3 class="stage-title">
      <span class="stage-name">기타</span><span class="stage-count">${unknown.length}</span></h3>
      ${listHTML("case-list", unknown.map((c) => caseHTML(c)))}</section>`);
  }
  if (stale.length) {
    groups.push(`<section class="stage stage-stale" data-stage="stale">
      <h3 class="stage-title">
        <span class="stage-name">장기 미진행</span>
        <span class="stage-count">${stale.length}</span>
        <span class="stage-desc">${STALE_DAYS}일 넘게 새 소식이 없는 사건 — 단계 배지로 마지막 상태를 표시</span>
      </h3>
      ${listHTML("case-list", stale.sort((a, b) => (a.last_date < b.last_date ? 1 : -1)).map((c) => caseHTML(c, true)))}
    </section>`);
  }
  const rest = groups.join("");
  if (part === "ours") return ourBlock;
  return rest || `<p class="empty">그 밖에 추적 중인 사건이 없습니다.</p>`;
}

// ---------- 제도 변화 시계 ----------
// scope(적용 대상)·sk(SK 해당)·deadline(의견제출 마감)·effective(시행일)은
// tool/pipeline/scheduleMeta.js 가 매기고, 새 항목은 배포 단계가 직접 적는다.
const SCOPE_LABEL = {
  group: "대기업집단", subcon: "하도급 원사업자", franchise: "가맹본부", retail: "대규모유통업자",
  platform: "온라인플랫폼", consumer: "소비자거래 사업자", cartel: "담합(전 사업자)",
  ftc: "공정위 절차·조직", sector: "특정 업종", all: "전 사업자",
};
const NOTICE_KINDS = new Set(["행정예고", "입법예고", "입법·행정예고"]);
const NOTICE_DAYS = 25; // 마감일을 모르는 예고는 보통 20일 안팎 — 그 뒤엔 의견수렴이 끝난 것으로 본다

// 단계: open(의견수렴 중) / pending(시행 예정·추진 중) / done(시행됨)
function phaseOf(s, today) {
  if (NOTICE_KINDS.has(s.kind)) {
    if (s.deadline) return s.deadline >= today ? "open" : "pending";
    const age = (Date.parse(today) - Date.parse(s.date)) / 86400000;
    return age <= NOTICE_DAYS ? "open" : "pending";
  }
  if (s.kind === "시행") return s.effective && s.effective > today ? "pending" : "done";
  return "pending"; // 추진 · 검토 · 국회 발의
}

function phaseBadge(s, phase, today) {
  if (phase === "open") {
    return s.deadline
      ? `<span class="ph ph-open">의견수렴 ~${fmtDate(s.deadline)} · ${dday(s.deadline, today)}</span>`
      : `<span class="ph ph-open">의견수렴 중</span>`;
  }
  if (phase === "done") return `<span class="ph ph-done">시행됨${s.effective ? " " + fmtDate(s.effective) : ""}</span>`;
  if (s.kind === "국회 발의") return `<span class="ph ph-pending">국회 계류</span>`;
  if (NOTICE_KINDS.has(s.kind)) return `<span class="ph ph-pending">의견수렴 종료 · 시행 준비${s.effective ? " · " + fmtDate(s.effective) + " 시행" : ""}</span>`;
  if (s.kind === "시행" && s.effective) return `<span class="ph ph-pending">${fmtDate(s.effective)} 시행 예정</span>`;
  return `<span class="ph ph-pending">${esc(s.kind)} 중</span>`;
}

function scopeChips(s) {
  const keys = Array.isArray(s.scope) && s.scope.length ? s.scope : ["all"];
  return keys.map((k) => `<span class="scope">${esc(SCOPE_LABEL[k] || k)}</span>`).join("");
}

function schedRow(s, today) {
  const phase = phaseOf(s, today);
  return `<li class="sched${s.sk ? " is-sk" : ""}">
      <div class="sched-when">
        <span class="sched-date">${fmtDate(s.date)}</span>
        <span class="sched-kind ${KIND_CLASS[s.kind] || "plan"}">${esc(s.kind)}</span>
      </div>
      <div class="sched-body">
        <div class="sched-title">${s.sk ? `<b class="sk-red">SK</b> ` : ""}${esc(s.title)}</div>
        <div class="sched-meta">${phaseBadge(s, phase, today)}${scopeChips(s)}</div>
        ${s.detail ? `<div class="sched-detail">${esc(s.detail)}</div>` : ""}
        ${phase === "open" ? "" : nextHTML(s, today)}
        <div class="case-src">${sourceHTML(s)}</div>
      </div>
    </li>`;
}

const PHASES = [
  { key: "open",    label: "의견수렴 중",      desc: "지금 의견을 낼 수 있는 입법·행정예고 — 마감 가까운 순" },
  { key: "pending", label: "시행 예정·추진 중", desc: "예고가 끝나 시행을 기다리거나, 정부·국회에서 추진 중인 것" },
  { key: "done",    label: "시행됨",          desc: "이미 시행된 제도 — 실무에 적용 중" },
];

function scheduleHTML(items, today, skOnly) {
  if (!items.length) return `<p class="empty">기록된 제도 변화가 없습니다.</p>`;
  const list = skOnly ? items.filter((s) => s.sk) : items;
  if (!list.length) return `<p class="empty">SK 해당으로 표시된 제도가 없습니다.</p>`;
  return PHASES.map((ph) => {
    let rows = list.filter((s) => phaseOf(s, today) === ph.key);
    if (!rows.length) return "";
    rows = ph.key === "open"
      ? rows.sort((a, b) => ((a.deadline || "9") < (b.deadline || "9") ? -1 : 1))
      : rows.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
    return `<section class="stage" data-phase="${ph.key}">
      <h3 class="stage-title">
        <span class="stage-name">${esc(ph.label)}</span>
        <span class="stage-count">${rows.length}</span>
        <span class="stage-desc">${esc(ph.desc)}</span>
      </h3>
      ${listHTML("sched-list", rows.map((s) => schedRow(s, today)))}
    </section>`;
  }).join("");
}

// "SK 해당만 보기" — 선택은 이 브라우저에만 남는다
function skOnlyPref() {
  try { return localStorage.getItem("sched-sk-only") === "1"; } catch (_) { return false; }
}
document.addEventListener("change", (e) => {
  if (e.target.id !== "sk-only") return;
  try { localStorage.setItem("sched-sk-only", e.target.checked ? "1" : "0"); } catch (_) {}
  const box = document.getElementById("sched-box");
  if (box) box.innerHTML = scheduleHTML(LAST.sched, LAST.today, e.target.checked);
});
let LAST = { sched: [], today: "" };

// ---------- 렌더 ----------
async function load() {
  const el = document.getElementById("dash");
  try {
    const res = await fetch("data/insight-latest.json", { cache: "no-store" });
    if (!res.ok) throw new Error("insight-latest.json 응답 오류: " + res.status);
    const d = await res.json();
    const cases = Array.isArray(d.cases) ? d.cases : [];
    const sched = Array.isArray(d.schedule) ? d.schedule : [];
    const today = todayKST();
    const upcoming = [...cases, ...sched].filter((o) => o.next && o.next.date && o.next.date >= today).length;
    const open = cases.filter((c) => ["조사", "심의", "소송", "수사"].includes(c.stage)).length;
    LAST = { sched, today };

    el.innerHTML = `
      <p class="dash-meta">
        <strong>${esc(d.date || "")}</strong> 기준 ·
        진행 중인 사건 <strong>${open}</strong>건 ·
        SK 관련 <strong>${cases.filter(isOurGroup).length}</strong>건 ·
        전체 <strong>${cases.length}</strong>건 ·
        제도 변화 <strong>${sched.length}</strong>건 ·
        다가오는 일정 <strong>${upcoming}</strong>건
      </p>

      <section class="viz-block">
        <h2>사건 파이프라인 — SK그룹 관련</h2>
        <p class="hint">SK그룹 계열사·기업집단 SK가 당사자인 사건입니다. 최근 움직임 순입니다.</p>
        ${pipelineHTML(cases, "ours")}
      </section>

      <section class="viz-block">
        <h2>다가오는 일정</h2>
        <p class="hint">의견제출 마감, 시행일, 변론·선고기일처럼 날짜가 정해진 것을 가까운 순으로 모았습니다.</p>
        ${upcomingHTML(cases, sched, today)}
      </section>

      <section class="viz-block">
        <h2>제도 변화 시계</h2>
        <p class="hint">법령·고시·지침을 <strong>의견수렴 중 → 시행 예정·추진 중 → 시행됨</strong>으로 나눴습니다.
          <b class="sk-red">SK</b> 표시는 SK그룹 계열사에 적용되거나 직접 영향이 있는 제도입니다.</p>
        <label class="sk-toggle"><input type="checkbox" id="sk-only" ${skOnlyPref() ? "checked" : ""} /> <b class="sk-red">SK</b> 해당만 보기 <span>(${sched.filter((s) => s.sk).length}/${sched.length})</span></label>
        <div id="sched-box">${scheduleHTML(sched, today, skOnlyPref())}</div>
      </section>

      <section class="viz-block">
        <h2>사건 파이프라인 — 그 밖의 사건</h2>
        <p class="hint">브리핑에 등장한 나머지 사건을 절차 단계별로 모았습니다.</p>
        ${pipelineHTML(cases, "rest")}
      </section>

      <p class="dash-foot">
        각 항목의 근거가 된 브리핑으로 이동할 수 있습니다.
        내용은 브리핑이 새로 배포될 때마다 자동으로 갱신됩니다.
      </p>`;
  } catch (err) {
    el.innerHTML = `<p class="error">분석 자료를 불러오지 못했습니다.<br /><small>${esc(err.message)}</small></p>`;
  }
}

load();

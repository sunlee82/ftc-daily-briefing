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
];

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

function briefingLink(id, text) {
  if (!id) return esc(text);
  return `<a class="src-link" href="briefing.html?date=${encodeURIComponent(id)}">${esc(text)}</a>`;
}

// ---------- 사건 파이프라인 ----------
function caseHTML(c) {
  const scale = c.scale
    ? `<span class="case-scale">${esc(c.scale)}</span>`
    : "";
  return `<li class="case">
    <div class="case-head">
      <span class="case-title">${esc(c.title)}</span>
      ${c.conduct ? `<span class="case-conduct">${esc(c.conduct)}</span>` : ""}
    </div>
    ${c.parties ? `<div class="case-parties">${esc(c.parties)}</div>` : ""}
    ${scale}
    <div class="case-move">
      <span class="case-date">${fmtDate(c.last_date)}</span>
      <span>${esc(c.last_move)}</span>
    </div>
    <div class="case-src">근거: ${briefingLink(c.source, c.source + " 브리핑")}</div>
  </li>`;
}

function pipelineHTML(cases) {
  const groups = STAGES.map((st) => {
    const list = cases
      .filter((c) => c.stage === st.key)
      .sort((a, b) => (a.last_date < b.last_date ? 1 : -1));
    if (!list.length) return "";
    return `<section class="stage" data-stage="${esc(st.key)}">
      <h3 class="stage-title">
        <span class="stage-name">${esc(st.label)}</span>
        <span class="stage-count">${list.length}</span>
        <span class="stage-desc">${esc(st.desc)}</span>
      </h3>
      <ul class="case-list">${list.map(caseHTML).join("")}</ul>
    </section>`;
  });
  const unknown = cases.filter((c) => !STAGES.some((s) => s.key === c.stage));
  if (unknown.length) {
    groups.push(`<section class="stage"><h3 class="stage-title">
      <span class="stage-name">기타</span><span class="stage-count">${unknown.length}</span></h3>
      <ul class="case-list">${unknown.map(caseHTML).join("")}</ul></section>`);
  }
  return groups.join("") || `<p class="empty">추적 중인 사건이 없습니다.</p>`;
}

// ---------- 제도 변화 시계 ----------
function scheduleHTML(items) {
  if (!items.length) return `<p class="empty">기록된 제도 변화가 없습니다.</p>`;
  const rows = items
    .slice()
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
    .map((s) => `<li class="sched">
      <div class="sched-when">
        <span class="sched-date">${fmtDate(s.date)}</span>
        <span class="sched-kind ${KIND_CLASS[s.kind] || "plan"}">${esc(s.kind)}</span>
      </div>
      <div class="sched-body">
        <div class="sched-title">${esc(s.title)}</div>
        ${s.detail ? `<div class="sched-detail">${esc(s.detail)}</div>` : ""}
        <div class="case-src">근거: ${briefingLink(s.source, s.source + " 브리핑")}</div>
      </div>
    </li>`);
  return `<ul class="sched-list">${rows.join("")}</ul>`;
}

// ---------- 렌더 ----------
async function load() {
  const el = document.getElementById("dash");
  try {
    const res = await fetch("data/insight-latest.json", { cache: "no-store" });
    if (!res.ok) throw new Error("insight-latest.json 응답 오류: " + res.status);
    const d = await res.json();
    const cases = Array.isArray(d.cases) ? d.cases : [];
    const sched = Array.isArray(d.schedule) ? d.schedule : [];
    const open = cases.filter((c) => ["조사", "심의", "소송", "수사"].includes(c.stage)).length;

    el.innerHTML = `
      <p class="dash-meta">
        <strong>${esc(d.date || "")}</strong> 기준 ·
        진행 중인 사건 <strong>${open}</strong>건 ·
        전체 <strong>${cases.length}</strong>건 ·
        제도 변화 <strong>${sched.length}</strong>건
      </p>

      <section class="viz-block">
        <h2>사건 파이프라인</h2>
        <p class="hint">브리핑에 등장한 사건을 절차 단계별로 모았습니다. 진행 중인 단계가 위에 옵니다.</p>
        ${pipelineHTML(cases)}
      </section>

      <section class="viz-block">
        <h2>제도 변화 시계</h2>
        <p class="hint">법령·고시·지침의 예고와 시행, 추진 중인 제도 개편을 최신순으로 정리했습니다.</p>
        ${scheduleHTML(sched)}
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

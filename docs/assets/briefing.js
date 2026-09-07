// 브리핑 상세 — ?date=YYYY-MM-DD 로 data/briefings/<date>.json을 읽어 렌더링. (순수 JS)

function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}
// 이스케이프 후 줄바꿈은 <br>로, **볼드**는 인물 강조(색상 포함), ##볼드##는 섹션
// 라벨 강조(색상 변경 없이 굵기만)로 되살린다. (위원회 소식 요약에서 사용)
function escBr(s) {
  return esc(s)
    .replace(/##(.+?)##/g, '<strong class="section-label">$1</strong>')
    .replace(/\*\*(.+?)\*\*/g, '<strong class="person-name">$1</strong>')
    .replace(/\n/g, "<br>");
}

// 보도자료 요약은 "리드 문장" + "- 로 시작하는 핵심 항목" 구조로 온다.
// 리드는 문단으로, 항목은 목록으로 나눠 숫자·기한이 눈에 걸리게 한다.
function bodyHTML(it) {
  const lines = String(it.summary || "").split("\n").map((l) => l.trim()).filter(Boolean);
  const bullets = lines.filter((l) => l.startsWith("- ")).map((l) => l.slice(2));
  if (!bullets.length) return `<p>${escBr(it.summary)}</p>`;
  const lead = lines.filter((l) => !l.startsWith("- ")).join("\n");
  return (
    (lead ? `<p>${escBr(lead)}</p>` : "") +
    `<ul class="pts">${bullets.map((b) => `<li>${escBr(b)}</li>`).join("")}</ul>`
  );
}

function itemHTML(it) {
  // 원문은 제목 줄 오른쪽 작은 링크로 — 항목마다 버튼이 한 줄씩 차지하면
  // 15건이 넘는 날엔 버튼만으로 화면이 그만큼 길어진다.
  const src = it.source_url
    ? `<a class="src-inline" href="${esc(it.source_url)}" target="_blank" rel="noopener">원문 ↗</a>`
    : "";
  return `<article class="item">
    <div class="item-row">
      <h3>${esc(it.headline)}</h3>
      ${src}
    </div>
    ${bodyHTML(it)}
  </article>`;
}

// 전체 요약은 그날 항목 전체를 아우르는 핵심 3줄로 온다. 줄마다 불릿으로 세우고
// **강조**는 accent 색 볼드로 살린다. 예전처럼 한 문단으로 오면 그대로 문단 처리.
function keypointsHTML(summary) {
  const lines = String(summary || "").split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length < 2) return `<p class="lead">${escBr(summary)}</p>`;
  return `<div class="keypoints">
    <span class="eyebrow">오늘의 핵심</span>
    <ul class="lead-list">${lines
      .map((l) => `<li>${escBr(l.replace(/^[-·]\s*/, ""))}</li>`)
      .join("")}</ul>
  </div>`;
}

function chips(arr) {
  return (arr || []).map((k) => `<span class="chip">${esc(k)}</span>`).join("");
}

// 카테고리 표시 순서 고정 (보도자료 → 위원회 소식 → 뉴스)
const CATEGORY_ORDER = ["press", "committee", "news"];
const CATEGORY_LABELS = { press: "공정위 보도자료", committee: "위원회 소식", news: "뉴스 보도내용" };

function itemsByCategoryHTML(items) {
  return CATEGORY_ORDER.map((cat) => {
    const group = (items || []).filter((it) => (it.category || "news") === cat);
    if (!group.length) return "";
    return `<section class="item-group">
      <h2 class="group-title">${esc(CATEGORY_LABELS[cat])} <small>(${group.length}건)</small></h2>
      ${group.map(itemHTML).join("")}
    </section>`;
  }).join("");
}

async function load() {
  const el = document.getElementById("detail");
  const params = new URLSearchParams(location.search);
  const date = params.get("date");
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    el.innerHTML = `<p class="error">잘못된 주소입니다. 날짜(date) 파라미터가 필요합니다.</p>`;
    return;
  }
  try {
    const res = await fetch(`data/briefings/${date}.json`, { cache: "no-store" });
    if (!res.ok) throw new Error("브리핑을 찾을 수 없습니다: " + res.status);
    const b = await res.json();
    document.title = `${b.title} — 공정위 동향`;
    el.innerHTML = `
      <div class="detail-head">
        <span class="date">${esc(b.date)}</span>
        <h1>${esc(b.title)}</h1>
        ${keypointsHTML(b.summary)}
        <div class="chips">
          ${chips(b.competitors)}
          ${chips(b.keywords)}
        </div>
      </div>
      ${itemsByCategoryHTML(b.items)}
    `;
  } catch (err) {
    el.innerHTML = `<p class="error">브리핑을 불러오지 못했습니다.<br /><small>${esc(err.message)}</small></p>`;
  }
}

load();

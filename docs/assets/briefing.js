// 브리핑 상세 — ?date=YYYY-MM-DD 로 data/briefings/<date>.json을 읽어 렌더링. (순수 JS)

function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}
// 이스케이프 후 줄바꿈만 <br>로 되살린다 (위원회 소식처럼 여러 줄 요약을 표시할 때 사용)
function escBr(s) {
  return esc(s).replace(/\n/g, "<br>");
}

function itemHTML(it) {
  const src = it.source_url
    ? `<a class="src" href="${esc(it.source_url)}" target="_blank" rel="noopener">원문 보기 ↗</a>`
    : "";
  return `<article class="item">
    <h3>${esc(it.headline)}</h3>
    <p>${escBr(it.summary)}</p>
    ${src}
  </article>`;
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
        <p class="lead">${esc(b.summary)}</p>
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

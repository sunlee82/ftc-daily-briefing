// 중요 자료실 — 상세. ?id=... 로 data/library/items/<id>.json을 읽어 렌더링. (순수 JS)

const TYPE_LABELS = { document: "📄 참고자료", article: "📰 주요기사" };

function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

function chips(arr) {
  return (arr || []).map((t) => `<span class="chip">${esc(t)}</span>`).join("");
}

function sectionHTML(sec) {
  return `<article class="item">
    <h3>${esc(sec.heading)}</h3>
    <p>${esc(sec.summary)}</p>
  </article>`;
}

async function load() {
  const el = document.getElementById("detail");
  const params = new URLSearchParams(location.search);
  const id = params.get("id");
  if (!id) {
    el.innerHTML = `<p class="error">잘못된 주소입니다. id 파라미터가 필요합니다.</p>`;
    return;
  }
  try {
    const res = await fetch(`data/library/items/${id}.json`, { cache: "no-store" });
    if (!res.ok) throw new Error("자료를 찾을 수 없습니다: " + res.status);
    const it = await res.json();
    document.title = `${it.title} — 중요 자료실`;

    const originalUrl = it.type === "document" && it.file_path ? it.file_path : it.source_url;
    const originalLabel = it.type === "document" ? "📎 원문 PDF 보기" : "🔗 원문 기사 보기";
    const originalBtn = originalUrl
      ? `<a class="src src-lg" href="${esc(originalUrl)}" target="_blank" rel="noopener">${originalLabel} ↗</a>`
      : "";

    const sections = (it.sections || []).map(sectionHTML).join("");

    el.innerHTML = `
      <div class="detail-head">
        <span class="date">${esc(it.date)}</span>
        <span class="type-badge">${esc(TYPE_LABELS[it.type] || it.type)}</span>
        <h1>${esc(it.title)}</h1>
        <p class="lead">${esc(it.summary)}</p>
        <div class="chips">${chips(it.tags)}</div>
        ${originalBtn ? `<div class="original-btn-row">${originalBtn}</div>` : ""}
      </div>
      ${sections}
    `;
  } catch (err) {
    el.innerHTML = `<p class="error">자료를 불러오지 못했습니다.<br /><small>${esc(err.message)}</small></p>`;
  }
}

load();

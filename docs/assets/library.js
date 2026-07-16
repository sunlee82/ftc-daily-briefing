// 중요 자료실 — 목록. data/library/index.json을 읽어 카드 그리드를 그린다. (순수 JS)

const TYPE_LABELS = { document: "📄 참고자료", article: "📰 주요기사" };

function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

function cardHTML(item) {
  const tags = (item.tags || []).map((t) => `<span class="chip">${esc(t)}</span>`).join("");
  return `<a class="card" href="library-item.html?id=${encodeURIComponent(item.id)}">
    <span class="date">${esc(item.date)}</span>
    <span class="type-badge">${esc(TYPE_LABELS[item.type] || item.type)}</span>
    <h2>${esc(item.title)}</h2>
    <p class="summary">${esc(item.summary)}</p>
    ${tags ? `<div class="chips card-tags">${tags}</div>` : ""}
  </a>`;
}

function renderTagFilter(items, onSelect) {
  const el = document.getElementById("tag-filter");
  const tagSet = new Set();
  items.forEach((it) => (it.tags || []).forEach((t) => tagSet.add(t)));
  if (!tagSet.size) return;

  const tags = ["전체", ...[...tagSet].sort()];
  el.innerHTML = tags
    .map((t, i) => `<button class="tag-btn${i === 0 ? " active" : ""}" data-tag="${esc(t)}" type="button">${esc(t)}</button>`)
    .join("");
  el.addEventListener("click", (e) => {
    const btn = e.target.closest(".tag-btn");
    if (!btn) return;
    el.querySelectorAll(".tag-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    onSelect(btn.getAttribute("data-tag"));
  });
}

async function load() {
  const el = document.getElementById("library-cards");
  try {
    const res = await fetch("data/library/index.json", { cache: "no-store" });
    if (!res.ok) throw new Error("index.json 응답 오류: " + res.status);
    let list = await res.json();
    if (!Array.isArray(list)) list = [];
    list = list.filter((it) => (it.status || "published") === "published");

    if (!list.length) {
      el.innerHTML = `<p class="empty">아직 등록된 자료가 없습니다.</p>`;
      return;
    }
    // 날짜 최신순 → 같은 날짜 안에서는 등록한 순서의 역순(마지막에 올린 게 맨 위)
    list = list
      .map((it, i) => ({ it, i }))
      .sort((a, b) => {
        if (a.it.date !== b.it.date) return a.it.date < b.it.date ? 1 : -1;
        return b.i - a.i;
      })
      .map((x) => x.it);

    const render = (tag) => {
      const filtered = !tag || tag === "전체" ? list : list.filter((it) => (it.tags || []).includes(tag));
      el.innerHTML = filtered.length
        ? filtered.map(cardHTML).join("")
        : `<p class="empty">'${esc(tag)}' 태그에 해당하는 자료가 없습니다.</p>`;
    };

    renderTagFilter(list, render);
    render("전체");
  } catch (err) {
    el.innerHTML = `<p class="error">자료실 목록을 불러오지 못했습니다.<br /><small>${esc(err.message)}</small></p>`;
  }
}

load();

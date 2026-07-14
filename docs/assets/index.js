// 카드 인덱스 — data/index.json을 읽어 카드 그리드를 그린다. (순수 JS, 빌드 없음)

function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

function cardHTML(b) {
  return `<a class="card" href="briefing.html?date=${encodeURIComponent(b.id)}">
    <span class="date">${esc(b.date)}</span>
    <h2>${esc(b.title)}</h2>
    <p class="summary">${esc(b.summary)}</p>
  </a>`;
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
    // 최신순 정렬
    list.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
    el.innerHTML = list.map(cardHTML).join("");
  } catch (err) {
    el.innerHTML = `<p class="error">브리핑 목록을 불러오지 못했습니다.<br /><small>${esc(err.message)}</small></p>`;
  }
}

load();

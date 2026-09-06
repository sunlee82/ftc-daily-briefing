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

function cardHTML(b, isToday) {
  const wd = weekdayOf(b.date);
  const todayChip = isToday ? `<span class="today">오늘</span>` : "";
  const counts = countsHTML(b.counts);
  const peek = peekHTML(b.peek);
  // counts·peek가 아직 없는 예전 카드는 기존처럼 요약을 보여준다
  const body = counts || peek
    ? counts + peek
    : `<p class="summary">${esc(b.summary)}</p>`;
  return `<a class="card" href="briefing.html?date=${encodeURIComponent(b.id)}">
    <span class="datebar">
      <span class="date">${esc(b.date)}${wd ? `<span class="wd">${wd}</span>` : ""}</span>${todayChip}
    </span>
    <h2>${esc(b.title)}</h2>
    ${body}
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
    const today = todayKST();
    el.innerHTML = list.map((b, i) => cardHTML(b, i === 0 && b.date === today)).join("");
  } catch (err) {
    el.innerHTML = `<p class="error">브리핑 목록을 불러오지 못했습니다.<br /><small>${esc(err.message)}</small></p>`;
  }
}

load();

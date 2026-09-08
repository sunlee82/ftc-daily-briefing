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

// 브리핑 분석 대시보드 — 배포된 모든 브리핑을 정량(추이·빈도)·정성(키워드·교차분석)으로 집계해 시각화.
// 외부 라이브러리 없이 순수 SVG로 렌더링. 색상은 dataviz 스킬의 검증된 참조 팔레트를 사용.
"use strict";

// ---------- 유틸 ----------
function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}
function fmt(n) {
  return n.toLocaleString("ko-KR");
}
async function fetchJSON(path) {
  const res = await fetch(path, { cache: "no-store" });
  if (!res.ok) throw new Error(`${path} 응답 오류: ${res.status}`);
  return res.json();
}

// ---------- 툴팁 (이벤트 위임) ----------
const tipEl = document.getElementById("viz-tooltip");
function positionTip(x, y) {
  tipEl.style.left = x + "px";
  tipEl.style.top = y + "px";
}
document.addEventListener("mouseover", (e) => {
  const t = e.target.closest("[data-tip]");
  if (!t) return;
  tipEl.textContent = t.getAttribute("data-tip");
  tipEl.classList.add("show");
  positionTip(e.clientX, e.clientY);
});
document.addEventListener("mousemove", (e) => {
  if (tipEl.classList.contains("show")) positionTip(e.clientX, e.clientY);
});
document.addEventListener("mouseout", (e) => {
  if (e.target.closest("[data-tip]")) tipEl.classList.remove("show");
});

// ---------- SVG 경로 헬퍼 (4px 라운드 데이터 끝, 베이스라인 쪽은 각짐) ----------
function roundedTopPath(x, y, w, h, r) {
  r = Math.min(r, w / 2, h);
  return `M${x},${y + h} L${x},${y + r} Q${x},${y} ${x + r},${y} L${x + w - r},${y} Q${x + w},${y} ${x + w},${y + r} L${x + w},${y + h} Z`;
}
function roundedRightPath(x, y, w, h, r) {
  w = Math.max(w, 0.001);
  r = Math.min(r, w, h / 2);
  return `M${x},${y} L${x + w - r},${y} Q${x + w},${y} ${x + w},${y + r} L${x + w},${y + h - r} Q${x + w},${y + h} ${x + w - r},${y + h} L${x},${y + h} Z`;
}

// ---------- 데이터 로드 & 집계 ----------
async function loadAllBriefings() {
  const index = await fetchJSON("data/index.json");
  const briefings = await Promise.all(
    index.map((c) => fetchJSON(`data/briefings/${c.id}.json`).catch(() => null))
  );
  return briefings.filter(Boolean);
}

const STOPWORDS = new Set([
  "있다", "있는", "있습니다", "하는", "했다", "한다", "되다", "됐다", "되며", "합니다", "했습니다",
  "됩니다", "한다고", "있다고", "했다고", "으로", "에서", "이번", "관련", "대한", "위해", "통해",
  "밝혔다", "전했다", "것으로", "것이다", "것을", "것이", "그리고", "하지만", "이라고", "라며",
  "이며", "한편", "이날", "오늘", "최근", "지난", "대해", "대해서", "통한", "에게", "에서는",
  "까지", "부터", "에는", "에도", "에만", "으로는", "로는", "라는", "이라는", "등을", "등이", "등의", "등",
]);

function tokenize(text) {
  return (text || "")
    .replace(/[^가-힣a-zA-Z0-9\s]/g, " ")
    .split(/\s+/)
    .map((w) => w.trim())
    .filter((w) => w.length >= 2 && !STOPWORDS.has(w) && !/^\d+$/.test(w));
}

const CATEGORY_LABELS = { press: "공정위 보도자료", committee: "위원회 소식", news: "뉴스 보도내용" };

function computeStats(briefings) {
  const keywordCounts = new Map();
  const wordCounts = new Map();
  const categoryCounts = new Map();
  const itemsByDate = [];
  let totalItems = 0;
  const namedEntities = new Set();

  briefings.forEach((b) => {
    (b.competitors || []).forEach((c) => {
      namedEntities.add(c);
      c.split(/\s+/).forEach((w) => namedEntities.add(w)); // 다중 단어 이름의 부분 단어도 제외
    });
    (b.keywords || []).forEach((k) => namedEntities.add(k));
  });

  briefings
    .slice()
    .sort((a, b) => (a.date < b.date ? -1 : 1))
    .forEach((b) => {
      const items = b.items || [];
      itemsByDate.push({ label: b.date, value: items.length });
      totalItems += items.length;
      items.forEach((it) => {
        const cat = it.category || "news";
        const catLabel = CATEGORY_LABELS[cat] || cat;
        categoryCounts.set(catLabel, (categoryCounts.get(catLabel) || 0) + 1);
        if (it.keyword) {
          keywordCounts.set(it.keyword, (keywordCounts.get(it.keyword) || 0) + 1);
        }
        tokenize(`${it.headline || ""} ${it.summary || ""}`).forEach((w) => {
          if (namedEntities.has(w)) return;
          wordCounts.set(w, (wordCounts.get(w) || 0) + 1);
        });
      });
    });

  const toSortedArr = (map) =>
    [...map.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);

  return {
    totalBriefings: briefings.length,
    totalItems,
    keywordCount: keywordCounts.size,
    itemsByDate,
    keywordCounts: toSortedArr(keywordCounts),
    categoryCounts: toSortedArr(categoryCounts),
    topWords: toSortedArr(wordCounts).slice(0, 10),
  };
}

// 상위 N개 + 나머지는 "기타"로 묶기
function topNWithOther(sortedArr, n) {
  if (sortedArr.length <= n) return sortedArr;
  const top = sortedArr.slice(0, n);
  const rest = sortedArr.slice(n).reduce((sum, x) => sum + x.value, 0);
  if (rest > 0) top.push({ label: "기타", value: rest });
  return top;
}

// ---------- 렌더러 ----------
function renderStatTiles(stats) {
  const avgItems = stats.totalBriefings ? Math.round((stats.totalItems / stats.totalBriefings) * 10) / 10 : 0;
  const tiles = [
    ["배포된 브리핑", fmt(stats.totalBriefings) + "건"],
    ["누적 수집 항목", fmt(stats.totalItems) + "건"],
    ["브리핑당 평균 항목", fmt(avgItems) + "건"],
    ["관심 키워드", fmt(stats.keywordCount) + "개"],
  ];
  return `<div class="stat-row">${tiles
    .map(([label, value]) => `<div class="stat-tile"><div class="label">${esc(label)}</div><div class="value">${esc(value)}</div></div>`)
    .join("")}</div>`;
}

// 날짜별 항목 수 — 세로 막대(단일 계열: 범례 불필요, 카드 제목이 계열을 대신함)
function renderDateBar(data) {
  if (!data.length) return `<p class="empty">데이터가 없습니다.</p>`;
  const W = 640, H = 200;
  const padL = 34, padR = 10, padT = 10, padB = 28;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const max = Math.max(...data.map((d) => d.value), 1);
  const n = data.length;
  const gap = 3;
  const barW = Math.max(2, Math.min(24, plotW / n - gap));
  const showLabels = n <= 14;
  const showValues = n <= 14;

  const gridY = [0, 0.5, 1].map((f) => padT + plotH * (1 - f));
  let gridSvg = gridY
    .map((y, i) => `<line class="grid-line" x1="${padL}" y1="${y}" x2="${W - padR}" y2="${y}" />
      <text class="axis-tick" x="${padL - 6}" y="${y + 3}" text-anchor="end">${fmt(Math.round(max * (i === 0 ? 1 : i === 1 ? 0.5 : 0)))}</text>`)
    .join("");

  let bars = "";
  data.forEach((d, i) => {
    const x = padL + i * (plotW / n) + (plotW / n - barW) / 2;
    const h = (d.value / max) * plotH;
    const y = padT + plotH - h;
    bars += `<path class="viz-bar" d="${roundedTopPath(x, y, barW, Math.max(h, 1), 4)}" style="fill:var(--viz-series-1)" data-tip="${esc(d.label)}: ${d.value}건"></path>`;
    if (showValues && h > 12) {
      bars += `<text class="bar-value" x="${x + barW / 2}" y="${y - 5}" text-anchor="middle">${d.value}</text>`;
    }
    if (showLabels) {
      bars += `<text class="axis-tick" x="${x + barW / 2}" y="${H - 8}" text-anchor="middle">${esc(d.label.slice(5))}</text>`;
    }
  });

  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="날짜별 수집 항목 수 추이">
    ${gridSvg}
    <line class="baseline" x1="${padL}" y1="${padT + plotH}" x2="${W - padR}" y2="${padT + plotH}" />
    ${bars}
  </svg>`;
}

// 순위형 가로 막대 — 키워드/단어 공용. 축 라벨이 이미 항목명을 표시하므로 단일 색만 사용.
function renderRankedBar(items, { unit = "건" } = {}) {
  if (!items.length) return `<p class="empty">데이터가 없습니다.</p>`;
  const rowH = 22, gap = 8;
  const W = 520;
  const labelW = 92, padR = 48;
  const barAreaW = W - labelW - padR;
  const H = items.length * (rowH + gap) - gap + 8;
  const max = Math.max(...items.map((d) => d.value), 1);

  const rows = items
    .map((d, i) => {
      const y = i * (rowH + gap) + 4;
      const w = (d.value / max) * barAreaW;
      return `
        <text class="bar-label" x="${labelW - 8}" y="${y + rowH / 2 + 4}" text-anchor="end">${esc(d.label.length > 10 ? d.label.slice(0, 9) + "…" : d.label)}</text>
        <path class="viz-bar" d="${roundedRightPath(labelW, y, w, rowH, 4)}" style="fill:var(--viz-series-1)" data-tip="${esc(d.label)}: ${fmt(d.value)}${unit}"></path>
        <text class="bar-value" x="${labelW + w + 6}" y="${y + rowH / 2 + 4}">${fmt(d.value)}</text>`;
    })
    .join("");

  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="빈도 순위 막대 차트">${rows}</svg>`;
}

// 키워드별 빈도 표 (접근성 대체 — 순위형 막대 차트의 원자료)
function renderKeywordTable(stats) {
  const body = stats.keywordCounts
    .map((k) => `<tr><td>${esc(k.label)}</td><td>${fmt(k.value)}</td></tr>`)
    .join("");
  return `<details class="table-view">
    <summary>표로 보기 (키워드별 원자료)</summary>
    <table class="data-table">
      <thead><tr><th>키워드</th><th>건수</th></tr></thead>
      <tbody>${body || '<tr><td colspan="2">데이터 없음</td></tr>'}</tbody>
    </table>
  </details>`;
}

// ---------- 메인 ----------
async function main() {
  const el = document.getElementById("dash");
  try {
    const briefings = await loadAllBriefings();
    if (!briefings.length) {
      el.innerHTML = `<p class="empty">아직 배포된 브리핑이 없어 분석할 데이터가 없습니다.</p>`;
      return;
    }
    const stats = computeStats(briefings);

    el.innerHTML = `
      ${renderStatTiles(stats)}

      <section class="dash-section">
        <h2>일자별 수집 항목 추이</h2>
        <p class="hint">정량 · 브리핑이 배포될 때마다 수집된 항목 수</p>
        <div class="chart-card">${renderDateBar(stats.itemsByDate)}</div>
      </section>

      <section class="dash-section">
        <h2>카테고리별 항목 수</h2>
        <p class="hint">정량 · 공정위 보도자료 · 위원회 소식 · 뉴스 보도내용 구성비</p>
        <div class="chart-card">${renderRankedBar(stats.categoryCounts)}</div>
      </section>

      <section class="dash-section">
        <h2>키워드별 언급 빈도</h2>
        <p class="hint">정량 · 공정거래위원회 관련 키워드별 등장 횟수</p>
        <div class="chart-card">${renderRankedBar(topNWithOther(stats.keywordCounts, 8))}</div>
        ${renderKeywordTable(stats)}
      </section>

      <section class="dash-section">
        <h2>자주 언급된 단어</h2>
        <p class="hint">정성 · 헤드라인·요약 텍스트에서 자주 등장한 단어 (빈도 기반 간이 분석, 키워드명 제외)</p>
        <div class="chart-card">${renderRankedBar(stats.topWords, { unit: "회" })}</div>
      </section>
    `;
  } catch (err) {
    el.innerHTML = `<p class="error">대시보드 데이터를 불러오지 못했습니다.<br /><small>${esc(err.message)}</small></p>`;
  }
}

main();

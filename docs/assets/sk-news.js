// SK 관련 뉴스 — 지금까지 배포된 브리핑에서 SK그룹 계열사가 나오는 항목만 모아 날짜별로 보여준다.
// data/index.json으로 브리핑 목록을 얻고, 각 data/briefings/<id>.json을 읽어 거른다. (순수 JS, 빌드 없음)
"use strict";

function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

// SK그룹 판별 — 대시보드(dashboard.js)와 같은 기준.
// "SK"는 앞뒤에 영문자가 붙지 않을 때만 인정(TASK 같은 오검출 방지).
// SK증권은 2018년 계열 분리, 원스토어는 2026-06 매각으로 제외한다.
const OUR_GROUP_RE = /(^|[^A-Za-z])SK([^A-Za-z]|$)|SKC|에스케이|11번가|티맵|하이닉스|최태원/;
const NOT_OUR_GROUP_RE = /SK증권/g;
function isOurGroup(text) {
  return OUR_GROUP_RE.test(String(text || "").replace(NOT_OUR_GROUP_RE, ""));
}

// 화면에서 SK 회사명을 빨간 굵은 글씨로 강조한다(이스케이프 후 적용)
// "SK" 글자와 사명에 SK가 없는 계열사 이름만 칠한다(SK증권은 제외).
const HL_RE = /(?<![A-Za-z])SKC?(?![A-Za-z]|증권)|11번가|티맵모빌리티|티맵|하이닉스|최태원/g;
function hl(s) {
  return esc(s).replace(HL_RE, (m) => `<b class="sk-red">${m}</b>`);
}
function hlBody(s) {
  return hl(s)
    .replace(/##(.+?)##/g, "<strong>$1</strong>")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\n/g, "<br>");
}

function bodyHTML(summary) {
  const lines = String(summary || "").split("\n").map((l) => l.trim()).filter(Boolean);
  const bullets = lines.filter((l) => l.startsWith("- ")).map((l) => l.slice(2));
  if (!bullets.length) return lines.length ? `<p>${hlBody(lines.join("\n"))}</p>` : "";
  const lead = lines.filter((l) => !l.startsWith("- ")).join("\n");
  return (lead ? `<p>${hlBody(lead)}</p>` : "") +
    `<ul class="pts">${bullets.map((b) => `<li>${hlBody(b)}</li>`).join("")}</ul>`;
}

const CAT_LABEL = { press: "공정위 보도자료", committee: "위원회 소식", news: "언론 보도" };
const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];
function fmtDate(id) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(id);
  if (!m) return esc(id);
  const wd = WEEKDAYS[new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).getUTCDay()];
  return `${+m[1]}.${+m[2]}.${+m[3]}.(${wd})`;
}

function itemHTML(it, id) {
  const src = it.source_url
    ? `<a class="src-inline" href="${esc(it.source_url)}" target="_blank" rel="noopener">원문 ↗</a>`
    : "";
  return `<article class="item">
    <div class="item-row">
      <h3><span class="sk-cat">${esc(CAT_LABEL[it.category] || "언론 보도")}</span>${hl(it.headline)}</h3>
      ${src}
    </div>
    ${bodyHTML(it.summary)}
    <a class="sk-day" href="briefing.html?date=${encodeURIComponent(id)}">이날 브리핑 전체 보기 →</a>
  </article>`;
}

async function load() {
  const el = document.getElementById("sk");
  try {
    const res = await fetch("data/index.json", { cache: "no-store" });
    if (!res.ok) throw new Error("index.json 응답 오류: " + res.status);
    const ids = (await res.json()).map((c) => c.id).filter((id) => /^\d{4}-\d{2}-\d{2}$/.test(id))
      .sort().reverse();

    const briefs = await Promise.all(ids.map((id) =>
      fetch(`data/briefings/${id}.json`, { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null)).catch(() => null)));

    const seen = new Set();
    const days = [];
    briefs.forEach((b, i) => {
      if (!b) return;
      const hits = (b.items || []).filter((it) => {
        // 위원회 소식은 인사·일정이라 SK가 등장할 일이 거의 없지만, 등장하면 싣는다
        if (!isOurGroup(`${it.headline} ${it.summary}`)) return false;
        const key = it.source_url || `${ids[i]}|${it.headline}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      if (hits.length) days.push({ id: ids[i], hits });
    });

    const total = days.reduce((n, d) => n + d.hits.length, 0);
    if (!total) {
      el.innerHTML = `<p class="empty">아직 SK 관련 항목이 없습니다.</p>`;
      return;
    }
    el.innerHTML = `
      <p class="sk-meta">브리핑 ${ids.length}일치에서 <b class="sk-red">SK</b> 관련 항목 <strong>${total}</strong>건을 찾았습니다. 최신순입니다.</p>
      ${days.map((d) => `<section class="item-group">
        <h2 class="group-title">${fmtDate(d.id)} <small>(${d.hits.length}건)</small></h2>
        ${d.hits.map((it) => itemHTML(it, d.id)).join("")}
      </section>`).join("")}`;
  } catch (err) {
    el.innerHTML = `<p class="error">자료를 불러오지 못했습니다.<br /><small>${esc(err.message)}</small></p>`;
  }
}

load();

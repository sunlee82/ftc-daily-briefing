// 인사발령 — data/personnel.json을 읽어 한 줄씩 나열하고 이름으로 찾을 수 있게 한다.
// 줄 형식은 브리핑 상세의 위원회 소식과 같게 맞추고, 발령일만 맨 뒤에 붙인다.
// 자료는 위원회 소식에서 배포 워크플로우가 누적한다. (순수 JS, 빌드 없음)
"use strict";

function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

let ALL = [];

function lineHTML(r) {
  const names = (r.names || [])
    .map((n) => `<strong class="person-name">${esc(n)}</strong>`)
    .join("·");
  const rankOrg = [r.rank || "", r.org ? `(${r.org})` : ""].join("");
  const period = r.period ? ` (${esc(r.period)})` : "";
  return `<li class="pr-line">
    <span class="pr-text">${names}${rankOrg ? " " + esc(rankOrg) : ""} &ndash; ${esc(r.action)}${period}<span class="pr-on">(${esc(r.date)})</span></span>
  </li>`;
}

function render(list) {
  const el = document.getElementById("records");
  if (!list.length) {
    el.innerHTML = `<p class="empty">찾는 조건에 맞는 발령이 없습니다.</p>`;
    return;
  }
  const sorted = list.slice().sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  el.innerHTML = `<div class="pr-panel"><ul class="pr-list">${sorted.map(lineHTML).join("")}</ul></div>`;
}

function applyFilter() {
  const q = document.getElementById("q").value.trim().toLowerCase();
  const list = !q ? ALL : ALL.filter((r) => {
    const hay = [(r.names || []).join(" "), r.rank, r.org, r.action, r.type, r.date]
      .join(" ").toLowerCase();
    return hay.includes(q);
  });
  const people = new Set(list.flatMap((r) => r.names || []));
  document.getElementById("summary").innerHTML =
    `발령 <strong>${list.length}</strong>건 · 인원 <strong>${people.size}</strong>명` +
    (q ? ` · &ldquo;<strong>${esc(q)}</strong>&rdquo; 검색 결과` : "");
  render(list);
}

async function load() {
  const el = document.getElementById("records");
  try {
    const res = await fetch("data/personnel.json", { cache: "no-store" });
    if (!res.ok) throw new Error("personnel.json 응답 오류: " + res.status);
    const d = await res.json();
    ALL = Array.isArray(d.records) ? d.records : [];
    document.getElementById("q").addEventListener("input", applyFilter);
    applyFilter();
  } catch (err) {
    el.innerHTML = `<p class="error">인사발령 자료를 불러오지 못했습니다.<br /><small>${esc(err.message)}</small></p>`;
  }
}

load();

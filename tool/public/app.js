// 브리핑 생성 도구 — 프런트 로직 (순수 JS)
// 흐름: 입력 → /api/generate → 편집 가능한 미리보기 → /api/publish

const $ = (id) => document.getElementById(id);
let brief = null; // 현재 편집 중인 브리핑 (서버 생성 후 클라이언트에서 수정)
// 이번 세션에서 한 번이라도 검색된 적 있는 항목 — 삭제해도 여기서는 빠지지 않는다.
// 추가 검색 시 "이미 본 적 있는" 판단 기준으로 쓴다(삭제한 항목이 재등장하지 않도록).
let seenUrls = new Set();
let seenHeadlines = new Set();
function trackSeen(items) {
  items.forEach((it) => {
    if (it.source_url) seenUrls.add(it.source_url);
    if (it.headline) seenHeadlines.add(it.headline);
  });
}

function splitList(v) {
  return v.split(",").map((s) => s.trim()).filter(Boolean);
}
function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}
function setStatus(el, msg, kind) {
  el.textContent = msg;
  el.className = "status" + (kind ? " " + kind : "");
}

// ---------- 필수 키워드 프리셋 (localStorage) ----------
const DEFAULT_MANDATORY_KEYWORDS = "공정위, 과징금, 현장조사, 담합";

function initMandatoryKeywords() {
  const saved = localStorage.getItem("briefing.mandatoryKeywords");
  $("mandatoryKeywords").value = saved || DEFAULT_MANDATORY_KEYWORDS;
}
function savePreset() {
  localStorage.setItem("briefing.mandatoryKeywords", $("mandatoryKeywords").value);
  setStatus($("gen-status"), "필수 키워드를 저장했습니다.", "ok");
}
function loadPreset() {
  const saved = localStorage.getItem("briefing.mandatoryKeywords");
  if (!saved) return setStatus($("gen-status"), "저장된 필수 키워드가 없습니다.", "err");
  $("mandatoryKeywords").value = saved;
  setStatus($("gen-status"), "필수 키워드를 불러왔습니다.", "ok");
}

function commonOpts() {
  return {
    windowHours: Number($("windowHours").value),
    maxPerPair: Number($("maxPerPair").value),
  };
}

// ---------- 생성 ----------
// 필수 키워드 각각으로 한 번씩 검색해 다양한 결과를 만든다.
async function generate() {
  const keywords = splitList($("mandatoryKeywords").value);
  if (!keywords.length) {
    return setStatus($("gen-status"), "필수 검색 키워드를 1개 이상 입력하세요.", "err");
  }
  const opts = { ...commonOpts(), keywords };
  $("generate").disabled = true;
  setStatus($("gen-status"), `필수 키워드(${keywords.join(", ")})로 동향 수집·요약 중…`, "");
  try {
    const res = await fetch("/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(opts),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "생성 실패");
    brief = data;
    seenUrls = new Set();
    seenHeadlines = new Set();
    trackSeen(brief.items);
    renderPreview();
    setStatus($("gen-status"), `생성 완료: 수집 ${data._meta.collected}건 → 중복 제거 후 ${data._meta.deduped}건`, "ok");
  } catch (err) {
    setStatus($("gen-status"), err.message, "err");
  } finally {
    $("generate").disabled = false;
  }
}

// ---------- 추가 검색 (지정한 키워드로, 기존 결과 제외하고 더 찾기) ----------
// 삭제한 항목도 포함해 "이번 세션에서 이미 본 적 있는" 모든 항목(seenUrls/seenHeadlines)을
// 기준으로 제외한다 — 남아있는 brief.items만 보면 삭제한 항목이 재등장할 수 있어서다.
async function generateMore() {
  if (!brief) return;
  const opts = {
    ...commonOpts(),
    keywords: splitList($("moreKeywords").value),
    excludeKeywords: splitList($("moreExcludeKeywords").value),
  };
  const excludeUrls = [...seenUrls];
  const existingHeadlines = [...seenHeadlines];

  $("generate-more").disabled = true;
  setStatus($("more-status"), "지정한 키워드로 추가 검색 중…", "");
  try {
    const res = await fetch("/api/generate-more", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...opts, excludeUrls, existingHeadlines }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "추가 검색 실패");
    if (!data.items.length) {
      setStatus($("more-status"), "새로 찾은 항목이 없습니다 (중복·유사 항목 제외).", "ok");
      return;
    }
    trackSeen(data.items);
    brief.items = regroupByCategory([...brief.items, ...data.items]);
    renderItems();
    setStatus($("more-status"), `${data.items.length}건 추가됨 (기존과 중복·유사한 항목은 제외).`, "ok");
  } catch (err) {
    setStatus($("more-status"), err.message, "err");
  } finally {
    $("generate-more").disabled = false;
  }
}

// ---------- 미리보기 · 편집 ----------
function renderPreview() {
  $("preview-panel").classList.remove("hidden");
  $("meta-line").textContent =
    `${brief.date} · 공정거래위원회 · 키워드 ${brief.keywords.join(", ")}`;
  $("edit-title").value = brief.title;
  $("edit-summary").value = brief.summary;
  renderItems();
  $("preview-panel").scrollIntoView({ behavior: "smooth", block: "start" });
}

// 카테고리 표시 순서 고정 (보도자료 → 위원회 소식 → 뉴스)
const CATEGORY_ORDER = ["press", "committee", "news"];
const CATEGORY_LABELS = { press: "공정위 보도자료", committee: "위원회 소식", news: "뉴스 보도내용" };

// 카테고리별로 항목을 다시 묶어 배열을 연속 구간으로 만든다(각 카테고리 내 상대 순서는 유지).
// ▲▼ 이동은 같은 카테고리가 배열에서 연속돼 있다는 전제로 동작하므로, 추가 검색으로
// 항목을 이어붙인 뒤에는 반드시 이 함수로 다시 정렬해야 한다.
function regroupByCategory(items) {
  return CATEGORY_ORDER.flatMap((cat) => items.filter((it) => it.category === cat));
}

function renderItems() {
  const box = $("items");
  box.innerHTML = "";

  for (const cat of CATEGORY_ORDER) {
    // [글로벌 인덱스, 항목] 쌍만 모아서 해당 카테고리 내 위/아래 이동 범위를 계산
    const group = brief.items
      .map((it, i) => [i, it])
      .filter(([, it]) => it.category === cat);
    if (!group.length) continue;

    const section = document.createElement("section");
    section.className = "item-group";
    section.innerHTML = `<h3 class="group-title">${esc(CATEGORY_LABELS[cat] || cat)} <small>(${group.length}건)</small></h3>`;

    group.forEach(([i, it], pos) => {
      const div = document.createElement("div");
      div.className = "edit-item";
      div.innerHTML = `
        <div class="top">
          <span class="tag">${esc(it.keyword || it.category_label || CATEGORY_LABELS[cat])}</span>
          <div class="order-controls">
            <button class="icon-btn" data-up="${i}" type="button" ${pos === 0 ? "disabled" : ""} title="위로">▲</button>
            <button class="icon-btn" data-down="${i}" type="button" ${pos === group.length - 1 ? "disabled" : ""} title="아래로">▼</button>
            <button class="link-danger" data-del="${i}" type="button">삭제</button>
          </div>
        </div>
        <input class="h" data-field="headline" data-i="${i}" value="${esc(it.headline)}" />
        <textarea data-field="summary" data-i="${i}" rows="2">${esc(it.summary)}</textarea>
        ${it.source_url
          ? `<a class="src" href="${esc(it.source_url)}" target="_blank" rel="noopener noreferrer">${esc(it.source_url)} ↗</a>`
          : ""}`;
      section.appendChild(div);
    });
    box.appendChild(section);
  }
}

// 같은 카테고리 내에서 i번째 항목을 j번째(글로벌 인덱스)로 이동(스왑)
function moveItem(i, j) {
  if (j < 0 || j >= brief.items.length) return;
  if (brief.items[i].category !== brief.items[j].category) return;
  [brief.items[i], brief.items[j]] = [brief.items[j], brief.items[i]];
  renderItems();
}

// 편집 반영 (이벤트 위임)
$("items").addEventListener("input", (e) => {
  const t = e.target;
  const i = t.getAttribute("data-i");
  const field = t.getAttribute("data-field");
  if (i != null && field) brief.items[Number(i)][field] = t.value;
});
$("items").addEventListener("click", (e) => {
  const up = e.target.getAttribute("data-up");
  if (up != null) return moveItem(Number(up), Number(up) - 1);
  const down = e.target.getAttribute("data-down");
  if (down != null) return moveItem(Number(down), Number(down) + 1);
  const del = e.target.getAttribute("data-del");
  if (del != null) {
    brief.items.splice(Number(del), 1);
    renderItems();
  }
});
$("edit-title").addEventListener("input", (e) => { brief.title = e.target.value; });
$("edit-summary").addEventListener("input", (e) => { brief.summary = e.target.value; });

// ---------- 제목·요약 새로고침 (현재까지 취사선택·추가검색·순서조정한 항목 기준) ----------
async function refreshOverview() {
  if (!brief) return;
  if (!brief.items.length) {
    return setStatus($("overview-status"), "항목이 없습니다. 최소 1건이 필요합니다.", "err");
  }
  $("refresh-overview").disabled = true;
  setStatus($("overview-status"), "현재 항목 기준으로 제목·요약 다시 작성 중…", "");
  try {
    const res = await fetch("/api/regenerate-overview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items: brief.items }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "새로고침 실패");
    brief.title = data.title;
    brief.summary = data.summary;
    $("edit-title").value = data.title;
    $("edit-summary").value = data.summary;
    setStatus($("overview-status"), "제목·요약을 새로 반영했습니다.", "ok");
  } catch (err) {
    setStatus($("overview-status"), err.message, "err");
  } finally {
    $("refresh-overview").disabled = false;
  }
}

// ---------- 배포 ----------
async function publish() {
  if (!brief) return;
  if (!brief.items.length) {
    return setStatus($("pub-status"), "항목이 없습니다. 최소 1건이 필요합니다.", "err");
  }
  $("publish").disabled = true;
  setStatus($("pub-status"), "배포 중…", "");
  try {
    const res = await fetch("/api/publish", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ brief }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "배포 실패");
    const gitLine = data.git?.pushed
      ? `🚀 GitHub Pages에도 push 완료 (1분 내 반영)`
      : `⚠️ git push는 안 됨 — ${esc(data.git?.note || "알 수 없음")} (로컬 저장은 완료)`;
    $("pub-status").innerHTML =
      `✅ 로컬 배포 완료 (총 ${data.count}건). <a href="${data.archiveUrl}" target="_blank">로컬 미리보기 ↗</a><br />${gitLine}`;
    $("pub-status").className = "status ok";
  } catch (err) {
    setStatus($("pub-status"), err.message, "err");
  } finally {
    $("publish").disabled = false;
  }
}

// ---------- 바인딩 ----------
initMandatoryKeywords();
$("generate").addEventListener("click", generate);
$("generate-more").addEventListener("click", generateMore);
$("refresh-overview").addEventListener("click", refreshOverview);
$("publish").addEventListener("click", publish);
$("save-preset").addEventListener("click", savePreset);
$("load-preset").addEventListener("click", loadPreset);

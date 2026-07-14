// 브리핑 생성 도구 — 프런트 로직 (순수 JS)
// 흐름: 입력 → /api/generate → 편집 가능한 미리보기 → /api/publish

const $ = (id) => document.getElementById(id);
let brief = null; // 현재 편집 중인 브리핑 (서버 생성 후 클라이언트에서 수정)

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

// ---------- 프리셋 (localStorage) ----------
function savePreset() {
  const p = { keywords: $("keywords").value };
  localStorage.setItem("briefing.preset", JSON.stringify(p));
  setStatus($("gen-status"), "프리셋을 저장했습니다.", "ok");
}
function loadPreset() {
  const raw = localStorage.getItem("briefing.preset");
  if (!raw) return setStatus($("gen-status"), "저장된 프리셋이 없습니다.", "err");
  const p = JSON.parse(raw);
  $("keywords").value = p.keywords || "";
  setStatus($("gen-status"), "프리셋을 불러왔습니다.", "ok");
}

// ---------- 생성 ----------
async function generate() {
  const keywords = splitList($("keywords").value);
  $("generate").disabled = true;
  setStatus($("gen-status"), keywords.length
    ? "공정거래위원회 동향 수집·요약 중…"
    : "공정거래위원회 전체 동향 수집·요약 중…", "");
  try {
    const res = await fetch("/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        keywords,
        windowHours: Number($("windowHours").value),
        maxPerPair: Number($("maxPerPair").value),
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "생성 실패");
    brief = data;
    renderPreview();
    setStatus($("gen-status"), `생성 완료: 수집 ${data._meta.collected}건 → 중복 제거 후 ${data._meta.deduped}건`, "ok");
  } catch (err) {
    setStatus($("gen-status"), err.message, "err");
  } finally {
    $("generate").disabled = false;
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
$("generate").addEventListener("click", generate);
$("publish").addEventListener("click", publish);
$("save-preset").addEventListener("click", savePreset);
$("load-preset").addEventListener("click", loadPreset);

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

function renderItems() {
  const box = $("items");
  box.innerHTML = "";
  brief.items.forEach((it, i) => {
    const div = document.createElement("div");
    div.className = "edit-item";
    div.innerHTML = `
      <div class="top">
        <span class="tag">${esc(it.keyword)}</span>
        <button class="link-danger" data-del="${i}" type="button">삭제</button>
      </div>
      <input class="h" data-field="headline" data-i="${i}" value="${esc(it.headline)}" />
      <textarea data-field="summary" data-i="${i}" rows="2">${esc(it.summary)}</textarea>
      ${it.source_url
        ? `<a class="src" href="${esc(it.source_url)}" target="_blank" rel="noopener noreferrer">${esc(it.source_url)} ↗</a>`
        : ""}`;
    box.appendChild(div);
  });
}

// 편집 반영 (이벤트 위임)
$("items").addEventListener("input", (e) => {
  const t = e.target;
  const i = t.getAttribute("data-i");
  const field = t.getAttribute("data-field");
  if (i != null && field) brief.items[Number(i)][field] = t.value;
});
$("items").addEventListener("click", (e) => {
  const del = e.target.getAttribute("data-del");
  if (del == null) return;
  brief.items.splice(Number(del), 1);
  renderItems();
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
    $("pub-status").innerHTML =
      `✅ 배포 완료 (총 ${data.count}건). <a href="${data.archiveUrl}" target="_blank">아카이브에서 보기 ↗</a>`;
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

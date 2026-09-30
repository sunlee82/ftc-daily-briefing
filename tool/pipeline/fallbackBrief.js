#!/usr/bin/env node
// ┌─────────────────────────────────────────────────────────────────────┐
// │  간이 브리핑 — Claude 다듬기가 실패한 날의 비상용.                     │
// │                                                                     │
// │  Claude가 한도 초과·로그인 만료·오류로 못 돌면 그날 브리핑이 아예 안   │
// │  나간다(GitHub 폴백도 같은 구독 토큰을 써서 한도 초과 땐 같이 죽는다). │
// │  품질이 낮더라도 회람이 끊기지 않게, 이 스크립트가 today.json만으로     │
// │  브리핑을 만든다.                                                     │
// │                                                                     │
// │  - 맥미니의 Ollama(localhost:11434)가 살아 있으면 보도자료 요약과      │
// │    위원회 소식 정리를 로컬 모델에 맡긴다.                             │
// │  - Ollama가 없거나 응답이 이상하면 원문에서 규칙대로 뽑는다(모델 없음). │
// │  - 뉴스는 모델 없이 규칙으로만 거른다: 최근 14일 배포분 URL 제외,      │
// │    하루 지난 기사 제외, 제목이 비슷한 중복 제외, 최대 10건.            │
// │  - 규제동향(insight)·인사발령(personnel)은 건드리지 않는다.            │
// │  - 제목 앞에 [간이]를 붙여 정식 브리핑과 구분한다.                    │
// │                                                                     │
// │  쓰는 파일: docs/data/briefings/<id>.json, latest.json, index.json    │
// │  커밋·푸시는 collect.sh가 한다.                                       │
// │                                                                     │
// │  환경변수: OLLAMA_MODEL(모델 지정), OLLAMA_HOST, FALLBACK_NO_LLM=1     │
// └─────────────────────────────────────────────────────────────────────┘
"use strict";

const fs = require("fs");
const path = require("path");
const { loadPublishedUrls } = require("./publishedUrls");

const PENDING = path.join("tool", "pending", "today.json");
const BRIEF_DIR = path.join("docs", "data", "briefings");
const LATEST = path.join("docs", "data", "latest.json");
const INDEX = path.join("docs", "data", "index.json");
const OLLAMA = (process.env.OLLAMA_HOST || "http://127.0.0.1:11434").replace(/\/$/, "");
const MAX_NEWS = 10;

// 한국어 요약에 쓸 만한 순서. 설치된 것 중 앞에 있는 것을 고른다.
const MODEL_PREF = [/qwen3/i, /qwen2\.5/i, /gemma3/i, /exaone/i, /gemma/i, /llama3/i, /mistral/i];

function log(...a) { console.log("[간이]", ...a); }

// ---------- Ollama ----------
async function pickModel() {
  if (process.env.FALLBACK_NO_LLM === "1") return null;
  try {
    const res = await fetch(`${OLLAMA}/api/tags`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    const names = ((await res.json()).models || []).map((m) => m.name)
      .filter((n) => !/embed/i.test(n));
    if (process.env.OLLAMA_MODEL) {
      return names.includes(process.env.OLLAMA_MODEL) ? process.env.OLLAMA_MODEL : null;
    }
    for (const re of MODEL_PREF) {
      const hit = names.find((n) => re.test(n));
      if (hit) return hit;
    }
    return names[0] || null;
  } catch {
    return null;
  }
}

async function ask(model, prompt) {
  if (!model) return null;
  try {
    const res = await fetch(`${OLLAMA}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model, prompt, stream: false, think: false,
        options: { temperature: 0.2, num_ctx: 8192 },
      }),
      signal: AbortSignal.timeout(240000),
    });
    if (!res.ok) return null;
    let out = String((await res.json()).response || "");
    out = out.replace(/<think>[\s\S]*?<\/think>/g, "").replace(/```[a-z]*\n?|```/g, "").trim();
    return out || null;
  } catch (e) {
    log("모델 응답 실패:", e.message);
    return null;
  }
}

// ---------- 보도자료 ----------
// 보도자료 PDF 첫머리의 "- ..." 부제 줄을 뽑는다(원문 그대로라 틀릴 일이 없다).
function pressRaw(it) {
  const t = String(it.pdfText || "");
  const subs = t.split("\n").slice(0, 40)
    .map((l) => l.trim())
    .filter((l) => /^-\s*\S/.test(l) && !/^-\s*\d+\s*-$/.test(l))
    .map((l) => "- " + l.replace(/^-\s*/, "").replace(/\s*-$/, "").replace(/\s+/g, " "))
    .slice(0, 4);
  if (subs.length) return `${it.headline}\n${subs.join("\n")}`;
  return it.dept ? `담당부서: ${it.dept} (원문 링크 참조)` : "원문 링크 참조";
}

function looksOk(s) {
  if (!s || s.length < 20 || s.length > 900) return false;
  const lines = s.split("\n").filter(Boolean);
  if (lines.length < 2 || lines.length > 7) return false;
  // 한국어가 대부분이어야 한다(모델이 영어로 답하는 경우를 거른다)
  const ko = (s.match(/[가-힣]/g) || []).length;
  return ko / s.replace(/\s/g, "").length > 0.3;
}

async function pressSummary(model, it) {
  if (model && it.pdfText) {
    const prompt = `다음은 공정거래위원회 보도자료 원문이다. 사내 법무팀 회람용으로 요약하라.

형식(이 형식만 출력하고 다른 말은 쓰지 마라):
첫 줄: 무엇을 하는 조치인지 한 문장, 40자 내외, 명사로 끝낸다(예: "~ 부과", "~ 체결", "~ 행정예고"). "~한다"로 끝내지 마라.
둘째 줄부터: "- "로 시작하는 항목 2~4개, 각 40자 내외 개조식.
금액·비율·날짜·기한은 **굵게** 표시한다. 원문에 없는 내용은 절대 쓰지 마라.

제목: ${it.headline}
원문:
${String(it.pdfText).slice(0, 6000)}`;
    const out = await ask(model, prompt);
    if (looksOk(out)) {
      return out.split("\n").map((l) => l.trim()).filter(Boolean)
        .map((l, i) => (i === 0 ? l.replace(/^[-*•]\s*/, "") : "- " + l.replace(/^[-*•]\s*/, "")))
        .join("\n");
    }
    log(`보도자료 요약을 모델이 제대로 못 만들어 원문 부제로 대신함: ${it.headline}`);
  }
  return pressRaw(it);
}

// ---------- 위원회 소식 ----------
function committeeRaw(it) {
  const t = String(it.pdfText || "");
  const sched = (t.split("【주요일정】")[1] || "").split(/【|◆/)[0]
    .split("\n").map((l) => l.trim()).filter((l) => /^\d{1,2}:\d{2}/.test(l))
    // 위원장·부위원장 두 칸이 한 줄로 붙어 나오므로 시각 기준으로 쪼개고 중복을 없앤다
    .flatMap((l) => l.split(/\s+(?=\d{1,2}:\d{2})/))
    .map((l) => l.replace(/^\d{1,2}:\d{2}\s*/, "").replace(/\s+/g, " ").trim())
    .filter((l, i, a) => l && a.indexOf(l) === i)
    .map((l) => "· " + l);
  const pers = (t.split("【인사발령】")[1] || "");
  const parts = [];
  parts.push("##[주요일정]##\n" + (sched.length ? sched.join("\n") : "· 원문 참조"));
  if (pers.trim()) parts.push("##[인사발령]##\n· 발령 사항 있음 — 원문 참조");
  return parts.join("\n\n");
}

async function committeeSummary(model, it) {
  if (model && it.pdfText) {
    const prompt = `다음은 공정거래위원회 "위원회 소식" 원문이다. 아래 형식 그대로 정리하라. 형식 외의 말은 쓰지 마라.

##[주요일정]##
· **위원장**: 일정(장소)
· **부위원장**: 일정(장소)

##[인사발령]##
· **이름** 직급(현 소속) - 발령 내용 (기간이 있으면 기간)

규칙: 시각(10:00 등)은 빼고 일정 이름과 장소만 쓴다. 원문에 없는 사람·일정은 쓰지 마라.
원문에 인사발령이 없으면 ##[인사발령]## 부분 전체를 빼라.

원문:
${String(it.pdfText).slice(0, 7000)}`;
    const out = await ask(model, prompt);
    if (out && out.includes("##[주요일정]##") && out.length < 4000) return out.trim();
    log("위원회 소식 정리를 모델이 제대로 못 만들어 원문 규칙 추출로 대신함");
  }
  return committeeRaw(it);
}

// ---------- 뉴스 ----------
// "35분 전", "16시간 전"만 오늘 기사로 본다. "2일 전"이나 날짜 표기는 지난 기사.
function isFresh(p) {
  const s = String(p || "");
  if (/(분|시간)\s*전/.test(s)) return !/(\d+)\s*시간/.test(s) || +s.match(/(\d+)\s*시간/)[1] < 24;
  return false;
}

function bigrams(s) {
  const t = String(s).replace(/[^가-힣A-Za-z0-9]/g, "");
  const set = new Set();
  for (let i = 0; i < t.length - 1; i++) set.add(t.slice(i, i + 2));
  return set;
}
function similar(a, b) {
  const A = bigrams(a), B = bigrams(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return inter / Math.min(A.size, B.size);
}

const OUR_GROUP_RE = /(^|[^A-Za-z])SK([^A-Za-z]|$)|SKC|에스케이|11번가|티맵|하이닉스|최태원/;

// 모델 없이 거르므로 공정위 이야기가 직접 나오는 기사만 남긴다
const FTC_RE = /공정위|공정거래|공정委|담합|하도급|가맹|대리점법|표시광고|과징금/;

// 최근 며칠 브리핑에 실린 제목·요약 — 주소만 다른 재탕 기사를 거르는 데 쓴다
function recentTexts(days = 3) {
  const out = [];
  try {
    const files = fs.readdirSync(BRIEF_DIR).filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort().slice(-days);
    for (const f of files) {
      const b = JSON.parse(fs.readFileSync(path.join(BRIEF_DIR, f), "utf8"));
      for (const it of b.items || []) out.push(`${it.headline} ${it.summary}`);
    }
  } catch {}
  return out;
}

function pickNews(items, published, pressTexts) {
  const recent = recentTexts();
  const kept = [];
  for (const it of items) {
    if (published.has(it.source_url)) continue;
    if (!isFresh(it.published_at)) continue;
    const h = it.headline || "";
    if (!FTC_RE.test(`${h} ${it.summary || ""}`)) continue;
    if (/블로그|카페|티스토리/.test(h)) continue;
    if (kept.some((k) => similar(k.headline, h) >= 0.4 || similar(k.summary, it.summary) >= 0.5)) continue;
    // 오늘 보도자료를 옮긴 기사, 최근 브리핑에 이미 실린 사건은 뺀다
    if (pressTexts.some((p) => similar(h, p) >= 0.5)) continue;
    if (recent.some((r) => similar(h, r) >= 0.6)) continue;
    kept.push(it);
  }
  // SK 관련을 앞으로
  const ours = (h) => OUR_GROUP_RE.test(String(h).replace(/SK증권/g, ""));
  kept.sort((a, b) => ours(b.headline) - ours(a.headline));
  return kept.slice(0, MAX_NEWS).map((it) => ({
    category: "news",
    category_label: it.category_label || "뉴스 보도내용",
    headline: it.headline,
    summary: String(it.summary || "").replace(/\s+/g, " ").trim(),
    source_url: it.source_url,
    published_at: it.published_at,
  }));
}

// ---------- 카드 요약 ----------
function committeePeek(summary) {
  const sched = (summary.split("##[주요일정]##")[1] || "").split("##[")[0]
    .split("\n").map((l) => l.replace(/^·\s*/, "").replace(/\*\*/g, "").trim()).filter(Boolean);
  const pers = summary.includes("##[인사발령]##");
  const head = sched[0] && !/원문 참조/.test(sched[0]) ? sched[0] : "";
  if (!head && !pers) return "주요일정·인사발령 내용 없음";
  return [head, pers ? "인사발령 있음" : ""].filter(Boolean).join(" · ");
}

async function main() {
  if (!fs.existsSync(PENDING)) { log("today.json 없음 — 할 일 없음"); return 0; }
  const src = JSON.parse(fs.readFileSync(PENDING, "utf8"));
  const id = src.id;
  const all = src.items || [];
  const published = loadPublishedUrls(BRIEF_DIR);
  published.delete(undefined);

  const model = await pickModel();
  log(model ? `로컬 모델 사용: ${model}` : "로컬 모델 없음 — 원문 규칙 추출만 사용");

  const press = [];
  for (const it of all.filter((i) => i.category === "press")) {
    if (published.has(it.source_url)) continue;
    press.push({
      category: "press", category_label: it.category_label || "공정위 보도자료",
      headline: it.headline, summary: await pressSummary(model, it),
      source_url: it.source_url, published_at: it.published_at,
    });
  }
  const committee = [];
  for (const it of all.filter((i) => i.category === "committee")) {
    committee.push({
      category: "committee", category_label: it.category_label || "위원회 소식",
      headline: it.headline, summary: await committeeSummary(model, it),
      source_url: it.source_url, published_at: it.published_at,
    });
  }
  const news = pickNews(
    all.filter((i) => i.category === "news"), published,
    all.filter((i) => i.category === "press").map((p) => `${p.headline} ${String(p.pdfText || "").slice(0, 3000)}`),
  );

  const items = [...press, ...committee, ...news];
  if (!items.length) { log("실을 항목이 없음 — 브리핑을 만들지 않음"); return 0; }

  const top = [...press, ...news].slice(0, 3).map((i) => i.headline);
  const brief = {
    id, date: src.date || id,
    title: "[간이] " + (top[0] || `${id} 위원회 소식`),
    summary: (top.length ? top : [committee[0].headline]).join("\n"),
    competitors: src.competitors || ["공정거래위원회"],
    keywords: src.keywords || [],
    items,
    generated_at: new Date().toISOString(),
    fallback: model ? `local:${model}` : "rules",
  };

  fs.mkdirSync(BRIEF_DIR, { recursive: true });
  const json = JSON.stringify(brief, null, 2) + "\n";
  fs.writeFileSync(path.join(BRIEF_DIR, `${id}.json`), json);
  fs.writeFileSync(LATEST, json);

  // index.json 카드
  const counts = { press: press.length, committee: committee.length, news: news.length };
  const peek = [
    ...press.map((p) => ({ cat: "press", headline: p.headline })),
    ...committee.slice(0, 1).map((c) => ({ cat: "committee", headline: committeePeek(c.summary) })),
  ];
  for (const n of news) { if (peek.length >= 4) break; peek.push({ cat: "news", headline: n.headline }); }
  let index = [];
  try { index = JSON.parse(fs.readFileSync(INDEX, "utf8")); } catch {}
  index = index.filter((c) => c.id !== id);
  index.push({ id, date: brief.date, title: brief.title, summary: brief.summary, counts, peek });
  index.sort((a, b) => (a.id < b.id ? 1 : -1));
  fs.writeFileSync(INDEX, JSON.stringify(index, null, 2) + "\n");

  // 처리 끝난 원문 정리(정식 다듬기와 같게)
  fs.rmSync(PENDING, { force: true });
  fs.rmSync(path.join("tool", "pending", "today-pdfs"), { recursive: true, force: true });

  log(`간이 브리핑 작성 — ${id}, 보도자료 ${counts.press} · 위원회 ${counts.committee} · 뉴스 ${counts.news}`);
  return 0;
}

main().then((c) => process.exit(c), (e) => { console.error("[간이] 실패:", e); process.exit(1); });

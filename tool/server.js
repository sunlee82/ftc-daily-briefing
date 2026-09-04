// 브리핑 생성 도구 — 로컬 서버 (Node 내장 모듈만 사용, 외부 의존성 없음)
// 공정거래위원회 일일동향을 관심 키워드로 검색해 브리핑을 만든다.
//
//  역할:
//   1) 입력 UI 제공        GET  /
//   2) 브리핑 생성          POST /api/generate   수집→중복제거 (원문 그대로, 요약 없음)
//   3) 초안 저장            POST /api/publish    tool/.drafts/에 JSON 저장
//   4) 아카이브 로컬 미리보기 GET /archive/*     docs/ 정적 서빙
//
//  Claude API는 전혀 쓰지 않는다(비용·키 관리 불필요). 화면에서는 검색 원문
//  그대로 보여주고 취사선택·순서조정만 한다. 제목/요약 다듬기와 위원회 소식 PDF
//  요약, 실제 docs/data 배포(git push)는 tool/.drafts/에 저장된 결과를
//  Claude Code(구독 세션)가 이어받아 수행한다.
"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");

// .env 로더 (의존성 없이 최소 구현) — 서버 시작 시 process.env로 주입
(function loadDotEnv() {
  const envPath = path.join(__dirname, "..", ".env");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    let val = m[2].trim().replace(/^['"]|['"]$/g, "");
    if (process.env[m[1]] === undefined) process.env[m[1]] = val;
  }
})();

const { buildPressItems, buildRawNewsItems, buildRawCommitteeItems, buildRawOverview } = require("./pipeline/summarize");
const { collect, dedupeAndSort } = require("./pipeline/collect");
const { fetchPressReleases, fetchCommitteeNews } = require("./pipeline/collectFtcBoard");
const { loadPublishedUrls } = require("./pipeline/publishedUrls");

const ROOT = path.join(__dirname, "..");
const DOCS = path.join(ROOT, "docs");
const BRIEF_DIR = path.join(DOCS, "data", "briefings");
const DRAFT_DIR = path.join(ROOT, "tool", ".drafts");
const PUBLIC = path.join(__dirname, "public");
const PORT = process.env.PORT || 4173;
const DEFAULT_WINDOW_HOURS = 48;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".pdf": "application/pdf",
};

// ---------- 유틸 ----------
function send(res, status, body, type = "text/plain; charset=utf-8") {
  res.writeHead(status, { "Content-Type": type });
  res.end(body);
}
function sendJSON(res, status, obj) {
  send(res, status, JSON.stringify(obj), "application/json; charset=utf-8");
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => {
      data += c;
      if (data.length > 1e6) reject(new Error("본문이 너무 큽니다"));
    });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}
function todayStr(now = new Date()) {
  // 로컬 기준 YYYY-MM-DD
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
function serveStatic(res, filePath) {
  fs.readFile(filePath, (err, buf) => {
    if (err) return send(res, 404, "Not Found");
    send(res, 200, buf, MIME[path.extname(filePath)] || "application/octet-stream");
  });
}

// ---------- 파이프라인 ----------
// 감시 대상은 공정거래위원회로 고정. 사용자는 관심 키워드만 입력(비우면 전체 동향 검색).
const MONITORED_AGENCY = "공정거래위원회";

// 실패해도 브리핑 생성 전체를 막지 않도록 각 카테고리를 개별적으로 감싼다(부분 성공).
async function safely(label, fn, fallback) {
  try {
    return { ok: true, value: await fn() };
  } catch (err) {
    console.warn(`[generate] ${label} 실패: ${err.message}`);
    return { ok: false, value: fallback, error: err.message };
  }
}

function parseKeywordInput(input) {
  const keywords = (input.keywords || []).map((s) => String(s).trim()).filter(Boolean);
  const excludeKeywords = (input.excludeKeywords || []).map((s) => String(s).trim()).filter(Boolean);
  return {
    keywords,
    excludeKeywords,
    // 검색용: 키워드가 없으면 빈 문자열 하나로 "기관명 단독 검색"을 수행
    searchKeywords: keywords.length ? keywords : [""],
    // 표시/저장용: 빈 검색은 "전체동향"으로 라벨링
    displayKeywords: keywords.length ? keywords : ["전체동향"],
  };
}

// (1) 공정위 보도자료, (2) 위원회 소식, (3) 뉴스 보도내용 — 세 카테고리를 병렬 수집한다.
// Claude를 전혀 호출하지 않으므로 원문 제목/스니펫을 그대로 항목으로 구성한다.
// excludeUrls(이번 세션에서 이미 본 항목)와 이미 배포된 브리핑의 항목은 결과에서 제외한다.
async function collectCategorized({ competitors, searchKeywords, excludeKeywords, opts, excludeUrls }) {
  const excludeSet = new Set(excludeUrls || []);
  for (const u of loadPublishedUrls(BRIEF_DIR)) excludeSet.add(u);

  const [pressResult, committeeRawResult, newsRawResult] = await Promise.all([
    safely("공정위 보도자료 수집", () => fetchPressReleases(opts.windowHours), []),
    safely("위원회 소식 수집", () => fetchCommitteeNews(opts.windowHours), []),
    safely("뉴스 검색(serper)", () => collect(competitors, searchKeywords, { ...opts, excludeKeywords }), []),
  ]);

  const freshPress = pressResult.value.filter((p) => !excludeSet.has(p.source_url));
  const freshCommitteeRaw = committeeRawResult.value.filter((c) => !excludeSet.has(c.source_url));
  const freshNewsRaw = newsRawResult.value.filter((n) => !excludeSet.has(n.url));

  const pressItems = buildPressItems(freshPress);
  const committeeItems = await buildRawCommitteeItems(freshCommitteeRaw);
  const newsRaw = dedupeAndSort(freshNewsRaw);
  const newsItems = buildRawNewsItems(newsRaw);

  return {
    items: [...pressItems, ...committeeItems, ...newsItems],
    meta: {
      categoryCounts: { press: pressItems.length, committee: committeeItems.length, news: newsItems.length },
      collected: newsRawResult.value.length,
      deduped: newsRaw.length,
      errors: [pressResult, committeeRawResult, newsRawResult].filter((r) => !r.ok).map((r) => r.error),
    },
  };
}

async function generate(input) {
  const { searchKeywords, excludeKeywords, displayKeywords } = parseKeywordInput(input);
  const competitors = [MONITORED_AGENCY];
  const opts = {
    windowHours: Number(input.windowHours) || DEFAULT_WINDOW_HOURS,
    maxPerPair: Number(input.maxPerPair) || 10,
  };
  const date = todayStr();

  const { items, meta } = await collectCategorized({ competitors, searchKeywords, excludeKeywords, opts });
  const { title, summary } = buildRawOverview(items, competitors.join("·"));

  return {
    id: date,
    date,
    title,
    summary,
    competitors,
    keywords: displayKeywords,
    items,
    generated_at: new Date().toISOString(),
    _meta: {
      sources: ["ftc.go.kr(보도자료)", "ftc.go.kr(위원회 소식)", "serper.dev/news"],
      ...meta,
    },
  };
}

// 추가 검색: 이미 브리핑에 담긴 항목(excludeUrls)과 겹치지 않는 새 항목만 찾아 반환한다.
// 전체 브리핑을 새로 만들지 않고 항목만 반환 — 제목/요약은 사용자가 편집 중인 기존 값을 그대로 유지한다.
async function generateMore(input) {
  const { searchKeywords, excludeKeywords } = parseKeywordInput(input);
  const competitors = [MONITORED_AGENCY];
  const opts = {
    windowHours: Number(input.windowHours) || DEFAULT_WINDOW_HOURS,
    maxPerPair: Number(input.maxPerPair) || 10,
  };
  const excludeUrls = (input.excludeUrls || []).filter(Boolean);

  const { items, meta } = await collectCategorized({ competitors, searchKeywords, excludeKeywords, opts, excludeUrls });

  return { items, _meta: meta };
}

// [저장]을 누르면 사용자가 화면에서 취사선택·순서조정을 마친 결과를 tool/.drafts/에
// 그대로 저장한다(docs/data 기록·git push는 하지 않음). pdfPath 등 로컬 전용 필드도
// 함께 남겨서, Claude Code가 이어받아 제목/요약을 다듬고 위원회 소식 PDF를 요약한 뒤
// 최종 배포(docs/data 기록 + git push)까지 수행하도록 한다.
function saveDraft(brief) {
  if (!brief.id || !/^\d{4}-\d{2}-\d{2}$/.test(brief.id)) {
    throw new Error("브리핑 id(날짜)가 올바르지 않습니다.");
  }
  fs.mkdirSync(DRAFT_DIR, { recursive: true });
  const draftPath = path.join(DRAFT_DIR, `${brief.id}.json`);
  fs.writeFileSync(draftPath, JSON.stringify(brief, null, 2) + "\n");
  return {
    ok: true,
    draft: true,
    path: path.relative(ROOT, draftPath),
    note: "초안으로 저장했습니다. Claude Code에게 '이 초안 다듬어서 배포해줘'라고 요청하세요.",
  };
}

// ---------- 라우팅 ----------
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    const pathname = decodeURIComponent(url.pathname);

    // API
    if (req.method === "POST" && pathname === "/api/generate") {
      const brief = await generate(JSON.parse((await readBody(req)) || "{}"));
      return sendJSON(res, 200, brief);
    }
    if (req.method === "POST" && pathname === "/api/generate-more") {
      const result = await generateMore(JSON.parse((await readBody(req)) || "{}"));
      return sendJSON(res, 200, result);
    }
    if (req.method === "POST" && pathname === "/api/regenerate-overview") {
      const body = JSON.parse((await readBody(req)) || "{}");
      const overview = buildRawOverview(body.items || [], MONITORED_AGENCY);
      return sendJSON(res, 200, overview);
    }
    if (req.method === "POST" && pathname === "/api/publish") {
      const body = JSON.parse((await readBody(req)) || "{}");
      const result = saveDraft(body.brief || body);
      return sendJSON(res, 200, result);
    }

    // 아카이브 로컬 미리보기: /archive/* -> docs/*
    if (pathname === "/archive" || pathname === "/archive/") {
      return serveStatic(res, path.join(DOCS, "index.html"));
    }
    if (pathname.startsWith("/archive/")) {
      const rel = pathname.slice("/archive/".length);
      const target = path.normalize(path.join(DOCS, rel));
      if (!target.startsWith(DOCS)) return send(res, 403, "Forbidden");
      return serveStatic(res, target);
    }

    // 도구 UI 정적 파일
    if (req.method === "GET") {
      const rel = pathname === "/" ? "index.html" : pathname.slice(1);
      const target = path.normalize(path.join(PUBLIC, rel));
      if (!target.startsWith(PUBLIC)) return send(res, 403, "Forbidden");
      if (fs.existsSync(target) && fs.statSync(target).isFile()) {
        return serveStatic(res, target);
      }
    }

    send(res, 404, "Not Found");
  } catch (err) {
    sendJSON(res, 400, { error: err.message });
  }
});

server.listen(PORT, () => {
  console.log(`\n  브리핑 생성 도구 실행 중`);
  console.log(`   ▶ 도구:     http://localhost:${PORT}/`);
  console.log(`   ▶ 아카이브: http://localhost:${PORT}/archive/\n`);
});

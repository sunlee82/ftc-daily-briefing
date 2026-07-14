// 브리핑 생성 도구 — 로컬 서버 (Node 내장 모듈만 사용, 외부 의존성 없음)
// 공정거래위원회 일일동향을 관심 키워드로 검색해 브리핑을 만든다.
//
//  역할:
//   1) 입력 UI 제공        GET  /
//   2) 브리핑 생성          POST /api/generate   수집→중복제거→요약
//   3) 배포                POST /api/publish    docs/data에 JSON 기록 + index 갱신
//   4) 아카이브 로컬 미리보기 GET /archive/*     docs/ 정적 서빙
//
//  외부 연동(serper.dev 검색, Claude 요약)은 tool/pipeline/*.js 안에만 격리되어 있고,
//  git push는 6단계 seam(publishToGit)으로 남겨둔 상태(현재 로컬 저장만).
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

const { collect, dedupeAndSort } = require("./pipeline/collect");
const { summarize } = require("./pipeline/summarize");

const ROOT = path.join(__dirname, "..");
const DOCS = path.join(ROOT, "docs");
const DATA = path.join(DOCS, "data");
const BRIEF_DIR = path.join(DATA, "briefings");
const INDEX_FILE = path.join(DATA, "index.json");
const PUBLIC = path.join(__dirname, "public");
const PORT = process.env.PORT || 4173;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
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

async function generate(input) {
  const keywords = (input.keywords || []).map((s) => String(s).trim()).filter(Boolean);
  const competitors = [MONITORED_AGENCY];
  const opts = {
    windowHours: Number(input.windowHours) || 24,
    maxPerPair: Number(input.maxPerPair) || 10,
  };
  const date = todayStr();

  // 검색용: 키워드가 없으면 빈 문자열 하나로 "기관명 단독 검색"을 수행
  const searchKeywords = keywords.length ? keywords : [""];
  // 표시/저장용: 빈 검색은 "전체동향"으로 라벨링
  const displayKeywords = keywords.length ? keywords : ["전체동향"];

  const rawAll = await collect(competitors, searchKeywords, opts);
  const raw = dedupeAndSort(rawAll);                          // 중복 제거 + 최신순
  const { title, summary, items } = await summarize(raw, { competitors, keywords: displayKeywords, date });

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
      sources: ["serper.dev/news"],
      summarizer: process.env.CLAUDE_MODEL || "claude-opus-4-8",
      collected: rawAll.length,
      deduped: raw.length,
    },
  };
}

// 배포 스냅샷에서 로컬 전용 필드(_meta 등) 제거
function toSnapshot(brief) {
  const { _meta, ...clean } = brief;
  return clean;
}

// 6단계 seam: 실제 배포에서는 여기서 git add/commit/push. 현재는 로컬 저장만.
async function publishToGit() {
  return { pushed: false, note: "git push는 아직 연결 전(로컬 저장만 수행)" };
}

async function publish(brief) {
  const snapshot = toSnapshot(brief);
  if (!snapshot.id || !/^\d{4}-\d{2}-\d{2}$/.test(snapshot.id)) {
    throw new Error("브리핑 id(날짜)가 올바르지 않습니다.");
  }
  fs.mkdirSync(BRIEF_DIR, { recursive: true });

  // 1) 상세 스냅샷 저장 (같은 날짜면 덮어쓰기)
  fs.writeFileSync(
    path.join(BRIEF_DIR, `${snapshot.id}.json`),
    JSON.stringify(snapshot, null, 2) + "\n"
  );

  // 2) 카드용 index.json 업서트
  let index = [];
  try {
    index = JSON.parse(fs.readFileSync(INDEX_FILE, "utf8"));
    if (!Array.isArray(index)) index = [];
  } catch { index = []; }
  const card = { id: snapshot.id, date: snapshot.date, title: snapshot.title, summary: snapshot.summary };
  index = index.filter((c) => c.id !== card.id);
  index.push(card);
  index.sort((a, b) => (a.date < b.date ? 1 : -1));
  fs.writeFileSync(INDEX_FILE, JSON.stringify(index, null, 2) + "\n");

  const git = await publishToGit();
  return { ok: true, id: snapshot.id, count: index.length, archiveUrl: `/archive/briefing.html?date=${snapshot.id}`, git };
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
    if (req.method === "POST" && pathname === "/api/publish") {
      const body = JSON.parse((await readBody(req)) || "{}");
      const result = await publish(body.brief || body);
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

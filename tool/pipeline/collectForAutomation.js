// ┌─────────────────────────────────────────────────────────────────────┐
// │  완전 자동 파이프라인의 "수집" 담당. GitHub Actions가 평일 아침마다    │
// │  이 스크립트를 실행한다. Claude API는 쓰지 않는다(키 불필요) —         │
// │  ftc.go.kr 게시판 스크래핑(collectFtcBoard.js)과 serper.dev 뉴스검색   │
// │  (collect.js)만 사용한다.                                              │
// │                                                                        │
// │  결과는 tool/pending/<날짜>.json (+ 위원회 소식 PDF)로 "저장소에       │
// │  커밋되는" 위치에 남긴다. tool/.drafts·tool/.raw-pdfs와 달리 이 폴더는 │
// │  .gitignore에서 제외되어 있어, 이후 Claude Cowork가 GitHub 커넥터로    │
// │  저장소에서 직접 읽어 다듬고 배포할 수 있다.                           │
// │                                                                        │
// │  이미 배포된 브리핑(docs/data/briefings/*.json, 최근 14일)과 겹치는    │
// │  항목은 자동으로 제외한다(publishedUrls.js).                           │
// └─────────────────────────────────────────────────────────────────────┘
"use strict";

const path = require("path");
const fs = require("fs");

// .env 로더 — GitHub Actions에서는 보통 secrets를 env로 주입하지만,
// 로컬에서 이 스크립트를 직접 테스트할 때도 .env를 읽도록 남겨둔다.
(function loadDotEnv() {
  const envPath = path.join(__dirname, "..", "..", ".env");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    let val = m[2].trim().replace(/^['"]|['"]$/g, "");
    if (process.env[m[1]] === undefined) process.env[m[1]] = val;
  }
})();

const { fetchPressReleases, fetchCommitteeNews } = require("./collectFtcBoard");
const { collect, dedupeAndSort } = require("./collect");
const { buildPressItems, buildRawNewsItems, buildRawCommitteeItems, buildRawOverview } = require("./summarize");
const { loadPublishedUrls } = require("./publishedUrls");

const MONITORED_AGENCY = "공정거래위원회";
// 웹 도구 기본 필수 키워드와 동일 (tool/public/app.js의 DEFAULT_MANDATORY_KEYWORDS)
const MANDATORY_KEYWORDS = ["공정위", "과징금", "현장조사", "담합"];
// 평일마다 돌지만 주말을 건너뛰므로(금→월) 최대 3일 공백이 생길 수 있어 넉넉히 잡는다
const WINDOW_HOURS = 96;
const MAX_PER_PAIR = 10;

const ROOT = path.join(__dirname, "..", "..");
const BRIEF_DIR = path.join(ROOT, "docs", "data", "briefings");
const PENDING_DIR = path.join(ROOT, "tool", "pending");

// KST(UTC+9) 기준 YYYY-MM-DD — GitHub Actions 러너는 UTC로 돌기 때문에 명시적으로 변환한다
function todayKST() {
  const kst = new Date(Date.now() + 9 * 3600 * 1000);
  const y = kst.getUTCFullYear();
  const m = String(kst.getUTCMonth() + 1).padStart(2, "0");
  const d = String(kst.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

async function main() {
  const date = todayKST();
  const excludeSet = loadPublishedUrls(BRIEF_DIR);

  const [pressRaw, committeeRaw, newsRawAll] = await Promise.all([
    fetchPressReleases(WINDOW_HOURS).catch((e) => ({ error: e.message, items: [] })),
    fetchCommitteeNews(WINDOW_HOURS).catch((e) => ({ error: e.message, items: [] })),
    collect([MONITORED_AGENCY], MANDATORY_KEYWORDS, { windowHours: WINDOW_HOURS, maxPerPair: MAX_PER_PAIR }).catch(
      (e) => ({ error: e.message, items: [] })
    ),
  ]);

  const press = (Array.isArray(pressRaw) ? pressRaw : pressRaw.items || []).filter(
    (p) => !excludeSet.has(p.source_url)
  );
  const committee = (Array.isArray(committeeRaw) ? committeeRaw : committeeRaw.items || []).filter(
    (c) => !excludeSet.has(c.source_url)
  );
  const newsRawList = Array.isArray(newsRawAll) ? newsRawAll : newsRawAll.items || [];
  const newsRaw = dedupeAndSort(newsRawList.filter((n) => !excludeSet.has(n.url)));

  fs.mkdirSync(PENDING_DIR, { recursive: true });
  const pdfDir = path.join(PENDING_DIR, `${date}-pdfs`);

  const pressItems = buildPressItems(press);
  const committeeItems = buildRawCommitteeItems(committee, pdfDir);
  const newsItems = buildRawNewsItems(newsRaw);
  const items = [...pressItems, ...committeeItems, ...newsItems];

  // pdfPath를 저장소 루트 기준 상대경로로 바꿔서, Cowork가 GitHub 커넥터로 그대로 열 수 있게 한다
  for (const it of items) {
    if (it.pdfPath) it.pdfPath = path.relative(ROOT, it.pdfPath);
  }

  const { title, summary } = buildRawOverview(items, MONITORED_AGENCY);

  const output = {
    id: date,
    date,
    title,
    summary,
    competitors: [MONITORED_AGENCY],
    keywords: MANDATORY_KEYWORDS,
    items,
    generated_at: new Date().toISOString(),
    _meta: {
      sources: ["ftc.go.kr(보도자료)", "ftc.go.kr(위원회 소식)", "serper.dev/news"],
      categoryCounts: { press: pressItems.length, committee: committeeItems.length, news: newsItems.length },
      collected: newsRawList.length,
      deduped: newsRaw.length,
      errors: [pressRaw.error, committeeRaw.error, newsRawAll.error].filter(Boolean),
    },
  };

  const outPath = path.join(PENDING_DIR, `${date}.json`);
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2) + "\n");
  console.log(`수집 완료: ${outPath} (press ${pressItems.length}, committee ${committeeItems.length}, news ${newsItems.length})`);
}

main().catch((err) => {
  console.error("ERROR:", err.message);
  process.exit(1);
});

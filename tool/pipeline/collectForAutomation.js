// ┌─────────────────────────────────────────────────────────────────────┐
// │  완전 자동 파이프라인의 "수집" 담당. GitHub Actions가 평일 아침마다    │
// │  이 스크립트를 실행한다. Claude API는 쓰지 않는다(키 불필요) —         │
// │  ftc.go.kr 게시판 스크래핑(collectFtcBoard.js)과 serper.dev 뉴스검색   │
// │  (collect.js)만 사용한다.                                              │
// │                                                                        │
// │  실행 시점 기준 최근 24시간 게시물만 수집한다. 이미 배포된 브리핑과    │
// │  겹치는지는 여기서 따지지 않는다(그 판단은 이후 Cowork가 내용 기준으로 │
// │  더 정확하게 함) — 매일 "오늘 원문"만 그대로 담는 게 목적이다.         │
// │                                                                        │
// │  결과는 tool/pending/today.json (+ 위원회 소식 PDF는                  │
// │  tool/pending/today-pdfs/)에 "저장소에 커밋되는" 고정된 파일명으로     │
// │  남긴다 — 다른 AI 툴이 매일 같은 주소(raw.githubusercontent.com/.../  │
// │  tool/pending/today.json)로 접근할 수 있도록. 매 실행마다 통째로      │
// │  덮어쓴다. tool/.drafts·tool/.raw-pdfs와 달리 이 폴더는 .gitignore에서 │
// │  제외되어 있어 실제로 git에 커밋된다.                                  │
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

const MONITORED_AGENCY = "공정거래위원회";
// 웹 도구 기본 필수 키워드와 동일 (tool/public/app.js의 DEFAULT_MANDATORY_KEYWORDS)
const MANDATORY_KEYWORDS = ["공정위", "과징금", "현장조사", "담합"];
// 보도자료·뉴스는 실행 시점 기준 "오늘"만 (collectFtcBoard.js의 recentDateSet은
// 시각이 아니라 날짜 단위로 비교 — windowHours=24 → 오늘 날짜만 포함)
const WINDOW_HOURS_PRESS_NEWS = 24;
// 위원회 소식은 게시판 등록일이 실제 내용 날짜보다 하루 늦게 찍히는 경향이 있어
// (예: "9월 4일자 위원회소식"이 게시판엔 "9월 3일" 게시물로 올라옴) 오늘 아침 실행
// 시점 기준 어제까지 포함해야 놓치지 않는다.
const WINDOW_HOURS_COMMITTEE = 48;
const MAX_PER_PAIR = 10;

const ROOT = path.join(__dirname, "..", "..");
const PENDING_DIR = path.join(ROOT, "tool", "pending");
const PDF_DIR = path.join(PENDING_DIR, "today-pdfs");
const OUT_PATH = path.join(PENDING_DIR, "today.json");

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

  const [pressRaw, committeeRaw, newsRawAll] = await Promise.all([
    fetchPressReleases(WINDOW_HOURS_PRESS_NEWS).catch((e) => ({ error: e.message, items: [] })),
    fetchCommitteeNews(WINDOW_HOURS_COMMITTEE).catch((e) => ({ error: e.message, items: [] })),
    collect([MONITORED_AGENCY], MANDATORY_KEYWORDS, {
      windowHours: WINDOW_HOURS_PRESS_NEWS,
      maxPerPair: MAX_PER_PAIR,
    }).catch((e) => ({ error: e.message, items: [] })),
  ]);

  const press = Array.isArray(pressRaw) ? pressRaw : pressRaw.items || [];
  const committee = Array.isArray(committeeRaw) ? committeeRaw : committeeRaw.items || [];
  const newsRawList = Array.isArray(newsRawAll) ? newsRawAll : newsRawAll.items || [];
  const newsRaw = dedupeAndSort(newsRawList);

  // 매번 통째로 새로 씀 — 전날 위원회 소식 PDF가 남아있지 않도록 먼저 비운다
  fs.rmSync(PDF_DIR, { recursive: true, force: true });
  fs.mkdirSync(PENDING_DIR, { recursive: true });

  const pressItems = buildPressItems(press);
  const committeeItems = buildRawCommitteeItems(committee, PDF_DIR);
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
      windowHours: { pressNews: WINDOW_HOURS_PRESS_NEWS, committee: WINDOW_HOURS_COMMITTEE },
      categoryCounts: { press: pressItems.length, committee: committeeItems.length, news: newsItems.length },
      collected: newsRawList.length,
      deduped: newsRaw.length,
      errors: [pressRaw.error, committeeRaw.error, newsRawAll.error].filter(Boolean),
    },
  };

  fs.writeFileSync(OUT_PATH, JSON.stringify(output, null, 2) + "\n");
  console.log(`수집 완료: ${OUT_PATH} (press ${pressItems.length}, committee ${committeeItems.length}, news ${newsItems.length})`);
}

main().catch((err) => {
  console.error("ERROR:", err.message);
  process.exit(1);
});

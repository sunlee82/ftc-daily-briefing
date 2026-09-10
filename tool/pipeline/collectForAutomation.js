// ┌─────────────────────────────────────────────────────────────────────┐
// │  완전 자동 파이프라인의 "수집" 담당. GitHub Actions가 평일 아침마다    │
// │  이 스크립트를 실행한다. Claude API는 쓰지 않는다(키 불필요) —         │
// │  ftc.go.kr 게시판 스크래핑(collectFtcBoard.js)과 serper.dev 뉴스검색   │
// │  (collect.js)만 사용한다.                                              │
// │                                                                        │
// │  ftc.go.kr 게시판(보도자료·위원회 소식)은 등록일 기준 최근 48시간,     │
// │  뉴스 검색은 24시간 내 게시물만 수집한다. 이미 배포된 브리핑과         │
// │  겹치는지는 여기서 따지지 않는다(그 판단은 이후 Cowork가 내용 기준으로 │
// │  더 정확하게 함) — 매일 "최신 원문"을 그대로 담는 게 목적이다.         │
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

// ── 관심 회사군 ────────────────────────────────────────────────────────
// 이 브리핑은 SK텔레콤과 그 관계사에서 사내 회람용으로 본다. 임원도 보기 때문에
// 그룹 차원의 공정위 이슈까지 알아야 한다. 그래서 기관 축(공정거래위원회 × 키워드)만으로는
// 놓치는 자사·그룹 기사를 회사 축으로 따로 훑는다.
//
// 회사명 단독으로 검색하면 실적·요금제·인사 기사가 쏟아지므로, 반드시 "공정거래위원회"와
// 묶어서 검색한다. 좁은 쿼리라 관련 기사가 없는 날은 0건으로 끝나 수집량이 불지 않는다.
const TELECOM_AFFILIATES = [
  "SK텔레콤",
  "SK브로드밴드",
  "SK오앤에스",
  "SK텔링크",
  "SK스토아",
  "SK쉴더스",
];
const SK_GROUP = [
  "SK그룹",
  "SK하이닉스",
  "SK이노베이션",
  "SK네트웍스",
  "SK에코플랜트",
  "SK스퀘어",
  "SK케미칼",
  "SK바이오팜",
];
const AFFILIATE_COMPANIES = [...TELECOM_AFFILIATES, ...SK_GROUP];
// 회사 축은 이 한 단어로만 묶는다 — 넓히면 무관한 기사가 딸려 온다.
const AFFILIATE_KEYWORDS = [MONITORED_AGENCY];
const MAX_PER_AFFILIATE = 5;
// ftc.go.kr 게시판(보도자료·위원회 소식)은 collectFtcBoard.js의 recentDateSet이
// 시각이 아니라 "등록일" 날짜 단위로 비교한다. 아침 9시에 실행하면 어제 오후·저녁에
// 등록된 게시물도 실제로는 24시간 이내인데 날짜가 하루 다르다는 이유로 빠질 수 있어
// (실제로 보도자료·위원회 소식 둘 다 이 문제가 확인됨) 오늘+어제(48시간)로 넉넉히 본다.
const WINDOW_HOURS_PRESS = 48;
// 위원회 소식은 게시글 제목에 "대상일"이 박혀 있다(예: "2026-09-07 위원회 소식").
// 금요일 저녁에 올라오는 글은 주말을 건너뛰어 다음 주 월요일을 가리키므로, 등록일
// 기준 48시간으로 담으면 토요일 브리핑에 실리고 정작 월요일엔 창을 벗어나 빠진다.
// 그래서 후보는 7일치로 넓게 훑고, 실제 채택은 아래 "대상일 == 오늘" 필터가 정한다.
// 창을 넓혀도 필터가 하나만 남기므로 엉뚱한 날에 실리거나 PDF가 불어나지 않는다.
// (연휴가 길어 다음 영업일이 며칠 뒤여도 7일이면 충분히 닿는다)
const WINDOW_HOURS_COMMITTEE = 168;
// 뉴스 검색(serper.dev)은 날짜 문자열 비교가 아니라 검색 API 자체의 최신순 결과라
// 이 문제가 없어 그대로 24시간 유지.
const WINDOW_HOURS_NEWS = 24;
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

  // 게시판 조회 실패를 여기에 모아 _meta.errors로 남긴다. 조용히 0건으로 넘어가면
  // "수집 실패"와 "그날 자료 없음"이 구분되지 않는다(2026-09-08에 실제로 발생).
  const boardErrors = [];
  // 게시판을 실제로 읽었는지 기록해 둔다. 맥미니의 collect.sh가 이 값을 보고
  // "반쪽 수집"이면 배포를 부르지 않고 다시 시도한다.
  const boardStats = {};

  const [pressRaw, committeeRaw, newsRawAll, affiliateRawAll] = await Promise.all([
    fetchPressReleases(WINDOW_HOURS_PRESS, boardErrors, boardStats).catch((e) => ({ error: e.message, items: [] })),
    fetchCommitteeNews(WINDOW_HOURS_COMMITTEE, boardErrors, boardStats).catch((e) => ({ error: e.message, items: [] })),
    collect([MONITORED_AGENCY], MANDATORY_KEYWORDS, {
      windowHours: WINDOW_HOURS_NEWS,
      maxPerPair: MAX_PER_PAIR,
    }).catch((e) => ({ error: e.message, items: [] })),
    // 회사 축 — 실패해도 기관 축 결과로 브리핑은 나온다
    collect(AFFILIATE_COMPANIES, AFFILIATE_KEYWORDS, {
      windowHours: WINDOW_HOURS_NEWS,
      maxPerPair: MAX_PER_AFFILIATE,
    }).catch((e) => ({ error: `관심 회사군 검색 실패: ${e.message}`, items: [] })),
  ]);

  const press = Array.isArray(pressRaw) ? pressRaw : pressRaw.items || [];
  const committeeAll = Array.isArray(committeeRaw) ? committeeRaw : committeeRaw.items || [];
  // 대상일이 오늘인 위원회 소식만 채택한다(제목이 "YYYY-MM-DD 위원회 소식" 형식).
  // 이 필터를 통과한 것만 PDF를 저장·텍스트 추출하므로 today.json도 가벼워진다.
  const committee = committeeAll.filter((r) => String(r.headline || "").startsWith(date));
  const newsRawList = Array.isArray(newsRawAll) ? newsRawAll : newsRawAll.items || [];
  const affiliateList = Array.isArray(affiliateRawAll) ? affiliateRawAll : affiliateRawAll.items || [];
  // 두 축을 합친 뒤 한 번에 중복 제거한다. 같은 기사가 양쪽에서 잡히면 하나만 남는다.
  // 항목의 competitor 필드에 회사명이 남아, 배포 단계가 관심 회사군 기사를 알아볼 수 있다.
  const newsRaw = dedupeAndSort([...newsRawList, ...affiliateList]);

  // 매번 통째로 새로 씀 — 전날 위원회 소식 PDF가 남아있지 않도록 먼저 비운다
  fs.rmSync(PDF_DIR, { recursive: true, force: true });
  fs.mkdirSync(PENDING_DIR, { recursive: true });

  const pressItems = await buildPressItems(press, PDF_DIR);
  const committeeItems = await buildRawCommitteeItems(committee, PDF_DIR);
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
      windowHours: { press: WINDOW_HOURS_PRESS, committee: WINDOW_HOURS_COMMITTEE, news: WINDOW_HOURS_NEWS },
      committeeCandidates: committeeAll.length,
      boards: boardStats,
      affiliateCompanies: AFFILIATE_COMPANIES.length,
      affiliateCollected: affiliateList.length,
      categoryCounts: { press: pressItems.length, committee: committeeItems.length, news: newsItems.length },
      collected: newsRawList.length + affiliateList.length,
      deduped: newsRaw.length,
      errors: [pressRaw.error, committeeRaw.error, newsRawAll.error, affiliateRawAll.error, ...boardErrors].filter(Boolean),
    },
  };

  fs.writeFileSync(OUT_PATH, JSON.stringify(output, null, 2) + "\n");
  console.log(`수집 완료: ${OUT_PATH} (press ${pressItems.length}, committee ${committeeItems.length}/${committeeAll.length} 대상일 일치, news ${newsItems.length} — 기관 축 ${newsRawList.length} + 회사 축 ${affiliateList.length} 중복 제거)`);

  // 실패가 있었으면 Actions 로그 맨 끝에서 눈에 띄게 알린다.
  // 종료 코드는 0으로 둔다 — 여기서 실패시키면 다듬기·배포가 통째로 건너뛰어
  // 그날 브리핑이 아예 안 나온다. 일부라도 수집됐으면 배포하는 편이 낫다.
  if (output._meta.errors.length) {
    console.error("::warning::수집 중 오류가 있었습니다. 이 날의 일부 자료가 누락됐을 수 있습니다.");
    for (const e of output._meta.errors) console.error(`  - ${e}`);
  }
}

main().catch((err) => {
  console.error("ERROR:", err.message);
  process.exit(1);
});

// ┌─────────────────────────────────────────────────────────────────────┐
// │  API 키 없이 쓰는 수집 전용 스크립트.                                  │
// │  공정위 보도자료·위원회 소식(ftc.go.kr, 키 불필요)과 뉴스(serper.dev,  │
// │  SERPER_API_KEY만 필요)를 모아 "원문 그대로" 반환한다.                 │
// │  Claude API(CLAUDE_API_KEY)는 전혀 쓰지 않는다 — 요약은 Claude Code    │
// │  세션(구독)이 이 결과를 읽고 직접 수행한다.                            │
// │                                                                        │
// │  위원회 소식 PDF는 base64로 담지 않고 파일로 저장한 뒤 경로만 반환한다 │
// │  — Claude Code의 Read 도구로 바로 열어보기 위함.                       │
// │                                                                        │
// │  CLI 사용:                                                             │
// │    node tool/pipeline/collectRaw.js --keywords "공정위,과징금" \       │
// │      --excludeKeywords "" --windowHours 24 --maxPerPair 10             │
// │    (결과 JSON을 stdout에 출력)                                         │
// └─────────────────────────────────────────────────────────────────────┘
"use strict";

const path = require("path");
const fs = require("fs");

// .env 로더 — 서버 없이 단독 CLI로 실행할 때도 SERPER_API_KEY를 읽도록
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

const MONITORED_AGENCY = "공정거래위원회";
const PDF_DIR = path.join(__dirname, "..", ".raw-pdfs"); // .gitignore에 이미 걸리는 tool/ 하위 임시 폴더

async function collectRaw({ keywords = [], excludeKeywords = [], windowHours = 24, maxPerPair = 10 } = {}) {
  const searchKeywords = keywords.length ? keywords : [""];
  const opts = { windowHours, maxPerPair, excludeKeywords };

  const [press, committeeRaw, newsRawAll] = await Promise.all([
    fetchPressReleases(windowHours).catch((e) => ({ error: e.message, items: [] })),
    fetchCommitteeNews(windowHours).catch((e) => ({ error: e.message, items: [] })),
    collect([MONITORED_AGENCY], searchKeywords, opts).catch((e) => ({ error: e.message, items: [] })),
  ]);

  const pressItems = Array.isArray(press) ? press : press.items;
  const committeeItems = Array.isArray(committeeRaw) ? committeeRaw : committeeRaw.items;
  const newsRawList = Array.isArray(newsRawAll) ? newsRawAll : newsRawAll.items;
  const newsRaw = dedupeAndSort(newsRawList || []);

  // 위원회 소식 PDF를 파일로 저장하고 base64는 결과에서 제외(용량 절약 + Read 도구로 바로 열기 위함)
  fs.mkdirSync(PDF_DIR, { recursive: true });
  const committee = (committeeItems || []).map((c) => {
    const { pdfBase64, ...rest } = c;
    let pdfPath = null;
    if (pdfBase64) {
      const safeName = c.headline.replace(/[^\w가-힣.-]/g, "_").slice(0, 60);
      pdfPath = path.join(PDF_DIR, `${c.published_at}_${safeName}.pdf`);
      fs.writeFileSync(pdfPath, Buffer.from(pdfBase64, "base64"));
    }
    return { ...rest, pdfPath };
  });

  return {
    date: new Date().toISOString().slice(0, 10),
    press: pressItems || [],
    committee,
    newsRaw,
    _errors: [press.error, committeeRaw.error, newsRawAll.error].filter(Boolean),
  };
}

// CLI로 직접 실행하면 인자를 파싱해 결과 JSON을 stdout에 출력
if (require.main === module) {
  const args = process.argv.slice(2);
  const getArg = (name, def) => {
    const i = args.indexOf(`--${name}`);
    return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : def;
  };
  const splitList = (v) => (v ? v.split(",").map((s) => s.trim()).filter(Boolean) : []);

  collectRaw({
    keywords: splitList(getArg("keywords", "")),
    excludeKeywords: splitList(getArg("excludeKeywords", "")),
    windowHours: Number(getArg("windowHours", 24)),
    maxPerPair: Number(getArg("maxPerPair", 10)),
  })
    .then((result) => console.log(JSON.stringify(result, null, 2)))
    .catch((err) => {
      console.error("ERROR:", err.message);
      process.exit(1);
    });
}

module.exports = { collectRaw };

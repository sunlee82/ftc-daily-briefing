// 제도 변화(schedule) 보조 필드 — 적용 대상(scope)·SK 해당 여부(sk)·의견제출 마감(deadline)·
// 시행일(effective)을 채운다. (순수 Node, 의존성 없음)
//
//   node tool/pipeline/scheduleMeta.js           비어 있는 필드만 채움
//   node tool/pipeline/scheduleMeta.js --force   전부 다시 계산
//
// 정식 다듬기(claude -p)는 지시문에 따라 새 항목에 직접 적는다. 이 파일은 그 전에
// 쌓인 항목을 소급하고, Claude가 빠뜨린 항목을 메우는 보조 수단이다.
// 대시보드(dashboard.js)는 이 필드로 "의견수렴 중 / 시행 예정·추진 중 / 시행됨"을 나누고
// "SK 해당만 보기"를 거른다.
"use strict";

const fs = require("fs");
const path = require("path");

// 적용 대상. 화면 라벨은 dashboard.js의 SCOPE_LABEL과 맞춘다.
const SCOPES = [
  { key: "group",     re: /기업집단|대기업집단|공시대상|총수|동일인|지주회사|지주사|사익편취|내부거래|상표권|지정자료|공시의무|중복상장|증손회사|계열/ },
  { key: "subcon",    re: /하도급|수급사업자|원사업자|연동제|기술탈취|기술유용|지급보증/ },
  { key: "franchise", re: /가맹|점주|프랜차이즈/ },
  { key: "retail",    re: /대규모유통|유통업체|납품업체|입점업체|대금\s*지급기한|정산/ },
  { key: "platform",  re: /플랫폼|배달앱|앱마켓|온라인|전자상거래|다크패턴|사용후기|리뷰|해외\s*플랫폼/ },
  { key: "consumer",  re: /소비자|표시광고|표시·광고|거짓.*광고|과장광고|약관|할부거래|상조|선수금|환급|렌탈|분양/ },
  { key: "cartel",    re: /담합|카르텔|리니언시|자진신고|입찰참가자격|가격재결정|가격명령/ },
  { key: "ftc",       re: /조직개편|기획단|경제분석국|사건절차|신고인|심의절차|이관|포상금|재검토|공정위책임|분쟁조정|해결센터|조사·처분권|지방\s*이양|현장조사\s*거부|고발/ },
  { key: "sector",    re: /정유|석유|반도체|제약|약사법|방산|방위산업|건설|축산|자조금|에너지|식품|먹거리|통신/ },
];

// SK그룹에 걸리는지 — 적용 대상이 그룹·하도급·유통·플랫폼·소비자·담합이면 해당.
// 업종 한정이면 SK 주력 업종(정유·반도체·에너지·통신·건설)일 때만 해당.
const SK_SCOPES = new Set(["group", "subcon", "retail", "platform", "consumer", "cartel"]);
const SK_SECTOR_RE = /정유|석유|반도체|에너지|통신|건설/;
// 공정위 내부 살림(조직·인력·센터 운영)은 기업에 직접 적용되는 제도가 아니다
const FTC_INTERNAL_RE = /조직개편|기획단|경제분석국|신설|이관|해결센터|포상금|전담조직|증원/;

function scopeOf(s) {
  const title = String(s.title || "");
  const text = `${title} ${s.detail || ""}`;
  // 제목이 공정위 조직·절차 얘기면 그걸로 본다(본문에 담합·플랫폼이 나와도 예시일 뿐)
  const ftcRe = SCOPES.find((x) => x.key === "ftc").re;
  if (ftcRe.test(title) || FTC_INTERNAL_RE.test(title)) return ["ftc"];
  const keys = SCOPES.filter((x) => x.re.test(text)).map((x) => x.key);
  const strong = keys.filter((k) => k !== "ftc");
  const out = strong.length ? strong : keys;
  return out.length ? out.slice(0, 3) : ["all"];
}

function skOf(s, scope) {
  const text = `${s.title} ${s.detail}`;
  // 업종 한정 제도(제약·축산 등)는 그 업종이 SK 쪽이 아니면 제외 — 제목으로 판단
  const sectorTitle = SCOPES.find((x) => x.key === "sector").re.test(String(s.title || ""));
  if (sectorTitle && !SK_SECTOR_RE.test(String(s.title || ""))) return false;
  if (scope.some((k) => SK_SCOPES.has(k))) return true;
  if (scope.includes("sector")) return SK_SECTOR_RE.test(text);
  if (scope.includes("all")) return true;
  // 절차 제도(전속고발·조사 불응 제재 등)는 모든 기업에 걸리지만, 공정위 내부 살림은 아니다
  if (scope.includes("ftc")) return !FTC_INTERNAL_RE.test(String(s.title || ""));
  return false;
}

// "10월 13일까지", "11월 2일까지 입법예고" → 마감일. 연도는 source 날짜 기준으로 앞뒤 6개월 안에서 고른다.
function pickYear(base, m, d) {
  const by = +base.slice(0, 4);
  const cand = [by - 1, by, by + 1].map((y) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`);
  const t = Date.parse(base);
  return cand.sort((a, b) => Math.abs(Date.parse(a) - t) - Math.abs(Date.parse(b) - t))[0];
}
function ymd(y, m, d) { return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`; }

function datesOf(s) {
  const text = String(s.detail || "");
  const base = s.date || s.source || "2026-01-01";
  let deadline = null, effective = null;
  let m;
  const re1 = /(?:(\d{4})년\s*)?(\d{1,2})월\s*(\d{1,2})일\s*까지/g;
  while ((m = re1.exec(text))) {
    const d = m[1] ? ymd(+m[1], +m[2], +m[3]) : pickYear(base, +m[2], +m[3]);
    if (!deadline || d > deadline) deadline = d; // 여러 마감이면 마지막 것
  }
  const re2 = /(?:(\d{4})년\s*)?(\d{1,2})월\s*(\d{1,2})일(?:부터|자)?\s*(?:현장\s*)?시행/g;
  while ((m = re2.exec(text))) {
    const d = m[1] ? ymd(+m[1], +m[2], +m[3]) : pickYear(base, +m[2], +m[3]);
    if (!effective || d > effective) effective = d;
  }
  // next에 마감이 있으면 그것도 본다
  if (s.next && s.next.date && /마감|의견|예고/.test(s.next.what || "")) {
    if (!deadline || s.next.date > deadline) deadline = s.next.date;
  }
  if (s.next && s.next.date && /시행/.test(s.next.what || "") && !/마감|예고|의견/.test(s.next.what || "") && !effective) effective = s.next.date;
  return { deadline, effective };
}

function fill(s, force) {
  if (force || !Array.isArray(s.scope) || !s.scope.length) s.scope = scopeOf(s);
  if (force || typeof s.sk !== "boolean") s.sk = skOf(s, s.scope);
  const { deadline, effective } = datesOf(s);
  if (force || !s.deadline) s.deadline = deadline;
  if (force || !s.effective) s.effective = effective;
  if (s.deadline === null) delete s.deadline;
  if (s.effective === null) delete s.effective;
  return s;
}

function run(force) {
  const p = path.join(__dirname, "..", "..", "docs", "data", "insight-latest.json");
  const d = JSON.parse(fs.readFileSync(p, "utf8"));
  for (const s of d.schedule || []) fill(s, force);
  const out = JSON.stringify(d, null, 2) + "\n";
  fs.writeFileSync(p, out);
  const snap = path.join(path.dirname(p), "insights", `${d.id}.json`);
  if (fs.existsSync(snap)) fs.writeFileSync(snap, out);
  const n = d.schedule.length;
  console.log(`[scheduleMeta] ${n}건 — SK 해당 ${d.schedule.filter((s) => s.sk).length}, 마감 ${d.schedule.filter((s) => s.deadline).length}, 시행일 ${d.schedule.filter((s) => s.effective).length}`);
  for (const s of d.schedule) console.log(`  ${s.sk ? "SK" : "  "} ${s.scope.join(",").padEnd(22)} ${s.deadline || "          "} ${s.effective || "          "} ${s.title.slice(0, 30)}`);
}

module.exports = { fill, scopeOf, skOf, datesOf };
if (require.main === module) run(process.argv.includes("--force"));

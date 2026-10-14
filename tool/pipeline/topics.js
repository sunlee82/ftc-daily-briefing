// 주제 분류 — 브리핑 항목마다 topics(주제 태그)를 매긴다. (순수 Node, 의존성 없음)
//
// 쓰임새 두 가지:
//   1) 한 번에 소급:  node tool/pipeline/topics.js            (topics 없는 항목만 채움)
//                     node tool/pipeline/topics.js --force    (전부 다시 매김)
//   2) 모듈로:        const { tagItem, TOPICS } = require("./topics")  — 간이 브리핑이 쓴다.
//
// 정식 다듬기(claude -p)는 지시문에 따라 Claude가 직접 topics를 적는다. 이 파일의
// 규칙은 그 전에 쌓인 항목과, Claude가 빠뜨린 항목을 메우는 보조 수단이다.
//
// 주제는 7개 고정. 화면(topics.html)의 탭이 이 순서대로 뜬다.
"use strict";

const fs = require("fs");
const path = require("path");

const TOPICS = [
  { key: "cartel",     label: "담합",          re: /담합|카르텔|입찰\s*담합|공동행위|리니언시|자진신고\s*감면|짬짜미|가격\s*합의/ },
  { key: "subcon",     label: "하도급·갑을",    re: /하도급|가맹|대리점|납품|대규모유통|유통업|갑질|기술\s*탈취|기술\s*유용|기술자료|연동제|정산|위탁|수급사업자|점주|밀어내기|부당\s*특약|단체\s*협상|을의|협상력|협력업체|협력사|하청|상생|자료\s*요구/ },
  { key: "group",      label: "기업집단·내부거래", re: /기업집단|대기업집단|총수|동일인|계열사|계열\s*분리|내부거래|부당\s*지원|사익\s*편취|일감\s*몰아주기|지주회사|지주사|상표권|지정자료|공시의무|공시\s*위반|순환출자|경제력\s*집중|위장\s*계열|친족|허위\s*자료|허위자료|자료\s*제출|우회\s*지원|통행세/ },
  { key: "consumer",   label: "소비자·표시광고",  re: /표시\s*광고|표시광고|과장\s*광고|거짓\s*광고|기만|허위\s*광고|소비자|약관|할부거래|상조|전자상거래|다크패턴|환불|청약철회|방문판매|제조물|리콜|위해제품|소비자원|광고|중요정보|결혼정보|가짜세일|할인율|품질\s*비교|비교정보/ },
  { key: "platform",   label: "플랫폼·디지털",   re: /플랫폼|배달앱|배민|쿠팡|네이버|카카오|구글|애플|앱마켓|온라인\s*쇼핑|오픈마켓|숙박\s*앱|AI\b|인공지능|알고리즘|최혜대우|끼워팔기|데이터|OTT|검색\s*광고|앱\s*수수료|디지털/i },
  { key: "merger",     label: "기업결합",        re: /기업결합|M&A|인수|합병|결합\s*심사|시정조치\s*이행|아시아나|결합\s*승인|사전심사|주식취득|사업재편|조건부\s*승인|승인/ },
  { key: "institution",label: "조직·절차·입법",  re: /조직\s*개편|정원|인사발령|위원장|부위원장|전원회의|소회의|심의절차|사건절차|전속고발|고발권|과징금\s*고시|과징금\s*부과기준|과징금\s*상한|형벌|입법예고|행정예고|시행령|국정감사|국감|국회|정무위|지방정부|지방\s*이양|조사권|현장조사\s*거부|조사\s*방해|경제분석국|중점조사|로펌|법무법인|인선|상임위원|인력|충원|승진|포상|사전공개|2심제|조사\s*방식|조사\s*거부|사건\s*처리|현장조사|심사보고서|심판|신고|민원|독립기관|CP\b|자율준수|발의|경쟁정책|연구회/ },
  { key: "enforce",    label: "제재·소송",      re: /과징금|시정명령|고발|행정소송|취소소송|집행정지|판결|선고|대법원|고법|서울고등법원|헌재|재판소원|검찰|기소|공판|무혐의|분할납부|과태료|제재/ },
];

const KEYS = TOPICS.map((t) => t.key);

// 제목은 가중치가 높다 — 제목에만 걸려도 채택, 요약은 두 번 이상 걸려야 채택.
// 아무것도 안 걸리면 가장 가까운 것 하나(조직·절차·입법은 기본값으로 쓰지 않는다).
function tagItem(it) {
  const head = String(it.headline || "");
  const body = String(it.summary || "");
  const hits = [];
  for (const t of TOPICS) {
    const inHead = t.re.test(head);
    const inBody = (body.match(new RegExp(t.re.source, t.re.flags.includes("g") ? t.re.flags : t.re.flags + "g")) || []).length;
    const score = (inHead ? 3 : 0) + Math.min(inBody, 3);
    if (score >= 2) hits.push({ key: t.key, score });
  }
  hits.sort((a, b) => b.score - a.score);
  let keys = hits.slice(0, 2).map((h) => h.key);
  // 위원회 소식(일정·인사)은 늘 조직·절차·입법
  if (it.category === "committee") keys = ["institution"];
  // 2개가 잡혔는데 둘째가 약하면 하나만
  if (keys.length === 2 && hits[1].score < hits[0].score - 2) keys = [keys[0]];
  if (!keys.length) keys = [];
  return keys;
}

function labelOf(key) {
  const t = TOPICS.find((x) => x.key === key);
  return t ? t.label : key;
}

function backfill({ force = false } = {}) {
  const dir = path.join(__dirname, "..", "..", "docs", "data", "briefings");
  const files = fs.readdirSync(dir).filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort();
  let changed = 0, items = 0, untagged = 0;
  const count = Object.fromEntries(KEYS.map((k) => [k, 0]));
  for (const f of files) {
    const p = path.join(dir, f);
    const b = JSON.parse(fs.readFileSync(p, "utf8"));
    let touched = false;
    for (const it of b.items || []) {
      items++;
      if (!force && Array.isArray(it.topics) && it.topics.length) {
        it.topics.forEach((k) => { if (count[k] != null) count[k]++; });
        continue;
      }
      const keys = tagItem(it);
      if (!keys.length) untagged++;
      it.topics = keys;
      keys.forEach((k) => count[k]++);
      touched = true;
    }
    if (touched) {
      fs.writeFileSync(p, JSON.stringify(b, null, 2) + "\n");
      changed++;
    }
  }
  // latest.json도 같은 내용이어야 한다
  const latest = path.join(dir, "..", "latest.json");
  if (files.length && fs.existsSync(latest)) {
    const last = JSON.parse(fs.readFileSync(path.join(dir, files[files.length - 1]), "utf8"));
    const cur = JSON.parse(fs.readFileSync(latest, "utf8"));
    if (cur.id === last.id) fs.writeFileSync(latest, JSON.stringify(last, null, 2) + "\n");
  }
  console.log(`[topics] 파일 ${changed}/${files.length} 갱신 — 항목 ${items}건, 미분류 ${untagged}건`);
  for (const k of KEYS) console.log(`  ${labelOf(k).padEnd(12)} ${count[k]}`);
}

module.exports = { TOPICS, KEYS, tagItem, labelOf };

if (require.main === module) {
  backfill({ force: process.argv.includes("--force") });
}

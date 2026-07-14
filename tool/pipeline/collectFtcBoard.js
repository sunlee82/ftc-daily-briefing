// ┌─────────────────────────────────────────────────────────────────────┐
// │  수집 단계 — 공정거래위원회 홈페이지(ftc.go.kr) 게시판 직접 스크래핑.  │
// │  (1) 보도자료 게시판 2곳(bordCd=3, key=12/13)                         │
// │  (2) 위원회 소식 게시판(bordCd=5, key=15) — 첨부 PDF도 함께 내려받음   │
// │  두 게시판 모두 서버 렌더링된 HTML 테이블이라 정규식으로 파싱한다.     │
// │  API 키가 필요 없다(공개 게시판).                                     │
// └─────────────────────────────────────────────────────────────────────┘
"use strict";

const BASE = "https://www.ftc.go.kr/www/";
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36";

const PRESS_BOARDS = [
  { url: "https://www.ftc.go.kr/www/selectBbsNttList.do?bordCd=3&key=12&searchCtgry=01,02", label: "보도/참고자료" },
  { url: "https://www.ftc.go.kr/www/selectBbsNttList.do?bordCd=3&key=13&searchCtgry=03", label: "설명자료" },
];
const COMMITTEE_BOARD_URL = "https://www.ftc.go.kr/www/selectBbsNttList.do?bordCd=5&key=15";

// ---------- HTML 파싱 유틸 ----------
const ENTITIES = { "&amp;": "&", "&#034;": '"', "&quot;": '"', "&#039;": "'", "&apos;": "'", "&lt;": "<", "&gt;": ">", "&nbsp;": " " };
function decodeEntities(s) {
  return s.replace(/&(amp|#034|quot|#039|apos|lt|gt|nbsp);/g, (m) => ENTITIES[m] || m);
}
function stripTags(html) {
  return decodeEntities(
    html.replace(/<!--[\s\S]*?-->/g, "").replace(/<[^>]+>/g, " ")
  ).replace(/\s+/g, " ").trim();
}
function extractCells(rowHtml) {
  return [...rowHtml.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => m[1]);
}
function extractRows(html) {
  const table = html.match(/<table[\s\S]*?<\/table>/);
  if (!table) return [];
  const body = table[0].replace(/<thead>[\s\S]*?<\/thead>/, ""); // 헤더 행 제외
  return [...body.matchAll(/<tr>[\s\S]*?<\/tr>/g)].map((m) => m[0]);
}

// "YYYY-MM-DD" 날짜가 최근 windowHours 이내(=최근 N일, 날짜 단위)인지
function todayKST(offsetDays = 0) {
  const d = new Date(Date.now() - offsetDays * 86400000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(d);
}
function recentDateSet(windowHours) {
  const days = Math.max(1, Math.ceil(windowHours / 24));
  const set = new Set();
  for (let i = 0; i < days; i++) set.add(todayKST(i));
  return set;
}

async function fetchHtml(url) {
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`ftc.go.kr ${res.status} (${url})`);
  return res.text();
}

/**
 * 보도자료 게시판 2곳을 스크래핑해 최근 windowHours 이내 게시물만 반환한다.
 * @returns {Array<{headline,dept,published_at,source_url,boardLabel}>}
 */
async function fetchPressReleases(windowHours) {
  const recent = recentDateSet(windowHours);
  const results = [];
  for (const board of PRESS_BOARDS) {
    let html;
    try {
      html = await fetchHtml(board.url);
    } catch (err) {
      console.warn(`[collectFtcBoard] ${board.label} 조회 실패: ${err.message}`);
      continue;
    }
    for (const row of extractRows(html)) {
      const cells = extractCells(row); // [번호, 구분, 제목, 담당부서, 등록일, 첨부파일]
      if (cells.length < 5) continue;
      const date = stripTags(cells[4]);
      if (!recent.has(date)) continue;
      const title = stripTags(cells[2]);
      const dept = stripTags(cells[3]);
      const hrefMatch = cells[2].match(/href="([^"]+)"/);
      const source_url = hrefMatch ? BASE + decodeEntities(hrefMatch[1]).replace(/^\.\//, "") : "";
      if (!title) continue;
      results.push({ headline: title, dept, published_at: date, source_url, boardLabel: board.label });
    }
  }
  return results;
}

/**
 * 위원회 소식 게시판을 스크래핑해 최근 windowHours 이내 게시물의 첨부 PDF를 내려받는다.
 * @returns {Array<{headline,published_at,source_url,dept,pdfBase64}>}
 */
async function fetchCommitteeNews(windowHours) {
  const recent = recentDateSet(windowHours);
  let html;
  try {
    html = await fetchHtml(COMMITTEE_BOARD_URL);
  } catch (err) {
    console.warn(`[collectFtcBoard] 위원회 소식 조회 실패: ${err.message}`);
    return [];
  }
  const matched = [];
  for (const row of extractRows(html)) {
    const cells = extractCells(row); // [번호, 제목, 담당부서, 등록일, 첨부, 조회]
    if (cells.length < 5) continue;
    const date = stripTags(cells[3]);
    if (!recent.has(date)) continue;
    const title = stripTags(cells[1]);
    const dept = stripTags(cells[2]);
    const hrefMatch = cells[1].match(/href="([^"]+)"/);
    const source_url = hrefMatch ? BASE + decodeEntities(hrefMatch[1]).replace(/^\.\//, "") : "";
    const fileMatch = cells[4].match(/downloadBbsFile\.do\?atchmnflNo=(\d+)/);
    if (!fileMatch || !title) continue;
    matched.push({ headline: title, dept, published_at: date, source_url, atchmnflNo: fileMatch[1] });
  }

  // PDF 다운로드는 병렬로, 일부 실패해도 나머지는 진행
  const settled = await Promise.allSettled(
    matched.map(async (m) => {
      const res = await fetch(`${BASE}downloadBbsFile.do?atchmnflNo=${m.atchmnflNo}`, {
        headers: { "User-Agent": UA },
      });
      if (!res.ok) throw new Error(`PDF ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      return { ...m, pdfBase64: buf.toString("base64") };
    })
  );
  const out = [];
  settled.forEach((r, i) => {
    if (r.status === "fulfilled") out.push(r.value);
    else console.warn(`[collectFtcBoard] PDF 다운로드 실패 (${matched[i].headline}): ${r.reason.message}`);
  });
  return out;
}

module.exports = { fetchPressReleases, fetchCommitteeNews };

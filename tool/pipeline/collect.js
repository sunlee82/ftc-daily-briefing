// ┌─────────────────────────────────────────────────────────────────────┐
// │  수집 단계 — serper.dev(구글 뉴스) 실제 연동.                         │
// │  기관(공정거래위원회) × 키워드 조합마다 serper.dev /news를 호출해     │
// │  제목·요약(snippet)·출처 URL·발표 날짜를 수집한다.                    │
// │  키워드가 빈 문자열이면 기관명 단독으로 검색(=전체 동향).             │
// │  환경변수 SERPER_API_KEY 필요.                                        │
// └─────────────────────────────────────────────────────────────────────┘
"use strict";

const SERPER_NEWS_URL = "https://google.serper.dev/news";

// 수집 기간(시간) → serper의 tbs(qdr) 최근성 필터로 매핑
function windowToTbs(windowHours) {
  if (windowHours <= 24) return "qdr:d";        // 최근 하루
  if (windowHours <= 24 * 7) return "qdr:w";    // 최근 한 주
  if (windowHours <= 24 * 31) return "qdr:m";   // 최근 한 달
  return "qdr:y";
}

// serper 뉴스의 date는 "3시간 전"·"1 day ago"·절대일자 등 다양 → 정렬용 분(minute) 환산
function relMinutes(s) {
  if (!s) return Infinity;
  const str = String(s).trim();
  const abs = Date.parse(str);
  if (!isNaN(abs)) return Math.max(0, (Date.now() - abs) / 60000);
  const m = str.match(/(\d+)\s*(min|minute|hour|day|week|month|분|시간|일|주|개월|달|시간전)/i);
  if (m) {
    const n = Number(m[1]);
    const u = m[2].toLowerCase();
    if (/min|분/.test(u)) return n;
    if (/hour|시간/.test(u)) return n * 60;
    if (/day|일/.test(u)) return n * 60 * 24;
    if (/week|주/.test(u)) return n * 60 * 24 * 7;
    if (/month|개월|달/.test(u)) return n * 60 * 24 * 30;
  }
  return Infinity; // 파싱 불가 → 뒤로
}

// 조합 하나에 대한 serper /news 호출. keyword가 빈 문자열이면 기관명만으로 검색.
// excludeTerms(예: "-담합 -가맹점")가 있으면 쿼리 끝에 덧붙여 해당 단어가 포함된 결과를 제외한다.
async function fetchPair(agency, keyword, { apiKey, num, tbs, gl, hl, excludeTerms }) {
  const base = keyword ? `${agency} ${keyword}` : agency;
  const q = excludeTerms ? `${base} ${excludeTerms}` : base;
  const res = await fetch(SERPER_NEWS_URL, {
    method: "POST",
    headers: { "X-API-KEY": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({ q, gl, hl, num, tbs }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`serper ${res.status} (${q}) ${text.slice(0, 120)}`);
  }
  const data = await res.json();
  const news = Array.isArray(data.news) ? data.news : [];
  return news.map((n) => ({
    competitor: agency,
    keyword: keyword || "전체동향",
    title: n.title || "(제목 없음)",
    url: n.link || "",
    published_at: n.date || "",          // 발표 날짜 (serper 원본 표기)
    source: n.source || "serper",        // 매체명
    snippet: n.snippet || "",            // 요약 원재료
  }));
}

/**
 * 기관 × 키워드 조합을 serper.dev로 검색해 raw 항목 배열을 반환한다.
 * keywords에 빈 문자열("")이 포함되면 그 조합은 기관명 단독으로 검색한다.
 * opts.excludeKeywords가 있으면 검색어에서 해당 단어가 포함된 결과를 제외한다.
 * @returns {Array<{competitor,keyword,title,url,published_at,source,snippet}>}
 */
async function collect(competitors, keywords, opts = {}) {
  const apiKey = process.env.SERPER_API_KEY;
  if (!apiKey) {
    throw new Error("SERPER_API_KEY가 설정되지 않았습니다. .env에 키를 넣고 서버를 재시작하세요.");
  }
  const excludeTerms = (opts.excludeKeywords || [])
    .map((k) => String(k).trim())
    .filter(Boolean)
    .map((k) => `-${k}`)
    .join(" ");
  const cfg = {
    apiKey,
    num: Math.min(Number(opts.maxPerPair) || 10, 30),
    tbs: windowToTbs(Number(opts.windowHours) || 24),
    gl: opts.gl || "kr",
    hl: opts.hl || "ko",
    excludeTerms,
  };

  const pairs = [];
  for (const c of competitors) for (const k of keywords) pairs.push([c, k]);

  // 조합별 병렬 호출 — 일부 실패해도 나머지는 진행(부분 성공)
  const settled = await Promise.allSettled(pairs.map(([c, k]) => fetchPair(c, k, cfg)));
  const raw = [];
  const errors = [];
  settled.forEach((r, i) => {
    if (r.status === "fulfilled") raw.push(...r.value);
    else errors.push(`${pairs[i][0]}/${pairs[i][1]}: ${r.reason.message}`);
  });

  // 전부 실패했다면 오류를 올려 UI에 표시
  if (raw.length === 0 && errors.length) {
    throw new Error("검색에 모두 실패했습니다 — " + errors[0]);
  }
  if (errors.length) console.warn("[collect] 일부 조합 실패:\n  " + errors.join("\n  "));
  return raw;
}

/** URL(우선) 또는 제목 기준 중복 제거 후 최신순 정렬 */
function dedupeAndSort(items) {
  const seen = new Set();
  const out = [];
  for (const it of items) {
    const key = (it.url || "").trim() || it.title.trim();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(it);
  }
  out.sort((a, b) => relMinutes(a.published_at) - relMinutes(b.published_at));
  return out;
}

module.exports = { collect, dedupeAndSort };

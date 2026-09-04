// 최근 며칠간 실제로 배포된 브리핑(docs/data/briefings/*.json)에 이미 포함된 항목의
// source_url을 모은다. 웹 도구(server.js)와 자동 수집 스크립트(collectForAutomation.js)가
// 공통으로 사용해, 이미 배포된 항목이 다시 초안에 나오지 않도록 한다.
"use strict";

const fs = require("fs");
const path = require("path");

const DEFAULT_LOOKBACK_DAYS = 14;

function loadPublishedUrls(briefDir, daysBack = DEFAULT_LOOKBACK_DAYS) {
  const urls = new Set();
  if (!fs.existsSync(briefDir)) return urls;
  const cutoff = Date.now() - daysBack * 86400000;
  for (const file of fs.readdirSync(briefDir)) {
    const dateStr = file.replace(/\.json$/, "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) continue;
    if (new Date(dateStr + "T00:00:00").getTime() < cutoff) continue;
    try {
      const brief = JSON.parse(fs.readFileSync(path.join(briefDir, file), "utf8"));
      for (const it of brief.items || []) {
        if (it.source_url) urls.add(it.source_url);
      }
    } catch (err) {
      console.warn(`[publishedUrls] 배포 이력 확인 실패 (${file}): ${err.message}`);
    }
  }
  return urls;
}

module.exports = { loadPublishedUrls, DEFAULT_LOOKBACK_DAYS };

/**
 * 天网 · 真实漏洞情报
 *
 * 数据源（全部为真实公共接口，无模拟条目）：
 *  - NVD CVE API 2.0  https://services.nvd.nist.gov/rest/json/cves/2.0
 *  - CISA KEV         https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json
 *
 * 失败时如实返回错误与“部分结果”，不会编造 CVE。
 */
'use strict';

const NVD_URL = 'https://services.nvd.nist.gov/rest/json/cves/2.0';
const KEV_URL = 'https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json';

const QUERY_TTL = 10 * 60 * 1000;
const KEV_TTL = 6 * 60 * 60 * 1000;
const KEV_RETRY = 5 * 60 * 1000;

const queryCache = new Map();
let kevState = { at: 0, ok: false, map: new Map(), count: 0, version: '', released: '', error: null };

async function fetchJSON(url, timeout) {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(timeout || 15000),
    headers: {
      accept: 'application/json',
      'user-agent': 'skynet-terminal/2.0 (authorized local lab)'
    }
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText || ''}`.trim());
  return res.json();
}

function kevCatalog(force = false) {
  const fresh = kevState.ok && Date.now() - kevState.at < KEV_TTL;
  const retryable = !kevState.ok && kevState.at && Date.now() - kevState.at < KEV_RETRY;
  if (!force && (fresh || retryable)) return Promise.resolve(kevState);

  const work = (async () => {
    try {
      const data = await fetchJSON(KEV_URL, 20000);
      const map = new Map();
      (Array.isArray(data.vulnerabilities) ? data.vulnerabilities : []).forEach(item => {
        if (!item || !item.cveID) return;
        map.set(String(item.cveID).toUpperCase(), {
          dateAdded: item.dateAdded || null,
          name: item.vulnerabilityName || null,
          vendor: item.vendorProject || null,
          product: item.product || null,
          ransomware: item.knownRansomwareCampaignUse || null
        });
      });
      kevState = {
        at: Date.now(),
        ok: true,
        map,
        count: Number(data.count) || map.size,
        version: data.catalogVersion || '',
        released: data.dateReleased || '',
        error: null
      };
    } catch (err) {
      kevState = {
        at: Date.now(),
        ok: false,
        map: kevState.map || new Map(),
        count: kevState.count || 0,
        version: kevState.version || '',
        released: kevState.released || '',
        error: String(err && err.message || err)
      };
    }
    return kevState;
  })();

  return work;
}

function cvssOf(metrics) {
  if (!metrics) return { score: null, severity: null, vector: null, version: null };
  const buckets = [
    ['cvssMetricV40', '4.0'],
    ['cvssMetricV31', '3.1'],
    ['cvssMetricV30', '3.0'],
    ['cvssMetricV2', '2.0']
  ];
  for (const [key, version] of buckets) {
    const list = metrics[key];
    if (!Array.isArray(list) || !list.length) continue;
    const item = list.find(entry => entry && entry.cvssData) || list[0];
    const data = item && item.cvssData;
    if (!data) continue;
    const severity = (item.baseSeverity && String(item.baseSeverity).toLowerCase())
      || (data.baseSeverity && String(data.baseSeverity).toLowerCase())
      || null;
    return {
      score: Number.isFinite(Number(data.baseScore)) ? Number(data.baseScore) : null,
      severity,
      vector: data.vectorString || null,
      version
    };
  }
  return { score: null, severity: null, vector: null, version: null };
}

function summarizeQuery(query, limit) {
  const safeQuery = String(query || '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 120);
  if (!safeQuery) throw new Error('empty query');
  return { safeQuery, safeLimit: Math.max(1, Math.min(20, Number(limit) || 5)) };
}

async function search(rawQuery, rawLimit) {
  const { safeQuery, safeLimit } = summarizeQuery(rawQuery, rawLimit);
  const key = `${safeQuery.toLowerCase()}|${safeLimit}`;
  const hit = queryCache.get(key);
  if (hit && Date.now() - hit.at < QUERY_TTL) return hit.data;

  const started = Date.now();
  const [kev, nvd] = await Promise.allSettled([
    kevCatalog(),
    fetchJSON(
      `${NVD_URL}?keywordSearch=${encodeURIComponent(safeQuery)}&resultsPerPage=20&noRejected`,
      18000
    )
  ]);

  const kevData = kev.status === 'fulfilled' ? kev.value : null;
  const kevMap = kevData && kevData.map ? kevData.map : new Map();
  const results = [];
  let total = 0;
  let source = 'NVD CVE API 2.0';
  let partial = false;
  let error = null;
  let catalog = null;

  if (nvd.status === 'fulfilled') {
    const payload = nvd.value || {};
    total = Number(payload.totalResults) || 0;
    (Array.isArray(payload.vulnerabilities) ? payload.vulnerabilities : []).forEach(entry => {
      const cve = entry && entry.cve;
      if (!cve || !cve.id) return;
      const cvss = cvssOf(cve.metrics);
      const description = (Array.isArray(cve.descriptions) ? cve.descriptions : []).find(d => d && d.lang === 'en');
      const kevEntry = kevMap.get(String(cve.id).toUpperCase()) || null;
      results.push({
        id: cve.id,
        published: String(cve.published || '').slice(0, 10),
        modified: String(cve.lastModified || '').slice(0, 10),
        status: cve.vulnStatus || '',
        score: cvss.score,
        severity: cvss.severity,
        cvssVersion: cvss.version,
        summary: description ? String(description.value).replace(/\s+/g, ' ').trim() : '',
        kev: kevEntry ? {
          dateAdded: kevEntry.dateAdded,
          ransomware: kevEntry.ransomware,
          name: kevEntry.name
        } : null
      });
    });
    results.sort((a, b) => ((b.score == null ? -1 : b.score) - (a.score == null ? -1 : a.score))
      || String(b.published || '').localeCompare(String(a.published || '')));
    results.length = Math.min(results.length, safeLimit);
    catalog = {
      count: kevData ? kevData.count : 0,
      version: kevData ? kevData.version : '',
      released: kevData ? kevData.released : '',
      ok: Boolean(kevData && kevData.ok),
      error: kevData ? kevData.error : null
    };
  } else {
    error = String(nvd.reason && nvd.reason.message || nvd.reason || 'NVD request failed');
    partial = true;
    if (kevData && kevData.ok) {
      source = 'CISA KEV（本地关键词检索，NVD 不可用）';
      const needle = safeQuery.toLowerCase();
      const matches = [];
      kevMap.forEach((entry, id) => {
        const haystack = `${id} ${entry.vendor || ''} ${entry.product || ''} ${entry.name || ''}`.toLowerCase();
        if (haystack.includes(needle)) matches.push({ id, entry });
      });
      total = matches.length;
      matches.slice(0, safeLimit).forEach(({ id, entry }) => {
        results.push({
          id,
          published: entry.dateAdded || '',
          modified: entry.dateAdded || '',
          status: 'KEV',
          score: null,
          severity: null,
          cvssVersion: null,
          summary: `${entry.vendor || ''} ${entry.product || ''} · ${entry.name || ''}`.trim(),
          kev: { dateAdded: entry.dateAdded, ransomware: entry.ransomware, name: entry.name }
        });
      });
      catalog = {
        count: kevData.count,
        version: kevData.version,
        released: kevData.released,
        ok: true,
        error: null
      };
    } else {
      source = 'NVD CVE API 2.0';
    }
  }

  const nvdLive = nvd.status === 'fulfilled';
  const data = {
    ok: nvdLive || Boolean(kevData && kevData.ok),
    real: true,
    query: safeQuery,
    source,
    partial,
    total,
    shown: results.length,
    limit: safeLimit,
    results,
    catalog,
    error: nvdLive ? null : error,
    ms: Date.now() - started,
    fetchedAt: new Date().toISOString()
  };
  if (!data.ok) {
    data.error = error || (kevData && kevData.error) || 'NVD 与 CISA KEV 均不可用';
  }
  queryCache.set(key, { at: Date.now(), data });
  if (queryCache.size > 100) queryCache.clear();
  return data;
}

async function kevInfo(cveId) {
  const catalog = await kevCatalog();
  const id = String(cveId || '').toUpperCase();
  return catalog.map.get(id) || null;
}

module.exports = { search, kevCatalog, kevInfo, cvssOf };

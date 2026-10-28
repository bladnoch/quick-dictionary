/* Provider adapters run only in the extension service worker. */
(function (root) {
  "use strict";
  const {cleanMarkup} = root.SelectDictCore;
  class ProviderError extends Error {
    constructor(code, message) { super(message); this.name = "ProviderError"; this.code = code; }
  }
  function parseNaver(data) {
    const maps = [data?.searchResultMap?.searchResultListMap, data?.searchResultMap, data?.searchResultListMap, data];
    const map = maps.find(value => value && (Array.isArray(value.WORD?.items) || Array.isArray(value.WORD?.m_items)));
    if (!map) throw new ProviderError("NAVER_FORMAT", "네이버 사전의 응답 형식을 읽지 못했습니다.");
    const items = map.WORD.items || map.WORD.m_items;
    if (!items.length) throw new ProviderError("NO_ENTRY", "네이버 영어사전에 검색 결과가 없습니다.");
    const entries = [];
    for (const item of items.slice(0, 5)) {
      const headword = cleanMarkup(item.handleEntry || item.expEntry || item.entry || item.searchEntry || "");
      const meanings = [];
      for (const group of (Array.isArray(item.meansCollector) ? item.meansCollector : [])) {
        const partOfSpeech = cleanMarkup(group.partOfSpeech || group.partOfSpeech2 || "");
        for (const meaning of (Array.isArray(group.means) ? group.means : [])) {
          const value = cleanMarkup(typeof meaning === "string" ? meaning : meaning.value || meaning.mean || "");
          if (value && !meanings.some(previous => previous.value === value && previous.partOfSpeech === partOfSpeech)) meanings.push({partOfSpeech, value});
        }
      }
      if (!meanings.length && typeof item.mean === "string") meanings.push({partOfSpeech: "", value: cleanMarkup(item.mean)});
      const pronunciations = [];
      for (const pronunciation of (Array.isArray(item.conjugationList) ? item.conjugationList : []).concat(Array.isArray(item.pronunciationList) ? item.pronunciationList : [])) {
        const value = cleanMarkup(pronunciation.pronunciation || pronunciation.phonetic || pronunciation.pronunciationValue || "");
        if (value && !pronunciations.includes(value)) pronunciations.push(value);
      }
      if (headword && meanings.length) entries.push({headword, meanings: meanings.slice(0, 7), pronunciation: pronunciations.slice(0, 2).join(" · "), source: cleanMarkup(item.sourceDictnameKO || item.sourceDictnameOri || "네이버 영어사전")});
    }
    if (!entries.length) throw new ProviderError("NAVER_FORMAT", "사전 뜻을 읽지 못했습니다. 네이버에서 전체 결과를 확인해 주세요.");
    return entries;
  }
  function parseGoogle(data) {
    const translated = Array.isArray(data?.[0]) ? data[0].map(part => Array.isArray(part) && typeof part[0] === "string" ? part[0] : "").join("") : "";
    if (!translated.trim()) throw new ProviderError("GOOGLE_FORMAT", "Google 번역 결과를 읽지 못했습니다.");
    return {translated: translated.trim(), detectedLanguage: typeof data[2] === "string" ? data[2] : "auto"};
  }
  function parseNaverSummary(data, query) {
    if (!Array.isArray(data?.items)) throw new ProviderError("NAVER_SUMMARY_FORMAT", "네이버 사전 요약을 읽지 못했습니다.");
    const normalize = value => cleanMarkup(value).normalize("NFKC").toLowerCase();
    const exact = [];
    for (const group of data.items) {
      if (!Array.isArray(group)) continue;
      for (const row of group) {
        if (!Array.isArray(row)) continue;
        const headword = cleanMarkup(Array.isArray(row[0]) ? row[0][0] : "");
        const meaning = cleanMarkup(Array.isArray(row[2]) ? row[2].filter(value => typeof value === "string").join("; ") : "");
        if (!headword || !meaning || normalize(headword) !== normalize(query)) continue;
        if (!exact.some(entry => entry.headword === headword && entry.meanings[0].value === meaning)) exact.push({headword, meanings: [{partOfSpeech: "", value: meaning}], pronunciation: "", source: "네이버 영어사전 · 사전 요약"});
      }
    }
    if (!exact.length) throw new ProviderError("NO_SUMMARY_ENTRY", "네이버 요약 조회에 일치하는 단어가 없습니다.");
    return exact.slice(0, 3);
  }
  function parseGoogleWeb(text) {
    // Google batches include an XSSI prefix and length lines. Parse only the requested RPC.
    const frames = [];
    for (const line of String(text).split(/\r?\n/)) {
      if (!line.trim().startsWith("[")) continue;
      try {
        const value = JSON.parse(line);
        if (Array.isArray(value)) frames.push(...value);
      } catch { /* Non-payload transport lines do not contain translation data. */ }
    }
    const packet = frames.find(value => Array.isArray(value) && value[0] === "wrb.fr" && value[1] === "MkEWBc" && typeof value[2] === "string");
    if (!packet) throw new ProviderError("GOOGLE_WEB_FORMAT", "Google 웹 번역 응답을 읽지 못했습니다.");
    let value;
    try { value = JSON.parse(packet[2]); } catch { throw new ProviderError("GOOGLE_WEB_FORMAT", "Google 웹 번역 데이터 형식이 변경되었습니다."); }
    const chunks = [];
    for (const block of (Array.isArray(value?.[1]?.[0]) ? value[1][0] : [])) {
      for (const segment of (Array.isArray(block?.[5]) ? block[5] : [])) {
        if (Array.isArray(segment) && typeof segment[0] === "string" && segment[0].trim()) chunks.push(segment[0].trim());
      }
    }
    if (!chunks.length) throw new ProviderError("GOOGLE_WEB_FORMAT", "Google 웹 번역에서 번역문을 찾지 못했습니다.");
    return {translated: chunks.join(" "), detectedLanguage: typeof value[2] === "string" ? value[2] : typeof value?.[0]?.[2] === "string" ? value[0][2] : "auto"};
  }
  async function requestText(url, fetcher = fetch, options = {}) {
    const {timeoutMs = 6500, ...requestOptions} = options;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetcher(url, {method: "GET", credentials: "omit", redirect: "error", signal: controller.signal, referrerPolicy: "no-referrer", ...requestOptions, headers: {Accept: "application/json", ...requestOptions.headers}});
      if (!response.ok) throw new ProviderError("HTTP_" + response.status, response.status === 429 ? "서비스의 요청 제한에 걸렸습니다. 잠시 후 다시 시도해 주세요." : "서비스 연결에 실패했습니다. (HTTP " + response.status + ")");
      const body = await response.text();
      if (!body.trim()) throw new ProviderError("EMPTY_RESPONSE", "서비스에서 빈 응답을 반환했습니다.");
      return body;
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      if (controller.signal.aborted) throw new ProviderError("TIMEOUT", "응답이 지연되고 있습니다. 공식 사이트에서 확인해 주세요.");
      throw new ProviderError("NETWORK", "서비스에 연결하지 못했습니다. 네트워크 연결을 확인해 주세요.");
    } finally { clearTimeout(timer); }
  }
  async function requestJSON(url, fetcher = fetch, options = {}) {
    const body = await requestText(url, fetcher, options);
    try { return JSON.parse(body); } catch { throw new ProviderError("INVALID_JSON", "서비스가 사전/번역 데이터 대신 다른 응답을 반환했습니다."); }
  }
  async function lookup(provider, query, targetLanguage, fetcher = fetch) {
    if (provider === "naver") {
      const params = new URLSearchParams({query, m: "pc", lang: "ko"});
      try {
        return {provider, query, entries: parseNaver(await requestJSON("https://en.dict.naver.com/api3/enko/search?" + params, fetcher, {timeoutMs: 9000}))};
      } catch (primaryError) {
        if (primaryError.code === "NO_ENTRY") throw primaryError;
        const summaryParams = new URLSearchParams({st: "11", r_lt: "11", q: query});
        try {
          const data = await requestJSON("https://ac-dict.naver.com/enko/ac?" + summaryParams, fetcher, {timeoutMs: 9000});
          return {provider, query, summary: true, entries: parseNaverSummary(data, query)};
        } catch (summaryError) {
          throw new ProviderError("NAVER_UNAVAILABLE", "네이버 사전 조회에 연결하지 못했습니다. (" + primaryError.code + " / " + summaryError.code + ")");
        }
      }
    }
    if (provider === "google") {
      const params = new URLSearchParams({rpcids: "MkEWBc", "source-path": "/", hl: targetLanguage, rt: "c"});
      const argument = JSON.stringify([[query, "auto", targetLanguage, true], [null]]);
      const body = new URLSearchParams({"f.req": JSON.stringify([[["MkEWBc", argument, null, "generic"]]])}).toString();
      try {
        const raw = await requestText("https://translate.google.com/_/TranslateWebserverUi/data/batchexecute?" + params, fetcher, {method: "POST", headers: {"Content-Type": "application/x-www-form-urlencoded;charset=UTF-8"}, body, timeoutMs: 9000});
        return {provider, query, ...parseGoogleWeb(raw)};
      } catch (primaryError) {
        const legacyParams = new URLSearchParams({client: "gtx", sl: "auto", tl: targetLanguage, dt: "t", q: query});
        try {
          return {provider, query, ...parseGoogle(await requestJSON("https://translate.googleapis.com/translate_a/single?" + legacyParams, fetcher))};
        } catch (legacyError) {
          throw new ProviderError("GOOGLE_UNAVAILABLE", "Google 번역 결과를 불러오지 못했습니다. (" + primaryError.code + " / " + legacyError.code + ")");
        }
      }
    }
    throw new ProviderError("BAD_PROVIDER", "지원하지 않는 서비스입니다.");
  }
  root.SelectDictProviders = Object.freeze({ProviderError, parseNaver, parseNaverSummary, parseGoogle, parseGoogleWeb, requestText, requestJSON, lookup});
})(globalThis);

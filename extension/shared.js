/* Shared pure functions. No network, storage or page access. */
(function (root) {
  "use strict";
  const MAX_TEXT = 5000;
  const LANGUAGES = Object.freeze({ko: "한국어", en: "영어", ja: "일본어", "zh-CN": "중국어(간체)", es: "스페인어", fr: "프랑스어", de: "독일어"});
  const DEFAULTS = Object.freeze({
    settingsVersion: 2,
    enabled: true,
    selectionMode: "button",
    presentation: "inline",
    targetLanguage: "ko",
    autoDelay: 250,
    phraseWordLimit: 1,
    ignoreEditable: false,
    fallbackToWindow: false,
    excludedDomains: []
  });
  function normalizeText(value) {
    return typeof value === "string" ? value.replace(/[\u200B\uFEFF]/g, "").replace(/\s+/gu, " ").trim() : "";
  }
  function validDomain(value) {
    const domain = typeof value === "string" ? value.trim().toLowerCase().replace(/^\*\./, "").replace(/\.$/, "") : "";
    return /^(?:localhost|(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)$/.test(domain) && domain.length <= 253 ? domain : "";
  }
  function sanitizeSettings(value = {}) {
    const v = value && typeof value === "object" ? value : {};
    return {
      settingsVersion: DEFAULTS.settingsVersion,
      enabled: typeof v.enabled === "boolean" ? v.enabled : DEFAULTS.enabled,
      selectionMode: ["button", "auto"].includes(v.selectionMode) ? v.selectionMode : DEFAULTS.selectionMode,
      // v1.0.0 saved window/fallback settings must never turn lookup into navigation.
      presentation: "inline",
      targetLanguage: Object.hasOwn(LANGUAGES, v.targetLanguage) ? v.targetLanguage : DEFAULTS.targetLanguage,
      autoDelay: Number.isFinite(v.autoDelay) ? Math.min(1000, Math.max(150, Math.round(v.autoDelay))) : DEFAULTS.autoDelay,
      phraseWordLimit: [1, 2, 3].includes(Number(v.phraseWordLimit)) ? Number(v.phraseWordLimit) : DEFAULTS.phraseWordLimit,
      // v1.1.1 enables editor selections once for legacy installs. Later explicit opt-outs are preserved.
      ignoreEditable: v.settingsVersion === DEFAULTS.settingsVersion && typeof v.ignoreEditable === "boolean" ? v.ignoreEditable : DEFAULTS.ignoreEditable,
      fallbackToWindow: false,
      excludedDomains: Array.isArray(v.excludedDomains) ? [...new Set(v.excludedDomains.map(validDomain).filter(Boolean))].slice(0, 100) : []
    };
  }
  function isExcluded(hostname, domains) {
    const host = String(hostname || "").toLowerCase().replace(/\.$/, "");
    return domains.some(domain => host === domain || host.endsWith("." + domain));
  }
  function dictionaryQuery(text) {
    return normalizeText(text).replace(/^[\s"“”‘’'([{<«]+|[\s"“”‘’'\])}>».,!?;:。！？]+$/gu, "");
  }
  function classify(text, settings = DEFAULTS) {
    const normalized = normalizeText(text);
    const query = dictionaryQuery(normalized);
    if (!normalized || !/\p{L}/u.test(normalized)) return {kind: "empty", provider: null, query: normalized};
    if (normalized.length > MAX_TEXT) return {kind: "too-long", provider: null, query: normalized};
    const words = query.split(" ");
    // Apostrophes, hyphenated words and dotted abbreviations count as one word.
    const lexical = token => /^[\p{L}\p{M}]+(?:['’\-‐‑][\p{L}\p{M}]+)*$/u.test(token) || /^(?:\p{L}\.)+\p{L}?$/u.test(token);
    const limit = [1, 2, 3].includes(settings.phraseWordLimit) ? settings.phraseWordLimit : 1;
    const dictionary = words.length <= limit && words.every(lexical) && query.length <= 120;
    return {kind: dictionary ? "word" : "sentence", provider: dictionary ? "naver" : "google", query: dictionary ? query : normalized};
  }
  function resolveLookup(text, provider, settings = DEFAULTS) {
    const routing = classify(text, settings);
    if (!routing.provider) throw new Error(routing.kind === "too-long" ? "한 번에 5,000자까지 선택할 수 있습니다." : "조회할 단어나 문장을 선택해 주세요.");
    if (provider != null && !["naver", "google"].includes(provider)) throw new Error("지원하지 않는 조회 방식입니다.");
    const selected = provider || routing.provider;
    return {provider: selected, query: selected === "naver" ? dictionaryQuery(text) : normalizeText(text), kind: routing.kind};
  }
  function providerURL(provider, text, target = "ko") {
    const query = normalizeText(text).slice(0, MAX_TEXT);
    if (provider === "naver") return "https://en.dict.naver.com/#/search?query=" + encodeURIComponent(query);
    if (provider === "google") {
      const params = new URLSearchParams({sl: "auto", tl: Object.hasOwn(LANGUAGES, target) ? target : "ko", text: query, op: "translate"});
      return "https://translate.google.com/?" + params;
    }
    throw new Error("지원하지 않는 서비스입니다.");
  }
  function cleanMarkup(value) {
    if (typeof value !== "string") return "";
    const entities = {amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " "};
    return normalizeText(value.replace(/<[^>]*>/g, " ").replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (match, entity) => {
      if (entity[0] === "#") {
        const code = entity[1].toLowerCase() === "x" ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
        return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "";
      }
      return entities[entity.toLowerCase()] || match;
    }));
  }
  root.SelectDictCore = Object.freeze({MAX_TEXT, LANGUAGES, DEFAULTS, normalizeText, validDomain, sanitizeSettings, isExcluded, dictionaryQuery, classify, resolveLookup, providerURL, cleanMarkup});
})(globalThis);

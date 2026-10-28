"use strict";
const {test} = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const context = vm.createContext({URLSearchParams, AbortController, setTimeout, clearTimeout, fetch});
for (const file of ["shared.js", "providers.js"]) vm.runInContext(fs.readFileSync(path.join(__dirname, "../extension", file), "utf8"), context);
const P = context.SelectDictProviders;

// Synthetic response fixtures: these do NOT claim a successful live provider call.
const naverFixture = {searchResultMap: {searchResultListMap: {WORD: {items: [{
  handleEntry: "<strong>warehouse</strong>",
  sourceDictnameKO: "테스트용 사전 출처",
  meansCollector: [{partOfSpeech: "명사", means: [{value: "창고"}, {value: "물품 보관소"}]}]
}]}}}};
test("Naver adapter extracts Korean meanings and strips markup", () => {
  const [entry] = P.parseNaver(naverFixture);
  assert.equal(entry.headword, "warehouse");
  assert.equal(entry.meanings[0].value, "창고");
  assert.equal(entry.meanings[0].partOfSpeech, "명사");
  assert.equal(entry.source, "테스트용 사전 출처");
});
test("Naver adapter reports empty dictionaries without inventing translations", () => {
  assert.throws(() => P.parseNaver({searchResultMap: {searchResultListMap: {WORD: {items: []}}}}), {code: "NO_ENTRY"});
  assert.throws(() => P.parseNaver({captcha: true}), {code: "NAVER_FORMAT"});
  assert.throws(() => P.parseNaver({WORD: {items: [{handleEntry: "test", meansCollector: []}]}}), {code: "NAVER_FORMAT"});
});
test("Google adapter joins translated segments", () => {
  const value = P.parseGoogle([[["안녕하세요. ", "Hello. "], ["좋은 아침입니다.", "Good morning."]], null, "en"]);
  assert.equal(value.translated, "안녕하세요. 좋은 아침입니다.");
  assert.equal(value.detectedLanguage, "en");
  assert.throws(() => P.parseGoogle({error: "rate limit"}), {code: "GOOGLE_FORMAT"});
});
test("HTTP 429 surfaces a specific error", async () => {
  await assert.rejects(P.requestJSON("https://test.invalid", async () => ({ok: false, status: 429})), {code: "HTTP_429"});
});
test("empty bodies and HTML error pages are errors, never successful results", async () => {
  await assert.rejects(P.requestJSON("https://test.invalid", async () => ({ok: true, text: async () => ""})), {code: "EMPTY_RESPONSE"});
  await assert.rejects(P.requestJSON("https://test.invalid", async () => ({ok: true, text: async () => "<html>blocked</html>"})), {code: "INVALID_JSON"});
});
test("network failures surface a user-facing failure", async () => {
  await assert.rejects(P.requestJSON("https://test.invalid", async () => { throw new Error("offline"); }), {code: "NETWORK"});
});
test("Naver lookup uses its fixed host and passes encoded query", async () => {
  let seen;
  const result = await P.lookup("naver", "ice cream", "ko", async (url, options) => {
    seen = {url: new URL(url), options};
    return {ok: true, text: async () => JSON.stringify(naverFixture)};
  });
  assert.equal(seen.url.origin, "https://en.dict.naver.com");
  assert.equal(seen.url.searchParams.get("query"), "ice cream");
  assert.equal(seen.options.credentials, "omit");
  assert.equal(seen.options.redirect, "error");
  assert.equal(result.provider, "naver");
});
test("Google lookup uses its web translation RPC and puts the text and target language in the POST body", async () => {
  let seen, request;
  const raw = fs.readFileSync(path.join(__dirname, "fixtures/google-live-web.txt"), "utf8");
  const result = await P.lookup("google", "A&B?", "ja", async (url, options) => {
    seen = new URL(url); request = options;
    return {ok: true, text: async () => raw};
  });
  assert.equal(seen.origin, "https://translate.google.com");
  assert.equal(seen.pathname, "/_/TranslateWebserverUi/data/batchexecute");
  assert.equal(request.method, "POST");
  const envelope = JSON.parse(new URLSearchParams(request.body).get("f.req"));
  const argument = JSON.parse(envelope[0][0][1]);
  assert.equal(argument[0][0], "A&B?"); assert.equal(argument[0][2], "ja");
  assert.equal(result.translated, "창고가 준비되었습니다.");
});
test("Google web parser reads the recorded successful provider response", () => {
  const raw = fs.readFileSync(path.join(__dirname, "fixtures/google-live-web.txt"), "utf8");
  const result = P.parseGoogleWeb(raw);
  assert.equal(result.translated, "창고가 준비되었습니다."); assert.equal(result.detectedLanguage, "en");
  assert.throws(() => P.parseGoogleWeb('<html>blocked</html>'), {code: "GOOGLE_WEB_FORMAT"});
});
test("Naver parser reads the recorded actual dictionary response", () => {
  const data = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures/naver-live-warehouse.json"), "utf8"));
  const result = P.parseNaver(data);
  assert.equal(result[0].headword, "warehouse"); assert.equal(result[0].meanings[0].value, "창고");
});
test("Naver summary uses exact headwords instead of mistaking suggestions for the selected word", () => {
  const data = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures/naver-summary-live-warehouse.json"), "utf8"));
  const result = P.parseNaverSummary(data, "warehouse");
  assert.equal(result[0].headword, "warehouse"); assert.equal(result[0].meanings[0].value, "창고");
  assert.ok(result.every(entry => entry.headword.toLowerCase() === "warehouse"));
  assert.throws(() => P.parseNaverSummary(data, "ware"), {code: "NO_SUMMARY_ENTRY"});
});
test("an empty Naver detailed response falls back to its inline dictionary summary", async () => {
  const data = fs.readFileSync(path.join(__dirname, "fixtures/naver-summary-live-warehouse.json"), "utf8");
  const urls = [];
  const result = await P.lookup("naver", "warehouse", "ko", async url => {
    urls.push(url);
    return {ok: true, text: async () => url.includes("ac-dict.naver.com") ? data : ""};
  });
  assert.equal(result.summary, true); assert.equal(result.entries[0].meanings[0].value, "창고");
  assert.equal(urls.length, 2); assert.equal(new URL(urls[1]).hostname, "ac-dict.naver.com");
});
test("Google RPC failure uses its alternative data endpoint rather than opening a webpage", async () => {
  const urls = [];
  const result = await P.lookup("google", "A test.", "ko", async url => {
    urls.push(url);
    return url.includes("batchexecute") ? {ok: false, status: 503} : {ok: true, text: async () => JSON.stringify([[["테스트입니다.", "A test."]], null, "en"])};
  });
  assert.equal(result.translated, "테스트입니다."); assert.equal(urls.length, 2);
  assert.equal(new URL(urls[1]).hostname, "translate.googleapis.com");
});

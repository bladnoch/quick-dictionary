"use strict";
const {test} = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const context = vm.createContext({URLSearchParams});
vm.runInContext(fs.readFileSync(path.join(__dirname, "../extension/shared.js"), "utf8"), context);
const C = context.SelectDictCore;

test("automatic routing handles words, contractions, punctuation and sentences", async t => {
  const cases = [
    ["warehouse", "naver", "warehouse"],
    ["Snowflake", "naver", "Snowflake"],
    ["don't", "naver", "don't"],
    ["state-of-the-art", "naver", "state-of-the-art"],
    ["‘warehouse,’", "naver", "warehouse"],
    ["U.S.A.", "naver", "U.S.A"],
    ["  hello\n", "naver", "hello"],
    ["데이터", "naver", "데이터"],
    ["data warehouse", "google", "data warehouse"],
    ["The warehouse is ready.", "google", "The warehouse is ready."],
    ["We\nneed\ta new warehouse.", "google", "We need a new warehouse."],
    ["https://example.com", "google", "https://example.com"],
    ["12345", null, "12345"],
    ["!!!", null, "!!!"],
    ["", null, ""]
  ];
  for (const [text, provider, query] of cases) await t.test(JSON.stringify(text), () => {
    const result = C.classify(text); assert.equal(result.provider, provider); assert.equal(result.query, query);
  });
});
test("phrases opt into dictionary routing; clauses still route to Google", () => {
  const settings = C.sanitizeSettings({phraseWordLimit: 2});
  assert.equal(C.classify("data warehouse", settings).provider, "naver");
  assert.equal(C.classify("I am ready", settings).provider, "google");
  assert.equal(C.classify("hello; world", settings).provider, "google");
});
test("long text is rejected instead of truncated or silently sent", () => {
  assert.equal(C.classify("a".repeat(5001)).kind, "too-long");
  assert.throws(() => C.resolveLookup("a".repeat(5001)), /5,000/);
  assert.throws(() => C.resolveLookup("123"), /선택/);
});
test("provider override and destinations are fixed and encoded", () => {
  assert.equal(C.resolveLookup("data warehouse", "naver").provider, "naver");
  assert.throws(() => C.resolveLookup("hello", "https://attacker.test"), /지원/);
  assert.throws(() => C.providerURL("javascript", "hello"), /지원/);
  const url = new URL(C.providerURL("google", "A&B <test> #한글?", "ko"));
  assert.equal(url.origin, "https://translate.google.com");
  assert.equal(url.searchParams.get("text"), "A&B <test> #한글?");
  assert.equal(url.searchParams.get("tl"), "ko");
  assert.equal(C.providerURL("naver", "ice cream"), "https://en.dict.naver.com/#/search?query=ice%20cream");
});
test("invalid or partial settings fall back to bounded known defaults", () => {
  const value = C.sanitizeSettings({enabled: "false", selectionMode: "evil", autoDelay: -99, phraseWordLimit: 99, targetLanguage: "xx", excludedDomains: ["*.example.com", "example.com", "evil/path", "https://bad.com", "localhost"]});
  assert.equal(value.enabled, true); assert.equal(value.selectionMode, "button"); assert.equal(value.autoDelay, 150);
  assert.equal(value.phraseWordLimit, 1); assert.equal(value.targetLanguage, "ko");
  assert.equal(value.excludedDomains.join(","), "example.com,localhost");
});
test("v1.0.0 automatic navigation preferences are disabled on read", () => {
  const value = C.sanitizeSettings({presentation: "window", fallbackToWindow: true});
  assert.equal(value.presentation, "inline");
  assert.equal(value.fallbackToWindow, false);
});
test("editor selections are enabled for both new and legacy installations", () => {
  assert.equal(C.sanitizeSettings().ignoreEditable, false);
  const migrated = C.sanitizeSettings({ignoreEditable: true, selectionMode: "auto", targetLanguage: "ja"});
  assert.equal(migrated.ignoreEditable, false);
  assert.equal(migrated.settingsVersion, 2);
  assert.equal(migrated.selectionMode, "auto");
  assert.equal(migrated.targetLanguage, "ja");
});
test("an editor opt-out chosen after migration is preserved on every read", () => {
  const value = C.sanitizeSettings({settingsVersion: 2, ignoreEditable: true});
  assert.equal(value.ignoreEditable, true);
  assert.equal(C.sanitizeSettings(value).ignoreEditable, true);
});
test("domain exclusions do not match lookalike suffix domains", () => {
  assert.equal(C.isExcluded("mail.example.com", ["example.com"]), true);
  assert.equal(C.isExcluded("example.com", ["example.com"]), true);
  assert.equal(C.isExcluded("notexample.com", ["example.com"]), false);
  assert.equal(C.isExcluded("example.com.evil.test", ["example.com"]), false);
});
test("remote markup becomes text; invalid code points do not crash", () => {
  assert.equal(C.cleanMarkup("<b>hello</b> &amp; &#xD55C;&#44544; &quot;x&quot;"), 'hello & 한글 "x"');
  assert.equal(C.cleanMarkup("&#999999999;"), "");
});

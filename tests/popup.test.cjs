"use strict";
const {test} = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"), vm = require("node:vm"), path = require("node:path");
async function harness(fail = false) {
  const ids = ["enabled", "targetLanguage", "autoDelay", "phraseWordLimit", "ignoreEditable", "excludedDomains", "delay-value", "site-control", "site-name", "site-toggle", "manual-text", "manual-lookup", "manual-result", "manual-open", "save-state", "settings-form", "connection-check", "connection-status"];
  const elements = Object.fromEntries(ids.map(id => [id, {id, value: "", checked: false, hidden: false, textContent: "", style: {}, attributes: {}, setAttribute(key, value) {this.attributes[key] = value;}, addEventListener() {}}]));
  const radios = {button: {value: "button", checked: false}, auto: {value: "auto", checked: false}};
  const document = {getElementById: id => elements[id], body: {classList: {toggle() {}}}, querySelector: selector => selector.includes(":checked") ? Object.values(radios).find(radio => radio.checked) : radios[selector.includes('value="auto"') ? "auto" : "button"]};
  const messages = [];
  const chrome = {storage: {local: {get: async () => ({settings: {presentation: "window", fallbackToWindow: true}}), set: async () => {}}}, tabs: {query: async () => [{url: "https://example.com"}]}, runtime: {id: "extension-id", sendMessage: async message => {
    messages.push(message);
    if (fail) return {ok: false, code: "HTTP_429", message: "요청 제한"};
    if (message.type === "PING") return {ok: true, version: "1.1.3"};
    if (message.text.includes(" ")) return {ok: true, result: {provider: "google", translated: "테스트 문장입니다."}};
    return {ok: true, result: {provider: "naver", entries: [{headword: "warehouse", meanings: [{partOfSpeech: "명사", value: "창고"}]}]}};
  }}};
  const context = vm.createContext({chrome, document, URL, URLSearchParams, setTimeout});
  for (const file of ["shared.js", "messaging.js", "popup.js"]) vm.runInContext(fs.readFileSync(path.join(__dirname, "../extension", file), "utf8"), context);
  await new Promise(setImmediate);
  return {context, elements, messages};
}
test("settings search displays a word's dictionary result in the popup without navigating", async () => {
  const h = await harness(); h.elements["manual-text"].value = "warehouse";
  await h.context.manualLookup();
  assert.equal(h.messages[0].type, "LOOKUP");
  assert.match(h.elements["manual-result"].textContent, /창고/);
  assert.equal(h.messages.filter(message => message.type === "OPEN_PROVIDER").length, 0);
});
test("settings search displays a sentence translation in the popup", async () => {
  const h = await harness(); h.elements["manual-text"].value = "A test sentence.";
  await h.context.manualLookup();
  assert.equal(h.messages[0].type, "LOOKUP");
  assert.equal(h.elements["manual-result"].textContent, "테스트 문장입니다.");
});
test("a failed settings search displays the error and never requests automatic navigation", async () => {
  const h = await harness(true); h.elements["manual-text"].value = "A test sentence.";
  await h.context.manualLookup();
  assert.match(h.elements["manual-result"].textContent, /요청 제한/);
  assert.match(h.elements["save-state"].textContent, /새 창은 자동으로 열지 않습니다/);
  assert.equal(h.messages.length, 1); assert.equal(h.messages[0].type, "LOOKUP");
});
test("the editor opt-out can be saved explicitly after legacy settings are migrated", async () => {
  const h = await harness();
  assert.equal(h.elements.ignoreEditable.checked, false);
  h.elements.ignoreEditable.checked = true;
  const settings = h.context.readForm();
  assert.equal(settings.settingsVersion, 2); assert.equal(settings.ignoreEditable, true);
});

test("connection check reports the installed version without a dictionary lookup", async () => {
  const h = await harness(); await h.context.checkConnection();
  assert.equal(h.messages.length, 1); assert.equal(h.messages[0].type, "PING");
  assert.match(h.elements["connection-status"].textContent, /연결 정상.*1\.1\.3/);
  assert.equal(h.elements["connection-check"].disabled, false);
});

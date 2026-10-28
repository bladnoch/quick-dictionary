"use strict";
const {test} = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const base = path.join(__dirname, "../extension");
function harness(config = {}) {
  const local = {settings: config}, session = {}, opened = [], changed = [], windows = new Map();
  const messages = [], menus = [], listeners = {}, rules = [];
  let calls = 0, failCode = "";
  const event = name => ({addListener(fn) {listeners[name] = fn;}});
  const chrome = {
    storage: {
      local: {get: async key => ({[key]: local[key]}), set: async value => Object.assign(local, value)},
      session: {get: async key => ({[key]: session[key]}), set: async value => Object.assign(session, value)}
    },
    runtime: {id: "extension-id", getManifest: () => ({version: "1.1.3"}), onMessage: event("message"), onInstalled: event("installed"), openOptionsPage: async () => {}},
    declarativeNetRequest: {updateDynamicRules: async rule => {rules.push(rule);}},
    windows: {
      get: async id => {if (!windows.has(id)) throw new Error("closed"); return windows.get(id);},
      create: async options => {const win = {id: opened.length + 11, type: options.type, incognito: options.incognito, tabs: [{id: opened.length + 100}]}; windows.set(win.id, win); opened.push(options); return win;},
      update: async (id, options) => changed.push({id, ...options})
    },
    tabs: {update: async (id, options) => changed.push({id, ...options}), create: async options => opened.push(options), query: async () => [{id: 1}], sendMessage: async (...args) => {messages.push(args); return {handled: true};}},
    contextMenus: {removeAll: async () => {}, create: value => menus.push(value), onClicked: event("context")},
    commands: {onCommand: event("command")}
  };
  const sandbox = {chrome, URLSearchParams, URL, AbortController, setTimeout, clearTimeout, fetch, console};
  const context = vm.createContext(sandbox);
  sandbox.importScripts = (...files) => {
    for (const file of files) vm.runInContext(fs.readFileSync(path.join(base, file), "utf8"), context);
    if (context.SelectDictProviders) context.SelectDictProviders = {...context.SelectDictProviders, lookup: async (provider, query, language) => {
      calls++;
      if (failCode) throw Object.assign(new Error("Provider unavailable"), {code: failCode});
      return {provider, query, translated: query + " [" + language + "]"};
    }};
  };
  vm.runInContext(fs.readFileSync(path.join(base, "background.js"), "utf8"), context);
  return {context, chrome, local, session, opened, changed, windows, menus, messages, listeners, rules,
    calls: () => calls, fail: code => {failCode = code;},
    request: message => context.dispatch(message, {id: "extension-id", tab: {id: 1}})};
}
test("worker settings request never calls a remote provider", async () => {
  const h = harness(); const response = await h.request({type: "GET_SETTINGS"});
  assert.equal(response.ok, true); assert.equal(response.settings.selectionMode, "button"); assert.equal(h.calls(), 0);
});
test("worker routes and caches identical successful requests", async () => {
  const h = harness();
  const a = await h.request({type: "LOOKUP", text: "warehouse"});
  const b = await h.request({type: "LOOKUP", text: "warehouse"});
  assert.equal(a.result.provider, "naver"); assert.equal(b.ok, true); assert.equal(h.calls(), 1);
  const c = await h.request({type: "LOOKUP", text: "I like this warehouse."});
  assert.equal(c.result.provider, "google"); assert.equal(h.calls(), 2);
});
test("worker lookup errors never request automatic navigation even with old fallback settings", async () => {
  const h = harness({presentation: "window", fallbackToWindow: true}); h.fail("HTTP_429");
  const response = await h.request({type: "LOOKUP", text: "Hello world."});
  assert.equal(response.ok, false); assert.equal(response.canFallback, false); assert.equal(h.opened.length, 0);
});
test("dictionary no-match does not automatically open a fallback window", async () => {
  const h = harness(); h.fail("NO_ENTRY");
  const response = await h.request({type: "LOOKUP", text: "zzword"});
  assert.equal(response.canFallback, false);
});
test("old window-mode settings migrate to inline lookup and cannot open a window", async () => {
  const h = harness({presentation: "window"});
  const response = await h.request({type: "LOOKUP", text: "warehouse"});
  assert.equal(response.result.provider, "naver"); assert.equal(h.calls(), 1);
  assert.equal(h.opened.length, 0);
});
test("Naver referrer rule applies only to this extension's dictionary XHR requests", async () => {
  const h = harness(); await h.request({type: "LOOKUP", text: "warehouse"});
  assert.equal(h.rules.length, 1);
  const rule = h.rules[0].addRules[0];
  assert.equal(rule.condition.initiatorDomains[0], "extension-id");
  assert.equal(rule.condition.requestDomains[0], "en.dict.naver.com");
  assert.equal(rule.condition.resourceTypes.join(","), "xmlhttprequest");
  assert.equal(rule.action.requestHeaders[0].value, "https://en.dict.naver.com/");
  assert.equal(rule.action.requestHeaders[1].header, "origin");
  assert.equal(rule.action.requestHeaders[1].operation, "remove");
  assert.equal(h.rules[0].addRules[1].condition.requestDomains[0], "ac-dict.naver.com");
  assert.equal(rule.action.responseHeaders, undefined);
});
test("rapid requests reuse a single provider popup", async () => {
  const h = harness();
  await Promise.all([h.request({type: "OPEN_PROVIDER", text: "first"}), h.request({type: "OPEN_PROVIDER", text: "second"})]);
  assert.equal(h.opened.length, 1); assert.ok(h.changed.some(change => change.url?.includes("second")));
});
test("a closed provider window is recreated", async () => {
  const h = harness();
  await h.request({type: "OPEN_PROVIDER", text: "first"}); h.windows.clear();
  await h.request({type: "OPEN_PROVIDER", text: "second"});
  assert.equal(h.opened.length, 2);
});
test("invalid providers and overlong messages are rejected before any network request", async () => {
  const h = harness();
  await assert.rejects(h.request({type: "LOOKUP", text: "hello", provider: "https://evil.test"}), /지원/);
  await assert.rejects(h.request({type: "LOOKUP", text: "x".repeat(5001)}), /5,000/);
  assert.equal(h.calls(), 0); assert.equal(h.opened.length, 0);
});
test("messages from other extension IDs are ignored", () => {
  const h = harness(); let replied = false;
  const result = h.listeners.message({type: "LOOKUP", text: "hello"}, {id: "untrusted-extension"}, () => {replied = true;});
  assert.equal(result, false); assert.equal(replied, false);
});
test("installation registers three selection context menus", async () => {
  const h = harness(); await h.listeners.installed();
  assert.equal(h.menus.length, 3); assert.ok(h.menus.every(menu => menu.contexts[0] === "selection"));
  assert.equal(h.local.settings.targetLanguage, "ko");
});
test("context menu dispatch targets the selected iframe", async () => {
  const h = harness();
  await h.listeners.context({menuItemId: "select-dict-naver", selectionText: "warehouse", frameId: 7}, {id: 22});
  assert.equal(h.messages[0][0], 22); assert.equal(h.messages[0][1].provider, "naver"); assert.equal(h.messages[0][2].frameId, 7);
});

test("connection diagnostics work even when settings storage is unavailable", async () => {
  const h = harness(); h.chrome.storage.local.get = async () => {throw new Error("storage failed");};
  const response = await h.request({type: "PING"});
  assert.equal(response.ok, true); assert.equal(response.version, "1.1.3"); assert.equal(h.calls(), 0);
});
test("worker exceptions return structured diagnostics while keeping the async message channel open", async () => {
  const h = harness(); h.chrome.storage.local.get = async () => {throw new Error("storage failed");};
  const response = await new Promise(resolve => {
    const keepOpen = h.listeners.message({type: "GET_SETTINGS"}, {id: "extension-id"}, resolve);
    assert.equal(keepOpen, true);
  });
  assert.equal(response.ok, false); assert.equal(response.code, "WORKER_ERROR"); assert.equal(response.message, "storage failed");
});

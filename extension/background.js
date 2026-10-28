"use strict";
importScripts("shared.js", "providers.js");
const Core = SelectDictCore;
const cache = new Map();
const inflight = new Map();
const CACHE_TTL = 10 * 60 * 1000;
let windowQueue = Promise.resolve();
// Naver's dictionary rejects the extension Origin or a missing service referrer.
// These rules affect only this extension's two read-only dictionary APIs, never page traffic.
const providerSetup = (async () => {
  if (!chrome.declarativeNetRequest?.updateDynamicRules) return;
  try {
    await chrome.declarativeNetRequest.updateDynamicRules({removeRuleIds: [101, 102], addRules: [{
      id: 101, priority: 1,
      action: {type: "modifyHeaders", requestHeaders: [{header: "referer", operation: "set", value: "https://en.dict.naver.com/"}, {header: "origin", operation: "remove"}]},
      condition: {requestDomains: ["en.dict.naver.com"], initiatorDomains: [chrome.runtime.id], urlFilter: "/api3/enko/search", resourceTypes: ["xmlhttprequest"]}
    }, {
      id: 102, priority: 1,
      action: {type: "modifyHeaders", requestHeaders: [{header: "origin", operation: "remove"}]},
      condition: {requestDomains: ["ac-dict.naver.com"], initiatorDomains: [chrome.runtime.id], urlFilter: "/enko/ac", resourceTypes: ["xmlhttprequest"]}
    }]});
  } catch { /* The Naver summary adapter remains available if policy disallows the rule. */ }
})();

async function settings() {
  const value = await chrome.storage.local.get("settings");
  return Core.sanitizeSettings(value.settings);
}
async function cachedLookup(provider, query, language) {
  const key = JSON.stringify([provider, query, language]);
  const entry = cache.get(key);
  if (entry && Date.now() - entry.time < CACHE_TTL) return entry.result;
  if (inflight.has(key)) return inflight.get(key);
  const promise = SelectDictProviders.lookup(provider, query, language);
  inflight.set(key, promise);
  try {
    const result = await promise;
    cache.set(key, {time: Date.now(), result});
    if (cache.size > 128) cache.delete(cache.keys().next().value);
    return result;
  } finally { inflight.delete(key); }
}
function openProviderWindow(url, incognito = false) {
  // Serialize mutations so rapid selections cannot create a storm of windows.
  const previous = windowQueue;
  const work = (async () => {
    try { await previous; } catch { /* A failed explicit open does not block the next one. */ }
    const key = incognito ? "providerWindowPrivate" : "providerWindow";
    const state = await chrome.storage.session.get(key);
    if (Number.isInteger(state[key])) {
      try {
        const existing = await chrome.windows.get(state[key], {populate: true});
        if (existing.type === "popup" && existing.tabs?.length === 1 && Boolean(existing.incognito) === incognito) {
          await chrome.tabs.update(existing.tabs[0].id, {url, active: true});
          await chrome.windows.update(existing.id, {focused: true});
          return;
        }
      } catch { /* A closed window is recreated. */ }
    }
    const created = await chrome.windows.create({url, type: "popup", width: 540, height: 720, focused: true, incognito});
    if (Number.isInteger(created?.id)) await chrome.storage.session.set({[key]: created.id});
  })();
  windowQueue = work;
  return work;
}
async function dispatch(message, sender) {
  if (message.type === "PING") return {ok: true, version: chrome.runtime.getManifest().version};
  const config = await settings();
  if (message.type === "GET_SETTINGS") return {ok: true, settings: config};
  if (message.type === "OPEN_SETTINGS") { await chrome.runtime.openOptionsPage(); return {ok: true}; }
  if (!["LOOKUP", "OPEN_PROVIDER"].includes(message.type)) throw new Error("알 수 없는 요청입니다.");
  // Never accept arbitrary destination URLs from a page or content script.
  const route = Core.resolveLookup(message.text, message.provider, config);
  const url = Core.providerURL(route.provider, route.query, config.targetLanguage);
  // Navigation is permitted only by the explicit "open site"/"small window" action.
  if (message.type === "OPEN_PROVIDER") {
    if (message.newTab === true) await chrome.tabs.create({url, active: true});
    else await openProviderWindow(url, Boolean(sender.tab?.incognito));
    return {ok: true, openedWindow: true, provider: route.provider, query: route.query, url};
  }
  await providerSetup;
  try {
    return {ok: true, result: await cachedLookup(route.provider, route.query, config.targetLanguage), url};
  } catch (error) {
    return {ok: false, code: error.code || "LOOKUP_FAILED", message: error.message || "결과를 불러오지 못했습니다.", provider: route.provider, query: route.query, url, canFallback: false};
  }
}
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || !message || typeof message.type !== "string") return false;
  (async () => {
    try { sendResponse(await dispatch(message, sender)); }
    catch (error) { sendResponse({ok: false, code: "WORKER_ERROR", message: error.message || "요청을 처리하지 못했습니다."}); }
  })();
  return true;
});
async function createMenus() {
  await chrome.contextMenus.removeAll();
  for (const [id, title] of [["select-dict-auto", "선택 사전: 자동 분기"], ["select-dict-naver", "네이버 영어사전에서 찾기"], ["select-dict-google", "Google 번역으로 번역하기"]]) {
    chrome.contextMenus.create({id, title, contexts: ["selection"]});
  }
}
chrome.runtime.onInstalled.addListener(async () => {
  await chrome.storage.local.set({settings: await settings()});
  await createMenus();
});
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!info.menuItemId.startsWith("select-dict-") || !info.selectionText) return;
  const provider = info.menuItemId === "select-dict-auto" ? null : info.menuItemId.endsWith("naver") ? "naver" : "google";
  try {
    if (!Number.isInteger(tab?.id)) throw new Error("No tab");
    const response = await chrome.tabs.sendMessage(tab.id, {type: "SHOW_LOOKUP", text: info.selectionText, provider}, {frameId: info.frameId || 0});
    if (!response?.handled) throw new Error("No content script");
  } catch {
    try { await dispatch({type: "OPEN_PROVIDER", text: info.selectionText, provider}, {tab}); } catch { /* Invalid selections are ignored. */ }
  }
});
chrome.commands.onCommand.addListener(async command => {
  if (command !== "lookup-selection") return;
  try {
    const [tab] = await chrome.tabs.query({active: true, currentWindow: true});
    if (Number.isInteger(tab?.id)) await chrome.tabs.sendMessage(tab.id, {type: "LOOKUP_SELECTION"});
  } catch { /* Chrome internal pages do not allow content scripts. */ }
});

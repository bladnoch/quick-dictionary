"use strict";
const Core = SelectDictCore;
const connection = SelectDictMessaging.createClient();
const $ = id => document.getElementById(id);
let config = Core.sanitizeSettings();
let activeHost = "";
let loaded = false;
let manualRequest = 0;
function status(message, error = false) { $("save-state").textContent = message; $("save-state").style.color = error ? "#a04425" : ""; }
function readForm() {
  const domains = $("excludedDomains").value.split(/\r?\n/).map(value => value.trim()).filter(Boolean);
  const bad = domains.find(value => !Core.validDomain(value));
  if (bad) throw new Error("도메인만 입력해 주세요: " + bad.slice(0, 50));
  return Core.sanitizeSettings({
    settingsVersion: Core.DEFAULTS.settingsVersion,
    enabled: $("enabled").checked,
    selectionMode: document.querySelector('input[name="selectionMode"]:checked')?.value,
    presentation: "inline",
    targetLanguage: $("targetLanguage").value,
    autoDelay: Number($("autoDelay").value),
    phraseWordLimit: Number($("phraseWordLimit").value),
    ignoreEditable: $("ignoreEditable").checked,
    fallbackToWindow: false,
    excludedDomains: domains
  });
}
function render() {
  $("enabled").checked = config.enabled;
  document.body.classList.toggle("paused", !config.enabled);
  document.querySelector('input[name="selectionMode"][value="' + config.selectionMode + '"]').checked = true;
  for (const key of ["targetLanguage", "autoDelay", "phraseWordLimit"]) $(key).value = config[key];
  $("ignoreEditable").checked = config.ignoreEditable;
  $("excludedDomains").value = config.excludedDomains.join("\n");
  $("delay-value").textContent = config.autoDelay + "ms";
  renderSite();
}
function renderSite() {
  if (!activeHost) return;
  $("site-control").hidden = false;
  $("site-name").textContent = activeHost;
  const excluded = Core.isExcluded(activeHost, config.excludedDomains);
  $("site-toggle").textContent = excluded ? "이 사이트에서 사용" : "이 사이트 제외";
}
async function save() {
  if (!loaded) return false;
  try {
    config = readForm();
    await chrome.storage.local.set({settings: config});
    document.body.classList.toggle("paused", !config.enabled);
    renderSite(); status("저장됨 · 열려 있는 페이지에도 적용됩니다."); return true;
  } catch (error) { status(error.message || "설정을 저장하지 못했습니다.", true); return false; }
}
$("settings-form").addEventListener("submit", event => { event.preventDefault(); save(); });
$("settings-form").addEventListener("change", event => { if (event.target.id !== "manual-text") save(); });
$("autoDelay").addEventListener("input", () => { $("delay-value").textContent = $("autoDelay").value + "ms"; });
$("site-toggle").addEventListener("click", async () => {
  if (!loaded || !activeHost) return;
  try {
    const value = readForm();
    if (Core.isExcluded(activeHost, value.excludedDomains)) {
      value.excludedDomains = value.excludedDomains.filter(domain => !(activeHost === domain || activeHost.endsWith("." + domain)));
    } else value.excludedDomains.push(activeHost);
    config = Core.sanitizeSettings(value);
    await chrome.storage.local.set({settings: config}); render(); status("사이트 설정을 저장했습니다.");
  } catch (error) { status(error.message, true); }
});
async function manualLookup() {
  if (!await save()) return;
  const text = $("manual-text").value;
  const route = Core.classify(text, config);
  if (!route.provider) { status(route.kind === "too-long" ? "5,000자 이하로 입력해 주세요." : "단어나 문장을 입력해 주세요.", true); return; }
  const request = ++manualRequest;
  $("manual-result").hidden = false;
  $("manual-result").setAttribute("aria-busy", "true");
  $("manual-result").textContent = "결과를 불러오는 중…";
  $("manual-open").hidden = true;
  try {
    const response = await connection.send({type: "LOOKUP", text});
    if (request !== manualRequest) return;
    $("manual-result").setAttribute("aria-busy", "false");
    if (response?.ok && response.result) {
      const result = response.result;
      $("manual-result").textContent = result.provider === "naver" ? result.entries.map(entry => entry.headword + "\n" + entry.meanings.map(mean => (mean.partOfSpeech ? "[" + mean.partOfSpeech + "] " : "") + mean.value).join("\n")).join("\n\n") : result.translated;
      status("조회 결과를 표시했습니다.");
    } else {
      $("manual-result").textContent = (response?.message || "결과를 불러오지 못했습니다.") + (response?.code ? "\n오류: " + response.code : "") + (response?.detail ? "\n" + response.detail : "");
      status("조회에 실패했습니다. 새 창은 자동으로 열지 않습니다.", true);
    }
    $("manual-open").href = Core.providerURL(route.provider, text, config.targetLanguage);
    $("manual-open").hidden = false;
  } catch {
    if (request !== manualRequest) return;
    $("manual-result").setAttribute("aria-busy", "false");
    $("manual-result").textContent = "확장 프로그램을 다시 로드해 주세요.";
    status("확장 프로그램을 다시 로드해 주세요.", true);
  }
}
$("manual-lookup").addEventListener("click", manualLookup);
$("manual-text").addEventListener("keydown", event => { if (event.key === "Enter") { event.preventDefault(); manualLookup(); } });
async function checkConnection() {
  const output = $("connection-status"), control = $("connection-check");
  output.hidden = false; output.textContent = "확장 연결 확인 중…"; control.disabled = true;
  try {
    const response = await connection.send({type: "PING"});
    output.textContent = response.ok
      ? "확장 연결 정상 · 설치 버전 " + response.version + ". 기존 웹페이지에서 오류가 계속되면 그 페이지를 새로고침해 주세요."
      : response.message + "\n오류: " + response.code + (response.detail ? "\n" + response.detail : "");
  } finally { control.disabled = false; }
}
$("connection-check").addEventListener("click", checkConnection);
(async function initialize() {
  try {
    const value = await chrome.storage.local.get("settings");
    config = Core.sanitizeSettings(value.settings); render(); loaded = true;
    status(config.enabled ? "드래그 조회가 켜져 있습니다." : "드래그 조회가 일시 중지되었습니다.");
    try {
      const [tab] = await chrome.tabs.query({active: true, currentWindow: true});
      const url = new URL(tab?.url || "");
      if (["http:", "https:"].includes(url.protocol)) activeHost = url.hostname;
      renderSite();
    } catch { /* URL is unavailable outside an action click. */ }
  } catch { status("설정을 불러오지 못했습니다. 다시 열어 주세요.", true); }
})();

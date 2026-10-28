"use strict";
const {test} = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), vm = require("node:vm"), path = require("node:path");
const context = vm.createContext({setTimeout});
vm.runInContext(fs.readFileSync(path.join(__dirname, "../extension/messaging.js"), "utf8"), context);
const M = context.SelectDictMessaging;
function harness(handler, id = "extension-id") {
  let calls = 0, waits = 0;
  const runtime = {id, sendMessage: async message => {calls++; return handler(message, calls);}};
  const client = M.createClient({getRuntime: () => runtime, delay: async () => {waits++;}});
  return {client, runtime, calls: () => calls, waits: () => waits};
}
test("a provider failure is returned unchanged without retrying the service", async () => {
  const error = {ok: false, code: "HTTP_429", message: "rate limited"};
  const h = harness(() => error); assert.equal(await h.client.send({type: "LOOKUP"}), error);
  assert.equal(h.calls(), 1); assert.equal(h.waits(), 0);
});
test("a missing runtime ID requires a page reload without attempting a message", async () => {
  const h = harness(() => assert.fail("must not send"), "");
  const result = await h.client.send({type: "LOOKUP"});
  assert.equal(result.code, "CONTEXT_INVALIDATED"); assert.equal(result.reloadRequired, true); assert.equal(h.calls(), 0);
});
test("an invalidated context exception is not retried even if the stale object has an ID", async () => {
  const h = harness(() => {throw new Error("Extension context invalidated.");});
  const result = await h.client.send({type: "LOOKUP"});
  assert.equal(result.code, "CONTEXT_INVALIDATED"); assert.equal(h.calls(), 1); assert.equal(h.waits(), 0);
});
test("a temporarily absent receiver is retried once and may recover", async () => {
  const h = harness((_message, n) => {if (n === 1) throw new Error("Could not establish connection. Receiving end does not exist."); return {ok: true, result: {translated: "recovered"}};});
  const result = await h.client.send({type: "LOOKUP"});
  assert.equal(result.ok, true); assert.equal(result.result.translated, "recovered"); assert.equal(h.calls(), 2);
});
test("a persistently closed message channel returns its original detail after one retry", async () => {
  const text = "The message port closed before a response was received.";
  const h = harness(() => {throw new Error(text);});
  const result = await h.client.send({type: "GET_SETTINGS"});
  assert.equal(result.code, "CHANNEL_CLOSED"); assert.equal(result.detail, text); assert.equal(result.reloadRequired, false);
  assert.equal(h.calls(), 2); assert.equal(h.waits(), 1);
});
test("an empty response is diagnosed separately and is retried at most once", async () => {
  const h = harness(() => undefined), result = await h.client.send({type: "PING"});
  assert.equal(result.code, "EMPTY_RESPONSE"); assert.equal(h.calls(), 2);
});
test("explicit navigation cannot be duplicated by a transport retry", async () => {
  const h = harness(() => {throw new Error("Could not establish connection. Receiving end does not exist.");});
  const result = await h.client.send({type: "OPEN_PROVIDER"});
  assert.equal(result.code, "NO_RECEIVER"); assert.equal(h.calls(), 1); assert.equal(h.waits(), 0);
});
test("unrecognized exceptions retain their real cause rather than claiming an expired context", async () => {
  const h = harness(() => {throw new Error("Unexpected listener failure");});
  const result = await h.client.send({type: "LOOKUP"});
  assert.equal(result.code, "MESSAGE_REJECTED"); assert.equal(result.detail, "Unexpected listener failure");
  assert.equal(result.reloadRequired, false); assert.equal(h.calls(), 1);
});
test("an extension removed during retry is reported as expired without a second send", async () => {
  const h = harness(() => {h.runtime.id = undefined; throw new Error("message port closed");});
  const result = await h.client.send({type: "LOOKUP"});
  assert.equal(result.code, "CONTEXT_INVALIDATED"); assert.equal(h.calls(), 1);
});

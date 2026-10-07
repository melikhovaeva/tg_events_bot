import test from 'node:test';
import assert from 'node:assert/strict';
import { sendMediaMessage } from '../src/services/media-message.js';

const photo = { stored_name: 'test.jpg', original_name: 'test.jpg' };
function apiStub() {
  const calls = [];
  return { calls, api: Object.fromEntries(['sendPhoto', 'sendMediaGroup', 'sendMessage'].map((name) => [name, async (...args) => calls.push({ name, args })])) };
}
test('one image keeps formatted text and invitation buttons on the same message', async () => {
  const { calls, api } = apiStub();
  const keyboard = { inline_keyboard: [] };
  await sendMediaMessage(api, '1', '<b>Hello</b>', [photo], keyboard);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, 'sendPhoto');
  assert.equal(calls[0].args[2].caption, '<b>Hello</b>');
  assert.equal(calls[0].args[2].reply_markup, keyboard);
});
test('album puts text on first image without repeating it', async () => {
  const { calls, api } = apiStub();
  await sendMediaMessage(api, '1', 'Hello', [photo, photo]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].args[1][0].caption, 'Hello');
  assert.equal(calls[0].args[1][1].caption, undefined);
});
test('long text is preserved separately when it exceeds Telegram caption limit', async () => {
  const { calls, api } = apiStub();
  await sendMediaMessage(api, '1', 'x'.repeat(1025), [photo]);
  assert.deepEqual(calls.map((call) => call.name), ['sendPhoto', 'sendMessage']);
});

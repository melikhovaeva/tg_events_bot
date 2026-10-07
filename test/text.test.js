import assert from 'node:assert/strict';
import test from 'node:test';
import { richTextHtml, telegramHtml } from '../src/lib/text.js';

test('rich text keeps supported formatting and removes unsafe markup', () => {
  const html = richTextHtml('<p>Текст <strong>важный</strong><script>alert(1)</script><a href="javascript:alert(1)">ссылка</a></p>');

  assert.match(html, /<b>важный<\/b>/);
  assert.doesNotMatch(html, /<script|<a href=/i);
});

test('Telegram conversion preserves paragraphs and supported links', () => {
  const text = telegramHtml('<p>Первая строка</p><p><a href="https://perasperadastra.ru">Вторая</a></p>');

  assert.match(text, /Первая строка\n\n<a href="https:\/\/perasperadastra.ru">Вторая<\/a>/);
});

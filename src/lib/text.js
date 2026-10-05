import crypto from 'node:crypto';

export const nowIso = () => new Date().toISOString();
export const token = () => crypto.randomBytes(18).toString('base64url');
export const esc = (value = '') => String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));

export const defaultText = {
  received: 'Ваша регистрация принята. Ожидайте ответа — мы пришлём решение в этот бот.',
  invite: 'Мы будем рады видеть вас на мероприятии «{event}»!\n\nПодтвердите участие в течение 24 часов, пожалуйста.',
  confirmed: 'Участие подтверждено — место закреплено за вами. За сутки до мероприятия придёт напоминание.',
  declined: 'Спасибо, что сообщили. Мы будем рады видеть вас на следующих мероприятиях!',
  expired: 'К сожалению, мы не дождались вашего ответа и освобождаем место. Будем рады видеть вас на следующих мероприятиях!',
  reminder: 'Напоминаем: «{event}» уже завтра. Ждём вас!',
};

function decodeEditorEntities(value) {
  const entities = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", '#x27': "'", nbsp: ' ', '#160': ' ' };
  let decoded = String(value);
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const next = decoded.replace(/&(amp|lt|gt|quot|#39|#x27|nbsp|#160);/gi, (_, name) => entities[name.toLowerCase()] || _);
    if (next === decoded) break;
    decoded = next;
  }
  return decoded;
}

export const telegramHtml = (value = '') => {
  // Old pasted content may have been entity-escaped several times. Restore it
  // before reducing it to the small, safe HTML subset supported by Telegram.
  const valueWithDecodedTags = decodeEditorEntities(value);
  return valueWithDecodedTags
  .replace(/<br\s*\/?\s*>/gi, '\n')
  .replace(/\r\n|\r/g, '\n')
  .split(/(<[^>]*>)/g)
  .map((part) => {
    if (/^<(h[1-6])(?:\s[^>]*)?>$/i.test(part)) return '\n<b>';
    if (/^<\/(h[1-6])>$/i.test(part)) return '</b>\n';
    if (/^<\/?(div|p)(?:\s[^>]*)?>$/i.test(part)) return '\n';
    if (/^<\/(b|strong)>$/i.test(part)) return '</b>';
    if (/^<\/(i|em)>$/i.test(part)) return '</i>';
    if (/^<\/u>$/i.test(part)) return '</u>';
    if (/^<\/(s|strike|del)>$/i.test(part)) return '</s>';
    if (/^<\/(a)>$/i.test(part)) return '</a>';
    if (/^<(b|strong)(?:\s[^>]*)?>$/i.test(part)) return '<b>';
    if (/^<(i|em)(?:\s[^>]*)?>$/i.test(part)) return '<i>';
    if (/^<u(?:\s[^>]*)?>$/i.test(part)) return '<u>';
    if (/^<(s|strike|del)(?:\s[^>]*)?>$/i.test(part)) return '<s>';
    const link = part.match(/^<a\s+[^>]*href=["'](https?:\/\/[^"'<>\s]+|tg:\/\/[^"'<>\s]+)["'][^>]*>$/i);
    return link ? `<a href="${esc(link[1])}">` : esc(part);
  }).join('')
  .replace(/\n{3,}/g, '\n\n');
};

export const eventText = (event, key) => telegramHtml((event[`${key}_text`] || defaultText[key]).replaceAll('{event}', event.title));
export const messageOptions = (options) => ({ parse_mode: 'HTML', ...options });

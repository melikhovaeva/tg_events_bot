import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import express from 'express';
import multer from 'multer';
import QRCode from 'qrcode';
import { Bot, InlineKeyboard, Keyboard, InputFile } from 'grammy';
import { agreementUrl, policyUrl, validateConfig } from './lib/config.js';
import { dbPath, ensureDataDirectories, uploadsDir } from './lib/paths.js';
import { defaultText, esc, eventText, messageOptions, nowIso, telegramHtml, token } from './lib/text.js';

validateConfig();

ensureDataDirectories();
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.exec(`
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY, title TEXT NOT NULL, starts_at TEXT NOT NULL,
  description TEXT, venue TEXT, chat_url TEXT, cover_stored_name TEXT, cover_original_name TEXT, registration_text TEXT, received_text TEXT,
  invite_text TEXT, expired_text TEXT, confirmed_text TEXT, declined_text TEXT, reminder_text TEXT,
  registration_open INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS applicants (
  id INTEGER PRIMARY KEY, event_id INTEGER NOT NULL REFERENCES events(id),
  name TEXT NOT NULL, email TEXT, phone TEXT, timepad_id TEXT,
  claim_token TEXT NOT NULL UNIQUE, telegram_id TEXT, telegram_name TEXT,
  status TEXT NOT NULL DEFAULT 'awaiting_review', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS invitations (
  id INTEGER PRIMARY KEY, applicant_id INTEGER NOT NULL UNIQUE REFERENCES applicants(id),
  status TEXT NOT NULL DEFAULT 'pending', expires_at TEXT NOT NULL,
  responded_at TEXT, reminder_sent_at TEXT, checkin_token TEXT UNIQUE,
  final_confirmed_at TEXT,
  checked_in_at TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS invitation_attempts (
  id INTEGER PRIMARY KEY, applicant_id INTEGER NOT NULL REFERENCES applicants(id), invitation_id INTEGER NOT NULL REFERENCES invitations(id),
  status TEXT NOT NULL DEFAULT 'pending', sent_at TEXT NOT NULL, expires_at TEXT NOT NULL, responded_at TEXT
);
CREATE TABLE IF NOT EXISTS application_drafts (
  telegram_id TEXT NOT NULL, event_id INTEGER NOT NULL REFERENCES events(id),
  stage TEXT NOT NULL, name TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (telegram_id, event_id)
);
CREATE TABLE IF NOT EXISTS telegram_profiles (
  telegram_id TEXT PRIMARY KEY, name TEXT NOT NULL, phone TEXT NOT NULL,
  telegram_name TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS profile_drafts (
  telegram_id TEXT PRIMARY KEY, continuation TEXT NOT NULL DEFAULT '', stage TEXT NOT NULL,
  name TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS event_assets (
  id INTEGER PRIMARY KEY, event_id INTEGER NOT NULL REFERENCES events(id), original_name TEXT NOT NULL,
  stored_name TEXT NOT NULL UNIQUE, delivery_stage TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS event_images (
  id INTEGER PRIMARY KEY, event_id INTEGER NOT NULL REFERENCES events(id), original_name TEXT NOT NULL,
  stored_name TEXT NOT NULL UNIQUE, position INTEGER NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS event_message_images (
  id INTEGER PRIMARY KEY, event_id INTEGER NOT NULL REFERENCES events(id), message_key TEXT NOT NULL,
  original_name TEXT NOT NULL, stored_name TEXT NOT NULL UNIQUE, position INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS telegram_consents (
  telegram_id TEXT PRIMARY KEY, telegram_name TEXT, accepted_at TEXT NOT NULL,
  policy_url TEXT NOT NULL, agreement_url TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS blocked_users (
  telegram_id TEXT PRIMARY KEY, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS conversations (
  telegram_id TEXT PRIMARY KEY, telegram_name TEXT, last_message TEXT, last_message_at TEXT NOT NULL,
  unread_count INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS conversation_messages (
  id INTEGER PRIMARY KEY, telegram_id TEXT NOT NULL, direction TEXT NOT NULL,
  text TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS support_drafts (
  telegram_id TEXT PRIMARY KEY, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS posts (
  id INTEGER PRIMARY KEY, title TEXT NOT NULL, content TEXT NOT NULL DEFAULT '',
  audience TEXT NOT NULL DEFAULT 'all', event_id INTEGER REFERENCES events(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS post_images (
  id INTEGER PRIMARY KEY, post_id INTEGER NOT NULL REFERENCES posts(id), original_name TEXT NOT NULL,
  stored_name TEXT NOT NULL UNIQUE, position INTEGER NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS post_files (
  id INTEGER PRIMARY KEY, post_id INTEGER NOT NULL REFERENCES posts(id), original_name TEXT NOT NULL,
  stored_name TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
`);
for (const [table, column, definition] of [
  ['events', 'description', 'TEXT'], ['events', 'venue', 'TEXT'], ['applicants', 'phone', 'TEXT'],
  ['events', 'registration_text', 'TEXT'], ['events', 'received_text', 'TEXT'], ['events', 'invite_text', 'TEXT'],
  ['events', 'confirmed_text', 'TEXT'], ['events', 'declined_text', 'TEXT'], ['events', 'reminder_text', 'TEXT'],
  ['events', 'expired_text', 'TEXT'], ['invitations', 'final_confirmed_at', 'TEXT'],
  ['events', 'cover_stored_name', 'TEXT'], ['events', 'cover_original_name', 'TEXT'],
  ['events', 'registration_open', 'INTEGER NOT NULL DEFAULT 1'],
]) {
  try { db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`); } catch { /* already exists */ }
}

const mainKeyboard = () => new Keyboard()
  .text('Мероприятия').text('Мои регистрации').row()
  .text('Написать организатору').resized().persistent();
const userStatus = {
  awaiting_review: 'заявка рассматривается', pending: 'ждём ответа на приглашение',
  invited: 'ждём ответа на приглашение', confirmed: 'участие подтверждено',
  declined: 'участие отменено', expired: 'ответ не получен', cancelled: 'регистрация отменена',
};
function recordConversationMessage(telegramId, telegramName, direction, text) {
  const createdAt = nowIso();
  db.prepare('INSERT INTO conversation_messages (telegram_id,direction,text,created_at) VALUES (?,?,?,?)').run(telegramId, direction, text, createdAt);
  const unreadCount = direction === 'in' ? 1 : 0;
  db.prepare(`INSERT INTO conversations (telegram_id,telegram_name,last_message,last_message_at,unread_count) VALUES (?,?,?,?,?)
    ON CONFLICT(telegram_id) DO UPDATE SET telegram_name=excluded.telegram_name,last_message=excluded.last_message,last_message_at=excluded.last_message_at,unread_count=${direction === 'in' ? 'conversations.unread_count+1' : '0'}`)
    .run(telegramId, telegramName || null, text, createdAt, unreadCount);
}
async function sendAssets(telegramId, eventId, stage) {
  const assets = db.prepare('SELECT * FROM event_assets WHERE event_id=? AND delivery_stage=?').all(eventId, stage);
  for (const asset of assets) await bot.api.sendDocument(telegramId, new InputFile(path.join(uploadsDir, asset.stored_name), asset.original_name)).catch(console.error);
}
async function sendMessageImages(telegramId, eventId, key) {
  const images = db.prepare('SELECT * FROM event_message_images WHERE event_id=? AND message_key=? ORDER BY position').all(eventId, key);
  if (images.length) await bot.api.sendMediaGroup(telegramId, images.map(image => ({ type: 'photo', media: new InputFile(path.join(uploadsDir, image.stored_name), image.original_name) }))).catch(console.error);
}
const adminOnly = (req, res, next) => {
  const header = req.headers.authorization || '';
  const [kind, encoded] = header.split(' ');
  const [user, pass] = kind === 'Basic' && encoded ? Buffer.from(encoded, 'base64').toString().split(':') : [];
  if (user === 'admin' && pass === process.env.ADMIN_PASSWORD) return next();
  res.set('WWW-Authenticate', 'Basic realm="Event admin"'); return res.status(401).send('Authorization required');
};

const bot = new Bot(process.env.BOT_TOKEN || '');
bot.catch((error) => console.error('Ошибка обработки сообщения Telegram:', error.error || error));
bot.api.setMyCommands([
  { command: 'events', description: 'Посмотреть мероприятия' },
  { command: 'my', description: 'Мои регистрации' },
  { command: 'help', description: 'Помощь' },
]).catch(console.error);
bot.use(async (ctx, next) => {
  const telegramId = ctx.from?.id ? String(ctx.from.id) : null;
  if (!telegramId || !db.prepare('SELECT 1 FROM blocked_users WHERE telegram_id=?').get(telegramId)) return next();
  if (ctx.callbackQuery) await ctx.answerCallbackQuery({ text: 'Доступ к боту ограничен.', show_alert: true });
  else if (ctx.chat) await ctx.reply('Доступ к этому боту ограничен.');
});
const updateInviteAttempt = (invitationId, status, responded = false) => db.prepare(`UPDATE invitation_attempts SET status=?, responded_at=?
  WHERE id=(SELECT id FROM invitation_attempts WHERE invitation_id=? ORDER BY id DESC LIMIT 1)`).run(status, responded ? nowIso() : null, invitationId);
async function requestProfile(ctx, continuation = '') {
  const telegramId = String(ctx.from.id);
  db.prepare(`INSERT INTO profile_drafts (telegram_id,continuation,stage,name) VALUES (?,?,'name',NULL)
    ON CONFLICT(telegram_id) DO UPDATE SET continuation=excluded.continuation,stage='name',name=NULL`).run(telegramId, continuation || '');
  return ctx.reply('Спасибо. Теперь сохраним данные для регистрации на мероприятия Perasperadastra.\n\nФИО и номер телефона будут использоваться, чтобы оформить ваши будущие заявки и связаться с вами по событию.\n\nНапишите ваши имя и фамилию.', { reply_markup: { remove_keyboard: true } });
}
async function editApplicationMessage(ctx, text) {
  if (ctx.callbackQuery?.message?.photo) return ctx.editMessageCaption(text, messageOptions());
  return ctx.editMessageText(text, messageOptions());
}
async function continueStart(ctx, claim) {
  const profile = db.prepare('SELECT * FROM telegram_profiles WHERE telegram_id=?').get(String(ctx.from.id));
  if (!profile) return requestProfile(ctx, claim);
  const eventMatch = claim?.match(/^event_(\d+)$/);
  if (eventMatch) {
    const event = db.prepare('SELECT * FROM events WHERE id=?').get(eventMatch[1]);
    if (!event) return ctx.reply('Это мероприятие не найдено или уже недоступно.');
    const date = new Date(event.starts_at).toLocaleString('ru-RU', { dateStyle: 'long', timeStyle: 'short' });
    const details = [event.registration_text || event.description, event.venue && `📍 ${event.venue}`, `🗓 ${date}`, event.registration_open ? 'Регистрация открыта' : 'Регистрация закрыта'].filter(Boolean).join('\n\n');
    const existing = db.prepare('SELECT status FROM applicants WHERE event_id=? AND telegram_id=?').get(event.id, String(ctx.from.id));
    if (existing && existing.status !== 'cancelled') return ctx.reply(`Вы уже подали заявку на «${event.title}». Сейчас: ${userStatus[existing.status] || existing.status}.`, { reply_markup: mainKeyboard() });
    const keyboard = event.registration_open ? new InlineKeyboard().text('Подать заявку', `apply:${event.id}`) : undefined;
    const images = db.prepare('SELECT * FROM event_images WHERE event_id=? ORDER BY position').all(event.id);
    const cardText = `«${esc(event.title)}»\n\n${telegramHtml(details)}`;
    const options = messageOptions(keyboard ? { reply_markup: keyboard } : undefined);
    if (images.length === 1 && cardText.length <= 1024) {
      await ctx.replyWithPhoto(new InputFile(path.join(uploadsDir, images[0].stored_name), images[0].original_name), { caption: cardText, ...options });
      await sendMessageImages(ctx.chat.id, event.id, 'registration');
      return;
    }
    if (images.length > 1) await bot.api.sendMediaGroup(ctx.chat.id, images.map(image => ({ type: 'photo', media: new InputFile(path.join(uploadsDir, image.stored_name), image.original_name) })));
    else if (event.cover_stored_name && cardText.length <= 1024) {
      await ctx.replyWithPhoto(new InputFile(path.join(uploadsDir, event.cover_stored_name), event.cover_original_name || 'cover'), { caption: cardText, ...options });
      await sendMessageImages(ctx.chat.id, event.id, 'registration');
      return;
    }
    await sendMessageImages(ctx.chat.id, event.id, 'registration');
    return ctx.reply(cardText, options);
  }
  if (!claim) return ctx.reply('Добро пожаловать! Здесь можно посмотреть мероприятия, следить за своими заявками и написать организаторам.', { reply_markup: mainKeyboard() });
  const applicant = db.prepare('SELECT * FROM applicants WHERE claim_token = ?').get(claim);
  if (!applicant) return ctx.reply('Эта ссылка недействительна или устарела. Свяжитесь с организаторами.');
  if (applicant.telegram_id && applicant.telegram_id !== String(ctx.from.id)) return ctx.reply('Эта ссылка уже привязана к другому Telegram-аккаунту.');
  db.prepare("UPDATE applicants SET telegram_id=?, telegram_name=?, status=CASE WHEN status='awaiting_review' THEN 'awaiting_review' ELSE status END WHERE id=?")
    .run(String(ctx.from.id), ctx.from.username || null, applicant.id);
  return ctx.reply('Спасибо, заявка получена. Мы рассмотрим её и пришлём решение в этот бот.');
}
async function requestConsent(ctx, claim) {
  const continuation = claim || 'home';
  const keyboard = new InlineKeyboard()
    .url('Политика конфиденциальности', policyUrl)
    .row()
    .url('Согласие на обработку данных', agreementUrl)
    .row()
    .text('Согласиться и продолжить', `consent:${continuation}`);
  return ctx.reply('Привет! Это Perasperadastra ✱\n\nПеред тем как перейти к событию, давайте договоримся о важном: мы бережно храним ваши данные и используем их только для регистрации и связи по мероприятию.\n\nПожалуйста, ознакомьтесь с документами ниже. Нажимая «Согласиться и продолжить», вы даёте согласие на обработку персональных данных.', { reply_markup: keyboard });
}
bot.command('start', async ctx => {
  const claim = ctx.match?.trim();
  const consent = db.prepare('SELECT 1 FROM telegram_consents WHERE telegram_id=?').get(String(ctx.from.id));
  if (!consent) return requestConsent(ctx, claim);
  return continueStart(ctx, claim);
});
bot.callbackQuery(/^consent:(.*)$/, async ctx => {
  const claim = ctx.match[1] === 'home' ? '' : ctx.match[1];
  db.prepare(`INSERT INTO telegram_consents (telegram_id,telegram_name,accepted_at,policy_url,agreement_url) VALUES (?,?,?,?,?)
    ON CONFLICT(telegram_id) DO UPDATE SET telegram_name=excluded.telegram_name, accepted_at=excluded.accepted_at, policy_url=excluded.policy_url, agreement_url=excluded.agreement_url`)
    .run(String(ctx.from.id), ctx.from.username || null, nowIso(), policyUrl, agreementUrl);
  await ctx.answerCallbackQuery({ text: 'Согласие сохранено' });
  await ctx.editMessageText('Спасибо. Согласие на обработку персональных данных сохранено.');
  return continueStart(ctx, claim);
});

bot.callbackQuery(/^apply:(\d+)$/, async ctx => {
  const event = db.prepare('SELECT * FROM events WHERE id=?').get(ctx.match[1]);
  if (!event) return ctx.answerCallbackQuery({ text: 'Мероприятие не найдено.', show_alert: true });
  if (!event.registration_open) return ctx.answerCallbackQuery({ text: 'Регистрация на это мероприятие закрыта.', show_alert: true });
  const telegramId = String(ctx.from.id);
  const profile = db.prepare('SELECT * FROM telegram_profiles WHERE telegram_id=?').get(telegramId);
  if (!profile) {
    await ctx.answerCallbackQuery();
    return requestProfile(ctx, `event_${event.id}`);
  }
  const existing = db.prepare('SELECT * FROM applicants WHERE event_id=? AND telegram_id=?').get(event.id, telegramId);
  if (existing && existing.status !== 'cancelled') {
    return ctx.answerCallbackQuery({ text: 'Заявка уже подана.', show_alert: true });
  }
  if (existing) {
    db.transaction(() => {
      db.prepare('DELETE FROM invitation_attempts WHERE applicant_id=?').run(existing.id);
      db.prepare('DELETE FROM invitations WHERE applicant_id=?').run(existing.id);
      db.prepare("UPDATE applicants SET status='awaiting_review' WHERE id=?").run(existing.id);
    })();
  }
  if (existing) db.prepare("UPDATE applicants SET name=?,phone=?,claim_token=?,telegram_name=?,status='awaiting_review' WHERE id=?")
    .run(profile.name, profile.phone, token(), ctx.from.username || null, existing.id);
  else db.prepare('INSERT INTO applicants (event_id,name,phone,claim_token,telegram_id,telegram_name,status) VALUES (?,?,?,?,?,?,?)')
    .run(event.id, profile.name, profile.phone, token(), telegramId, ctx.from.username || null, 'awaiting_review');
  await ctx.answerCallbackQuery({ text: 'Заявка отправлена' });
  return editApplicationMessage(ctx, eventText(event, 'received'));
});

bot.on('message:contact', async ctx => {
  const telegramId = String(ctx.from.id);
  const profileDraft = db.prepare('SELECT * FROM profile_drafts WHERE telegram_id=? AND stage=\'phone\'').get(telegramId);
  if (profileDraft && ctx.message.contact.user_id === ctx.from.id) {
    db.prepare(`INSERT INTO telegram_profiles (telegram_id,name,phone,telegram_name,created_at,updated_at) VALUES (?,?,?,?,?,?)
      ON CONFLICT(telegram_id) DO UPDATE SET name=excluded.name,phone=excluded.phone,telegram_name=excluded.telegram_name,updated_at=excluded.updated_at`)
      .run(telegramId, profileDraft.name, ctx.message.contact.phone_number, ctx.from.username || null, nowIso(), nowIso());
    db.prepare('DELETE FROM profile_drafts WHERE telegram_id=?').run(telegramId);
    return continueStart(ctx, profileDraft.continuation);
  }
  const draft = db.prepare("SELECT * FROM application_drafts WHERE telegram_id=? AND stage='phone'").get(telegramId);
  if (!draft || ctx.message.contact.user_id !== ctx.from.id) return;
  const name = draft.name;
  const existing = db.prepare('SELECT id FROM applicants WHERE event_id=? AND telegram_id=?').get(draft.event_id, telegramId);
  if (existing) db.prepare("UPDATE applicants SET name=?,phone=?,claim_token=?,telegram_name=?,status='awaiting_review' WHERE id=?")
    .run(name, ctx.message.contact.phone_number, token(), ctx.from.username || null, existing.id);
  else db.prepare('INSERT INTO applicants (event_id,name,phone,claim_token,telegram_id,telegram_name,status) VALUES (?,?,?,?,?,?,?)')
    .run(draft.event_id, name, ctx.message.contact.phone_number, token(), telegramId, ctx.from.username || null, 'awaiting_review');
  db.prepare('DELETE FROM application_drafts WHERE telegram_id=? AND event_id=?').run(telegramId, draft.event_id);
  const event = db.prepare('SELECT * FROM events WHERE id=?').get(draft.event_id);
  await ctx.reply(eventText(event, 'received'), messageOptions({ reply_markup: mainKeyboard() }));
});

bot.on('message:text', async ctx => {
  const telegramId = String(ctx.from.id);
  const profileDraft = db.prepare('SELECT * FROM profile_drafts WHERE telegram_id=?').get(telegramId);
  if (profileDraft) {
    const text = ctx.message.text.trim();
    if (profileDraft.stage === 'name') {
      if (text.length < 3) return ctx.reply('Напишите, пожалуйста, имя и фамилию полностью.');
      db.prepare("UPDATE profile_drafts SET stage='phone',name=? WHERE telegram_id=?").run(text, telegramId);
      const keyboard = new Keyboard().requestContact('📱 Отправить мой номер').resized().oneTime();
      return ctx.reply('Теперь отправьте номер телефона кнопкой ниже. Он нужен для связи по мероприятию.', { reply_markup: keyboard });
    }
    return ctx.reply('Для продолжения нажмите «Отправить мой номер».');
  }
  const draft = db.prepare('SELECT * FROM application_drafts WHERE telegram_id=?').get(telegramId);
  if (!draft) {
    const text = ctx.message.text.trim();
    if (/^\/events(?:@\w+)?$/i.test(text)) return showEvents(ctx);
    if (/^\/my(?:@\w+)?$/i.test(text)) return showMyApplications(ctx);
    if (/^\/help(?:@\w+)?$/i.test(text)) return ctx.reply('Используйте кнопки ниже: можно посмотреть мероприятия, свои регистрации или написать организаторам.', { reply_markup: mainKeyboard() });
    if (text === 'Мероприятия') return showEvents(ctx);
    if (text === 'Мои регистрации') return showMyApplications(ctx);
    if (text === 'Написать организатору') {
      db.prepare('INSERT OR REPLACE INTO support_drafts (telegram_id,created_at) VALUES (?,?)').run(telegramId, nowIso());
      return ctx.reply('Напишите сообщение — оно появится у команды Perasperadastra в диалогах.', { reply_markup: mainKeyboard() });
    }
    if (!text.startsWith('/')) {
      const support = db.prepare('SELECT 1 FROM support_drafts WHERE telegram_id=?').get(telegramId);
      recordConversationMessage(telegramId, ctx.from.username, 'in', text);
      if (support) {
        db.prepare('DELETE FROM support_drafts WHERE telegram_id=?').run(telegramId);
        return ctx.reply('Спасибо, сообщение передано команде. Ответ придёт сюда.', { reply_markup: mainKeyboard() });
      }
    }
    return;
  }
  const text = ctx.message.text.trim();
  if (draft.stage === 'name') {
    if (text.length < 2) return ctx.reply('Напишите, пожалуйста, имя чуть подробнее.');
    db.prepare("UPDATE application_drafts SET stage='phone', name=? WHERE telegram_id=? AND event_id=?").run(text, telegramId, draft.event_id);
    const keyboard = new Keyboard().requestContact('📱 Отправить мой номер').resized().oneTime();
    return ctx.reply('Теперь отправьте номер телефона кнопкой ниже. Это обязательное поле для регистрации.', { reply_markup: keyboard });
  }
  if (draft.stage === 'phone') return ctx.reply('Для завершения регистрации нажмите «Отправить мой номер».');
});

async function showEvents(ctx) {
  const events = db.prepare("SELECT * FROM events WHERE starts_at >= ? ORDER BY starts_at").all(nowIso());
  if (!events.length) return ctx.reply('Ближайших мероприятий пока нет. Следите за анонсами Perasperadastra.', { reply_markup: mainKeyboard() });
  if (events.length === 1) return continueStart(ctx, `event_${events[0].id}`);
  const keyboard = new InlineKeyboard();
  events.forEach(event => keyboard.text(`${event.title}${event.registration_open ? '' : ' · регистрация закрыта'}`, `event:${event.id}`).row());
  return ctx.reply('Выберите мероприятие, чтобы посмотреть детали.', { reply_markup: keyboard });
}
async function showMyApplications(ctx) {
  const applications = db.prepare(`SELECT a.*, e.title, e.starts_at, i.status AS invitation_status
    FROM applicants a JOIN events e ON e.id=a.event_id LEFT JOIN invitations i ON i.applicant_id=a.id
    WHERE a.telegram_id=? ORDER BY e.starts_at DESC`).all(String(ctx.from.id));
  if (!applications.length) return ctx.reply('У вас пока нет регистраций. Откройте «Мероприятия», чтобы выбрать событие.', { reply_markup: mainKeyboard() });
  for (const application of applications) {
    const status = application.invitation_status || application.status;
    const date = new Date(application.starts_at).toLocaleString('ru-RU', { dateStyle: 'medium', timeStyle: 'short' });
    const keyboard = application.status === 'cancelled' ? undefined : new InlineKeyboard().text('Отменить регистрацию', `withdraw:${application.id}`);
    await ctx.reply(`«${application.title}»\n${date}\nСтатус: ${userStatus[status] || status}`, { reply_markup: keyboard });
  }
}
bot.callbackQuery(/^event:(\d+)$/, async ctx => {
  await ctx.answerCallbackQuery();
  return continueStart(ctx, `event_${ctx.match[1]}`);
});
bot.callbackQuery(/^withdraw:(\d+)$/, async ctx => {
  const row = db.prepare('SELECT * FROM applicants WHERE id=? AND telegram_id=?').get(ctx.match[1], String(ctx.from.id));
  if (!row || row.status === 'cancelled') return ctx.answerCallbackQuery({ text: 'Регистрация уже отменена.', show_alert: true });
  const invitation = db.prepare('SELECT * FROM invitations WHERE applicant_id=?').get(row.id);
  db.transaction(() => {
    db.prepare("UPDATE applicants SET status='cancelled' WHERE id=?").run(row.id);
    if (invitation) {
      db.prepare("UPDATE invitations SET status='declined',responded_at=? WHERE id=?").run(nowIso(), invitation.id);
      updateInviteAttempt(invitation.id, 'declined', true);
    }
  })();
  await ctx.answerCallbackQuery({ text: 'Регистрация отменена' });
  return ctx.editMessageText('Регистрация отменена. Если планы изменятся, вы сможете снова подать заявку по ссылке на мероприятие.');
});

bot.callbackQuery(/^answer:(yes|no):(\d+)$/, async ctx => {
  const [, answer, id] = ctx.match;
  const row = db.prepare(`SELECT i.*, a.telegram_id, a.name, e.id AS event_id, e.title, e.starts_at, e.chat_url, e.confirmed_text, e.declined_text
    FROM invitations i JOIN applicants a ON a.id=i.applicant_id JOIN events e ON e.id=a.event_id WHERE i.id=?`).get(id);
  if (!row || row.telegram_id !== String(ctx.from.id)) return ctx.answerCallbackQuery({ text: 'Приглашение не найдено.', show_alert: true });
  if (row.status !== 'pending' || new Date(row.expires_at) <= new Date()) return ctx.answerCallbackQuery({ text: 'Срок ответа уже закончился.', show_alert: true });
  if (answer === 'no') {
    db.prepare("UPDATE invitations SET status='declined', responded_at=? WHERE id=?").run(nowIso(), id);
    updateInviteAttempt(id, 'declined', true);
    db.prepare("UPDATE applicants SET status='declined' WHERE id=?").run(row.applicant_id);
    await ctx.editMessageText(eventText(row, 'declined'), messageOptions()); await sendMessageImages(row.telegram_id, row.event_id, 'declined');
  } else {
    const checkinToken = token();
    db.prepare("UPDATE invitations SET status='confirmed', responded_at=?, checkin_token=? WHERE id=?").run(nowIso(), checkinToken, id);
    updateInviteAttempt(id, 'confirmed', true);
    db.prepare("UPDATE applicants SET status='confirmed' WHERE id=?").run(row.applicant_id);
    const qr = await QRCode.toBuffer(checkinToken, { width: 700, margin: 2 });
    await ctx.editMessageText(eventText(row, 'confirmed'), messageOptions({ reply_markup: new InlineKeyboard().text('Не смогу прийти', `cancel:${id}`) })); await sendMessageImages(row.telegram_id, row.event_id, 'confirmed');
    if (row.chat_url) await ctx.reply(`Пока можете присоединиться к чату мероприятия: ${row.chat_url}`);
    await sendAssets(row.telegram_id, row.event_id, 'confirmed');
    await ctx.replyWithPhoto(new Uint8Array(qr), { caption: `Ваш QR для входа на «${row.title}». Сохраните его.\nРезервный код: ${checkinToken.slice(0, 8).toUpperCase()}` });
  }
  return ctx.answerCallbackQuery();
});

bot.callbackQuery(/^cancel:(\d+)$/, async ctx => {
  const row = db.prepare(`SELECT i.*, a.telegram_id, a.id applicant_id, e.id event_id, e.title, e.declined_text FROM invitations i JOIN applicants a ON a.id=i.applicant_id JOIN events e ON e.id=a.event_id WHERE i.id=?`).get(ctx.match[1]);
  if (!row || row.telegram_id !== String(ctx.from.id) || row.status !== 'confirmed') return ctx.answerCallbackQuery({ text: 'Это участие уже нельзя отменить.', show_alert: true });
  db.prepare("UPDATE invitations SET status='declined', responded_at=? WHERE id=?").run(nowIso(), row.id);
  updateInviteAttempt(row.id, 'declined', true);
  db.prepare("UPDATE applicants SET status='declined' WHERE id=?").run(row.applicant_id);
  await ctx.editMessageText(eventText(row, 'declined'), messageOptions()); await sendMessageImages(row.telegram_id, row.event_id, 'declined');
  return ctx.answerCallbackQuery();
});
bot.callbackQuery(/^final:(yes|no):(\d+)$/, async ctx => {
  const [, answer, id] = ctx.match;
  const row = db.prepare('SELECT i.*, a.telegram_id, a.id applicant_id, e.id event_id, e.declined_text, e.title FROM invitations i JOIN applicants a ON a.id=i.applicant_id JOIN events e ON e.id=a.event_id WHERE i.id=?').get(id);
  if (!row || row.telegram_id !== String(ctx.from.id) || row.status !== 'confirmed') return ctx.answerCallbackQuery({ text: 'Приглашение не найдено.', show_alert: true });
  if (answer === 'no') { db.prepare("UPDATE invitations SET status='declined', responded_at=? WHERE id=?").run(nowIso(), id); updateInviteAttempt(id, 'declined', true); db.prepare("UPDATE applicants SET status='declined' WHERE id=?").run(row.applicant_id); await ctx.editMessageText(eventText(row, 'declined'), messageOptions()); await sendMessageImages(row.telegram_id, row.event_id, 'declined'); return ctx.answerCallbackQuery(); }
  db.prepare('UPDATE invitations SET final_confirmed_at=? WHERE id=?').run(nowIso(), id);
  await ctx.editMessageText('Спасибо, ждём вас на мероприятии!'); return ctx.answerCallbackQuery();
});

async function sendInvite(applicantId) {
  const row = db.prepare('SELECT a.*, e.* FROM applicants a JOIN events e ON e.id=a.event_id WHERE a.id=?').get(applicantId);
  if (!row?.telegram_id) throw new Error('Участник ещё не запустил бота по персональной ссылке');
  if (db.prepare('SELECT 1 FROM blocked_users WHERE telegram_id=?').get(row.telegram_id)) throw new Error('Доступ гостя к боту ограничен');
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  let invitation = db.prepare('SELECT * FROM invitations WHERE applicant_id=?').get(applicantId);
  if (invitation?.status === 'confirmed') throw new Error('Участие уже подтверждено');
  if (invitation) db.prepare("UPDATE invitations SET status='pending', expires_at=?, responded_at=NULL WHERE id=?").run(expiresAt, invitation.id);
  else {
    const r = db.prepare("INSERT INTO invitations (applicant_id,status,expires_at) VALUES (?, 'pending', ?)").run(applicantId, expiresAt);
    invitation = { id: r.lastInsertRowid };
  }
  db.prepare("INSERT INTO invitation_attempts (applicant_id,invitation_id,status,sent_at,expires_at) VALUES (?,?,'pending',?,?)").run(applicantId, invitation.id, nowIso(), expiresAt);
  db.prepare("UPDATE applicants SET status='invited' WHERE id=?").run(applicantId);
  const keyboard = new InlineKeyboard().text('Подтверждаю участие', `answer:yes:${invitation.id}`).text('Не смогу прийти', `answer:no:${invitation.id}`);
  await bot.api.sendMessage(row.telegram_id, eventText(row, 'invite'), messageOptions({ reply_markup: keyboard })); await sendMessageImages(row.telegram_id, row.event_id, 'invite');
}

async function runAutomation() {
  const expired = db.prepare("SELECT i.*, a.telegram_id, a.id applicant_id, e.id AS event_id, e.title, e.expired_text FROM invitations i JOIN applicants a ON a.id=i.applicant_id JOIN events e ON e.id=a.event_id WHERE i.status='pending' AND i.expires_at <= ?").all(nowIso());
  for (const row of expired) {
    db.prepare("UPDATE invitations SET status='expired' WHERE id=?").run(row.id);
    updateInviteAttempt(row.id, 'expired');
    db.prepare("UPDATE applicants SET status='expired' WHERE id=?").run(row.applicant_id);
    if (row.telegram_id) { await bot.api.sendMessage(row.telegram_id, eventText(row, 'expired'), messageOptions()).catch(console.error); await sendMessageImages(row.telegram_id, row.event_id, 'expired'); }
  }
  const upcoming = db.prepare(`SELECT i.*, a.telegram_id, e.id AS event_id, e.title, e.starts_at, e.reminder_text FROM invitations i
    JOIN applicants a ON a.id=i.applicant_id JOIN events e ON e.id=a.event_id
    WHERE i.status='confirmed' AND i.reminder_sent_at IS NULL AND e.starts_at BETWEEN ? AND ?`)
    .all(nowIso(), new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString());
  for (const row of upcoming) {
    if (row.telegram_id) {
      const keyboard = new InlineKeyboard().text('Буду', `final:yes:${row.id}`).text('Не смогу прийти', `final:no:${row.id}`);
      await bot.api.sendMessage(row.telegram_id, eventText(row, 'reminder'), messageOptions({ reply_markup: keyboard })).catch(console.error);
      await sendMessageImages(row.telegram_id, row.event_id, 'reminder');
      await sendAssets(row.telegram_id, row.event_id, 'reminder');
    }
    db.prepare('UPDATE invitations SET reminder_sent_at=? WHERE id=?').run(nowIso(), row.id);
  }
}

const app = express();
const upload = multer({
  storage: multer.diskStorage({
    destination: uploadsDir,
    filename: (_, file, done) => done(null, `${Date.now()}-${token()}${path.extname(file.originalname)}`),
  }),
  limits: { fileSize: 20 * 1024 * 1024 },
});
app.use(express.urlencoded({ extended: false }));
app.use(express.json());
app.get('/', (_, res) => res.redirect('/admin'));
app.get('/api/admin/state', adminOnly, (req, res) => {
  const events = db.prepare(`SELECT e.*, COUNT(DISTINCT a.id) AS registered, COUNT(DISTINCT i.id) AS invited,
    SUM(CASE WHEN i.status='confirmed' THEN 1 ELSE 0 END) AS confirmed,
    SUM(CASE WHEN i.checked_in_at IS NOT NULL THEN 1 ELSE 0 END) AS checked_in
    FROM events e LEFT JOIN applicants a ON a.event_id=e.id LEFT JOIN invitations i ON i.applicant_id=a.id
    GROUP BY e.id ORDER BY e.starts_at DESC`).all();
  const selected = Number(req.query.event || events[0]?.id);
  const people = selected ? db.prepare(`SELECT a.*, i.id invitation_id, i.status invitation_status, i.expires_at, i.checked_in_at,
    EXISTS(SELECT 1 FROM blocked_users b WHERE b.telegram_id=a.telegram_id) AS blocked,
    (SELECT ia.status FROM invitation_attempts ia WHERE ia.applicant_id=a.id AND ia.status!='pending' ORDER BY ia.id DESC LIMIT 1) AS previous_invitation_status
    FROM applicants a LEFT JOIN invitations i ON i.applicant_id=a.id WHERE a.event_id=? ORDER BY a.created_at DESC`).all(selected) : [];
  const assets = selected ? db.prepare('SELECT * FROM event_assets WHERE event_id=? ORDER BY created_at DESC').all(selected) : [];
  const guests = db.prepare(`SELECT a.telegram_id, a.telegram_name, a.name, a.phone, MAX(a.created_at) AS last_seen,
    COUNT(a.id) AS events_count FROM applicants a GROUP BY COALESCE(a.telegram_id, 'applicant:' || a.id) ORDER BY last_seen DESC`).all();
  const messageImages = selected ? db.prepare('SELECT id,message_key,original_name,position FROM event_message_images WHERE event_id=? ORDER BY position').all(selected) : [];
  const eventImages = selected ? db.prepare('SELECT id,event_id,original_name,position FROM event_images WHERE event_id=? ORDER BY position').all(selected) : [];
  const posts = db.prepare(`SELECT p.*, e.title AS event_title FROM posts p LEFT JOIN events e ON e.id=p.event_id ORDER BY p.updated_at DESC`).all();
  const postImages = db.prepare('SELECT id,post_id,original_name,position FROM post_images ORDER BY position').all();
  const postFiles = db.prepare('SELECT id,post_id,original_name FROM post_files ORDER BY created_at').all();
  const conversations = db.prepare('SELECT * FROM conversations ORDER BY last_message_at DESC').all();
  res.json({ events, selected, people, assets, guests, messageImages, eventImages, posts, postImages, postFiles, conversations, botUsername: process.env.BOT_USERNAME });
});
app.get('/admin/legacy', adminOnly, (req, res) => {
  const events = db.prepare('SELECT * FROM events ORDER BY starts_at DESC').all();
  const selected = Number(req.query.event || events[0]?.id);
  const current = events.find(event => event.id === selected);
  const assets = selected ? db.prepare('SELECT * FROM event_assets WHERE event_id=? ORDER BY created_at DESC').all(selected) : [];
  const people = selected ? db.prepare(`SELECT a.*, i.id invitation_id, i.status invitation_status, i.expires_at, i.checked_in_at
    FROM applicants a LEFT JOIN invitations i ON i.applicant_id=a.id WHERE a.event_id=? ORDER BY a.created_at DESC`).all(selected) : [];
  res.send(layout('Админка', `<h1>Мероприятия</h1><form method="post" action="/admin/events"><input name="title" placeholder="Название" required><input name="starts_at" type="datetime-local" required><input name="venue" placeholder="Место"><input name="description" placeholder="Описание"><input name="chat_url" placeholder="Ссылка на чат (необязательно)"><button>Создать</button></form>
    <p>${events.map(e => `<a href="/admin?event=${e.id}">${esc(e.title)}</a> — ${new Date(e.starts_at).toLocaleString('ru-RU')}</p>`).join('') || 'Событий пока нет.'}
    ${selected ? `${eventSettings(current, assets)}<hr><h2>Заявки</h2><p><strong>Ссылка на регистрацию:</strong> <a href="https://t.me/${encodeURIComponent(process.env.BOT_USERNAME)}?start=event_${selected}">открыть мероприятие в боте</a></p><p><a href="/admin/export/${selected}">Скачать CSV</a> · <a href="/admin/checkin">Режим чек-ина</a></p><table><tr><th>ФИО и телефон</th><th>Telegram</th><th>Статус</th><th>Действие</th></tr>${people.map(p => `<tr><td>${esc(p.name)}<br><small>${esc(p.phone || 'Телефон не указан')}</small></td><td>${p.telegram_id ? esc(p.telegram_name ? '@' + p.telegram_name : 'Username не задан') : 'Не подключён'}</td><td>${esc(p.invitation_status || p.status)}${p.checked_in_at ? ' · пришёл' : ''}</td><td>${p.telegram_id && !['confirmed','pending'].includes(p.invitation_status) ? `<form method="post" action="/admin/invite/${p.id}"><button>Пригласить</button></form>` : ''}</td></tr>`).join('')}</table>` : ''}`));
});
const adminBuild = path.resolve('./admin/dist');
app.use('/admin', adminOnly, express.static(adminBuild));
app.post('/admin/events', adminOnly, upload.array('images', 9), (req, res) => {
  const images = req.files || [];
  if (images.some(file => !file.mimetype.startsWith('image/'))) return res.status(400).send('Карточка может содержать только изображения');
  const createEvent = db.transaction(() => {
    const result = db.prepare('INSERT INTO events (title,starts_at,description,venue,chat_url) VALUES (?,?,?,?,?)')
      .run(req.body.title, new Date(req.body.starts_at).toISOString(), req.body.description || null, req.body.venue || null, req.body.chat_url || null);
    const eventId = result.lastInsertRowid;
    const insertImage = db.prepare('INSERT INTO event_images (event_id,original_name,stored_name,position) VALUES (?,?,?,?)');
    images.forEach((file, position) => insertImage.run(eventId, file.originalname, file.filename, position));
  });
  createEvent();
  res.redirect('/admin');
});
app.post('/admin/events/:id/settings', adminOnly, (req, res) => {
  db.prepare(`UPDATE events SET registration_text=?, received_text=?, invite_text=?, confirmed_text=?, declined_text=?, reminder_text=? WHERE id=?`)
    .run(req.body.registration_text || null, req.body.received_text || null, req.body.invite_text || null, req.body.confirmed_text || null, req.body.declined_text || null, req.body.reminder_text || null, req.params.id);
  res.redirect(`/admin?event=${req.params.id}`);
});
app.post('/api/admin/events/:id/texts', adminOnly, (req, res) => {
  db.prepare('UPDATE events SET description=?, invite_text=?, expired_text=?, confirmed_text=?, reminder_text=?, declined_text=? WHERE id=?')
    .run(telegramHtml(req.body.description || '') || null, telegramHtml(req.body.invite_text || '') || null, telegramHtml(req.body.expired_text || '') || null, telegramHtml(req.body.confirmed_text || '') || null, telegramHtml(req.body.reminder_text || '') || null, telegramHtml(req.body.declined_text || '') || null, req.params.id);
  res.json({ ok: true });
});
app.post('/api/admin/events/:id/registration', adminOnly, (req, res) => {
  db.prepare('UPDATE events SET registration_open=? WHERE id=?').run(req.body.open ? 1 : 0, req.params.id);
  res.json({ ok: true });
});
app.delete('/api/admin/applicants/:id', adminOnly, (req, res) => {
  const applicant = db.prepare('SELECT id FROM applicants WHERE id=?').get(req.params.id);
  if (!applicant) return res.sendStatus(404);
  db.transaction(() => {
    db.prepare('DELETE FROM invitation_attempts WHERE applicant_id=?').run(applicant.id);
    db.prepare('DELETE FROM invitations WHERE applicant_id=?').run(applicant.id);
    db.prepare('DELETE FROM applicants WHERE id=?').run(applicant.id);
  })();
  res.json({ ok: true });
});
app.post('/api/admin/applicants/:id/block', adminOnly, (req, res) => {
  const applicant = db.prepare('SELECT telegram_id FROM applicants WHERE id=?').get(req.params.id);
  if (!applicant) return res.sendStatus(404);
  if (!applicant.telegram_id) return res.status(400).json({ error: 'Гость ещё не подключил Telegram' });
  if (req.body.blocked) db.prepare('INSERT OR IGNORE INTO blocked_users (telegram_id) VALUES (?)').run(applicant.telegram_id);
  else db.prepare('DELETE FROM blocked_users WHERE telegram_id=?').run(applicant.telegram_id);
  res.json({ ok: true });
});
app.post('/api/admin/events/:id/invitations', adminOnly, async (req, res) => {
  const event = db.prepare('SELECT id FROM events WHERE id=?').get(req.params.id);
  const ids = [...new Set((Array.isArray(req.body.applicantIds) ? req.body.applicantIds : []).map(Number).filter(Number.isInteger))];
  if (!event) return res.sendStatus(404);
  if (!ids.length) return res.status(400).json({ error: 'Выберите хотя бы одного гостя' });
  if (ids.length > 500) return res.status(400).json({ error: 'За один раз можно пригласить до 500 гостей' });
  const eligible = db.prepare(`SELECT a.id, a.telegram_id, i.status AS invitation_status,
    EXISTS(SELECT 1 FROM blocked_users b WHERE b.telegram_id=a.telegram_id) AS blocked
    FROM applicants a LEFT JOIN invitations i ON i.applicant_id=a.id WHERE a.event_id=? AND a.id=?`);
  const sent = [];
  const skipped = [];
  for (const id of ids) {
    const person = eligible.get(event.id, id);
    if (!person) { skipped.push({ id, reason: 'заявка не найдена' }); continue; }
    if (!person.telegram_id) { skipped.push({ id, reason: 'гость не запустил бота' }); continue; }
    if (person.blocked) { skipped.push({ id, reason: 'доступ к боту ограничен' }); continue; }
    if (['pending', 'confirmed'].includes(person.invitation_status)) { skipped.push({ id, reason: 'приглашение уже активно' }); continue; }
    try {
      await sendInvite(id);
      sent.push(id);
      if (sent.length < ids.length) await new Promise(resolve => setTimeout(resolve, 60));
    } catch (error) { skipped.push({ id, reason: error.message }); }
  }
  res.json({ ok: true, sent, skipped });
});
app.delete('/api/admin/events/:id', adminOnly, (req, res) => {
  const event = db.prepare('SELECT * FROM events WHERE id=?').get(req.params.id);
  if (!event) return res.sendStatus(404);
  const storedNames = [event.cover_stored_name,
    ...db.prepare('SELECT stored_name FROM event_images WHERE event_id=?').all(event.id).map(row => row.stored_name),
    ...db.prepare('SELECT stored_name FROM event_message_images WHERE event_id=?').all(event.id).map(row => row.stored_name),
    ...db.prepare('SELECT stored_name FROM event_assets WHERE event_id=?').all(event.id).map(row => row.stored_name),
  ].filter(Boolean);
  db.transaction(() => {
    const applicantIds = db.prepare('SELECT id FROM applicants WHERE event_id=?').all(event.id).map(row => row.id);
    const deleteAttempts = db.prepare('DELETE FROM invitation_attempts WHERE applicant_id=?');
    const deleteInvites = db.prepare('DELETE FROM invitations WHERE applicant_id=?');
    applicantIds.forEach(id => { deleteAttempts.run(id); deleteInvites.run(id); });
    db.prepare('DELETE FROM application_drafts WHERE event_id=?').run(event.id);
    db.prepare('DELETE FROM applicants WHERE event_id=?').run(event.id);
    db.prepare('DELETE FROM event_images WHERE event_id=?').run(event.id);
    db.prepare('DELETE FROM event_message_images WHERE event_id=?').run(event.id);
    db.prepare('DELETE FROM event_assets WHERE event_id=?').run(event.id);
    db.prepare('UPDATE posts SET event_id=NULL WHERE event_id=?').run(event.id);
    db.prepare('DELETE FROM events WHERE id=?').run(event.id);
  })();
  storedNames.forEach(name => fs.unlink(path.join(uploadsDir, name), () => {}));
  res.json({ ok: true });
});
app.get('/api/admin/dialogs/:telegramId', adminOnly, (req, res) => {
  const conversation = db.prepare('SELECT * FROM conversations WHERE telegram_id=?').get(req.params.telegramId);
  if (!conversation) return res.sendStatus(404);
  db.prepare('UPDATE conversations SET unread_count=0 WHERE telegram_id=?').run(conversation.telegram_id);
  const messages = db.prepare('SELECT * FROM conversation_messages WHERE telegram_id=? ORDER BY id').all(conversation.telegram_id);
  res.json({ conversation: { ...conversation, unread_count: 0 }, messages });
});
app.post('/api/admin/dialogs/:telegramId/reply', adminOnly, async (req, res) => {
  const conversation = db.prepare('SELECT * FROM conversations WHERE telegram_id=?').get(req.params.telegramId);
  const text = telegramHtml(req.body.text || '');
  if (!conversation) return res.sendStatus(404);
  if (!text.replace(/<[^>]+>/g, '').trim()) return res.status(400).json({ error: 'Напишите сообщение' });
  if (db.prepare('SELECT 1 FROM blocked_users WHERE telegram_id=?').get(conversation.telegram_id)) return res.status(400).json({ error: 'Доступ гостя к боту ограничен' });
  try { await bot.api.sendMessage(conversation.telegram_id, text, messageOptions()); }
  catch (error) { return res.status(400).json({ error: `Не удалось отправить: ${error.message}` }); }
  recordConversationMessage(conversation.telegram_id, conversation.telegram_name, 'out', text);
  res.json({ ok: true });
});
app.post('/api/admin/events/:id', adminOnly, (req, res) => {
  const title = String(req.body.title || '').trim();
  const startsAt = new Date(req.body.starts_at);
  if (!title || Number.isNaN(startsAt.getTime())) return res.status(400).json({ error: 'Укажите название и дату мероприятия' });
  const result = db.prepare('UPDATE events SET title=?, starts_at=?, description=?, venue=?, chat_url=? WHERE id=?')
    .run(title, startsAt.toISOString(), telegramHtml(req.body.description || '') || null, String(req.body.venue || '').trim() || null, String(req.body.chat_url || '').trim() || null, req.params.id);
  if (!result.changes) return res.sendStatus(404);
  res.json({ ok: true });
});
app.post('/api/admin/events/:id/images', adminOnly, upload.array('images', 9), (req, res) => {
  const event = db.prepare('SELECT id FROM events WHERE id=?').get(req.params.id);
  const files = req.files || [];
  if (!event) return res.sendStatus(404);
  if (files.some(file => !file.mimetype.startsWith('image/'))) return res.status(400).json({ error: 'Можно загрузить только изображения' });
  const currentCount = db.prepare('SELECT COUNT(*) AS count FROM event_images WHERE event_id=?').get(event.id).count;
  if (currentCount + files.length > 9) return res.status(400).json({ error: 'В карточке может быть не больше 9 изображений' });
  const position = db.prepare('SELECT COALESCE(MAX(position), -1) AS max FROM event_images WHERE event_id=?').get(event.id).max;
  const insert = db.prepare('INSERT INTO event_images (event_id,original_name,stored_name,position) VALUES (?,?,?,?)');
  const images = files.map((file, index) => ({ id: Number(insert.run(event.id, file.originalname, file.filename, position + index + 1).lastInsertRowid) }));
  res.json({ ok: true, images });
});
app.get('/api/admin/event-images/:id', adminOnly, (req, res) => { const image = db.prepare('SELECT * FROM event_images WHERE id=?').get(req.params.id); if (!image) return res.sendStatus(404); return res.sendFile(path.join(uploadsDir, image.stored_name)); });
app.delete('/api/admin/event-images/:id', adminOnly, (req, res) => {
  const image = db.prepare('SELECT * FROM event_images WHERE id=?').get(req.params.id);
  if (!image) return res.sendStatus(404);
  db.prepare('DELETE FROM event_images WHERE id=?').run(image.id); fs.unlink(path.join(uploadsDir, image.stored_name), () => {}); res.json({ ok: true });
});
app.post('/api/admin/events/:id/images/order', adminOnly, (req, res) => {
  const ids = Array.isArray(req.body.ids) ? req.body.ids.map(Number) : [];
  const found = db.prepare('SELECT id FROM event_images WHERE event_id=?').all(req.params.id).map(image => image.id);
  if (ids.length !== found.length || ids.some(id => !found.includes(id)) || new Set(ids).size !== ids.length) return res.status(400).json({ error: 'Не удалось изменить порядок изображений' });
  const update = db.prepare('UPDATE event_images SET position=? WHERE id=?'); db.transaction(() => ids.forEach((id, position) => update.run(position, id)))(); res.json({ ok: true });
});
app.post('/api/admin/posts', adminOnly, (req, res) => {
  const title = String(req.body.title || '').trim();
  if (!title) return res.status(400).json({ error: 'Добавьте название поста' });
  const audience = ['all', 'event', 'manual'].includes(req.body.audience) ? req.body.audience : 'all';
  const eventId = audience === 'event' && Number(req.body.event_id) ? Number(req.body.event_id) : null;
  const result = db.prepare('INSERT INTO posts (title,content,audience,event_id,updated_at) VALUES (?,?,?,?,?)')
    .run(title, telegramHtml(req.body.content || ''), audience, eventId, nowIso());
  res.json({ ok: true, id: Number(result.lastInsertRowid) });
});
app.post('/api/admin/posts/:id', adminOnly, (req, res) => {
  const title = String(req.body.title || '').trim();
  if (!title) return res.status(400).json({ error: 'Добавьте название поста' });
  const audience = ['all', 'event', 'manual'].includes(req.body.audience) ? req.body.audience : 'all';
  const eventId = audience === 'event' && Number(req.body.event_id) ? Number(req.body.event_id) : null;
  const result = db.prepare('UPDATE posts SET title=?, content=?, audience=?, event_id=?, updated_at=? WHERE id=?')
    .run(title, telegramHtml(req.body.content || ''), audience, eventId, nowIso(), req.params.id);
  if (!result.changes) return res.sendStatus(404);
  res.json({ ok: true, id: Number(req.params.id) });
});
app.post('/api/admin/posts/:id/images', adminOnly, upload.array('images', 9), (req, res) => {
  const files = req.files || [];
  const post = db.prepare('SELECT id FROM posts WHERE id=?').get(req.params.id);
  if (!post) return res.sendStatus(404);
  if (files.some(file => !file.mimetype.startsWith('image/'))) return res.status(400).json({ error: 'Можно загрузить только изображения' });
  const currentCount = db.prepare('SELECT COUNT(*) AS count FROM post_images WHERE post_id=?').get(post.id).count;
  if (currentCount + files.length > 9) return res.status(400).json({ error: 'В одном посте может быть не больше 9 изображений' });
  const position = db.prepare('SELECT COALESCE(MAX(position), -1) AS max FROM post_images WHERE post_id=?').get(post.id).max;
  const insert = db.prepare('INSERT INTO post_images (post_id,original_name,stored_name,position) VALUES (?,?,?,?)');
  const images = files.map((file, index) => ({ id: Number(insert.run(post.id, file.originalname, file.filename, position + index + 1).lastInsertRowid) }));
  res.json({ ok: true, images });
});
app.get('/api/admin/post-images/:id', adminOnly, (req, res) => { const image = db.prepare('SELECT * FROM post_images WHERE id=?').get(req.params.id); if (!image) return res.sendStatus(404); return res.sendFile(path.join(uploadsDir, image.stored_name)); });
app.delete('/api/admin/post-images/:id', adminOnly, (req, res) => {
  const image = db.prepare('SELECT * FROM post_images WHERE id=?').get(req.params.id);
  if (!image) return res.sendStatus(404);
  db.prepare('DELETE FROM post_images WHERE id=?').run(image.id); fs.unlink(path.join(uploadsDir, image.stored_name), () => {}); res.json({ ok: true });
});
app.post('/api/admin/posts/:id/images/order', adminOnly, (req, res) => {
  const ids = Array.isArray(req.body.ids) ? req.body.ids.map(Number) : [];
  const found = db.prepare('SELECT id FROM post_images WHERE post_id=?').all(req.params.id).map(image => image.id);
  if (ids.length !== found.length || ids.some(id => !found.includes(id)) || new Set(ids).size !== ids.length) return res.status(400).json({ error: 'Не удалось изменить порядок изображений' });
  const update = db.prepare('UPDATE post_images SET position=? WHERE id=?'); db.transaction(() => ids.forEach((id, position) => update.run(position, id)))(); res.json({ ok: true });
});
app.post('/api/admin/posts/:id/files', adminOnly, upload.array('files', 10), (req, res) => {
  const post = db.prepare('SELECT id FROM posts WHERE id=?').get(req.params.id);
  if (!post) return res.sendStatus(404);
  const files = req.files || [];
  const insert = db.prepare('INSERT INTO post_files (post_id,original_name,stored_name) VALUES (?,?,?)');
  const saved = files.map(file => ({ id: Number(insert.run(post.id, file.originalname, file.filename).lastInsertRowid), original_name: file.originalname }));
  res.json({ ok: true, files: saved });
});
app.get('/api/admin/post-files/:id', adminOnly, (req, res) => { const file = db.prepare('SELECT * FROM post_files WHERE id=?').get(req.params.id); if (!file) return res.sendStatus(404); return res.download(path.join(uploadsDir, file.stored_name), file.original_name); });
app.delete('/api/admin/post-files/:id', adminOnly, (req, res) => {
  const file = db.prepare('SELECT * FROM post_files WHERE id=?').get(req.params.id);
  if (!file) return res.sendStatus(404);
  db.prepare('DELETE FROM post_files WHERE id=?').run(file.id); fs.unlink(path.join(uploadsDir, file.stored_name), () => {}); res.json({ ok: true });
});
app.post('/api/admin/events/:id/message-images/:key', adminOnly, upload.array('images', 9), (req, res) => {
  const messageKeys = new Set(['registration', 'invite', 'expired', 'confirmed', 'declined', 'reminder']);
  if (!messageKeys.has(req.params.key)) return res.status(400).json({ error: 'Неизвестный тип сообщения' });
  const files = req.files || [];
  if (files.some(file => !file.mimetype.startsWith('image/'))) return res.status(400).json({ error: 'Можно загрузить только изображения' });
  const currentCount = db.prepare('SELECT COUNT(*) AS count FROM event_message_images WHERE event_id=? AND message_key=?').get(req.params.id, req.params.key).count;
  if (currentCount + files.length > 9) return res.status(400).json({ error: 'В одном сообщении может быть не больше 9 изображений' });
  const position = db.prepare('SELECT COALESCE(MAX(position), -1) AS max FROM event_message_images WHERE event_id=? AND message_key=?').get(req.params.id, req.params.key).max;
  const insert = db.prepare('INSERT INTO event_message_images (event_id,message_key,original_name,stored_name,position) VALUES (?,?,?,?,?)');
  const images = files.map((file, index) => {
    const result = insert.run(req.params.id, req.params.key, file.originalname, file.filename, position + index + 1);
    return { id: Number(result.lastInsertRowid), original_name: file.originalname, position: position + index + 1 };
  });
  res.json({ ok: true, images });
});
app.get('/api/admin/message-images/:id', adminOnly, (req, res) => { const image = db.prepare('SELECT * FROM event_message_images WHERE id=?').get(req.params.id); if (!image) return res.sendStatus(404); return res.sendFile(path.join(uploadsDir, image.stored_name)); });
app.delete('/api/admin/message-images/:id', adminOnly, (req, res) => {
  const image = db.prepare('SELECT * FROM event_message_images WHERE id=?').get(req.params.id);
  if (!image) return res.sendStatus(404);
  db.prepare('DELETE FROM event_message_images WHERE id=?').run(req.params.id);
  fs.unlink(path.join(uploadsDir, image.stored_name), () => {});
  res.json({ ok: true });
});
app.post('/api/admin/events/:id/message-images/:key/order', adminOnly, (req, res) => {
  const ids = Array.isArray(req.body.ids) ? req.body.ids.map(Number) : [];
  const found = db.prepare(`SELECT id FROM event_message_images WHERE event_id=? AND message_key=? ORDER BY position`).all(req.params.id, req.params.key).map(image => image.id);
  if (ids.length !== found.length || ids.some(id => !found.includes(id)) || new Set(ids).size !== ids.length) return res.status(400).json({ error: 'Не удалось изменить порядок изображений' });
  const update = db.prepare('UPDATE event_message_images SET position=? WHERE id=?');
  db.transaction(() => ids.forEach((id, position) => update.run(position, id)))();
  res.json({ ok: true });
});
app.post('/api/admin/checkin', adminOnly, (req, res) => {
  const raw = String(req.body.code || '').trim();
  const eventId = Number(req.body.event_id);
  if (!raw) return res.status(400).json({ error: 'Введите код из QR' });
  const byToken = db.prepare(`SELECT i.*, a.name, a.event_id, e.title FROM invitations i JOIN applicants a ON a.id=i.applicant_id JOIN events e ON e.id=a.event_id
    WHERE i.checkin_token=? ${eventId ? 'AND a.event_id=?' : ''}`).get(...(eventId ? [raw, eventId] : [raw]));
  const row = byToken || db.prepare(`SELECT i.*, a.name, a.event_id, e.title FROM invitations i JOIN applicants a ON a.id=i.applicant_id JOIN events e ON e.id=a.event_id
    WHERE upper(substr(i.checkin_token,1,8))=? ${eventId ? 'AND a.event_id=?' : ''}`).get(...(eventId ? [raw.toUpperCase(), eventId] : [raw.toUpperCase()]));
  if (!row) return res.status(404).json({ error: 'Код не найден для этого мероприятия' });
  if (row.status !== 'confirmed') return res.status(409).json({ error: 'Участие этого гостя не подтверждено' });
  if (row.checked_in_at) return res.status(409).json({ error: 'Гость уже отмечен', guest: row.name, already: true });
  db.prepare('UPDATE invitations SET checked_in_at=? WHERE id=?').run(nowIso(), row.id);
  res.json({ ok: true, guest: row.name, event: row.title });
});
app.post('/admin/events/:id/assets', adminOnly, upload.single('material'), (req, res) => {
  if (req.file) db.prepare('INSERT INTO event_assets (event_id,original_name,stored_name,delivery_stage) VALUES (?,?,?,?)').run(req.params.id, req.file.originalname, req.file.filename, req.body.delivery_stage);
  res.redirect(`/admin?event=${req.params.id}`);
});
app.get('/admin/assets/:id', adminOnly, (req, res) => { const asset = db.prepare('SELECT * FROM event_assets WHERE id=?').get(req.params.id); if (!asset) return res.sendStatus(404); return res.download(path.join(uploadsDir, asset.stored_name), asset.original_name); });
app.post('/admin/invite/:id', adminOnly, async (req, res) => { try { await sendInvite(Number(req.params.id)); } catch (e) { return res.status(400).send(layout('Ошибка', `<p>${esc(e.message)}</p><p><a href="/admin">Назад</a></p>`)); } res.redirect('back'); });
app.get('/admin/checkin', adminOnly, (req, res) => res.send(layout('Чек-ин', `<h1>Чек-ин</h1><form method="post"><input name="code" autofocus placeholder="Вставьте QR-значение или код"><button>Отметить</button></form><p>QR можно сканировать камерой телефона в любом совместимом сканере и вставить полученное значение сюда.</p>`)));
app.post('/admin/checkin', adminOnly, (req, res) => { const raw = String(req.body.code || '').trim(); const row = db.prepare(`SELECT i.*, a.name, e.title FROM invitations i JOIN applicants a ON a.id=i.applicant_id JOIN events e ON e.id=a.event_id WHERE i.checkin_token=?`).get(raw) || db.prepare(`SELECT i.*, a.name, e.title FROM invitations i JOIN applicants a ON a.id=i.applicant_id JOIN events e ON e.id=a.event_id WHERE upper(substr(i.checkin_token,1,8))=?`).get(raw.toUpperCase()); if (!row) return res.status(404).send(layout('Не найдено', '<p>Код не найден.</p><p><a href="/admin/checkin">Назад</a></p>')); if (row.checked_in_at) return res.send(layout('Уже отмечен', `<p>${esc(row.name)} уже был отмечен: ${new Date(row.checked_in_at).toLocaleString('ru-RU')}.</p><p><a href="/admin/checkin">Назад</a></p>`)); db.prepare('UPDATE invitations SET checked_in_at=? WHERE id=?').run(nowIso(), row.id); res.send(layout('Готово', `<h1>✓ ${esc(row.name)}</h1><p>Отмечен на «${esc(row.title)}».</p><p><a href="/admin/checkin">Сканировать следующего</a></p>`)); });
app.get('/admin/export/:eventId', adminOnly, (req, res) => { const rows = db.prepare(`SELECT a.name,a.phone,a.telegram_name,a.status,i.status invitation_status,i.checked_in_at FROM applicants a LEFT JOIN invitations i ON i.applicant_id=a.id WHERE a.event_id=?`).all(req.params.eventId); const csv = ['name,phone,telegram_username,applicant_status,invitation_status,checked_in_at', ...rows.map(r => [r.name,r.phone,r.telegram_name,r.status,r.invitation_status,r.checked_in_at].map(v => `"${String(v || '').replaceAll('"','""')}"`).join(','))].join('\n'); res.type('text/csv').attachment('guests.csv').send(csv); });
function eventSettings(event, assets) {
  const field = (name, label, fallback = '') => `<label>${label}<textarea name="${name}" rows="3" placeholder="${esc(fallback)}">${esc(event[name] || fallback)}</textarea></label>`;
  return `<hr><details open><summary><strong>Тексты и материалы</strong></summary><form method="post" action="/admin/events/${event.id}/settings" class="settings">
    ${field('registration_text', 'Карточка регистрации', event.description || 'Описание, которое человек увидит до подачи заявки')}
    ${field('received_text', 'После принятия заявки', defaultText.received)}
    ${field('invite_text', 'Приглашение', defaultText.invite)}
    ${field('confirmed_text', 'После подтверждения', defaultText.confirmed)}
    ${field('declined_text', 'После отказа', defaultText.declined)}
    ${field('reminder_text', 'Напоминание за сутки', defaultText.reminder)}
    <p><small>Используйте <code>{event}</code>, чтобы подставить название мероприятия.</small></p><button>Сохранить тексты</button></form>
    <form method="post" action="/admin/events/${event.id}/assets" enctype="multipart/form-data"><label>Материал <input type="file" name="material" required></label><select name="delivery_stage"><option value="confirmed">Отправить после подтверждения</option><option value="reminder">Отправить в напоминании за сутки</option></select><button>Загрузить</button></form>
    ${assets.length ? `<ul>${assets.map(asset => `<li><a href="/admin/assets/${asset.id}">${esc(asset.original_name)}</a> — ${asset.delivery_stage === 'confirmed' ? 'после подтверждения' : 'в напоминании'}</li>`).join('')}</ul>` : '<p><small>Материалы ещё не загружены.</small></p>'}
  </details>`;
}
function layout(title, body) { return `<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><style>
:root{--ds-background:#fff;--ds-foreground:#111;--ds-gray-100:#fafafa;--ds-gray-200:#eaeaea;--ds-gray-400:#888;--ds-gray-600:#666;--ds-blue:#0070f3;--ds-blue-hover:#0067df;--ds-focus:#79b8ff;--ds-radius:7px}*{box-sizing:border-box}body{margin:0;min-height:100vh;background:var(--ds-background);color:var(--ds-foreground);font:14px/1.55 Geist,ui-sans-serif,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.shell{width:min(1160px,calc(100% - 48px));margin:auto;padding:20px 0 72px}.masthead{height:46px;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid var(--ds-gray-200);color:var(--ds-gray-600);font-size:13px}.brand{color:var(--ds-foreground);font-size:15px;font-weight:600;letter-spacing:-.025em;text-decoration:none}.brand i{font-style:normal;color:var(--ds-blue)}.page{padding-top:42px}h1{margin:0 0 26px;font-size:32px;line-height:1.2;letter-spacing:-.045em;font-weight:600}h2{font-size:18px;line-height:1.35;letter-spacing:-.02em;margin:36px 0 14px;font-weight:600}h1+form,details{border:1px solid var(--ds-gray-200);border-radius:var(--ds-radius);padding:16px;background:var(--ds-background)}hr{border:0;border-top:1px solid var(--ds-gray-200);margin:34px 0}input,button,select,textarea{margin:4px 4px 4px 0;border-radius:var(--ds-radius);border:1px solid var(--ds-gray-200);background:var(--ds-background);color:var(--ds-foreground);font:inherit;padding:9px 11px}input::placeholder,textarea::placeholder{color:var(--ds-gray-400)}input:focus,textarea:focus,select:focus{outline:2px solid var(--ds-focus);outline-offset:1px;border-color:var(--ds-blue)}textarea{display:block;width:min(720px,100%);min-height:84px;resize:vertical}button{background:var(--ds-foreground);border-color:var(--ds-foreground);color:#fff;font-weight:500;cursor:pointer;transition:background .15s ease}button:hover{background:#333;border-color:#333}button:focus-visible,a:focus-visible,summary:focus-visible{outline:2px solid var(--ds-focus);outline-offset:3px}a{color:var(--ds-blue);text-decoration:none}a:hover{text-decoration:underline}p{color:var(--ds-gray-600)}p strong{color:var(--ds-foreground);font-weight:500}small{color:var(--ds-gray-600)}code{border:1px solid var(--ds-gray-200);border-radius:4px;background:var(--ds-gray-100);padding:1px 4px;font:12px ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--ds-foreground)}details{margin:24px 0}summary{cursor:pointer;font-size:15px;color:var(--ds-foreground)}details[open] summary{margin-bottom:14px}.settings{margin:10px 0}label{display:block;margin:15px 0;color:var(--ds-foreground);font-weight:500}label textarea{margin-top:7px;font-weight:400}table{border-collapse:separate;border-spacing:0;width:100%;overflow:hidden;border:1px solid var(--ds-gray-200);border-radius:var(--ds-radius)}td,th{border-bottom:1px solid var(--ds-gray-200);padding:13px 12px;text-align:left}th{color:var(--ds-gray-600);font-size:12px;font-weight:400}tr:last-child td{border-bottom:0}tr:hover td{background:var(--ds-gray-100)}td form{margin:0}td form button{padding:7px 10px;font-size:13px}ul{padding-left:20px;color:var(--ds-gray-600)}select{appearance:auto}@media(max-width:680px){.shell{width:min(100% - 28px,1160px);padding-top:12px}.masthead span{display:none}.page{padding-top:28px}h1{font-size:28px}table{display:block;overflow:auto;white-space:nowrap}input{width:100%}button{margin-top:8px}}
</style><body><main class="shell"><header class="masthead"><a class="brand" href="/admin">EVENT<i>OPS</i></a><span>управление мероприятиями</span></header><section class="page">${body}</section></main></body></html>`; }

const port = Number(process.env.PORT || 3000);
app.listen(port, () => console.log(`Admin: http://localhost:${port}/admin`));
if (process.env.BOT_TOKEN) {
  bot.start().catch(error => console.error('Telegram bot did not start:', error.message));
  setInterval(() => runAutomation().catch(console.error), 60_000);
  runAutomation().catch(console.error);
}

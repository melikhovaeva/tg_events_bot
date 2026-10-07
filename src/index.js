import 'dotenv/config';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import express from 'express';
import multer from 'multer';
import QRCode from 'qrcode';
import { Bot, InlineKeyboard, Keyboard, InputFile } from 'grammy';
import { agreementUrl, policyUrl, validateConfig } from './lib/config.js';
import { createDatabaseBackup, millisecondsUntilNextMoscowBackup } from './lib/backup.js';
import { loginPage } from './lib/login-page.js';
import { backupsDir, dbPath, ensureDataDirectories, uploadsDir } from './lib/paths.js';
import { defaultText, esc, eventText, messageOptions, nowIso, richTextHtml, telegramHtml, token } from './lib/text.js';
import { createInvitationService } from './services/invitations.js';
import { parseEventTime } from './lib/event-time.js';

validateConfig();

ensureDataDirectories();
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.exec(`
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY, title TEXT NOT NULL, starts_at TEXT NOT NULL,
  description TEXT, venue TEXT, chat_url TEXT, cover_stored_name TEXT, cover_original_name TEXT, registration_text TEXT, received_text TEXT,
  invite_text TEXT, expired_text TEXT, confirmed_text TEXT, declined_text TEXT, rejected_text TEXT, reminder_text TEXT,
  registration_open INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS applicants (
  id INTEGER PRIMARY KEY, event_id INTEGER NOT NULL REFERENCES events(id),
  name TEXT NOT NULL, email TEXT, phone TEXT, timepad_id TEXT, was_school_student INTEGER,
  claim_token TEXT NOT NULL UNIQUE, telegram_id TEXT, telegram_name TEXT,
  status TEXT NOT NULL DEFAULT 'awaiting_review', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS invitations (
  id INTEGER PRIMARY KEY, applicant_id INTEGER NOT NULL UNIQUE REFERENCES applicants(id),
  status TEXT NOT NULL DEFAULT 'pending', expires_at TEXT NOT NULL,
  responded_at TEXT, reminder_sent_at TEXT, final_expires_at TEXT, checkin_token TEXT UNIQUE,
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
  telegram_name TEXT, was_school_student INTEGER, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS profile_drafts (
  telegram_id TEXT PRIMARY KEY, continuation TEXT NOT NULL DEFAULT '', stage TEXT NOT NULL,
  name TEXT, phone TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
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
CREATE TABLE IF NOT EXISTS post_recipients (
  post_id INTEGER NOT NULL REFERENCES posts(id), telegram_id TEXT NOT NULL,
  PRIMARY KEY (post_id, telegram_id)
);
CREATE TABLE IF NOT EXISTS post_sends (
  id INTEGER PRIMARY KEY, post_id INTEGER NOT NULL REFERENCES posts(id), sender_id INTEGER REFERENCES admin_users(id),
  recipients_count INTEGER NOT NULL, sent_count INTEGER NOT NULL, failed_count INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS post_delivery_results (
  id INTEGER PRIMARY KEY, send_id INTEGER NOT NULL REFERENCES post_sends(id), telegram_id TEXT NOT NULL,
  status TEXT NOT NULL, reason TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS post_images (
  id INTEGER PRIMARY KEY, post_id INTEGER NOT NULL REFERENCES posts(id), original_name TEXT NOT NULL,
  stored_name TEXT NOT NULL UNIQUE, position INTEGER NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS post_files (
  id INTEGER PRIMARY KEY, post_id INTEGER NOT NULL REFERENCES posts(id), original_name TEXT NOT NULL,
  stored_name TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS admin_sessions (
  id TEXT PRIMARY KEY, expires_at INTEGER NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS admin_users (
  id INTEGER PRIMARY KEY, username TEXT NOT NULL UNIQUE, display_name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'director', password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, last_login_at TEXT
);
CREATE TABLE IF NOT EXISTS admin_audit_log (
  id INTEGER PRIMARY KEY, admin_user_id INTEGER REFERENCES admin_users(id),
  username TEXT NOT NULL, method TEXT NOT NULL, path TEXT NOT NULL,
  status_code INTEGER NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
`);
for (const [table, column, definition] of [
  ['events', 'description', 'TEXT'], ['events', 'venue', 'TEXT'], ['applicants', 'phone', 'TEXT'],
  ['events', 'registration_text', 'TEXT'], ['events', 'received_text', 'TEXT'], ['events', 'invite_text', 'TEXT'],
  ['events', 'confirmed_text', 'TEXT'], ['events', 'declined_text', 'TEXT'], ['events', 'rejected_text', 'TEXT'], ['events', 'reminder_text', 'TEXT'],
  ['events', 'expired_text', 'TEXT'], ['invitations', 'final_confirmed_at', 'TEXT'], ['invitations', 'final_expires_at', 'TEXT'],
  ['events', 'final_confirmed_text', 'TEXT'], ['events', 'final_declined_text', 'TEXT'],
  ['events', 'cover_stored_name', 'TEXT'], ['events', 'cover_original_name', 'TEXT'],
  ['events', 'registration_open', 'INTEGER NOT NULL DEFAULT 1'],
  ['applicants', 'was_school_student', 'INTEGER'],
  ['telegram_profiles', 'was_school_student', 'INTEGER'],
  ['profile_drafts', 'phone', 'TEXT'],
  ['admin_sessions', 'user_id', 'INTEGER REFERENCES admin_users(id)'],
  ['admin_users', 'is_active', 'INTEGER NOT NULL DEFAULT 1'],
  ['admin_users', 'event_id', 'INTEGER REFERENCES events(id)'],
  ['admin_audit_log', 'action', 'TEXT'],
  ['admin_audit_log', 'details', 'TEXT'],
]) {
  try { db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`); } catch { /* already exists */ }
}

// Before this status existed, an unanswered final confirmation was saved as a
// regular decline. A real decline always has responded_at, so this restores
// the distinction for existing guests as well.
db.transaction(() => {
  const missedFinals = db.prepare("SELECT applicant_id FROM invitations WHERE status='declined' AND final_expires_at IS NOT NULL AND final_confirmed_at IS NULL AND responded_at IS NULL").all();
  db.prepare("UPDATE invitations SET status='final_expired' WHERE status='declined' AND final_expires_at IS NOT NULL AND final_confirmed_at IS NULL AND responded_at IS NULL").run();
  const updateApplicant = db.prepare("UPDATE applicants SET status='final_expired' WHERE id=? AND status='declined'");
  missedFinals.forEach(({ applicant_id }) => updateApplicant.run(applicant_id));
})();

const mainKeyboard = () => new Keyboard()
  .text('Мероприятия').text('Мои регистрации').row()
  .text('Написать организатору').resized().persistent();
const userStatus = {
  awaiting_review: 'заявка рассматривается', pending: 'ждём ответа на приглашение',
  invited: 'ждём ответа на приглашение', confirmed: 'участие подтверждено',
  delivery_failed: 'приглашение пока не доставлено — мы попробуем отправить его ещё раз',
  declined: 'участие отменено', rejected: 'организатор пока не может пригласить вас', expired: 'ответ не получен',
  final_expired: 'финальное подтверждение не получено', cancelled: 'регистрация отменена',
};
function recordConversationMessage(telegramId, telegramName, direction, text) {
  const createdAt = nowIso();
  db.prepare('INSERT INTO conversation_messages (telegram_id,direction,text,created_at) VALUES (?,?,?,?)').run(telegramId, direction, text, createdAt);
  const unreadCount = direction === 'in' ? 1 : 0;
  db.prepare(`INSERT INTO conversations (telegram_id,telegram_name,last_message,last_message_at,unread_count) VALUES (?,?,?,?,?)
    ON CONFLICT(telegram_id) DO UPDATE SET telegram_name=COALESCE(excluded.telegram_name, conversations.telegram_name),last_message=excluded.last_message,last_message_at=excluded.last_message_at,unread_count=${direction === 'in' ? 'conversations.unread_count+1' : 'conversations.unread_count'}`)
    .run(telegramId, telegramName || null, text, createdAt, unreadCount);
}
function ensureConversationsForBotUsers() {
  const users = db.prepare(`
    SELECT telegram_id, telegram_name, accepted_at AS joined_at FROM telegram_consents
    UNION ALL
    SELECT telegram_id, telegram_name, updated_at AS joined_at FROM telegram_profiles
    UNION ALL
    SELECT telegram_id, telegram_name, created_at AS joined_at FROM applicants WHERE telegram_id IS NOT NULL
  `).all();
  const knownUsers = new Map();
  for (const user of users) {
    if (!user.telegram_id) continue;
    const known = knownUsers.get(user.telegram_id);
    if (!known || user.joined_at > known.joined_at || (!known.telegram_name && user.telegram_name)) knownUsers.set(user.telegram_id, user);
  }
  const add = db.prepare('INSERT OR IGNORE INTO conversations (telegram_id,telegram_name,last_message,last_message_at,unread_count) VALUES (?,?,?,?,0)');
  const addName = db.prepare('UPDATE conversations SET telegram_name=COALESCE(telegram_name, ?) WHERE telegram_id=?');
  db.transaction(() => {
    knownUsers.forEach((user) => {
      add.run(user.telegram_id, user.telegram_name || null, '', user.joined_at || nowIso());
      if (user.telegram_name) addName.run(user.telegram_name, user.telegram_id);
    });
  })();
}
const sessionDurationMs = 30 * 24 * 60 * 60 * 1000;
function passwordHash(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(password), salt, 64);
  return `scrypt$${salt.toString('base64url')}$${hash.toString('base64url')}`;
}
function passwordMatches(password, encoded) {
  const [algorithm, salt, expected] = String(encoded || '').split('$');
  if (algorithm !== 'scrypt' || !salt || !expected) return false;
  const actual = crypto.scryptSync(String(password), Buffer.from(salt, 'base64url'), 64);
  const target = Buffer.from(expected, 'base64url');
  return actual.length === target.length && crypto.timingSafeEqual(actual, target);
}
if (!db.prepare('SELECT 1 FROM admin_users LIMIT 1').get()) {
  db.prepare("INSERT INTO admin_users (username,display_name,role,password_hash) VALUES ('admin','Ева-София Мелихова','admin',?)")
    .run(passwordHash(process.env.ADMIN_PASSWORD));
}
// Rename the initial bootstrap account to the administrator's chosen login.
// Existing sessions remain valid because they are linked by user ID.
db.prepare("UPDATE admin_users SET username='shultsee' WHERE username='admin' AND NOT EXISTS(SELECT 1 FROM admin_users WHERE username='shultsee')").run();
db.prepare("UPDATE admin_sessions SET user_id=(SELECT id FROM admin_users WHERE username IN ('shultsee','admin') LIMIT 1) WHERE user_id IS NULL").run();
function sessionCookie(sessionId) {
  return `event_ops_session=${sessionId}; Max-Age=${sessionDurationMs / 1000}; Path=/; HttpOnly; SameSite=Lax${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`;
}
function readCookie(req, name) {
  const pair = (req.headers.cookie || '').split(';').map(part => part.trim()).find(part => part.startsWith(`${name}=`));
  return pair ? decodeURIComponent(pair.slice(name.length + 1)) : null;
}
function currentAdmin(req) {
  const id = readCookie(req, 'event_ops_session');
  if (!id) return null;
  const session = db.prepare(`SELECT s.id AS session_id, s.expires_at, u.id, u.username, u.display_name, u.role, u.event_id
    FROM admin_sessions s JOIN admin_users u ON u.id=s.user_id WHERE s.id=? AND u.is_active=1`).get(id);
  if (!session || session.expires_at <= Date.now()) {
    db.prepare('DELETE FROM admin_sessions WHERE id=?').run(id);
    return null;
  }
  return session;
}
function isAdmin(req) {
  return Boolean(currentAdmin(req));
}
function auditFallback(method, path) {
  if (method === 'POST' && path === '/login') return 'Вошёл в систему';
  if (method === 'POST' && path === '/admin/events') return 'Создал мероприятие';
  if (method === 'POST' && /\/api\/admin\/events\/\d+$/.test(path)) return 'Изменил мероприятие';
  if (method === 'DELETE' && /\/api\/admin\/events\/\d+$/.test(path)) return 'Удалил мероприятие';
  if (method === 'POST' && /\/api\/admin\/events\/\d+\/texts$/.test(path)) return 'Изменил тексты мероприятия';
  if (method === 'POST' && /\/api\/admin\/events\/\d+\/registration$/.test(path)) return 'Изменил регистрацию мероприятия';
  if (method === 'POST' && /\/api\/admin\/events\/\d+\/invitations$/.test(path)) return 'Отправил приглашения';
  if (method === 'POST' && /\/api\/admin\/posts$/.test(path)) return 'Создал пост';
  if (method === 'POST' && /\/api\/admin\/posts\/\d+$/.test(path)) return 'Изменил пост';
  if (method === 'POST' && /\/api\/admin\/posts\/\d+\/send$/.test(path)) return 'Отправил пост';
  if (method === 'POST' && path === '/api/admin/checkin') return 'Отметил гостя на чек-ине';
  if (method === 'DELETE' && /\/api\/admin\/applicants\/\d+$/.test(path)) return 'Удалил регистрацию гостя';
  if (method === 'POST' && /\/api\/admin\/applicants\/\d+\/reject$/.test(path)) return 'Отказал в приглашении';
  if (method === 'POST' && /\/api\/admin\/applicants\/\d+\/block$/.test(path)) return 'Изменил доступ гостя к боту';
  if (method === 'POST' && path === '/api/admin/users') return 'Создал учётную запись';
  if (method === 'POST' && /\/api\/admin\/users\/\d+\/status$/.test(path)) return 'Изменил доступ сотрудника';
  if (method === 'POST' && path === '/api/admin/account/password') return 'Изменил пароль';
  return 'Изменил данные в системе';
}

// До появления полей action/details журнал хранил только технический маршрут.
// Переводим прежние записи один раз при запуске, чтобы старая история тоже была читаемой.
const legacyAuditRows = db.prepare("SELECT id, method, path FROM admin_audit_log WHERE action IS NULL OR TRIM(action) = ''").all();
const updateLegacyAuditAction = db.prepare('UPDATE admin_audit_log SET action=? WHERE id=?');
for (const entry of legacyAuditRows) updateLegacyAuditAction.run(auditFallback(entry.method, entry.path), entry.id);

const auditPageSize = 20;
function auditLogPage(beforeId = null) {
  const before = Number(beforeId);
  const rows = Number.isInteger(before) && before > 0
    ? db.prepare('SELECT * FROM admin_audit_log WHERE id<? ORDER BY id DESC LIMIT ?').all(before, auditPageSize + 1)
    : db.prepare('SELECT * FROM admin_audit_log ORDER BY id DESC LIMIT ?').all(auditPageSize + 1);
  return { entries: rows.slice(0, auditPageSize), hasMore: rows.length > auditPageSize };
}

function setAudit(req, action, details = null) {
  req.auditAction = action;
  req.auditDetails = details;
}
const adminOnly = (req, res, next) => {
  const user = currentAdmin(req);
  if (user) {
    req.adminUser = user;
    if (user.role === 'assistant' && req.path.startsWith('/api/admin/') && !['/api/admin/state', '/api/admin/checkin', '/api/admin/account/password'].includes(req.path)) {
      return res.status(403).json({ error: 'Помощнику доступны только список гостей и чек-ин назначенного мероприятия' });
    }
    const sessionId = readCookie(req, 'event_ops_session');
    db.prepare('UPDATE admin_sessions SET expires_at=? WHERE id=?').run(Date.now() + sessionDurationMs, sessionId);
    res.set('Set-Cookie', sessionCookie(sessionId));
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.once('finish', () => {
        db.prepare('INSERT INTO admin_audit_log (admin_user_id,username,method,path,status_code,action,details) VALUES (?,?,?,?,?,?,?)')
          .run(user.id, user.username, req.method, req.path, res.statusCode, req.auditAction || auditFallback(req.method, req.path), req.auditDetails || null);
      });
    }
    return next();
  }
  if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Сессия закончилась. Войдите снова.' });
  return res.redirect('/login/form');
};
const primaryAdminOnly = (req, res, next) => adminOnly(req, res, () => {
  if (req.adminUser.role === 'admin') return next();
  return res.status(403).json({ error: 'Только администратор может управлять учётными записями' });
});

const bot = new Bot(process.env.BOT_TOKEN || '');
const botEnabled = Boolean(process.env.BOT_TOKEN) && process.env.BOT_ENABLED !== 'false';
const { runAutomation, sendAssets, sendInvite, sendMessageImages, updateInviteAttempt } = createInvitationService({ db, bot });
async function sendCheckinQr(ctx, row, checkinToken, qr) {
  const event = db.prepare('SELECT * FROM events WHERE id=?').get(row.event_id);
  const caption = `${eventText(event, 'final_confirmed').trim()}\n\nРезервный код: ${checkinToken.slice(0, 8).toUpperCase()}`;
  if (caption.length <= 1024) await ctx.replyWithPhoto(new InputFile(qr, 'checkin.png'), messageOptions({ caption }));
  else {
    await ctx.replyWithPhoto(new InputFile(qr, 'checkin.png'));
    await ctx.reply(caption, messageOptions());
  }
  await sendMessageImages(row.telegram_id, row.event_id, 'final_confirmed');
}
const transcriptForApiCall = (method, payload) => {
  if (method === 'sendMessage') return payload.text;
  if (method === 'sendPhoto') return payload.caption || '🖼 Изображение';
  if (method === 'sendDocument') return payload.caption || '📎 Файл';
  if (method === 'sendMediaGroup') return `🖼 Изображения: ${Array.isArray(payload.media) ? payload.media.length : 1}`;
  return null;
};
bot.api.config.use(async (prev, method, payload, signal) => {
  const result = await prev(method, payload, signal);
  const text = transcriptForApiCall(method, payload);
  if (text && payload.chat_id) recordConversationMessage(String(payload.chat_id), null, 'out', text);
  return result;
});
bot.catch((error) => console.error('Ошибка обработки сообщения Telegram:', error.error || error));
if (botEnabled) {
  bot.api.setMyCommands([
    { command: 'events', description: 'Посмотреть мероприятия' },
    { command: 'my', description: 'Мои регистрации' },
    { command: 'help', description: 'Помощь' },
  ]).catch(console.error);
}
bot.use(async (ctx, next) => {
  const telegramId = ctx.from?.id ? String(ctx.from.id) : null;
  if (!telegramId || !db.prepare('SELECT 1 FROM blocked_users WHERE telegram_id=?').get(telegramId)) return next();
  if (ctx.callbackQuery) await ctx.answerCallbackQuery({ text: 'Доступ к боту ограничен.', show_alert: true });
  else if (ctx.chat) await ctx.reply('Доступ к этому боту ограничен.');
});
bot.use(async (ctx, next) => {
  const telegramId = ctx.from?.id ? String(ctx.from.id) : null;
  const message = ctx.message;
  if (telegramId && message) {
    const text = message.text || message.caption || (message.contact ? '📱 Отправил номер телефона' : message.photo ? '🖼 Отправил изображение' : message.document ? '📎 Отправил файл' : null);
    if (text) recordConversationMessage(telegramId, ctx.from?.username || null, 'in', text);
  }
  return next();
});
async function requestProfile(ctx, continuation = '') {
  const telegramId = String(ctx.from.id);
  db.prepare(`INSERT INTO profile_drafts (telegram_id,continuation,stage,name,phone) VALUES (?,?,'name',NULL,NULL)
    ON CONFLICT(telegram_id) DO UPDATE SET continuation=excluded.continuation,stage='name',name=NULL,phone=NULL`).run(telegramId, continuation || '');
  return ctx.reply('Спасибо. Теперь сохраним данные для регистрации на мероприятия Perasperadastra.\n\nФИО и номер телефона будут использоваться, чтобы оформить ваши будущие заявки и связаться с вами по событию.\n\nНапишите ваши имя и фамилию.', { reply_markup: { remove_keyboard: true } });
}
async function requestSchoolStatus(ctx, continuation, profile) {
  const telegramId = String(ctx.from.id);
  db.prepare(`INSERT INTO profile_drafts (telegram_id,continuation,stage,name,phone) VALUES (?,?,'school',?,?)
    ON CONFLICT(telegram_id) DO UPDATE SET continuation=excluded.continuation,stage='school',name=excluded.name,phone=excluded.phone`)
    .run(telegramId, continuation || '', profile.name, profile.phone);
  const keyboard = new InlineKeyboard().text('Да', 'school:yes').text('Нет', 'school:no');
  return ctx.reply('Подскажите, пожалуйста: вы были студентом школы Perasperadastra?', { reply_markup: keyboard });
}
async function continueStart(ctx, claim) {
  const profile = db.prepare('SELECT * FROM telegram_profiles WHERE telegram_id=?').get(String(ctx.from.id));
  if (!profile) return requestProfile(ctx, claim);
  if (profile.was_school_student === null || profile.was_school_student === undefined) return requestSchoolStatus(ctx, claim, profile);
  const eventMatch = claim?.match(/^event_(\d+)$/);
  if (eventMatch) {
    const event = db.prepare('SELECT * FROM events WHERE id=?').get(eventMatch[1]);
    if (!event) return ctx.reply('Это мероприятие не найдено или уже недоступно.');
    const details = [event.registration_text || event.description, event.registration_open ? 'Регистрация открыта' : 'Регистрация закрыта'].filter(Boolean).join('\n\n');
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

bot.callbackQuery(/^school:(yes|no)$/, async ctx => {
  const telegramId = String(ctx.from.id);
  const draft = db.prepare("SELECT * FROM profile_drafts WHERE telegram_id=? AND stage='school'").get(telegramId);
  if (!draft) return ctx.answerCallbackQuery({ text: 'Анкета уже заполнена.', show_alert: true });
  const wasSchoolStudent = ctx.match[1] === 'yes' ? 1 : 0;
  db.prepare(`INSERT INTO telegram_profiles (telegram_id,name,phone,telegram_name,was_school_student,created_at,updated_at) VALUES (?,?,?,?,?,?,?)
    ON CONFLICT(telegram_id) DO UPDATE SET name=excluded.name,phone=excluded.phone,telegram_name=excluded.telegram_name,was_school_student=excluded.was_school_student,updated_at=excluded.updated_at`)
    .run(telegramId, draft.name, draft.phone, ctx.from.username || null, wasSchoolStudent, nowIso(), nowIso());
  db.prepare('DELETE FROM profile_drafts WHERE telegram_id=?').run(telegramId);
  await ctx.answerCallbackQuery({ text: 'Ответ сохранён' });
  await ctx.editMessageText('Спасибо, ответ сохранён.');
  return continueStart(ctx, draft.continuation);
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
  if (existing) db.prepare("UPDATE applicants SET name=?,phone=?,was_school_student=?,claim_token=?,telegram_name=?,status='awaiting_review' WHERE id=?")
    .run(profile.name, profile.phone, profile.was_school_student, token(), ctx.from.username || null, existing.id);
  else db.prepare('INSERT INTO applicants (event_id,name,phone,was_school_student,claim_token,telegram_id,telegram_name,status) VALUES (?,?,?,?,?,?,?,?)')
    .run(event.id, profile.name, profile.phone, profile.was_school_student, token(), telegramId, ctx.from.username || null, 'awaiting_review');
  await ctx.answerCallbackQuery({ text: 'Регистрация принята' });
  // An event card may include a separate image album. Do not replace the
  // card's text after a click: send the resulting status as a new message.
  return ctx.reply(eventText(event, 'received'), messageOptions({ reply_markup: mainKeyboard() }));
});

bot.on('message:contact', async ctx => {
  const telegramId = String(ctx.from.id);
  const profileDraft = db.prepare('SELECT * FROM profile_drafts WHERE telegram_id=? AND stage=\'phone\'').get(telegramId);
  if (profileDraft && ctx.message.contact.user_id === ctx.from.id) {
    db.prepare("UPDATE profile_drafts SET stage='school',phone=? WHERE telegram_id=?").run(ctx.message.contact.phone_number, telegramId);
    const keyboard = new InlineKeyboard().text('Да', 'school:yes').text('Нет', 'school:no');
    return ctx.reply('Подскажите, пожалуйста: вы были студентом школы Perasperadastra?', { reply_markup: keyboard });
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
    if (profileDraft.stage === 'school') return ctx.reply('Пожалуйста, выберите «Да» или «Нет» кнопкой выше.');
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
  const applications = db.prepare(`SELECT a.*, e.title, e.starts_at, e.description, e.registration_text, e.venue, i.status AS invitation_status
    FROM applicants a JOIN events e ON e.id=a.event_id LEFT JOIN invitations i ON i.applicant_id=a.id
    WHERE a.telegram_id=? ORDER BY e.starts_at DESC`).all(String(ctx.from.id));
  if (!applications.length) return ctx.reply('У вас пока нет регистраций. Откройте «Мероприятия», чтобы выбрать событие.', { reply_markup: mainKeyboard() });
  for (const application of applications) {
    const status = application.invitation_status || application.status;
    const completedStatuses = new Set(['cancelled', 'declined', 'rejected', 'expired', 'final_expired']);
    const keyboard = completedStatuses.has(status) || completedStatuses.has(application.status)
      ? undefined
      : new InlineKeyboard().text('Отменить регистрацию', `withdraw:${application.id}`);
    const announcement = application.registration_text || application.description;
    const text = [
      `<b>«${esc(application.title)}»</b>`,
      announcement && telegramHtml(announcement).trim(),
      `Статус: ${esc(userStatus[status] || status)}`,
    ].filter(Boolean).join('\n\n');
    await ctx.reply(text, messageOptions({ reply_markup: keyboard }));
  }
}
bot.callbackQuery(/^event:(\d+)$/, async ctx => {
  await ctx.answerCallbackQuery({ text: 'Открываю мероприятие' });
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
  await ctx.answerCallbackQuery({ text: answer === 'yes' ? 'Участие подтверждено' : 'Отказ сохранён' });
  if (answer === 'no') {
    db.prepare("UPDATE invitations SET status='declined', responded_at=? WHERE id=?").run(nowIso(), id);
    updateInviteAttempt(id, 'declined', true);
    db.prepare("UPDATE applicants SET status='declined' WHERE id=?").run(row.applicant_id);
    await ctx.editMessageText(eventText(row, 'declined'), messageOptions()); await sendMessageImages(row.telegram_id, row.event_id, 'declined');
  } else {
    const directCheckin = new Date(row.starts_at).getTime() - Date.now() <= 24 * 60 * 60 * 1000;
    const checkinToken = directCheckin ? token() : null;
    db.prepare("UPDATE invitations SET status='confirmed', responded_at=?, checkin_token=?, final_confirmed_at=? WHERE id=?").run(nowIso(), checkinToken, directCheckin ? nowIso() : null, id);
    updateInviteAttempt(id, 'confirmed', true);
    db.prepare("UPDATE applicants SET status='confirmed' WHERE id=?").run(row.applicant_id);
    await ctx.editMessageText(directCheckin ? 'Участие подтверждено. QR-код для входа придёт следующим сообщением.' : eventText(row, 'confirmed'), messageOptions({ reply_markup: new InlineKeyboard().text('Не смогу прийти', `cancel:${id}`) })); await sendMessageImages(row.telegram_id, row.event_id, 'confirmed');
    if (row.chat_url) await ctx.reply(`Пока можете присоединиться к чату мероприятия: ${row.chat_url}`);
    if (directCheckin) {
      const qr = await QRCode.toBuffer(checkinToken, { width: 900, margin: 4, errorCorrectionLevel: 'H' });
      await sendAssets(row.telegram_id, row.event_id, 'confirmed');
      await sendCheckinQr(ctx, row, checkinToken, qr);
    }
  }
  return;
});

bot.callbackQuery(/^cancel:(\d+)$/, async ctx => {
  const row = db.prepare(`SELECT i.*, a.telegram_id, a.id applicant_id, e.id event_id, e.title, e.declined_text FROM invitations i JOIN applicants a ON a.id=i.applicant_id JOIN events e ON e.id=a.event_id WHERE i.id=?`).get(ctx.match[1]);
  if (!row || row.telegram_id !== String(ctx.from.id) || row.status !== 'confirmed') return ctx.answerCallbackQuery({ text: 'Это участие уже нельзя отменить.', show_alert: true });
  await ctx.answerCallbackQuery({ text: 'Участие отменено' });
  db.prepare("UPDATE invitations SET status='declined', responded_at=? WHERE id=?").run(nowIso(), row.id);
  updateInviteAttempt(row.id, 'declined', true);
  db.prepare("UPDATE applicants SET status='declined' WHERE id=?").run(row.applicant_id);
  await ctx.editMessageText(eventText(row, 'declined'), messageOptions()); await sendMessageImages(row.telegram_id, row.event_id, 'declined');
  return;
});
bot.callbackQuery(/^final:(yes|no):(\d+)$/, async ctx => {
  const [, answer, id] = ctx.match;
  const row = db.prepare('SELECT i.*, a.telegram_id, a.id applicant_id, e.id event_id, e.final_declined_text, e.title FROM invitations i JOIN applicants a ON a.id=i.applicant_id JOIN events e ON e.id=a.event_id WHERE i.id=?').get(id);
  if (!row || row.telegram_id !== String(ctx.from.id) || row.status !== 'confirmed') return ctx.answerCallbackQuery({ text: 'Приглашение не найдено.', show_alert: true });
  if (row.final_confirmed_at || !row.final_expires_at || new Date(row.final_expires_at) <= new Date()) return ctx.answerCallbackQuery({ text: 'Срок финального подтверждения закончился.', show_alert: true });
  await ctx.answerCallbackQuery({ text: answer === 'yes' ? 'Подтверждение сохранено' : 'Участие отменено' });
  if (answer === 'no') { db.prepare("UPDATE invitations SET status='declined', responded_at=? WHERE id=?").run(nowIso(), id); updateInviteAttempt(id, 'declined', true); db.prepare("UPDATE applicants SET status='declined' WHERE id=?").run(row.applicant_id); await ctx.editMessageText(eventText(row, 'final_declined'), messageOptions()); await sendMessageImages(row.telegram_id, row.event_id, 'final_declined'); return; }
  const checkinToken = token();
  db.prepare('UPDATE invitations SET final_confirmed_at=?,checkin_token=? WHERE id=?').run(nowIso(), checkinToken, id);
  const qr = await QRCode.toBuffer(checkinToken, { width: 900, margin: 4, errorCorrectionLevel: 'H' });
  await ctx.editMessageText('Участие подтверждено. QR-код для входа придёт следующим сообщением.');
  await sendAssets(row.telegram_id, row.event_id, 'confirmed');
  await sendCheckinQr(ctx, row, checkinToken, qr);
  return;
});

const app = express();
const adminBuild = path.resolve('./admin/dist');
const upload = multer({
  storage: multer.diskStorage({
    destination: uploadsDir,
    filename: (_, file, done) => done(null, `${Date.now()}-${token()}${path.extname(file.originalname)}`),
  }),
  limits: { fileSize: 20 * 1024 * 1024 },
});
app.use(express.urlencoded({ extended: false }));
app.use(express.json());
app.get('/health', (_, res) => res.json({ ok: true }));
app.get('/brand/logo.svg', (_, res) => res.sendFile(path.join(adminBuild, 'logo_perasperadastra.svg')));
app.get('/login', (req, res) => res.redirect(isAdmin(req) ? '/admin' : `/login/form${req.query.error ? '?error=1' : ''}`));
app.get('/login/form', (req, res) => res.type('html').send(loginPage(req.query.error === '1')));
app.post('/login', (req, res) => {
  const username = String(req.body.username || 'admin').trim().toLowerCase();
  const user = db.prepare('SELECT * FROM admin_users WHERE username=? AND is_active=1').get(username);
  if (!user || !passwordMatches(req.body.password, user.password_hash)) return res.redirect('/login/form?error=1');
  const sessionId = crypto.randomBytes(32).toString('base64url');
  db.prepare('DELETE FROM admin_sessions WHERE expires_at <= ?').run(Date.now());
  db.prepare('INSERT INTO admin_sessions (id,user_id,expires_at) VALUES (?,?,?)').run(sessionId, user.id, Date.now() + sessionDurationMs);
  db.prepare('UPDATE admin_users SET last_login_at=? WHERE id=?').run(nowIso(), user.id);
  db.prepare('INSERT INTO admin_audit_log (admin_user_id,username,method,path,status_code,action) VALUES (?,?,?,?,?,?)')
    .run(user.id, user.username, 'POST', '/login', 302, 'Вошёл в систему');
  res.set('Set-Cookie', sessionCookie(sessionId));
  return res.redirect('/admin');
});
app.post('/logout', (req, res) => {
  const sessionId = readCookie(req, 'event_ops_session');
  if (sessionId) db.prepare('DELETE FROM admin_sessions WHERE id=?').run(sessionId);
  res.set('Set-Cookie', 'event_ops_session=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax');
  res.redirect('/login/form');
});
app.get('/', (_, res) => res.redirect('/admin'));
app.get('/api/admin/state', adminOnly, (req, res) => {
  ensureConversationsForBotUsers();
  const allEvents = db.prepare(`SELECT e.*, COUNT(DISTINCT a.id) AS registered, COUNT(DISTINCT i.id) AS invited,
    SUM(CASE WHEN i.status='confirmed' THEN 1 ELSE 0 END) AS confirmed,
    SUM(CASE WHEN i.checked_in_at IS NOT NULL THEN 1 ELSE 0 END) AS checked_in
    FROM events e LEFT JOIN applicants a ON a.event_id=e.id LEFT JOIN invitations i ON i.applicant_id=a.id
    GROUP BY e.id ORDER BY e.starts_at DESC`).all();
  const events = req.adminUser.role === 'assistant' ? allEvents.filter((event) => event.id === req.adminUser.event_id) : allEvents;
  const selected = req.adminUser.role === 'assistant' ? req.adminUser.event_id : Number(req.query.event || events[0]?.id);
  const people = selected ? db.prepare(`SELECT a.*, i.id invitation_id, i.status invitation_status, i.expires_at, i.final_expires_at, i.final_confirmed_at, i.reminder_sent_at, i.checked_in_at,
    EXISTS(SELECT 1 FROM blocked_users b WHERE b.telegram_id=a.telegram_id) AS blocked,
    (SELECT ia.status FROM invitation_attempts ia WHERE ia.applicant_id=a.id AND ia.status!='pending' ORDER BY ia.id DESC LIMIT 1) AS previous_invitation_status
    FROM applicants a LEFT JOIN invitations i ON i.applicant_id=a.id WHERE a.event_id=? ORDER BY a.created_at DESC`).all(selected) : [];
  const assets = selected && req.adminUser.role !== 'assistant' ? db.prepare('SELECT * FROM event_assets WHERE event_id=? ORDER BY created_at DESC').all(selected) : [];
  const guests = req.adminUser.role === 'assistant' ? [] : db.prepare(`SELECT a.telegram_id, a.telegram_name, a.name, a.phone, MAX(a.created_at) AS last_seen,
    MAX(a.was_school_student) AS was_school_student, COUNT(a.id) AS events_count
    FROM applicants a GROUP BY COALESCE(a.telegram_id, 'applicant:' || a.id) ORDER BY last_seen DESC`).all();
  const messageImages = selected && req.adminUser.role !== 'assistant' ? db.prepare('SELECT id,message_key,original_name,position FROM event_message_images WHERE event_id=? ORDER BY position').all(selected) : [];
  const eventImages = selected && req.adminUser.role !== 'assistant' ? db.prepare('SELECT id,event_id,original_name,position FROM event_images WHERE event_id=? ORDER BY position').all(selected) : [];
  const posts = req.adminUser.role === 'assistant' ? [] : db.prepare(`SELECT p.*, e.title AS event_title FROM posts p LEFT JOIN events e ON e.id=p.event_id ORDER BY p.updated_at DESC`).all();
  const postImages = req.adminUser.role === 'assistant' ? [] : db.prepare('SELECT id,post_id,original_name,position FROM post_images ORDER BY position').all();
  const postFiles = req.adminUser.role === 'assistant' ? [] : db.prepare('SELECT id,post_id,original_name FROM post_files ORDER BY created_at').all();
  const conversations = req.adminUser.role === 'assistant' ? [] : db.prepare(`SELECT c.*, COALESCE(p.name, a.name) AS person_name
    FROM conversations c
    LEFT JOIN telegram_profiles p ON p.telegram_id=c.telegram_id
    LEFT JOIN (SELECT telegram_id, MAX(name) AS name FROM applicants WHERE telegram_id IS NOT NULL GROUP BY telegram_id) a ON a.telegram_id=c.telegram_id
    ORDER BY c.last_message_at DESC`).all();
  const postRecipients = req.adminUser.role === 'assistant' ? [] : db.prepare('SELECT post_id,telegram_id FROM post_recipients').all();
  const postSendSummaries = req.adminUser.role === 'assistant' ? [] : db.prepare(`SELECT s.* FROM post_sends s
    JOIN (SELECT post_id, MAX(id) AS id FROM post_sends GROUP BY post_id) latest ON latest.id=s.id`).all();
  const adminUsers = req.adminUser.role === 'admin' ? db.prepare('SELECT u.id,u.username,u.display_name,u.role,u.is_active,u.event_id,u.created_at,u.last_login_at,e.title AS event_title FROM admin_users u LEFT JOIN events e ON e.id=u.event_id ORDER BY u.role, u.display_name').all() : [];
  const audit = req.adminUser.role === 'admin' ? auditLogPage() : { entries: [], hasMore: false };
  res.json({ events, selected, people, assets, guests, messageImages, eventImages, posts, postImages, postFiles, postRecipients, postSendSummaries, conversations, adminUsers, auditLog: audit.entries, auditHasMore: audit.hasMore, currentUser: req.adminUser, botUsername: process.env.BOT_USERNAME });
});
app.get('/api/admin/audit', primaryAdminOnly, (req, res) => res.json(auditLogPage(req.query.before)));
app.post('/api/admin/account/password', adminOnly, (req, res) => {
  const currentPassword = String(req.body.current_password || '');
  const newPassword = String(req.body.new_password || '');
  const user = db.prepare('SELECT * FROM admin_users WHERE id=?').get(req.adminUser.id);
  if (!passwordMatches(currentPassword, user.password_hash)) return res.status(400).json({ error: 'Текущий пароль введён неверно' });
  if (newPassword.length < 10) return res.status(400).json({ error: 'Новый пароль должен содержать не меньше 10 символов' });
  db.transaction(() => {
    db.prepare('UPDATE admin_users SET password_hash=? WHERE id=?').run(passwordHash(newPassword), user.id);
    db.prepare('DELETE FROM admin_sessions WHERE user_id=? AND id!=?').run(user.id, readCookie(req, 'event_ops_session'));
  })();
  setAudit(req, 'Изменил пароль');
  res.json({ ok: true });
});
app.post('/api/admin/users', primaryAdminOnly, (req, res) => {
  const username = String(req.body.username || '').trim().toLowerCase();
  const displayName = String(req.body.display_name || '').trim();
  const password = String(req.body.password || '');
  const role = ['admin', 'director', 'assistant'].includes(req.body.role) ? req.body.role : 'director';
  const eventId = role === 'assistant' ? Number(req.body.event_id) : null;
  if (!/^[a-z0-9._-]{3,32}$/.test(username)) return res.status(400).json({ error: 'Логин: от 3 до 32 символов, латиница, цифры, точка, дефис или нижнее подчёркивание' });
  if (!displayName) return res.status(400).json({ error: 'Укажите имя пользователя' });
  if (password.length < 10) return res.status(400).json({ error: 'Временный пароль должен содержать не меньше 10 символов' });
  if (role === 'assistant' && !db.prepare('SELECT 1 FROM events WHERE id=?').get(eventId)) return res.status(400).json({ error: 'Выберите мероприятие для помощника' });
  try {
    const result = db.prepare('INSERT INTO admin_users (username,display_name,role,password_hash,event_id) VALUES (?,?,?,?,?)').run(username, displayName, role, passwordHash(password), eventId);
    setAudit(req, 'Создал учётную запись', `${displayName} · ${role === 'assistant' ? 'помощник мероприятия' : role === 'admin' ? 'администратор' : 'директор'}`);
    res.json({ ok: true, id: Number(result.lastInsertRowid) });
  } catch (error) {
    if (String(error.message).includes('UNIQUE')) return res.status(400).json({ error: 'Этот логин уже занят' });
    throw error;
  }
});
app.post('/api/admin/users/:id/status', primaryAdminOnly, (req, res) => {
  const userId = Number(req.params.id);
  const active = Boolean(req.body.active);
  const user = db.prepare('SELECT * FROM admin_users WHERE id=?').get(userId);
  if (!user) return res.sendStatus(404);
  if (user.id === req.adminUser.id && !active) return res.status(400).json({ error: 'Нельзя отключить собственную учётную запись' });
  db.transaction(() => {
    db.prepare('UPDATE admin_users SET is_active=? WHERE id=?').run(active ? 1 : 0, user.id);
    if (!active) db.prepare('DELETE FROM admin_sessions WHERE user_id=?').run(user.id);
  })();
  setAudit(req, active ? 'Восстановил доступ сотрудника' : 'Отключил доступ сотрудника', user.display_name);
  res.json({ ok: true });
});
app.post('/api/admin/users/:id/event', primaryAdminOnly, (req, res) => {
  const user = db.prepare('SELECT * FROM admin_users WHERE id=?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'Сотрудник не найден' });
  if (user.role !== 'assistant') return res.status(400).json({ error: 'Назначение мероприятия доступно только для помощников' });
  const eventId = req.body.event_id === null || req.body.event_id === '' ? null : Number(req.body.event_id);
  const event = eventId === null ? null : db.prepare('SELECT id,title FROM events WHERE id=?').get(eventId);
  if (eventId !== null && (!Number.isInteger(eventId) || !event)) return res.status(400).json({ error: 'Выберите существующее мероприятие' });
  db.prepare('UPDATE admin_users SET event_id=? WHERE id=?').run(eventId, user.id);
  setAudit(req, 'Изменил назначение помощника', `${user.display_name} · ${event?.title || 'без мероприятия'}`);
  res.json({ ok: true });
});
app.get('/admin/legacy', adminOnly, (req, res) => {
  if (req.adminUser.role === 'assistant') return res.status(403).send('Доступ ограничен назначенным мероприятием.');
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
app.use('/admin', adminOnly, express.static(adminBuild));
app.post('/admin/events', adminOnly, upload.array('images', 9), (req, res) => {
  const startsAt = parseEventTime(req.body);
  if (Number.isNaN(startsAt.getTime())) return res.status(400).json({ error: 'Укажите корректные дату и время мероприятия' });
  const images = req.files || [];
  if (images.some(file => !file.mimetype.startsWith('image/'))) return res.status(400).send('Карточка может содержать только изображения');
  const createEvent = db.transaction(() => {
    const result = db.prepare('INSERT INTO events (title,starts_at,description,venue,chat_url) VALUES (?,?,?,?,?)')
      .run(req.body.title, startsAt.toISOString(), req.body.description || null, req.body.venue || null, req.body.chat_url || null);
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
  db.prepare('UPDATE events SET description=?, invite_text=?, expired_text=?, confirmed_text=?, reminder_text=?, declined_text=?, rejected_text=?, final_confirmed_text=?, final_declined_text=? WHERE id=?')
    .run(richTextHtml(req.body.description || '') || null, richTextHtml(req.body.invite_text || '') || null, richTextHtml(req.body.expired_text || '') || null, richTextHtml(req.body.confirmed_text || '') || null, richTextHtml(req.body.reminder_text || '') || null, richTextHtml(req.body.declined_text || '') || null, richTextHtml(req.body.rejected_text || '') || null, richTextHtml(req.body.final_confirmed_text || '') || null, richTextHtml(req.body.final_declined_text || '') || null, req.params.id);
  res.json({ ok: true });
});
app.post('/api/admin/events/:id/registration', adminOnly, (req, res) => {
  const event = db.prepare('SELECT * FROM events WHERE id=?').get(req.params.id);
  if (!event) return res.sendStatus(404);
  const open = Boolean(req.body.open);
  const notify = open && !event.registration_open;
  db.prepare('UPDATE events SET registration_open=? WHERE id=?').run(open ? 1 : 0, event.id);
  setAudit(req, open ? 'Открыл регистрацию' : 'Закрыл регистрацию', event.title);
  ensureConversationsForBotUsers();
  const recipients = notify ? db.prepare(`SELECT telegram_id FROM conversations
    WHERE NOT EXISTS(SELECT 1 FROM blocked_users b WHERE b.telegram_id=conversations.telegram_id)`).all() : [];
  res.json({ ok: true, notificationQueued: notify, recipients: recipients.length });
  if (!notify || !recipients.length) return;
  const date = new Date(event.starts_at).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow', dateStyle: 'long', timeStyle: 'short' });
  const text = `Открыта регистрация на «${event.title}»\n🗓 ${date}`;
  const keyboard = new InlineKeyboard().text('Открыть мероприятие', `event:${event.id}`);
  // Do not hold the admin interface while Telegram delivers a notification to
  // every subscriber. Individual failures are expected (for example, a user
  // may have blocked the bot) and must not prevent registration from opening.
  void (async () => {
    for (const { telegram_id: telegramId } of recipients) {
      await bot.api.sendMessage(telegramId, text, messageOptions({ reply_markup: keyboard })).catch(console.error);
      await new Promise((resolve) => setTimeout(resolve, 60));
    }
  })();
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
app.post('/api/admin/applicants/:id/reject', adminOnly, async (req, res) => {
  const person = db.prepare(`SELECT a.*, e.id AS event_id, e.title, e.rejected_text
    FROM applicants a JOIN events e ON e.id=a.event_id WHERE a.id=?`).get(req.params.id);
  if (!person) return res.sendStatus(404);
  if (!person.telegram_id) return res.status(400).json({ error: 'Гость ещё не запустил бота — отправить отказ в Telegram нельзя' });
  if (db.prepare('SELECT 1 FROM blocked_users WHERE telegram_id=?').get(person.telegram_id)) return res.status(400).json({ error: 'Доступ гостя к боту ограничен' });
  try {
    await bot.api.sendMessage(person.telegram_id, eventText(person, 'rejected'), messageOptions());
    await sendMessageImages(person.telegram_id, person.event_id, 'rejected');
  } catch (error) {
    return res.status(502).json({ error: `Telegram не доставил отказ: ${error.description || error.message}` });
  }
  db.transaction(() => {
    db.prepare("UPDATE applicants SET status='rejected' WHERE id=?").run(person.id);
    db.prepare("UPDATE invitations SET status='rejected', responded_at=? WHERE applicant_id=?").run(nowIso(), person.id);
  })();
  setAudit(req, 'Отказал в приглашении', `${person.name} · ${person.title}`);
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
    if (person.invitation_status === 'confirmed') { skipped.push({ id, reason: 'участие уже подтверждено' }); continue; }
    try {
      await sendInvite(id);
      sent.push(id);
      if (sent.length < ids.length) await new Promise(resolve => setTimeout(resolve, 60));
    } catch (error) { skipped.push({ id, reason: error.message }); }
  }
  setAudit(req, 'Отправил приглашения', `Мероприятие #${event.id} · доставлено: ${sent.length}, не доставлено: ${skipped.length}`);
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
    // Keep staff accounts, but detach assistants from the deleted event.
    db.prepare('UPDATE admin_users SET event_id=NULL WHERE event_id=?').run(event.id);
    db.prepare('DELETE FROM events WHERE id=?').run(event.id);
  })();
  setAudit(req, 'Удалил мероприятие', event.title);
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
  res.json({ ok: true });
});
app.post('/api/admin/events/:id', adminOnly, (req, res) => {
  const title = String(req.body.title || '').trim();
  const startsAt = parseEventTime(req.body);
  if (!title || Number.isNaN(startsAt.getTime())) return res.status(400).json({ error: 'Укажите название и дату мероприятия' });
  const result = db.prepare('UPDATE events SET title=?, starts_at=?, description=?, venue=?, chat_url=? WHERE id=?')
    .run(title, startsAt.toISOString(), richTextHtml(req.body.description || '') || null, String(req.body.venue || '').trim() || null, String(req.body.chat_url || '').trim() || null, req.params.id);
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
function manualRecipients(value) {
  return [...new Set((Array.isArray(value) ? value : []).map(String).filter(Boolean))].slice(0, 500);
}
function savePostRecipients(postId, recipientIds) {
  const remove = db.prepare('DELETE FROM post_recipients WHERE post_id=?');
  const add = db.prepare('INSERT OR IGNORE INTO post_recipients (post_id,telegram_id) VALUES (?,?)');
  db.transaction(() => {
    remove.run(postId);
    recipientIds.forEach((telegramId) => {
      if (db.prepare('SELECT 1 FROM conversations WHERE telegram_id=?').get(telegramId)) add.run(postId, telegramId);
    });
  })();
}
function postRecipientsFor(post) {
  if (post.audience === 'event' && post.event_id) {
    return db.prepare(`SELECT DISTINCT a.telegram_id FROM applicants a
      WHERE a.event_id=? AND a.telegram_id IS NOT NULL
      AND NOT EXISTS(SELECT 1 FROM blocked_users b WHERE b.telegram_id=a.telegram_id)`).all(post.event_id);
  }
  if (post.audience === 'all') {
    return db.prepare(`SELECT c.telegram_id FROM conversations c
      WHERE NOT EXISTS(SELECT 1 FROM blocked_users b WHERE b.telegram_id=c.telegram_id)`).all();
  }
  return db.prepare(`SELECT r.telegram_id FROM post_recipients r
    WHERE r.post_id=? AND NOT EXISTS(SELECT 1 FROM blocked_users b WHERE b.telegram_id=r.telegram_id)`).all(post.id);
}
app.post('/api/admin/posts', adminOnly, (req, res) => {
  const title = String(req.body.title || '').trim();
  if (!title) return res.status(400).json({ error: 'Добавьте название поста' });
  const audience = ['all', 'event', 'manual'].includes(req.body.audience) ? req.body.audience : 'all';
  const eventId = audience === 'event' && Number(req.body.event_id) ? Number(req.body.event_id) : null;
  const result = db.prepare('INSERT INTO posts (title,content,audience,event_id,updated_at) VALUES (?,?,?,?,?)')
    .run(title, richTextHtml(req.body.content || ''), audience, eventId, nowIso());
  if (audience === 'manual') savePostRecipients(Number(result.lastInsertRowid), manualRecipients(req.body.recipient_ids));
  res.json({ ok: true, id: Number(result.lastInsertRowid) });
});
app.post('/api/admin/posts/:id', adminOnly, (req, res) => {
  const title = String(req.body.title || '').trim();
  if (!title) return res.status(400).json({ error: 'Добавьте название поста' });
  const audience = ['all', 'event', 'manual'].includes(req.body.audience) ? req.body.audience : 'all';
  const eventId = audience === 'event' && Number(req.body.event_id) ? Number(req.body.event_id) : null;
  const result = db.prepare('UPDATE posts SET title=?, content=?, audience=?, event_id=?, updated_at=? WHERE id=?')
    .run(title, richTextHtml(req.body.content || ''), audience, eventId, nowIso(), req.params.id);
  if (!result.changes) return res.sendStatus(404);
  savePostRecipients(Number(req.params.id), audience === 'manual' ? manualRecipients(req.body.recipient_ids) : []);
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
  if (!files.length) return res.status(400).json({ error: 'Выберите хотя бы один файл' });
  if (files.length > 10) return res.status(400).json({ error: 'К одному посту можно прикрепить до 10 файлов' });
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
app.get('/api/admin/posts/:id/recipients', adminOnly, (req, res) => {
  const post = db.prepare('SELECT * FROM posts WHERE id=?').get(req.params.id);
  if (!post) return res.sendStatus(404);
  ensureConversationsForBotUsers();
  const recipients = postRecipientsFor(post);
  res.json({ count: recipients.length });
});
app.post('/api/admin/posts/:id/send', adminOnly, async (req, res) => {
  const post = db.prepare('SELECT * FROM posts WHERE id=?').get(req.params.id);
  if (!post) return res.sendStatus(404);
  ensureConversationsForBotUsers();
  const recipients = postRecipientsFor(post);
  if (!recipients.length) return res.status(400).json({ error: 'В выбранной аудитории пока нет доступных пользователей' });
  const images = db.prepare('SELECT * FROM post_images WHERE post_id=? ORDER BY position').all(post.id);
  const files = db.prepare('SELECT * FROM post_files WHERE post_id=? ORDER BY created_at').all(post.id);
  const text = telegramHtml(post.content || '');
  if (!text && !images.length && !files.length) return res.status(400).json({ error: 'Добавьте текст, изображение или файл перед отправкой' });
  const sent = [];
  const skipped = [];
  for (const { telegram_id: telegramId } of recipients) {
    try {
      if (text) await bot.api.sendMessage(telegramId, text, messageOptions());
      if (images.length) await bot.api.sendMediaGroup(telegramId, images.map((image) => ({ type: 'photo', media: new InputFile(path.join(uploadsDir, image.stored_name), image.original_name) })));
      for (const file of files) await bot.api.sendDocument(telegramId, new InputFile(path.join(uploadsDir, file.stored_name), file.original_name));
      sent.push(telegramId);
      if (sent.length < recipients.length) await new Promise((resolve) => setTimeout(resolve, 60));
    } catch (error) {
      skipped.push({ telegramId, reason: error.description || error.message || 'не удалось отправить' });
    }
  }
  const send = db.prepare('INSERT INTO post_sends (post_id,sender_id,recipients_count,sent_count,failed_count,created_at) VALUES (?,?,?,?,?,?)')
    .run(post.id, req.adminUser.id, recipients.length, sent.length, skipped.length, nowIso());
  const recordResult = db.prepare('INSERT INTO post_delivery_results (send_id,telegram_id,status,reason,created_at) VALUES (?,?,?,?,?)');
  db.transaction(() => {
    sent.forEach((telegramId) => recordResult.run(send.lastInsertRowid, telegramId, 'sent', null, nowIso()));
    skipped.forEach(({ telegramId, reason }) => recordResult.run(send.lastInsertRowid, telegramId, 'failed', reason, nowIso()));
  })();
  setAudit(req, 'Отправил пост', `«${post.title}» · доставлено: ${sent.length} из ${recipients.length}${skipped.length ? `, ошибок: ${skipped.length}` : ''}`);
  res.json({ ok: true, sent: sent.length, skipped, sendId: Number(send.lastInsertRowid) });
});
app.post('/api/admin/events/:id/message-images/:key', adminOnly, upload.array('images', 9), (req, res) => {
  const messageKeys = new Set(['registration', 'invite', 'expired', 'confirmed', 'declined', 'rejected', 'reminder', 'final_confirmed', 'final_declined']);
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
  if (req.adminUser.role === 'assistant' && eventId !== req.adminUser.event_id) return res.status(403).json({ error: 'Этот QR относится к другому мероприятию' });
  if (!raw) return res.status(400).json({ error: 'Введите код из QR' });
  const byToken = db.prepare(`SELECT i.*, a.name, a.event_id, e.title FROM invitations i JOIN applicants a ON a.id=i.applicant_id JOIN events e ON e.id=a.event_id
    WHERE i.checkin_token=? ${eventId ? 'AND a.event_id=?' : ''}`).get(...(eventId ? [raw, eventId] : [raw]));
  const row = byToken || db.prepare(`SELECT i.*, a.name, a.event_id, e.title FROM invitations i JOIN applicants a ON a.id=i.applicant_id JOIN events e ON e.id=a.event_id
    WHERE upper(substr(i.checkin_token,1,8))=? ${eventId ? 'AND a.event_id=?' : ''}`).get(...(eventId ? [raw.toUpperCase(), eventId] : [raw.toUpperCase()]));
  if (!row) return res.status(404).json({ error: 'Код не найден для этого мероприятия' });
  if (row.status !== 'confirmed') return res.status(409).json({ error: 'Участие этого гостя не подтверждено' });
  if (row.checked_in_at) return res.status(409).json({ error: 'Гость уже отмечен', guest: row.name, already: true });
  db.prepare('UPDATE invitations SET checked_in_at=? WHERE id=?').run(nowIso(), row.id);
  setAudit(req, 'Отметил гостя на чек-ине', `${row.name} · ${row.title}`);
  res.json({ ok: true, guest: row.name, event: row.title });
});
app.post('/admin/events/:id/assets', adminOnly, upload.single('material'), (req, res) => {
  if (req.file) db.prepare('INSERT INTO event_assets (event_id,original_name,stored_name,delivery_stage) VALUES (?,?,?,?)').run(req.params.id, req.file.originalname, req.file.filename, req.body.delivery_stage);
  res.redirect(`/admin?event=${req.params.id}`);
});
app.get('/admin/assets/:id', adminOnly, (req, res) => { const asset = db.prepare('SELECT * FROM event_assets WHERE id=?').get(req.params.id); if (!asset) return res.sendStatus(404); return res.download(path.join(uploadsDir, asset.stored_name), asset.original_name); });
app.post('/admin/invite/:id', adminOnly, async (req, res) => { try { await sendInvite(Number(req.params.id)); } catch (e) { return res.status(400).send(layout('Ошибка', `<p>${esc(e.message)}</p><p><a href="/admin">Назад</a></p>`)); } res.redirect('back'); });
// The React check-in screen is the only supported admission flow.  The old
// form did not validate the invitation status and could mark a declined guest
// as present, so keep old bookmarks harmless by redirecting to the safe UI.
app.get('/admin/checkin', adminOnly, (_req, res) => res.redirect('/admin?page=checkin'));
app.post('/admin/checkin', adminOnly, (_req, res) => res.redirect(303, '/admin?page=checkin'));
app.get('/admin/export/:eventId', adminOnly, (req, res) => { if (req.adminUser.role === 'assistant') return res.status(403).send('Помощник не может выгружать данные гостей.'); const rows = db.prepare(`SELECT a.name,a.phone,a.telegram_name,a.was_school_student,a.status,i.status invitation_status,i.checked_in_at FROM applicants a LEFT JOIN invitations i ON i.applicant_id=a.id WHERE a.event_id=?`).all(req.params.eventId); const csv = ['name,phone,telegram_username,was_school_student,applicant_status,invitation_status,checked_in_at', ...rows.map(r => [r.name,r.phone,r.telegram_name,r.was_school_student === null ? '' : r.was_school_student ? 'yes' : 'no',r.status,r.invitation_status,r.checked_in_at].map(v => `"${String(v || '').replaceAll('"','""')}"`).join(','))].join('\n'); res.type('text/csv').attachment('guests.csv').send(csv); });
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
const server = app.listen(port, () => console.log(`Admin: http://localhost:${port}/admin`));

async function runDailyBackup() {
  try {
    const target = await createDatabaseBackup(db, backupsDir);
    console.log(`Database backup: ${target}`);
  } catch (error) {
    console.error('Database backup failed:', error);
  }
}

function scheduleDailyBackup() {
  const scheduleNext = () => {
    const delay = millisecondsUntilNextMoscowBackup();
    setTimeout(async () => {
      await runDailyBackup();
      scheduleNext();
    }, delay).unref();
  };

  void runDailyBackup();
  scheduleNext();
}

scheduleDailyBackup();

function startBot() {
  bot.start().catch((error) => {
    console.error('Telegram bot did not start:', error.message);
    // A second temporary instance can cause Telegram's 409 conflict. Retrying
    // keeps production self-healing once that instance is gone.
    setTimeout(startBot, 30_000).unref();
  });
}
if (botEnabled) {
  startBot();
  setInterval(() => runAutomation().catch(console.error), 60_000);
  runAutomation().catch(console.error);
}

function shutdown(signal) {
  console.log(`${signal}: завершаем работу…`);
  bot.stop();
  server.close(() => {
    db.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.once('SIGTERM', () => shutdown('SIGTERM'));
process.once('SIGINT', () => shutdown('SIGINT'));

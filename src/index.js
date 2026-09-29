import 'dotenv/config';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import express from 'express';
import multer from 'multer';
import QRCode from 'qrcode';
import { Bot, InlineKeyboard, Keyboard, InputFile } from 'grammy';

const required = ['BOT_TOKEN', 'BOT_USERNAME', 'ADMIN_PASSWORD'];
const missing = required.filter(key => {
  const value = process.env[key] || '';
  return !value || /replace_with|your_bot|change-this/.test(value);
});
if (missing.length) {
  console.error(`Не заполнены настройки в .env: ${missing.join(', ')}.`);
  console.error('Скопируйте .env.example в .env и укажите значения.');
  process.exit(1);
}

const dbPath = process.env.DATABASE_PATH || './data/events.sqlite';
fs.mkdirSync(path.dirname(dbPath), { recursive: true });
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
const uploadsDir = path.resolve('./data/uploads');
fs.mkdirSync(uploadsDir, { recursive: true });
db.exec(`
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY, title TEXT NOT NULL, starts_at TEXT NOT NULL,
  description TEXT, venue TEXT, chat_url TEXT, cover_stored_name TEXT, cover_original_name TEXT, registration_text TEXT, received_text TEXT,
  invite_text TEXT, confirmed_text TEXT, declined_text TEXT, reminder_text TEXT,
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
  checked_in_at TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS application_drafts (
  telegram_id TEXT NOT NULL, event_id INTEGER NOT NULL REFERENCES events(id),
  stage TEXT NOT NULL, name TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (telegram_id, event_id)
);
CREATE TABLE IF NOT EXISTS event_assets (
  id INTEGER PRIMARY KEY, event_id INTEGER NOT NULL REFERENCES events(id), original_name TEXT NOT NULL,
  stored_name TEXT NOT NULL UNIQUE, delivery_stage TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS event_images (
  id INTEGER PRIMARY KEY, event_id INTEGER NOT NULL REFERENCES events(id), original_name TEXT NOT NULL,
  stored_name TEXT NOT NULL UNIQUE, position INTEGER NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
`);
for (const [table, column, definition] of [
  ['events', 'description', 'TEXT'], ['events', 'venue', 'TEXT'], ['applicants', 'phone', 'TEXT'],
  ['events', 'registration_text', 'TEXT'], ['events', 'received_text', 'TEXT'], ['events', 'invite_text', 'TEXT'],
  ['events', 'confirmed_text', 'TEXT'], ['events', 'declined_text', 'TEXT'], ['events', 'reminder_text', 'TEXT'],
  ['events', 'cover_stored_name', 'TEXT'], ['events', 'cover_original_name', 'TEXT'],
]) {
  try { db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`); } catch { /* already exists */ }
}

const nowIso = () => new Date().toISOString();
const token = () => crypto.randomBytes(18).toString('base64url');
const esc = (value = '') => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const defaultText = {
  received: 'Спасибо, заявка принята. Мы рассмотрим её и пришлём решение в этот бот.',
  invite: 'Мы будем рады видеть вас на мероприятии «{event}»!\n\nПодтвердите участие в течение 24 часов, пожалуйста.',
  confirmed: 'Участие подтверждено — место закреплено за вами. За сутки до мероприятия придёт напоминание.',
  declined: 'Спасибо, что сообщили. Мы будем рады видеть вас на следующих мероприятиях!',
  reminder: 'Напоминаем: «{event}» уже завтра. Ждём вас!',
};
const eventText = (event, key) => (event[`${key}_text`] || defaultText[key]).replaceAll('{event}', event.title);
async function sendAssets(telegramId, eventId, stage) {
  const assets = db.prepare('SELECT * FROM event_assets WHERE event_id=? AND delivery_stage=?').all(eventId, stage);
  for (const asset of assets) await bot.api.sendDocument(telegramId, new InputFile(path.join(uploadsDir, asset.stored_name), asset.original_name)).catch(console.error);
}
const adminOnly = (req, res, next) => {
  const header = req.headers.authorization || '';
  const [kind, encoded] = header.split(' ');
  const [user, pass] = kind === 'Basic' && encoded ? Buffer.from(encoded, 'base64').toString().split(':') : [];
  if (user === 'admin' && pass === process.env.ADMIN_PASSWORD) return next();
  res.set('WWW-Authenticate', 'Basic realm="Event admin"'); return res.status(401).send('Authorization required');
};

const bot = new Bot(process.env.BOT_TOKEN || '');
bot.command('start', async ctx => {
  const claim = ctx.match?.trim();
  const eventMatch = claim?.match(/^event_(\d+)$/);
  if (eventMatch) {
    const event = db.prepare('SELECT * FROM events WHERE id=?').get(eventMatch[1]);
    if (!event) return ctx.reply('Это мероприятие не найдено или уже недоступно.');
    const date = new Date(event.starts_at).toLocaleString('ru-RU', { dateStyle: 'long', timeStyle: 'short' });
    const details = [event.registration_text || event.description, event.venue && `📍 ${event.venue}`, `🗓 ${date}`].filter(Boolean).join('\n\n');
    const existing = db.prepare('SELECT status FROM applicants WHERE event_id=? AND telegram_id=?').get(event.id, String(ctx.from.id));
    if (existing) return ctx.reply(`Вы уже подали заявку на «${event.title}». Статус: ${existing.status}. Решение придёт в этот бот.`);
    const keyboard = new InlineKeyboard().text('Подать заявку', `apply:${event.id}`);
    const images = db.prepare('SELECT * FROM event_images WHERE event_id=? ORDER BY position').all(event.id);
    if (images.length) await bot.api.sendMediaGroup(ctx.chat.id, images.map((image, index) => ({ type: 'photo', media: new InputFile(path.join(uploadsDir, image.stored_name), image.original_name), caption: index === 0 ? `«${event.title}»` : undefined })));
    else if (event.cover_stored_name) await ctx.replyWithPhoto(new InputFile(path.join(uploadsDir, event.cover_stored_name), event.cover_original_name || 'cover'), { caption: `«${event.title}»` });
    return ctx.reply(`«${event.title}»\n\n${details}`, { reply_markup: keyboard });
  }
  if (!claim) return ctx.reply('Добро пожаловать! Откройте ссылку на мероприятие, чтобы подать заявку.');
  const applicant = db.prepare('SELECT * FROM applicants WHERE claim_token = ?').get(claim);
  if (!applicant) return ctx.reply('Эта ссылка недействительна или устарела. Свяжитесь с организаторами.');
  if (applicant.telegram_id && applicant.telegram_id !== String(ctx.from.id)) return ctx.reply('Эта ссылка уже привязана к другому Telegram-аккаунту.');
  db.prepare("UPDATE applicants SET telegram_id=?, telegram_name=?, status=CASE WHEN status='awaiting_review' THEN 'awaiting_review' ELSE status END WHERE id=?")
    .run(String(ctx.from.id), ctx.from.username || null, applicant.id);
  return ctx.reply('Спасибо, заявка получена. Мы рассмотрим её и пришлём решение в этот бот.');
});

bot.callbackQuery(/^apply:(\d+)$/, async ctx => {
  const event = db.prepare('SELECT * FROM events WHERE id=?').get(ctx.match[1]);
  if (!event) return ctx.answerCallbackQuery({ text: 'Мероприятие не найдено.', show_alert: true });
  const telegramId = String(ctx.from.id);
  if (db.prepare('SELECT 1 FROM applicants WHERE event_id=? AND telegram_id=?').get(event.id, telegramId)) {
    return ctx.answerCallbackQuery({ text: 'Заявка уже подана.', show_alert: true });
  }
  db.prepare(`INSERT INTO application_drafts (telegram_id,event_id,stage) VALUES (?,?,'name')
    ON CONFLICT(telegram_id,event_id) DO UPDATE SET stage='name', name=NULL`).run(telegramId, event.id);
  await ctx.editMessageText(`Заявка на «${event.title}».\n\nКак к вам обращаться? Напишите имя и фамилию.`);
  return ctx.answerCallbackQuery();
});

bot.on('message:contact', async ctx => {
  const telegramId = String(ctx.from.id);
  const draft = db.prepare("SELECT * FROM application_drafts WHERE telegram_id=? AND stage='phone'").get(telegramId);
  if (!draft || ctx.message.contact.user_id !== ctx.from.id) return;
  const name = draft.name;
  db.prepare('INSERT INTO applicants (event_id,name,phone,claim_token,telegram_id,telegram_name,status) VALUES (?,?,?,?,?,?,?)')
    .run(draft.event_id, name, ctx.message.contact.phone_number, token(), telegramId, ctx.from.username || null, 'awaiting_review');
  db.prepare('DELETE FROM application_drafts WHERE telegram_id=? AND event_id=?').run(telegramId, draft.event_id);
  const event = db.prepare('SELECT * FROM events WHERE id=?').get(draft.event_id);
  await ctx.reply(eventText(event, 'received'), { reply_markup: { remove_keyboard: true } });
});

bot.on('message:text', async ctx => {
  const telegramId = String(ctx.from.id);
  const draft = db.prepare('SELECT * FROM application_drafts WHERE telegram_id=?').get(telegramId);
  if (!draft) return;
  const text = ctx.message.text.trim();
  if (draft.stage === 'name') {
    if (text.length < 2) return ctx.reply('Напишите, пожалуйста, имя чуть подробнее.');
    db.prepare("UPDATE application_drafts SET stage='phone', name=? WHERE telegram_id=? AND event_id=?").run(text, telegramId, draft.event_id);
    const keyboard = new Keyboard().requestContact('📱 Отправить мой номер').resized().oneTime();
    return ctx.reply('Теперь отправьте номер телефона кнопкой ниже. Это обязательное поле для регистрации.', { reply_markup: keyboard });
  }
  if (draft.stage === 'phone') return ctx.reply('Для завершения регистрации нажмите «Отправить мой номер».');
});

bot.callbackQuery(/^answer:(yes|no):(\d+)$/, async ctx => {
  const [, answer, id] = ctx.match;
  const row = db.prepare(`SELECT i.*, a.telegram_id, a.name, e.id AS event_id, e.title, e.starts_at, e.chat_url, e.confirmed_text, e.declined_text
    FROM invitations i JOIN applicants a ON a.id=i.applicant_id JOIN events e ON e.id=a.event_id WHERE i.id=?`).get(id);
  if (!row || row.telegram_id !== String(ctx.from.id)) return ctx.answerCallbackQuery({ text: 'Приглашение не найдено.', show_alert: true });
  if (row.status !== 'pending' || new Date(row.expires_at) <= new Date()) return ctx.answerCallbackQuery({ text: 'Срок ответа уже закончился.', show_alert: true });
  if (answer === 'no') {
    db.prepare("UPDATE invitations SET status='declined', responded_at=? WHERE id=?").run(nowIso(), id);
    db.prepare("UPDATE applicants SET status='declined' WHERE id=?").run(row.applicant_id);
    await ctx.editMessageText(eventText(row, 'declined'));
  } else {
    const checkinToken = token();
    db.prepare("UPDATE invitations SET status='confirmed', responded_at=?, checkin_token=? WHERE id=?").run(nowIso(), checkinToken, id);
    db.prepare("UPDATE applicants SET status='confirmed' WHERE id=?").run(row.applicant_id);
    const qr = await QRCode.toBuffer(checkinToken, { width: 700, margin: 2 });
    await ctx.editMessageText(eventText(row, 'confirmed'));
    if (row.chat_url) await ctx.reply(`Пока можете присоединиться к чату мероприятия: ${row.chat_url}`);
    await sendAssets(row.telegram_id, row.event_id, 'confirmed');
    await ctx.replyWithPhoto(new Uint8Array(qr), { caption: `Ваш QR для входа на «${row.title}». Сохраните его.\nРезервный код: ${checkinToken.slice(0, 8).toUpperCase()}` });
  }
  return ctx.answerCallbackQuery();
});

async function sendInvite(applicantId) {
  const row = db.prepare('SELECT a.*, e.* FROM applicants a JOIN events e ON e.id=a.event_id WHERE a.id=?').get(applicantId);
  if (!row?.telegram_id) throw new Error('Участник ещё не запустил бота по персональной ссылке');
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  let invitation = db.prepare('SELECT * FROM invitations WHERE applicant_id=?').get(applicantId);
  if (invitation?.status === 'confirmed') throw new Error('Участие уже подтверждено');
  if (invitation) db.prepare("UPDATE invitations SET status='pending', expires_at=?, responded_at=NULL WHERE id=?").run(expiresAt, invitation.id);
  else {
    const r = db.prepare("INSERT INTO invitations (applicant_id,status,expires_at) VALUES (?, 'pending', ?)").run(applicantId, expiresAt);
    invitation = { id: r.lastInsertRowid };
  }
  db.prepare("UPDATE applicants SET status='invited' WHERE id=?").run(applicantId);
  const keyboard = new InlineKeyboard().text('Подтверждаю участие', `answer:yes:${invitation.id}`).text('Не смогу прийти', `answer:no:${invitation.id}`);
  await bot.api.sendMessage(row.telegram_id, eventText(row, 'invite'), { reply_markup: keyboard });
}

async function runAutomation() {
  const expired = db.prepare("SELECT i.*, a.telegram_id, a.id applicant_id FROM invitations i JOIN applicants a ON a.id=i.applicant_id WHERE i.status='pending' AND i.expires_at <= ?").all(nowIso());
  for (const row of expired) {
    db.prepare("UPDATE invitations SET status='expired' WHERE id=?").run(row.id);
    db.prepare("UPDATE applicants SET status='expired' WHERE id=?").run(row.applicant_id);
    if (row.telegram_id) await bot.api.sendMessage(row.telegram_id, 'К сожалению, мы не дождались вашего ответа и освобождаем место. Будем рады видеть вас на следующих мероприятиях!').catch(console.error);
  }
  const upcoming = db.prepare(`SELECT i.*, a.telegram_id, e.id AS event_id, e.title, e.starts_at, e.reminder_text FROM invitations i
    JOIN applicants a ON a.id=i.applicant_id JOIN events e ON e.id=a.event_id
    WHERE i.status='confirmed' AND i.reminder_sent_at IS NULL AND e.starts_at BETWEEN ? AND ?`)
    .all(nowIso(), new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString());
  for (const row of upcoming) {
    if (row.telegram_id) {
      await bot.api.sendMessage(row.telegram_id, eventText(row, 'reminder')).catch(console.error);
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
app.get('/', (_, res) => res.redirect('/admin'));
app.get('/api/admin/state', adminOnly, (req, res) => {
  const events = db.prepare('SELECT * FROM events ORDER BY starts_at DESC').all();
  const selected = Number(req.query.event || events[0]?.id);
  const people = selected ? db.prepare(`SELECT a.*, i.id invitation_id, i.status invitation_status, i.expires_at, i.checked_in_at
    FROM applicants a LEFT JOIN invitations i ON i.applicant_id=a.id WHERE a.event_id=? ORDER BY a.created_at DESC`).all(selected) : [];
  const assets = selected ? db.prepare('SELECT * FROM event_assets WHERE event_id=? ORDER BY created_at DESC').all(selected) : [];
  res.json({ events, selected, people, assets, botUsername: process.env.BOT_USERNAME });
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

import path from 'node:path';
import { InlineKeyboard, InputFile } from 'grammy';
import { uploadsDir } from '../lib/paths.js';
import { eventText, messageOptions, nowIso, token } from '../lib/text.js';

export function createInvitationService({ db, bot }) {
  const updateInviteAttempt = (invitationId, status, responded = false) => db.prepare(`UPDATE invitation_attempts SET status=?, responded_at=?
    WHERE id=(SELECT id FROM invitation_attempts WHERE invitation_id=? ORDER BY id DESC LIMIT 1)`).run(status, responded ? nowIso() : null, invitationId);

  async function sendAssets(telegramId, eventId, stage) {
    const assets = db.prepare('SELECT * FROM event_assets WHERE event_id=? AND delivery_stage=?').all(eventId, stage);
    for (const asset of assets) await bot.api.sendDocument(telegramId, new InputFile(path.join(uploadsDir, asset.stored_name), asset.original_name)).catch(console.error);
  }

  async function sendMessageImages(telegramId, eventId, key) {
    const images = db.prepare('SELECT * FROM event_message_images WHERE event_id=? AND message_key=? ORDER BY position').all(eventId, key);
    if (images.length) await bot.api.sendMediaGroup(telegramId, images.map((image) => ({ type: 'photo', media: new InputFile(path.join(uploadsDir, image.stored_name), image.original_name) }))).catch(console.error);
  }

  async function sendInvite(applicantId) {
    const row = db.prepare('SELECT a.*, e.* FROM applicants a JOIN events e ON e.id=a.event_id WHERE a.id=?').get(applicantId);
    if (!row?.telegram_id) throw new Error('Участник ещё не запустил бота по персональной ссылке');
    if (db.prepare('SELECT 1 FROM blocked_users WHERE telegram_id=?').get(row.telegram_id)) throw new Error('Доступ гостя к боту ограничен');
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    let invitation = db.prepare('SELECT * FROM invitations WHERE applicant_id=?').get(applicantId);
    if (invitation?.status === 'confirmed') throw new Error('Участие уже подтверждено');
    if (invitation) db.prepare("UPDATE invitations SET status='pending', expires_at=?, responded_at=NULL WHERE id=?").run(expiresAt, invitation.id);
    else invitation = { id: db.prepare("INSERT INTO invitations (applicant_id,status,expires_at) VALUES (?, 'pending', ?)").run(applicantId, expiresAt).lastInsertRowid };
    db.prepare("INSERT INTO invitation_attempts (applicant_id,invitation_id,status,sent_at,expires_at) VALUES (?,?,'pending',?,?)").run(applicantId, invitation.id, nowIso(), expiresAt);
    db.prepare("UPDATE applicants SET status='invited' WHERE id=?").run(applicantId);
    const keyboard = new InlineKeyboard().text('Подтверждаю участие', `answer:yes:${invitation.id}`).text('Не смогу прийти', `answer:no:${invitation.id}`);
    await bot.api.sendMessage(row.telegram_id, eventText(row, 'invite'), messageOptions({ reply_markup: keyboard }));
    await sendMessageImages(row.telegram_id, row.event_id, 'invite');
  }

  async function runAutomation() {
    const expired = db.prepare("SELECT i.*, a.telegram_id, a.id applicant_id, e.id AS event_id, e.title, e.expired_text FROM invitations i JOIN applicants a ON a.id=i.applicant_id JOIN events e ON e.id=a.event_id WHERE i.status='pending' AND i.expires_at <= ?").all(nowIso());
    for (const row of expired) {
      db.prepare("UPDATE invitations SET status='expired' WHERE id=?").run(row.id);
      updateInviteAttempt(row.id, 'expired'); db.prepare("UPDATE applicants SET status='expired' WHERE id=?").run(row.applicant_id);
      if (row.telegram_id) { await bot.api.sendMessage(row.telegram_id, eventText(row, 'expired'), messageOptions()).catch(console.error); await sendMessageImages(row.telegram_id, row.event_id, 'expired'); }
    }
    const upcoming = db.prepare(`SELECT i.*, a.telegram_id, e.id AS event_id, e.title, e.starts_at, e.reminder_text FROM invitations i JOIN applicants a ON a.id=i.applicant_id JOIN events e ON e.id=a.event_id WHERE i.status='confirmed' AND i.reminder_sent_at IS NULL AND e.starts_at BETWEEN ? AND ?`).all(nowIso(), new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString());
    for (const row of upcoming) {
      if (row.telegram_id) {
        const keyboard = new InlineKeyboard().text('Буду', `final:yes:${row.id}`).text('Не смогу прийти', `final:no:${row.id}`);
        await bot.api.sendMessage(row.telegram_id, eventText(row, 'reminder'), messageOptions({ reply_markup: keyboard })).catch(console.error);
        await sendMessageImages(row.telegram_id, row.event_id, 'reminder'); await sendAssets(row.telegram_id, row.event_id, 'reminder');
      }
      db.prepare('UPDATE invitations SET reminder_sent_at=? WHERE id=?').run(nowIso(), row.id);
    }
  }

  return { runAutomation, sendAssets, sendInvite, sendMessageImages, updateInviteAttempt };
}

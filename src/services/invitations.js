import path from 'node:path';
import QRCode from 'qrcode';
import { InlineKeyboard, InputFile } from 'grammy';
import { uploadsDir } from '../lib/paths.js';
import { eventText, messageOptions, nowIso, token } from '../lib/text.js';
import { sendMediaMessage } from './media-message.js';

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
    const expiresAt = new Date(Math.min(Date.now() + 24 * 60 * 60 * 1000, new Date(row.starts_at).getTime())).toISOString();
    let invitation = db.prepare('SELECT * FROM invitations WHERE applicant_id=?').get(applicantId);
    if (invitation?.status === 'confirmed') throw new Error('Участие уже подтверждено');
    if (invitation) db.prepare("UPDATE invitations SET status='pending', expires_at=?, responded_at=NULL WHERE id=?").run(expiresAt, invitation.id);
    else invitation = { id: db.prepare("INSERT INTO invitations (applicant_id,status,expires_at) VALUES (?, 'pending', ?)").run(applicantId, expiresAt).lastInsertRowid };
    db.prepare("INSERT INTO invitation_attempts (applicant_id,invitation_id,status,sent_at,expires_at) VALUES (?,?,'pending',?,?)").run(applicantId, invitation.id, nowIso(), expiresAt);
    db.prepare("UPDATE applicants SET status='invited' WHERE id=?").run(applicantId);
    const keyboard = new InlineKeyboard().text('Подтверждаю участие', `answer:yes:${invitation.id}`).style('primary').text('Не смогу прийти', `answer:no:${invitation.id}`).style('danger');
    try {
      const images = db.prepare('SELECT * FROM event_message_images WHERE event_id=? AND message_key=? ORDER BY position').all(row.event_id, 'invite');
      await sendMediaMessage(bot.api, row.telegram_id, eventText(row, 'invite'), images, keyboard);
    } catch (error) {
      // A pending invitation means that a person actually received a button to
      // answer.  Keep failed deliveries separate so the organiser can retry
      // them instead of mistaking Telegram's error for a guest's silence.
      const blocked = /bot was blocked by the user/i.test(error.description || error.message || '');
      const status = blocked ? 'bot_blocked' : 'delivery_failed';
      db.prepare('UPDATE invitations SET status=? WHERE id=?').run(status, invitation.id);
      updateInviteAttempt(invitation.id, status);
      db.prepare("UPDATE applicants SET status='awaiting_review' WHERE id=?").run(applicantId);
      throw new Error(blocked ? 'Пользователь заблокировал бота. Приглашение не доставлено. Повторите после разблокировки.' : `Telegram не доставил приглашение: ${error.message}`);
    }
  }

  async function sendSchedule(telegramId, event) {
    const images = db.prepare('SELECT * FROM event_message_images WHERE event_id=? AND message_key=? ORDER BY position').all(event.id, 'reminder');
    await sendMediaMessage(bot.api, telegramId, eventText(event, 'reminder'), images);
  }

  async function sendReminder(applicantId) {
    const row = db.prepare(`SELECT i.*, a.telegram_id, a.event_id FROM invitations i JOIN applicants a ON a.id=i.applicant_id WHERE a.id=?`).get(applicantId);
    if (!row || !row.telegram_id || row.status !== 'confirmed' || row.venue_response === 'pending') throw new Error('Участие гостя не подтверждено');
    if (db.prepare('SELECT 1 FROM blocked_users WHERE telegram_id=?').get(row.telegram_id)) throw new Error('Доступ гостя ограничен');
    const event = db.prepare('SELECT * FROM events WHERE id=?').get(row.event_id);
    const checkinToken = row.checkin_token || token();
    const qr = await QRCode.toBuffer(checkinToken, { width: 900, margin: 4, errorCorrectionLevel: 'H' });
    const keyboard = new InlineKeyboard().text('Отменить регистрацию', `cancel:${row.id}`).style('danger');
    await sendSchedule(row.telegram_id, event);
    const caption = `${eventText(event, 'final_confirmed').trim()}\n\nРезервный код: ${checkinToken.slice(0, 8).toUpperCase()}`;
    if (caption.length <= 1024) await bot.api.sendPhoto(row.telegram_id, new InputFile(qr, 'checkin.png'), messageOptions({ caption, reply_markup: keyboard }));
    else {
      await bot.api.sendPhoto(row.telegram_id, new InputFile(qr, 'checkin.png'));
      await bot.api.sendMessage(row.telegram_id, caption, messageOptions({ reply_markup: keyboard }));
    }
    db.prepare('UPDATE invitations SET reminder_sent_at=?,final_confirmed_at=COALESCE(final_confirmed_at,?),final_expires_at=NULL,checkin_token=? WHERE id=?').run(nowIso(), nowIso(), checkinToken, row.id);
    await sendAssets(row.telegram_id, row.event_id, 'reminder');
  }

  async function runAutomation() {
    const expired = db.prepare("SELECT i.*, a.telegram_id, a.id applicant_id, e.id AS event_id, e.title, e.expired_text FROM invitations i JOIN applicants a ON a.id=i.applicant_id JOIN events e ON e.id=a.event_id WHERE i.status='pending' AND i.expires_at <= ?").all(nowIso());
    for (const row of expired) {
      db.prepare("UPDATE invitations SET status='expired' WHERE id=?").run(row.id);
      updateInviteAttempt(row.id, 'expired'); db.prepare("UPDATE applicants SET status='expired' WHERE id=?").run(row.applicant_id);
      if (row.telegram_id) { await bot.api.sendMessage(row.telegram_id, eventText(row, 'expired'), messageOptions()).catch(console.error); await sendMessageImages(row.telegram_id, row.event_id, 'expired'); }
    }
    const upcoming = db.prepare(`SELECT i.applicant_id FROM invitations i JOIN applicants a ON a.id=i.applicant_id JOIN events e ON e.id=a.event_id WHERE i.status='confirmed' AND COALESCE(i.venue_response,'')!='pending' AND i.reminder_sent_at IS NULL AND e.starts_at BETWEEN ? AND ?`).all(nowIso(), new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString());
    for (const row of upcoming) {
      try { await sendReminder(row.applicant_id); } catch (error) { console.error('Reminder delivery failed', row.applicant_id, error.message); }
    }
  }

  return { sendSchedule, sendReminder, runAutomation, sendAssets, sendInvite, sendMessageImages, updateInviteAttempt };
}

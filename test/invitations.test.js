import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import { createInvitationService } from '../src/services/invitations.js';

function setup({ sendMessage = async () => ({ ok: true }) } = {}) {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE events (
      id INTEGER PRIMARY KEY, title TEXT NOT NULL, starts_at TEXT NOT NULL,
      invite_text TEXT, expired_text TEXT, reminder_text TEXT
    );
    CREATE TABLE applicants (
      id INTEGER PRIMARY KEY, event_id INTEGER NOT NULL, name TEXT NOT NULL,
      telegram_id TEXT, status TEXT NOT NULL DEFAULT 'awaiting_review'
    );
    CREATE TABLE invitations (
      id INTEGER PRIMARY KEY, applicant_id INTEGER NOT NULL UNIQUE,
      status TEXT NOT NULL, expires_at TEXT NOT NULL, responded_at TEXT,
      reminder_sent_at TEXT, final_expires_at TEXT, final_confirmed_at TEXT, venue_response TEXT, checkin_token TEXT
    );
    CREATE TABLE invitation_attempts (
      id INTEGER PRIMARY KEY, applicant_id INTEGER NOT NULL, invitation_id INTEGER NOT NULL,
      status TEXT NOT NULL, sent_at TEXT NOT NULL, expires_at TEXT NOT NULL, responded_at TEXT
    );
    CREATE TABLE blocked_users (telegram_id TEXT PRIMARY KEY);
    CREATE TABLE event_assets (event_id INTEGER, delivery_stage TEXT, original_name TEXT, stored_name TEXT);
    CREATE TABLE event_message_images (event_id INTEGER, message_key TEXT, original_name TEXT, stored_name TEXT, position INTEGER);
  `);
  db.prepare('INSERT INTO events (id,title,starts_at,invite_text,expired_text,reminder_text) VALUES (1,?,?,?,?,?)')
    .run('Лекторий', new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(), 'Приглашаем на {event}', 'Время ответа закончилось', 'Подтвердите участие');
  db.prepare('INSERT INTO applicants (id,event_id,name,telegram_id,status) VALUES (1,1,?,?,?)')
    .run('Ева', '100', 'awaiting_review');
  const calls = [];
  const bot = { api: { sendPhoto: async (...args) => { calls.push(args); return { ok: true }; }, sendMessage: async (...args) => { calls.push(args); return sendMessage(...args); } } };
  return { db, calls, service: createInvitationService({ db, bot }) };
}

test('invitation is pending only after Telegram accepts the message', async () => {
  const { db, calls, service } = setup();

  await service.sendInvite(1);

  assert.equal(calls.length, 1);
  assert.match(calls[0][1], /Приглашаем на Лекторий/);
  assert.equal(db.prepare('SELECT status FROM invitations WHERE applicant_id=1').get().status, 'pending');
  assert.equal(db.prepare('SELECT status FROM applicants WHERE id=1').get().status, 'invited');
  assert.equal(db.prepare('SELECT status FROM invitation_attempts').get().status, 'pending');
});

test('failed Telegram invitation is visible as a delivery failure and can be retried', async () => {
  const { db, service } = setup({ sendMessage: async () => { throw new Error('network unavailable'); } });

  await assert.rejects(() => service.sendInvite(1), /Telegram не доставил приглашение/);

  assert.equal(db.prepare('SELECT status FROM invitations WHERE applicant_id=1').get().status, 'delivery_failed');
  assert.equal(db.prepare('SELECT status FROM applicants WHERE id=1').get().status, 'awaiting_review');
  assert.equal(db.prepare('SELECT status FROM invitation_attempts').get().status, 'delivery_failed');
});

test('Telegram user block has a distinct status and remains retryable', async () => {
  let blocked = true;
  const { db, service } = setup({ sendMessage: async () => { if (blocked) throw new Error('403: Forbidden: bot was blocked by the user'); } });
  await assert.rejects(() => service.sendInvite(1), /Пользователь заблокировал бота/);
  assert.equal(db.prepare('SELECT status FROM invitations').get().status, 'bot_blocked');
  assert.equal(db.prepare('SELECT status FROM invitation_attempts').get().status, 'bot_blocked');
  blocked = false;
  await service.sendInvite(1);
  assert.equal(db.prepare('SELECT status FROM invitations').get().status, 'pending');
});

test('automation expires an unanswered initial invitation', async () => {
  const { db, calls, service } = setup();
  db.prepare("INSERT INTO invitations (id,applicant_id,status,expires_at) VALUES (1,1,'pending',?)").run(new Date(Date.now() - 1_000).toISOString());
  db.prepare("INSERT INTO invitation_attempts (applicant_id,invitation_id,status,sent_at,expires_at) VALUES (1,1,'pending',?,?)")
    .run(new Date().toISOString(), new Date(Date.now() - 1_000).toISOString());

  await service.runAutomation();

  assert.equal(db.prepare('SELECT status FROM invitations WHERE id=1').get().status, 'expired');
  assert.equal(db.prepare('SELECT status FROM applicants WHERE id=1').get().status, 'expired');
  assert.equal(db.prepare('SELECT status FROM invitation_attempts WHERE invitation_id=1').get().status, 'expired');
  assert.match(calls.at(-1)[1], /Время ответа закончилось/);
});

test('automation no longer refuses guests for missing final confirmation', async () => {
  const { db, service } = setup();
  db.prepare("INSERT INTO invitations (id,applicant_id,status,expires_at,final_expires_at) VALUES (1,1,'confirmed',?,?)")
    .run(new Date(Date.now() + 60_000).toISOString(), new Date(Date.now() - 1_000).toISOString());

  await service.runAutomation();

  assert.equal(db.prepare('SELECT status FROM invitations WHERE id=1').get().status, 'confirmed');
});

test('daily reminder sends QR and cancellation without another confirmation, only once', async () => {
  const { db, calls, service } = setup();
  db.prepare('UPDATE events SET starts_at=? WHERE id=1').run(new Date(Date.now()+3600000).toISOString());
  db.prepare("INSERT INTO invitations(id,applicant_id,status,expires_at,checkin_token) VALUES(1,1,'confirmed',?,'existing-qr')").run(new Date().toISOString());
  await service.runAutomation();
  const row=db.prepare('SELECT * FROM invitations WHERE id=1').get();
  assert.ok(row.final_confirmed_at); assert.ok(row.reminder_sent_at); assert.equal(row.checkin_token,'existing-qr'); assert.equal(row.final_expires_at,null);
  assert.equal(calls.at(-1)[2].reply_markup.inline_keyboard[0][0].callback_data,'cancel:1');
  const count=calls.length; await service.runAutomation(); assert.equal(calls.length,count);
});

test('manual confirmation schedule uses reminder editor text without action buttons', async () => {
  const { db, calls, service } = setup();
  const event = db.prepare('SELECT * FROM events WHERE id=1').get();
  await service.sendSchedule('100', event);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][1], event.reminder_text);
  assert.equal(calls[0][2].reply_markup, undefined);
});

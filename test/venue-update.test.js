import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import { sendVenueUpdate, venueUpdateRecipients } from '../src/services/venue-update.js';

test('venue update targets only primary confirmations, excludes named guests, and tracks delivery', async () => {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE applicants(id INTEGER PRIMARY KEY,event_id INTEGER,telegram_id TEXT,telegram_name TEXT,status TEXT);
    CREATE TABLE invitations(id INTEGER PRIMARY KEY,applicant_id INTEGER,status TEXT,final_confirmed_at TEXT,reminder_sent_at TEXT,venue_response TEXT,venue_update_sent INTEGER DEFAULT 0);
    CREATE TABLE blocked_users(telegram_id TEXT);`);
  const add = (id, name, status='confirmed', final=null, reminder=null, response=null) => {
    db.prepare('INSERT INTO applicants VALUES (?,2,?,?,?)').run(id,String(id),name,status);
    db.prepare('INSERT INTO invitations VALUES (?,?,?,?,?,?,0)').run(id,id,status,final,reminder,response);
  };
  add(1,'eligible'); add(2,'Ivs354'); add(3,'rine_taemin'); add(4,'final','confirmed','now');
  add(5,'waiting','pending'); add(6,'refused','declined'); add(7,'answered','confirmed',null,null,'confirmed');
  add(8,'failure'); add(9,'reminder','confirmed',null,'now');
  assert.deepEqual(venueUpdateRecipients(db,2).map(p=>p.applicant_id),[1,8]);
  const api={sendMessage:async (id,text,options)=>{ if(id==='8') throw Error('delivery failed'); assert.match(text,/Музей космонавтики/); assert.equal(options.reply_markup.inline_keyboard[0][0].callback_data,'venue:yes:1'); }};
  const result=await sendVenueUpdate(db,api,2);
  assert.deepEqual(result.sent,[1]); assert.equal(result.failed.length,1);
  assert.equal(db.prepare('SELECT venue_response FROM invitations WHERE id=1').get().venue_response,'pending');
  assert.equal(db.prepare('SELECT venue_update_sent FROM invitations WHERE id=8').get().venue_update_sent,0);
  assert.deepEqual(venueUpdateRecipients(db,2).map(p=>p.applicant_id),[8]);
  db.close();
});

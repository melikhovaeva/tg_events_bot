import assert from 'node:assert/strict';
import test from 'node:test';
import {telegramMessageHtml,telegramMessageSnapshot} from '../src/lib/telegram-message.js';

test('incoming post keeps hidden links, nested formatting and UTF-16 emoji offsets',()=>{
  const text='💜 Наш чат';
  const entities=[{type:'bold',offset:3,length:7},{type:'text_link',offset:3,length:7,url:'https://t.me/test?a=1&b=2'}];
  // Use the actual substring length, as Telegram does.
  entities.forEach(e=>e.length=text.length-3);
  const html=telegramMessageHtml({text,entities});
  assert.ok(html.includes('💜 '));assert.ok(html.includes('<strong>'));assert.ok(html.includes('href="https://t.me/test?a=1&amp;b=2"'));assert.ok(html.includes('Наш чат'));
});
test('incoming HTML escapes text and rejects unsafe entity links',()=>{
  assert.equal(telegramMessageHtml({text:'<x>',entities:[{type:'text_link',offset:0,length:3,url:'javascript:alert(1)'}]}),'&lt;x&gt;');
});
test('media snapshot keeps original caption entities, files and album grouping without sender/contact data',()=>{
  const message={message_id:3,caption:'Фото',caption_entities:[{type:'bold',offset:0,length:4}],media_group_id:'album',photo:[{file_id:'photo'}],document:{file_id:'doc'},from:{id:42},contact:{phone_number:'secret'}};
  const saved=telegramMessageSnapshot(message);
  assert.deepEqual(saved.caption_entities,message.caption_entities);assert.equal(saved.photo[0].file_id,'photo');assert.equal(saved.media_group_id,'album');assert.equal(saved.message_id,3);assert.equal(saved.from,undefined);assert.equal(saved.contact,undefined);
});

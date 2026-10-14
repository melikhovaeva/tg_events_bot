import { InlineKeyboard } from 'grammy';
import { messageOptions } from '../lib/text.js';

export const venueUpdateText = `<b>У нас важное обновление по лекторию ❤️‍🔥</b>

Изначально мы должны были встретиться в офисе компании, но из-за последних событий с этой недели там временно запретили проведение внешних мероприятий.

Мы очень не хотели отменять встречу и последние дни искали вариант, как всё-таки её сохранить. И нашли новую площадку  <b>Музей космонавтики</b> 🚀

Сам лекторий остаётся бесплатным, но для прохода на территорию музея понадобится входной билет:
<b>350 ₽</b> — для студентов очной формы
<b>500 ₽</b> — взрослый билет

Если у вас есть Пушкинская карта, билет можно оформить онлайн через неё или просто купить на сайте:
<a href="https://bilet.mos.ru/event/295419257/">https://bilet.mos.ru/event/295419257/</a>

Из-за изменений нам нужно ещё раз понять, кто точно сможет прийти в новом формате. Пожалуйста, подтвердите участие ниже.`;

export function venueUpdateRecipients(db, eventId) {
  return db.prepare(`SELECT i.id invitation_id, a.id applicant_id, a.telegram_id
    FROM invitations i JOIN applicants a ON a.id=i.applicant_id
    WHERE a.event_id=? AND i.status='confirmed' AND a.status='confirmed'
    AND i.final_confirmed_at IS NULL AND i.reminder_sent_at IS NULL
    AND i.venue_response IS NULL AND i.venue_update_sent=0
    AND a.telegram_id IS NOT NULL
    AND LOWER(LTRIM(COALESCE(a.telegram_name,''),'@')) NOT IN ('ivs354','rine_taemin')
    AND NOT EXISTS(SELECT 1 FROM blocked_users b WHERE b.telegram_id=a.telegram_id)`).all(eventId);
}

export async function sendVenueUpdate(db, api, eventId) {
  const sent = [], failed = [];
  for (const person of venueUpdateRecipients(db, eventId)) {
    try {
      await api.sendMessage(person.telegram_id, venueUpdateText, messageOptions({ reply_markup: new InlineKeyboard()
        .text('Я приду и куплю билет', `venue:yes:${person.invitation_id}`).style('primary').row()
        .text('Не смогу прийти', `venue:no:${person.invitation_id}`).style('danger') }));
      db.prepare("UPDATE invitations SET venue_update_sent=1,venue_response='pending' WHERE id=? AND venue_response IS NULL").run(person.invitation_id);
      sent.push(person.applicant_id);
    } catch (error) { failed.push({ id: person.applicant_id, reason: error.description || error.message }); }
  }
  return { sent, failed };
}

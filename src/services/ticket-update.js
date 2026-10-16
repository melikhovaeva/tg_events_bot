export const ticketUpdateText = `<b>Где и как купить билеты?</b>
Билеты можно приобрести по <a href="https://bilet.mos.ru/event/295419257/">ссылке</a>.

При покупке выберите сеанс на <b>10:00</b> — «Посещение основной экспозиции и выставок Музея космонавтики».

Утром в нашем чате мы поделимся маршрутом до зала, где пройдёт мероприятие.

Если вы ещё не присоединились, самое время! Велком в наш чат: <a href="https://t.me/perasperagram_community_chat">@perasperagram_community_chat</a>`;

export function ticketRecipients(db, eventId) {
  return db.prepare(`SELECT DISTINCT a.telegram_id FROM applicants a JOIN invitations i ON i.applicant_id=a.id
    WHERE a.event_id=? AND a.status='confirmed' AND i.status='confirmed' AND a.telegram_id IS NOT NULL
    AND (COALESCE(i.venue_response,'') NOT IN ('pending','declined') OR i.final_confirmed_at IS NOT NULL)
    AND NOT EXISTS(SELECT 1 FROM blocked_users b WHERE b.telegram_id=a.telegram_id)
    AND NOT EXISTS(SELECT 1 FROM ticket_update_deliveries d WHERE d.event_id=a.event_id AND d.telegram_id=a.telegram_id)`).all(eventId);
}

export async function sendTicketUpdate(db, api, eventId) {
  const sent=[],failed=[];
  for (const person of ticketRecipients(db,eventId)) {
    try {
      const message=await api.sendMessage(person.telegram_id,ticketUpdateText,{parse_mode:'HTML',link_preview_options:{is_disabled:true}});
      db.prepare('INSERT INTO ticket_update_deliveries(event_id,telegram_id,message_id) VALUES (?,?,?)').run(eventId,person.telegram_id,message.message_id);
      sent.push(person.telegram_id);
    } catch(error) { failed.push({telegramId:person.telegram_id,reason:error.description||error.message}); }
    await new Promise(resolve=>setTimeout(resolve,60));
  }
  return {sent,failed};
}

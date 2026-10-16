const escape = (value) => String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');

export function telegramMessageSnapshot(message) {
  const snapshot = {};
  for (const key of ['message_id','date','text','entities','caption','caption_entities','media_group_id','photo','document','video','animation','audio','voice','video_note','has_media_spoiler']) {
    if (message[key] !== undefined) snapshot[key] = message[key];
  }
  return snapshot;
}

export function telegramMessageHtml(message) {
  const text = message.text ?? message.caption ?? '';
  const entities = message.text !== undefined ? message.entities : message.caption_entities;
  const ranges = [];
  const tags = { bold:'strong',italic:'em',underline:'u',strikethrough:'s',code:'code',pre:'pre',blockquote:'blockquote',expandable_blockquote:'blockquote',spoiler:'span' };
  for (const entity of entities || []) {
    if (!Number.isInteger(entity.offset) || !Number.isInteger(entity.length) || entity.offset<0 || entity.length<=0 || entity.offset+entity.length>text.length) continue;
    let tag = tags[entity.type], open;
    if (entity.type === 'text_link' || entity.type === 'url') {
      const url = entity.url || text.slice(entity.offset,entity.offset+entity.length);
      if (!/^(https?:\/\/|tg:\/\/|mailto:)/i.test(url)) continue;
      tag='a'; open=`<a href="${escape(url)}" target="_blank" rel="noopener noreferrer">`;
    }
    if (tag) ranges.push({start:entity.offset,end:entity.offset+entity.length,order:ranges.length,open:open||`<${tag}>`,close:`</${tag}>`});
  }
  // Telegram entity offsets are UTF-16, matching JavaScript string indices.
  let html='';
  for(let index=0;index<=text.length;index++) {
    for(const range of ranges.filter(r=>r.end===index).sort((a,b)=>b.start-a.start || b.order-a.order)) html+=range.close;
    for(const range of ranges.filter(r=>r.start===index).sort((a,b)=>b.end-a.end)) html+=range.open;
    if(index<text.length) html+=escape(text[index]);
  }
  return html;
}

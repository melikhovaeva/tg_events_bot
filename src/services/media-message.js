import path from 'node:path';
import { InputFile } from 'grammy';
import { uploadsDir } from '../lib/paths.js';
import { messageOptions } from '../lib/text.js';

export async function sendMediaMessage(api, chatId, text, images = [], keyboard) {
  // Telegram limits photo captions to 1024 characters after parsing HTML.
  const visible = text.replace(/<[^>]*>/g, '').replace(/&(?:amp|lt|gt|quot|#39);/g, 'x');
  const fits = visible.length <= 1024;
  const media = (image) => new InputFile(path.join(uploadsDir, image.stored_name), image.original_name);
  if (images.length === 1 && fits) {
    return api.sendPhoto(chatId, media(images[0]), { caption: text, parse_mode: 'HTML', ...(keyboard ? { reply_markup: keyboard } : {}) });
  }
  if (images.length) {
    if (images.length === 1) await api.sendPhoto(chatId, media(images[0]));
    else await api.sendMediaGroup(chatId, images.map((image, index) => ({ type: 'photo', media: media(image), ...(index === 0 && fits ? { caption: text, parse_mode: 'HTML' } : {}) })));
  }
  if (!images.length || !fits) {
    if (text) return api.sendMessage(chatId, text, messageOptions(keyboard ? { reply_markup: keyboard } : undefined));
  } else if (keyboard) {
    return api.sendMessage(chatId, 'Выберите ответ:', { reply_markup: keyboard });
  }
}

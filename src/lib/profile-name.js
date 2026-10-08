export function profileNameError(value) {
  const name = String(value || '').trim();
  if (/\d/u.test(name)) return 'Сейчас напишите только полное ФИО, без номера телефона. Телефон попросим на следующем шаге.';
  if (name.split(/\s+/u).length < 2 || !/^[\p{L}\p{M}\s’'\-]+$/u.test(name)) {
    return 'Напишите полное ФИО: фамилию, имя и отчество, если есть. Например: Иванова Анна Сергеевна.';
  }
  return null;
}

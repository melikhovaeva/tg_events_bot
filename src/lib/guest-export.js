import ExcelJS from 'exceljs';

const statuses = { awaiting_review: 'Новая заявка', invited: 'Ждёт ответа', pending: 'Ждёт ответа', delivery_failed: 'Приглашение не доставлено', confirmed: 'Первично подтвердил', declined: 'Отказался', rejected: 'Отказ организатора', expired: 'Не ответил за 24 часа', final_expired: 'Не подтвердил за 6 часов', cancelled: 'Отменил регистрацию' };
export async function guestWorkbook(event, people) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Участники', { views: [{ state: 'frozen', ySplit: 1 }] });
  sheet.columns = [
    { header: 'ФИО', key: 'name', width: 38 },
    { header: 'Телефон', key: 'phone', width: 20 },
    { header: 'Telegram', key: 'telegram', width: 24 },
    { header: 'Студент школы', key: 'student', width: 19 },
    { header: 'Статус', key: 'status', width: 32 },
    { header: 'Пришёл', key: 'attended', width: 12 },
    { header: 'Дата регистрации · МСК', key: 'created', width: 27 },
  ];
  const date = (value) => value ? new Date(value.endsWith('Z') || value.includes('+') ? value : value.replace(' ', 'T') + 'Z').toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' }) : '';
  for (const person of people) sheet.addRow({
    name: person.name || '', phone: String(person.phone || ''), telegram: person.telegram_name ? `@${person.telegram_name}` : '',
    student: person.was_school_student == null ? 'Не указано' : person.was_school_student ? 'Да' : 'Нет',
    status: person.checked_in_at ? 'Пришёл' : person.invitation_status === 'confirmed' && person.final_confirmed_at ? 'Участие подтверждено' : person.invitation_status === 'confirmed' && person.reminder_sent_at ? 'Ждём финального ответа' : statuses[person.invitation_status || person.status] || 'Не указан',
    attended: person.checked_in_at ? 'Да' : 'Нет', created: date(person.created_at),
  });
  sheet.getColumn('phone').numFmt = '@';
  sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF18181B' } };
  sheet.getRow(1).height = 30;
  sheet.autoFilter = { from: 'A1', to: `G${Math.max(1, sheet.rowCount)}` };
  workbook.title = event.title;
  return workbook.xlsx.writeBuffer();
}

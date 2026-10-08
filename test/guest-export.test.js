import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { guestWorkbook } from '../src/lib/guest-export.js';

test('Excel export preserves phones as text and contains every registration', async () => {
  const buffer = await guestWorkbook({ title: 'Лекторий' }, [
    { name: '=Иванов', phone: '+79991234567', telegram_name: 'ivan', status: 'awaiting_review', was_school_student: 0 },
    { name: 'Анна', status: 'confirmed', invitation_status: 'confirmed', final_confirmed_at: '2026-10-17T09:00:00Z', checked_in_at: '2026-10-17T10:00:00Z' },
  ]);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const sheet = workbook.getWorksheet('Участники');
  assert.equal(sheet.rowCount, 3);
  assert.equal(sheet.getCell('A2').value, '=Иванов');
  assert.equal(sheet.getCell('B2').value, '+79991234567');
  assert.equal(sheet.getCell('C2').value, '@ivan');
  assert.equal(sheet.getCell('E3').value, 'Пришёл');
  assert.equal(sheet.getCell('F3').value, 'Да');
});

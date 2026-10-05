import fs from 'node:fs';
import path from 'node:path';

const MOSCOW_OFFSET_MS = 3 * 60 * 60 * 1000;

function moscowDateKey(now = new Date()) {
  return new Date(now.getTime() + MOSCOW_OFFSET_MS).toISOString().slice(0, 10);
}

export async function createDatabaseBackup(db, backupsDir, { keep = 3, now = new Date() } = {}) {
  fs.mkdirSync(backupsDir, { recursive: true });

  const target = path.join(backupsDir, `events-${moscowDateKey(now)}.sqlite`);
  const temporary = `${target}.tmp`;
  fs.rmSync(temporary, { force: true });
  await db.backup(temporary);
  fs.renameSync(temporary, target);

  const backups = fs.readdirSync(backupsDir)
    .filter((file) => /^events-\d{4}-\d{2}-\d{2}\.sqlite$/.test(file))
    .sort()
    .reverse();
  for (const oldBackup of backups.slice(keep)) fs.rmSync(path.join(backupsDir, oldBackup), { force: true });

  return target;
}

export function millisecondsUntilNextMoscowBackup(now = new Date()) {
  const moscowNow = new Date(now.getTime() + MOSCOW_OFFSET_MS);
  const target = new Date(moscowNow);
  target.setUTCHours(3, 30, 0, 0);
  if (target <= moscowNow) target.setUTCDate(target.getUTCDate() + 1);
  return target.getTime() - moscowNow.getTime();
}

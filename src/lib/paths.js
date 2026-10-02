import fs from 'node:fs';
import path from 'node:path';

export const dbPath = process.env.DATABASE_PATH || './data/events.sqlite';
export const uploadsDir = path.resolve('./data/uploads');

export function ensureDataDirectories() {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  fs.mkdirSync(uploadsDir, { recursive: true });
}

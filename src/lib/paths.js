import fs from 'node:fs';
import path from 'node:path';

// In production DATA_DIR is mounted as a persistent Docker volume. Keeping the
// database and uploaded files together makes deployments replaceable without
// losing event data.
export const dataDir = path.resolve(
  process.env.DATA_DIR || path.dirname(process.env.DATABASE_PATH || './data/events.sqlite'),
);
export const dbPath = path.resolve(process.env.DATABASE_PATH || path.join(dataDir, 'events.sqlite'));
export const uploadsDir = path.join(dataDir, 'uploads');
export const backupsDir = path.join(dataDir, 'backups');

export function ensureDataDirectories() {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(uploadsDir, { recursive: true });
}

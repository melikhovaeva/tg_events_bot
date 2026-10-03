import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { backupsDir, dataDir, dbPath } from '../src/lib/paths.js';

fs.mkdirSync(dataDir, { recursive: true });
fs.mkdirSync(backupsDir, { recursive: true });

if (!fs.existsSync(dbPath)) {
  console.error(`База данных не найдена: ${dbPath}`);
  process.exit(1);
}

const date = new Date().toISOString().replaceAll(':', '-').replace(/\.\d{3}Z$/, 'Z');
const target = path.join(backupsDir, `events-${date}.sqlite`);
const db = new Database(dbPath, { readonly: true });

try {
  await db.backup(target);
  console.log(`Резервная копия создана: ${target}`);
} finally {
  db.close();
}

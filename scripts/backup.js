import 'dotenv/config';
import fs from 'node:fs';
import Database from 'better-sqlite3';
import { createDatabaseBackup } from '../src/lib/backup.js';
import { backupsDir, dataDir, dbPath } from '../src/lib/paths.js';

fs.mkdirSync(dataDir, { recursive: true });
fs.mkdirSync(backupsDir, { recursive: true });

if (!fs.existsSync(dbPath)) {
  console.error(`База данных не найдена: ${dbPath}`);
  process.exit(1);
}

const db = new Database(dbPath, { readonly: true });

try {
  const target = await createDatabaseBackup(db, backupsDir);
  console.log(`Резервная копия создана: ${target}`);
} finally {
  db.close();
}

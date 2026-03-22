import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import pg from 'pg';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const sqlPath = join(__dirname, '../supabase/migrations/001_create_records.sql');

// POSTGRES_URL from .env.local (or env)
const url = process.env.POSTGRES_URL || process.env.DATABASE_URL;
if (!url) {
  console.error('POSTGRES_URL or DATABASE_URL required');
  process.exit(1);
}

const sql = readFileSync(sqlPath, 'utf-8')
  .split('\n')
  .filter(l => !l.trim().startsWith('--'))
  .join('\n');

const client = new pg.Client({
  connectionString: url,
  ssl: { rejectUnauthorized: false },
});
await client.connect();
await client.query(sql);
await client.end();
console.log('✓ Migration completed');

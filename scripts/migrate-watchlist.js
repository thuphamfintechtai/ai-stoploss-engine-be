/**
 * Migration cho Watchlist & Price Alerts.
 * Usage: npm run migrate:watchlist  hoặc  node scripts/migrate-watchlist.js
 */
import dotenv from 'dotenv';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import pkg from 'pg';
const { Pool } = pkg;

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sqlPath = path.join(__dirname, '..', 'migrations', '003_watchlist_alerts.sql');

async function migrate() {
  const pool = new Pool({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT || 5432,
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD
  });

  try {
    console.log('Running 003_watchlist_alerts.sql...');
    const sql = readFileSync(sqlPath, 'utf8');
    const sqlCompat = sql.replace(/\bEXECUTE FUNCTION\b/gi, 'EXECUTE PROCEDURE');
    await pool.query(sqlCompat);
    console.log('✅ Migration 003_watchlist_alerts hoàn tất.');
  } catch (err) {
    console.error('❌ Migration failed:', err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

migrate();

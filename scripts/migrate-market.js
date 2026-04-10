/**
 * Chỉ chạy migration bảng market (ohlcv_1d, ohlcv_1m, symbols, valuation, technical_indicators).
 * Dùng khi đã có schema.sql rồi, không cần chạy lại toàn bộ.
 * Usage: npm run migrate:market
 */
import dotenv from 'dotenv';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import pkg from 'pg';
const { Pool } = pkg;

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sqlPath = path.join(__dirname, '..', 'migrations', '002_market_tables.sql');

async function run() {
  const pool = new Pool({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT || 5432,
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD
  });

  try {
    const sql = readFileSync(sqlPath, 'utf8');
    await pool.query(sql);
    console.log('Market tables migration (002) completed.');
  } catch (err) {
    console.error('Migration failed:', err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

run();

/**
 * Xóa toàn bộ dữ liệu bảng positions (và trade_orders nếu có).
 * Chạy: node scripts/clear-positions.js
 */
import dotenv from 'dotenv';
import pkg from 'pg';
const { Pool } = pkg;

dotenv.config();

const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
});

const schema = process.env.DB_SCHEMA || 'financial';

async function clear() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const tables = [`${schema}.trade_orders`, `${schema}.positions`];
    for (const table of tables) {
      try {
        const res = await client.query(`DELETE FROM ${table}`);
        console.log(`Deleted ${res.rowCount} row(s) from ${table}`);
      } catch (e) {
        if (e.code === '42P01') console.log(`Table ${table} not found, skip.`);
        else throw e;
      }
    }
    await client.query('COMMIT');
    console.log('Done.');
  } catch (e) {
    await client.query('ROLLBACK');
    if (e.code === '42P01') {
      console.log('Table not found (skipped):', e.message);
    } else {
      throw e;
    }
  } finally {
    client.release();
    await pool.end();
  }
}

clear().catch((err) => {
  console.error(err);
  process.exit(1);
});

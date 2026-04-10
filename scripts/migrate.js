/**
 * Chạy migration: schema.sql rồi 002_market_tables.sql (nếu có)
 * Usage: npm run migrate   hoặc   node scripts/migrate.js
 */
import dotenv from 'dotenv';
import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import pkg from 'pg';
const { Pool } = pkg;

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(__dirname, '..', 'migrations');

async function runSql(pool, filePath, label) {
  const sql = readFileSync(filePath, 'utf8');
  const sqlCompat = sql.replace(/\bEXECUTE FUNCTION\b/gi, 'EXECUTE PROCEDURE');
  await pool.query(sqlCompat);
  console.log('  OK:', label);
}

async function migrate() {
  const pool = new Pool({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT || 5432,
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD
  });

  try {
    const schemaPath = path.join(migrationsDir, 'schema.sql');
    console.log('Running schema.sql...');
    await runSql(pool, schemaPath, 'schema.sql');

    const marketPath = path.join(migrationsDir, '002_market_tables.sql');
    if (existsSync(marketPath)) {
      console.log('Running 002_market_tables.sql...');
      await runSql(pool, marketPath, '002_market_tables.sql');
    }

    console.log('Migration completed successfully.');
  } catch (err) {
    console.error('Migration failed:', err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

migrate();

import pkg from 'pg';
const { Pool } = pkg;
import dotenv from 'dotenv';

dotenv.config();

// PostgreSQL connection pool – tăng timeout và bật keepAlive để tránh "Connection terminated due to connection timeout"
const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  min: parseInt(process.env.DB_POOL_MIN) || 2,
  max: parseInt(process.env.DB_POOL_MAX) || 10,
  idleTimeoutMillis: parseInt(process.env.DB_IDLE_TIMEOUT_MS) || 60000,
  connectionTimeoutMillis: parseInt(process.env.DB_CONNECT_TIMEOUT_MS) || 30000,
  statement_timeout: parseInt(process.env.DB_STATEMENT_TIMEOUT_MS) || 30000,
  keepAlive: true,
  keepAliveInitialDelayMillis: 10000
});

// Set default schema
pool.on('connect', (client) => {
  client.query(`SET search_path TO ${process.env.DB_SCHEMA || 'financial'}, public`);
});

// Error handler – chỉ log, không thoát process (pool sẽ loại client lỗi và tạo kết nối mới khi cần)
pool.on('error', (err) => {
  console.error('PostgreSQL pool error (idle client):', err.message);
});

// Test connection
export async function testConnection() {
  try {
    const client = await pool.connect();
    const result = await client.query('SELECT NOW() as now, current_schema() as schema');
    console.log('Database connected successfully');
    console.log(`   Time: ${result.rows[0].now}`);
    console.log(`   Schema: ${result.rows[0].schema}`);
    client.release();
    return true;
  } catch (err) {
    console.error('Database connection failed:', err.message);
    return false;
  }
}

// Query helper – retry 1 lần khi lỗi connection timeout / terminated (pool sẽ lấy connection mới)
const isConnectionError = (err) =>
  err?.message?.includes('connection timeout') ||
  err?.message?.includes('Connection terminated') ||
  err?.message?.includes('connection refused') ||
  err?.code === 'ECONNRESET' ||
  err?.code === 'ETIMEDOUT';

export async function query(text, params) {
  const start = Date.now();
  try {
    const result = await pool.query(text, params);
    const duration = Date.now() - start;
    if (process.env.LOG_LEVEL === 'debug') {
      console.log('Executed query', { text, duration, rows: result.rowCount });
    }
    return result;
  } catch (error) {
    if (isConnectionError(error)) {
      try {
        const result = await pool.query(text, params);
        if (process.env.LOG_LEVEL === 'debug') {
          console.log('Executed query (retry)', { duration: Date.now() - start, rows: result.rowCount });
        }
        return result;
      } catch (retryErr) {
        console.error('Database query error (after retry):', retryErr.message);
        throw retryErr;
      }
    }
    console.error('Database query error:', error.message);
    throw error;
  }
}

// Transaction helper
export async function transaction(callback) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

// Get client from pool (for complex operations)
export async function getClient() {
  return await pool.connect();
}

export default pool;

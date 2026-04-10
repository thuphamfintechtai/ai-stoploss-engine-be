/**
 * Seed database: tạo dữ liệu mẫu (user, portfolio) nếu cần
 * Usage: npm run seed   hoặc   node scripts/seed.js
 * Env: SEED_DEMO=true để tạo user/portfolio demo
 */
import dotenv from 'dotenv';
import { query, testConnection } from '../config/database.js';
import User from '../models/User.js';

dotenv.config();

async function seed() {
  try {
    const connected = await testConnection();
    if (!connected) {
      console.error('Database connection failed.');
      process.exit(1);
    }

    if (process.env.SEED_DEMO !== 'true') {
      console.log('Seed skipped. Set SEED_DEMO=true to create demo user and portfolio.');
      process.exit(0);
    }

    const demoEmail = process.env.SEED_DEMO_EMAIL || 'demo@example.com';
    const demoPassword = process.env.SEED_DEMO_PASSWORD || 'demo123456';
    const demoUsername = process.env.SEED_DEMO_USERNAME || 'demouser';

    const existing = await User.findByEmail(demoEmail);
    if (existing) {
      console.log('Demo user already exists:', demoEmail);
      process.exit(0);
    }

    const user = await User.create({
      email: demoEmail,
      username: demoUsername,
      password: demoPassword,
      fullName: 'Demo User'
    });

    await query(
      `INSERT INTO portfolios (user_id, name, total_balance, max_risk_percent, expected_return_percent)
       VALUES ($1, $2, $3, $4, $5)`,
      [user.id, 'Demo Portfolio', 500000000, 5, 10]
    );

    console.log('Seed completed. Demo user:', demoEmail, '| Password:', demoPassword);
  } catch (err) {
    console.error('Seed failed:', err.message);
    process.exit(1);
  }
}

seed();

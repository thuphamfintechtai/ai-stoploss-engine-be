import { query } from '../config/database.js';
import bcrypt from 'bcrypt';

class User {
  static async create({ email, username, password, fullName }) {
    const passwordHash = await bcrypt.hash(password, parseInt(process.env.BCRYPT_ROUNDS) || 10);

    const result = await query(
      `INSERT INTO users (email, username, password_hash, full_name)
       VALUES ($1, $2, $3, $4)
       RETURNING id, email, username, full_name, created_at, updated_at`,
      [email, username, passwordHash, fullName]
    );

    return result.rows[0];
  }

  static async findById(id) {
    const result = await query(
      `SELECT id, email, username, full_name, created_at, updated_at
       FROM users WHERE id = $1`,
      [id]
    );

    return result.rows[0];
  }

  static async findByEmail(email) {
    const result = await query(
      `SELECT id, email, username, password_hash, full_name, created_at, updated_at
       FROM users WHERE email = $1`,
      [email]
    );

    return result.rows[0];
  }

  static async findByUsername(username) {
    const result = await query(
      `SELECT id, email, username, password_hash, full_name, created_at, updated_at
       FROM users WHERE username = $1`,
      [username]
    );

    return result.rows[0];
  }

  static async validatePassword(plainPassword, hashedPassword) {
    return await bcrypt.compare(plainPassword, hashedPassword);
  }

  static async update(id, { email, username, fullName }) {
    const result = await query(
      `UPDATE users
       SET email = COALESCE($2, email),
           username = COALESCE($3, username),
           full_name = COALESCE($4, full_name)
       WHERE id = $1
       RETURNING id, email, username, full_name, updated_at`,
      [id, email, username, fullName]
    );

    return result.rows[0];
  }

  static async delete(id) {
    await query('DELETE FROM users WHERE id = $1', [id]);
  }
}

export default User;

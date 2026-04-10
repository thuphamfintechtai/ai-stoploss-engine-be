import User from '../models/User.js';
import { generateToken } from '../middleware/auth.js';
import Joi from 'joi';

// Validation schemas
export const registerSchema = Joi.object({
  email: Joi.string().email().required(),
  username: Joi.string().min(3).max(50).required(),
  password: Joi.string().min(6).required(),
  fullName: Joi.string().max(255).optional()
});

export const loginSchema = Joi.object({
  email: Joi.string().email().required(),
  password: Joi.string().required()
});

// Register new user
export const register = async (req, res, next) => {
  try {
    const body = req.validatedBody || req.body;
    const { email, username, password, fullName } = body;

    // Check if user already exists
    const existingUser = await User.findByEmail(email);
    if (existingUser) {
      return res.status(409).json({
        success: false,
        message: 'Email already registered'
      });
    }

    const existingUsername = await User.findByUsername(username);
    if (existingUsername) {
      return res.status(409).json({
        success: false,
        message: 'Username already taken'
      });
    }

    // Create user
    const user = await User.create({ email, username, password, fullName });

    // Generate token
    const token = generateToken(user.id);

    res.status(201).json({
      success: true,
      message: 'User registered successfully',
      data: {
        user: {
          id: user.id,
          email: user.email,
          username: user.username,
          fullName: user.full_name
        },
        token
      }
    });
  } catch (error) {
    next(error);
  }
};

// Login
export const login = async (req, res, next) => {
  try {
    const body = req.validatedBody || req.body;
    const { email, password } = body;

    // Find user by email
    const user = await User.findByEmail(email);
    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password'
      });
    }

    // Validate password
    const isValidPassword = await User.validatePassword(password, user.password_hash);
    if (!isValidPassword) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password'
      });
    }

    // Generate token
    const token = generateToken(user.id);

    res.json({
      success: true,
      message: 'Login successful',
      data: {
        user: {
          id: user.id,
          email: user.email,
          username: user.username,
          fullName: user.full_name
        },
        token
      }
    });
  } catch (error) {
    next(error);
  }
};

// Get current user info
export const me = async (req, res, next) => {
  try {
    const user = await User.findById(req.user.userId);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    res.json({
      success: true,
      data: {
        id: user.id,
        email: user.email,
        username: user.username,
        fullName: user.full_name,
        createdAt: user.created_at
      }
    });
  } catch (error) {
    next(error);
  }
};

// Logout (client-side only, just return success)
export const logout = async (req, res) => {
  res.json({
    success: true,
    message: 'Logout successful'
  });
};

export const updateProfileSchema = Joi.object({
  fullName: Joi.string().max(255).optional().allow(''),
  username: Joi.string().min(3).max(50).optional(),
});

// Update profile (fullName, username)
export const updateProfile = async (req, res, next) => {
  try {
    const body = req.validatedBody || req.body;
    const { fullName, username } = body;

    if (username) {
      const existing = await User.findByUsername(username);
      if (existing && existing.id !== req.user.userId) {
        return res.status(409).json({ success: false, message: 'Username đã được sử dụng' });
      }
    }

    const updated = await User.update(req.user.userId, { fullName, username });
    res.json({
      success: true,
      message: 'Cập nhật hồ sơ thành công',
      data: { id: updated.id, email: updated.email, username: updated.username, fullName: updated.full_name }
    });
  } catch (error) {
    next(error);
  }
};

export const changePasswordSchema = Joi.object({
  current_password: Joi.string().required(),
  new_password: Joi.string().min(6).required(),
});

// Change password
export const changePassword = async (req, res, next) => {
  try {
    const { current_password, new_password } = req.validatedBody || req.body;

    const user = await User.findById(req.user.userId);
    if (!user) {
      return res.status(404).json({ success: false, message: 'Người dùng không tồn tại' });
    }

    const valid = await User.validatePassword(current_password, user.password_hash);
    if (!valid) {
      return res.status(400).json({ success: false, message: 'Mật khẩu hiện tại không đúng' });
    }

    const DB = process.env.DB_SCHEMA || 'financial';
    const bcrypt = await import('bcrypt');
    const newHash = await bcrypt.default.hash(new_password, parseInt(process.env.BCRYPT_ROUNDS) || 10);
    const { query } = await import('../config/database.js');
    await query(`UPDATE ${DB}.users SET password_hash=$1, updated_at=NOW() WHERE id=$2`, [newHash, req.user.userId]);

    res.json({ success: true, message: 'Đổi mật khẩu thành công' });
  } catch (error) {
    next(error);
  }
};

export default { register, login, me, logout, updateProfile, changePassword, registerSchema, loginSchema, updateProfileSchema, changePasswordSchema };

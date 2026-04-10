import express from 'express';
import * as authController from '../controllers/auth.controller.js';
import { validate } from '../middleware/validation.js';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

// Public routes
router.post('/register', validate(authController.registerSchema), authController.register);
router.post('/login', validate(authController.loginSchema), authController.login);

// Protected routes
router.get('/me', authenticateToken, authController.me);
router.post('/logout', authenticateToken, authController.logout);
router.put('/profile', authenticateToken, validate(authController.updateProfileSchema), authController.updateProfile);
router.put('/change-password', authenticateToken, validate(authController.changePasswordSchema), authController.changePassword);

export default router;

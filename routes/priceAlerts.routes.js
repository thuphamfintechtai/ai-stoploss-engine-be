import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { getAlerts, createAlert, deleteAlert, toggleAlert, resetAlert } from '../controllers/priceAlerts.controller.js';

const router = express.Router();
router.use(authenticateToken);

router.get('/',              getAlerts);
router.post('/',             createAlert);
router.delete('/:id',        deleteAlert);
router.patch('/:id/toggle',  toggleAlert);
router.patch('/:id/reset',   resetAlert);

export default router;

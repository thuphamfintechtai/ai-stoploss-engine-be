import express from 'express';
import * as positionController from '../controllers/position.controller.js';
import { validate } from '../middleware/validation.js';
import { authenticateToken } from '../middleware/auth.js';

// mergeParams: true để nhận req.params.portfolioId từ route cha (portfolios/:portfolioId/positions)
const router = express.Router({ mergeParams: true });

router.use(authenticateToken);

router.get('/', positionController.list);
router.post('/', validate(positionController.createPositionSchema), positionController.create);
router.post('/calculate', validate(positionController.calculatePositionSchema), positionController.calculate);
router.get('/:id', positionController.getById);
router.patch('/:id', validate(positionController.updatePositionSchema), positionController.update);
router.post('/:id/close', validate(positionController.closePositionSchema), positionController.close);

export default router;

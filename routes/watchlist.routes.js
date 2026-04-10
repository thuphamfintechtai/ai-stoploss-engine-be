import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { getWatchlist, addToWatchlist, syncWatchlist, removeFromWatchlist } from '../controllers/watchlist.controller.js';

const router = express.Router();
router.use(authenticateToken);

router.get('/',            getWatchlist);
router.post('/',           addToWatchlist);
router.post('/bulk',       syncWatchlist);          // sync toàn bộ từ localStorage lên
router.delete('/:symbol',  removeFromWatchlist);

export default router;

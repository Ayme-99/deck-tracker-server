const express = require('express');
const router = express.Router();
const statsController = require('../controllers/statsController');
const protect = require('../middleware/authMiddleware');

router.use(protect);

router.get('/global/overview', statsController.getGlobalOverview);
router.get('/global/ranking', statsController.getDeckRanking);
router.get('/deck/:deckId/overview', statsController.getDeckOverview);
router.get('/deck/:deckId/matchups', statsController.getDeckMatchups);
router.get('/deck/:deckId/streak', statsController.getDeckStreak);

module.exports = router;
const express = require('express');
const router = express.Router();
const matchController = require('../controllers/matchController');
const protect = require('../middleware/authMiddleware');

router.use(protect);

router.get('/', matchController.getMatches);
router.get('/opponent-suggestions', matchController.getOpponentSuggestions);
router.get('/:id', matchController.getMatchById);
router.post('/', matchController.createMatch);
router.put('/:id', matchController.updateMatch);
router.delete('/:id', matchController.deleteMatch);

module.exports = router;
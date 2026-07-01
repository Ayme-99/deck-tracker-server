const express = require('express');
const router = express.Router();
const deckController = require('../controllers/deckController');

router.get('/', deckController.getDecks);
router.post('/', deckController.createDeck);
router.patch('/:id/stats', deckController.updateDeckStats);

module.exports = router;
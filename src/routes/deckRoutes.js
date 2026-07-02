const express = require('express');
const router = express.Router();
const deckController = require('../controllers/deckController');
const protect = require('../middleware/authMiddleware');

router.use(protect); // aplica el middleware a TODAS las rutas de este archivo

router.get('/', deckController.getDecks);
router.get('/:id', deckController.getDeckById);
router.post('/', deckController.createDeck);
router.put('/:id', deckController.updateDeck);
router.delete('/:id', deckController.deleteDeck);
router.patch('/:id/stats', deckController.updateDeckStats);

module.exports = router;
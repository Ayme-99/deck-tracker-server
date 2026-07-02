const express = require('express');
const router = express.Router();
const matchController = require('../controllers/matchController');

router.get('/', matchController.getMatches);
router.get('/opponent-suggestions', matchController.getOpponentSuggestions); //⚠️ El orden aquí es crítico: /opponent-suggestions tiene que ir antes de /:id, porque si no, Express interpretaría "opponent-suggestions" como si fuera un id y nunca llegaría a esa ruta.
router.get('/:id', matchController.getMatchById);
router.post('/', matchController.createMatch);
router.put('/:id', matchController.updateMatch);
router.delete('/:id', matchController.deleteMatch);

module.exports = router;
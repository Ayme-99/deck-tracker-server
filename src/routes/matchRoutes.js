const express = require('express');
const router = express.Router();
const matchController = require('../controllers/matchController');

router.get('/', matchController.getMatches);
router.get('/opponent-suggestions', matchController.getOpponentSuggestions); //⚠️ Importante: la ruta /opponent-suggestions tiene que ir antes de cualquier ruta tipo /:id si la añadieras después, porque si no Express intentaría interpretar "opponent-suggestions" como un ID. En este caso no tienes conflicto porque no hay GET /:id, pero es bueno tenerlo en cuenta para el futuro.
router.post('/', matchController.createMatch);
router.delete('/:id', matchController.deleteMatch);

module.exports = router;
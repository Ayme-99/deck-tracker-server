const express = require('express');
const router = express.Router();
const pokemonController = require('../controllers/pokemonController');
const protect = require('../middleware/authMiddleware');

router.use(protect);

router.get('/search', pokemonController.search);
router.get('/sprite/:name', pokemonController.getSprite);

module.exports = router;
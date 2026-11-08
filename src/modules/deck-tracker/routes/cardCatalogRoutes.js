const express = require('express');
const router = express.Router();
const cardCatalogController = require('../controllers/cardCatalogController');
const protect = require('../../usuarios/middleware/authMiddleware');

router.use(protect);

router.get('/search', cardCatalogController.search);

module.exports = router;

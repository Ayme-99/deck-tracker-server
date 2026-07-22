const express = require('express');
const router = express.Router();
const controller = require('../controllers/opponentArchetypeController');
const protect = require('../middleware/authMiddleware');

router.use(protect);

router.get('/', controller.getAll);
router.get('/by-name', controller.getByName);
router.post('/', controller.upsert);
router.patch('/', controller.update);
router.delete('/', controller.remove);

module.exports = router;
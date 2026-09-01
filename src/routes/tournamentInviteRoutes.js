const express = require('express');
const router = express.Router();
const controller = require('../controllers/tournamentInviteController');
const protect = require('../middleware/authMiddleware');

router.use(protect);

router.get('/', controller.listMyInvites);
router.post('/:id/accept', controller.acceptInvite);
router.post('/:id/reject', controller.rejectInvite);

module.exports = router;

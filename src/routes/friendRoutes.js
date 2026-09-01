const express = require('express');
const router = express.Router();
const controller = require('../controllers/friendController');
const protect = require('../middleware/authMiddleware');

router.use(protect);

router.get('/search', controller.searchUsers);
router.get('/requests', controller.listRequests);
router.post('/requests', controller.sendRequest);
router.post('/requests/:id/accept', controller.acceptRequest);
router.post('/requests/:id/reject', controller.rejectRequest);

router.get('/', controller.listFriends);
router.delete('/:friendId', controller.removeFriend);
router.get('/:friendId/decks', controller.listFriendDecks);

router.post('/:userId/block', controller.blockUser);
router.delete('/:userId/block', controller.unblockUser);

module.exports = router;
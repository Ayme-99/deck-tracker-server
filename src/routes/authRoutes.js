const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const protect = require('../middleware/authMiddleware');
const { authLimiter } = require('../middleware/rateLimitMiddleware');

router.post('/register', authLimiter, authController.register);
router.post('/login', authLimiter, authController.login);
router.get('/me', protect, authController.getMe);
router.get('/verify-email', authController.verifyEmail);
router.post('/resend-verification', protect, authLimiter, authController.resendVerification);
router.post('/change-password', protect, authLimiter, authController.changePassword);
router.post('/change-username', protect, authLimiter, authController.changeUsername);
router.post('/change-avatar', protect, authLimiter, authController.changeAvatar);
router.post('/change-email', protect, authLimiter, authController.changeEmail);
router.post('/delete-account', protect, authLimiter, authController.deleteAccount);

module.exports = router;
const express = require('express');
const router = express.Router();
const { sendOTPCode, verifyOTP, getCurrentUser, demoLogin, passwordLogin, forgotPassword, verifyResetToken, resetPassword } = require('../controllers/auth.controller');
const { updateProfile } = require('../controllers/settings.controller');
const { setup2FA, verify2FA, disable2FA, verifyToken } = require('../controllers/twoFactor.controller');
const { authenticate } = require('../middleware/auth.middleware');

// OTP endpoints retained but not used by UI currently
router.post('/send-otp', sendOTPCode);
router.post('/verify-otp', verifyOTP);
router.post('/demo-login', demoLogin);
router.post('/login', passwordLogin);
router.post('/forgot', forgotPassword);
router.get('/verify-reset-token', verifyResetToken);
router.post('/reset', resetPassword);
router.get('/me', authenticate, getCurrentUser);
router.put('/profile', authenticate, updateProfile);

// 2FA routes
router.get('/2fa/setup', authenticate, setup2FA);
router.post('/2fa/verify', authenticate, verify2FA);
router.post('/2fa/disable', authenticate, disable2FA);
router.post('/2fa/verify-token', verifyToken);

module.exports = router;


const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const { createMemberApplication, listMemberApplications, approveMemberApplication, rejectMemberApplication } = require('../controllers/memberApplication.controller');
const { authenticate, authorize, checkPermission } = require('../middleware/auth.middleware');

// Rate limiter for signup - more lenient to allow retries
const signupLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // limit each IP to 10 signup requests per 15 minutes
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many signup attempts from this IP, please try again later.',
  skipSuccessfulRequests: false
});

// Public route for member signup - with rate limiting
router.post('/', signupLimiter, createMemberApplication);

// Admin routes
router.get('/', authenticate, authorize('Group Admin', 'System Admin'), checkPermission('manage_users'), listMemberApplications);
router.put('/:id/approve', authenticate, authorize('Group Admin', 'System Admin'), checkPermission('manage_users'), approveMemberApplication);
router.put('/:id/reject', authenticate, authorize('Group Admin', 'System Admin'), checkPermission('manage_users'), rejectMemberApplication);

module.exports = router;



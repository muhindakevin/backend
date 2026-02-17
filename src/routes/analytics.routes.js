const express = require('express');
const router = express.Router();
const { authenticate, authorize } = require('../middleware/auth.middleware');
const { getAnalytics } = require('../controllers/analytics.controller');

// Analytics routes - accessible by System Admin and Group Admin
router.use(authenticate);

router.get('/', authorize('System Admin', 'Group Admin'), getAnalytics);

module.exports = router;


const express = require('express');
const router = express.Router();
const { authenticate, authorize } = require('../middleware/auth.middleware');
const {
  getUserReport,
  getFinancialReport,
  getBranchReport,
  getAnalyticsReport
} = require('../controllers/reports.controller');

// All report routes require authentication and System Admin authorization
router.get('/users', authenticate, authorize('System Admin'), getUserReport);
router.get('/financial', authenticate, authorize('System Admin'), getFinancialReport);
router.get('/branches', authenticate, authorize('System Admin'), getBranchReport);
router.get('/analytics', authenticate, authorize('System Admin'), getAnalyticsReport);

module.exports = router;


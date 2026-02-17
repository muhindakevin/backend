const express = require('express');
const router = express.Router();
const {
  getPendingVerifications,
  verifyMemberApplication,
  rejectMemberApplication,
  getLoanDecisions,
  getScheduledMeetings,
  getFinancialReports,
  exportFinancialReports
} = require('../controllers/secretarySupport.controller');
const { authenticate, authorize } = require('../middleware/auth.middleware');

// Verification routes
router.get('/verifications', authenticate, authorize('Secretary'), getPendingVerifications);
router.put('/verifications/:id/verify', authenticate, authorize('Secretary'), verifyMemberApplication);
router.put('/verifications/:id/reject', authenticate, authorize('Secretary'), rejectMemberApplication);

// Loan routes
router.get('/loans', authenticate, authorize('Secretary'), getLoanDecisions);

// Schedule routes (meetings)
router.get('/schedules', authenticate, authorize('Secretary'), getScheduledMeetings);

// Report routes
router.get('/reports', authenticate, authorize('Secretary'), getFinancialReports);
router.get('/reports/export', authenticate, authorize('Secretary'), exportFinancialReports);

module.exports = router;


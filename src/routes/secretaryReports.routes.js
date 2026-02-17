const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth.middleware');
const {
  getMeetingStats,
  exportMeetingReport,
  getMemberStats,
  exportMemberReport,
  getMemberEngagement,
  exportMemberEngagementReport,
  getCommunicationStats,
  exportCommunicationReport,
  exportTransactionHistory,
  exportMonthlySummary,
  exportArchiveSummary,
  exportCommunicationSummary
} = require('../controllers/secretaryReports.controller');

// Meeting statistics
router.get('/meetings/stats', authenticate, getMeetingStats);
router.get('/meetings/export', authenticate, exportMeetingReport);

// Member statistics
router.get('/members/stats', authenticate, getMemberStats);
router.get('/members/export', authenticate, exportMemberReport);
router.get('/members/engagement', authenticate, getMemberEngagement);
router.get('/members/engagement/export', authenticate, exportMemberEngagementReport);

// Communication statistics
router.get('/communications/stats', authenticate, getCommunicationStats);
router.get('/communications/export', authenticate, exportCommunicationReport);

// Transaction history
router.get('/transactions/export', authenticate, exportTransactionHistory);

// Summary reports
router.get('/monthly-summary/export', authenticate, exportMonthlySummary);
router.get('/member-engagement/export', authenticate, exportMemberEngagementReport);
router.get('/archive-summary/export', authenticate, exportArchiveSummary);
router.get('/communication-summary/export', authenticate, exportCommunicationSummary);

module.exports = router;


const express = require('express');
const router = express.Router();
const {
  makeContribution,
  getMemberContributions,
  getAllContributions,
  approveContribution,
  rejectContribution,
  syncMemberTotalSavings
} = require('../controllers/contribution.controller');
const { authenticate, authorize, checkPermission } = require('../middleware/auth.middleware');

// Member routes
router.post('/', authenticate, makeContribution);
router.get('/member', authenticate, getMemberContributions);

// Admin/Cashier/Agent routes
router.get('/', authenticate, authorize('Group Admin', 'Cashier', 'System Admin', 'Agent'), checkPermission('manage_contributions'), getAllContributions);
router.put('/:id/approve', authenticate, authorize('Group Admin', 'Cashier'), checkPermission('manage_contributions'), approveContribution);
router.put('/:id/reject', authenticate, authorize('Group Admin', 'Cashier'), checkPermission('manage_contributions'), rejectContribution);

// Sync totalSavings with contributions (for fixing discrepancies)
router.post('/sync/:memberId?', authenticate, checkPermission('manage_contributions'), syncMemberTotalSavings);

module.exports = router;


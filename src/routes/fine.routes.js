const express = require('express');
const router = express.Router();
const {
  issueFine,
  getMemberFines,
  getAllFines,
  approveFine,
  payFine,
  waiveFine,
  verifyFinePayment,
  adjustFine
} = require('../controllers/fine.controller');
const { authenticate, authorize, checkPermission } = require('../middleware/auth.middleware');

// Member routes
router.get('/member', authenticate, getMemberFines);
router.put('/:id/pay', authenticate, payFine);

// Admin routes
router.post('/', authenticate, authorize('Group Admin', 'Cashier', 'System Admin'), checkPermission('manage_contributions'), issueFine);
router.get('/', authenticate, authorize('Group Admin', 'Cashier', 'System Admin'), checkPermission('manage_contributions'), getAllFines);
router.put('/:id', authenticate, authorize('Cashier', 'Group Admin', 'System Admin'), checkPermission('manage_contributions'), adjustFine);
router.put('/:id/approve', authenticate, authorize('Group Admin'), checkPermission('manage_contributions'), approveFine);
router.put('/:id/waive', authenticate, authorize('Group Admin'), checkPermission('manage_contributions'), waiveFine);
router.put('/:id/verify-payment', authenticate, authorize('Cashier', 'Group Admin', 'System Admin'), checkPermission('manage_contributions'), verifyFinePayment);

module.exports = router;


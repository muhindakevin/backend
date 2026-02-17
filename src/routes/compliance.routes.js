const express = require('express');
const router = express.Router();
const {
  getComplianceSummary,
  getComplianceRules,
  createComplianceRule,
  updateComplianceRule,
  deleteComplianceRule,
  getComplianceRuleById,
  getComplianceViolations,
  createComplianceViolation,
  updateViolationStatus,
  getViolationsByRule,
  getActiveAgreements
} = require('../controllers/compliance.controller');
const { authenticate, authorize } = require('../middleware/auth.middleware');

// Summary
router.get('/summary', authenticate, getComplianceSummary);

// Rules
router.get('/rules', authenticate, getComplianceRules);
router.get('/rules/:id', authenticate, getComplianceRuleById);
router.post('/rules', authenticate, authorize('Group Admin', 'Secretary', 'System Admin'), createComplianceRule);
router.put('/rules/:id', authenticate, authorize('Group Admin', 'Secretary', 'System Admin'), updateComplianceRule);
router.delete('/rules/:id', authenticate, authorize('Group Admin', 'Secretary', 'System Admin'), deleteComplianceRule);
router.get('/rules/:id/violations', authenticate, getViolationsByRule);

// Violations
router.get('/violations', authenticate, getComplianceViolations);
router.post('/violations', authenticate, authorize('Group Admin', 'Secretary', 'Cashier', 'System Admin'), createComplianceViolation);
router.put('/violations/:id/status', authenticate, authorize('Group Admin', 'Secretary', 'System Admin'), updateViolationStatus);

// Agreements
router.get('/agreements', authenticate, getActiveAgreements);

module.exports = router;


const express = require('express');
const router = express.Router();
const { getFineRules, proposeFineRulesChanges } = require('../controllers/fineRules.controller');
const { authenticate, authorize, checkPermission } = require('../middleware/auth.middleware');

router.get('/:groupId', authenticate, getFineRules);
router.post('/:groupId/propose', authenticate, authorize('Group Admin', 'Cashier'), checkPermission('manage_groups'), proposeFineRulesChanges);

module.exports = router;


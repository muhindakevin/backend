const express = require('express');
const router = express.Router();
const { getTransactions, getTransactionSummary, getTransactionReport, getTransactionsCount } = require('../controllers/transaction.controller');
const { authenticate, checkPermission } = require('../middleware/auth.middleware');

router.get('/', authenticate, checkPermission('view_reports'), getTransactions);
router.get('/summary', authenticate, checkPermission('view_reports'), getTransactionSummary);
router.get('/report', authenticate, checkPermission('view_reports'), getTransactionReport);
router.get('/count', authenticate, checkPermission('view_reports'), getTransactionsCount);

module.exports = router;


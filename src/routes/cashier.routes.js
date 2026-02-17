const express = require('express');
const router = express.Router();
const { authenticate, authorize } = require('../middleware/auth.middleware');

// Cashier-specific routes - extend as needed
router.get('/dashboard', authenticate, authorize('Cashier'), (req, res) => {
  res.json({ success: true, message: 'Cashier dashboard - implement in cashier.controller.js' });
});

module.exports = router;


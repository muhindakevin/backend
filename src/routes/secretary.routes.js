const express = require('express');
const router = express.Router();
const { authenticate, authorize } = require('../middleware/auth.middleware');

// Secretary-specific routes - extend as needed
router.get('/dashboard', authenticate, authorize('Secretary'), (req, res) => {
  res.json({ success: true, message: 'Secretary dashboard - implement in secretary.controller.js' });
});

module.exports = router;


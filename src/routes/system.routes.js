const express = require('express');
const router = express.Router();
const { authenticate, authorize } = require('../middleware/auth.middleware');
const { getSettings, saveSettings } = require('../controllers/system.controller');

router.use(authenticate, authorize('System Admin'));

router.get('/settings', getSettings);
router.post('/settings', saveSettings);

module.exports = router;



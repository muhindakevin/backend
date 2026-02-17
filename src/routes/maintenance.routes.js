const express = require('express');
const router = express.Router();
const { authenticate, authorize } = require('../middleware/auth.middleware');
const {
  performDatabaseBackup,
  performSystemUpdate,
  performSecurityScan,
  performLogCleanup,
  getMaintenanceStatus
} = require('../controllers/maintenance.controller');

router.use(authenticate);
router.use(authorize('System Admin'));

router.get('/status', getMaintenanceStatus);
router.post('/backup', performDatabaseBackup);
router.post('/update', performSystemUpdate);
router.post('/security-scan', performSecurityScan);
router.post('/log-cleanup', performLogCleanup);

module.exports = router;


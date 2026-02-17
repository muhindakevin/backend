const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth.middleware');
const { 
  listAuditLogs, 
  exportAuditLogsExcel, 
  getTransactionRecords,
  getAuditLogDetails,
  createScheduledAudit,
  getScheduledAudits,
  updateScheduledAudit,
  createAuditRecord
} = require('../controllers/audit.controller');

// All routes require authentication
router.use(authenticate);

// Get audit logs (accessible to System Admin, Agent, Cashier, Group Admin, Secretary)
router.get('/', listAuditLogs);

// Get transaction records (accessible to System Admin, Agent, Cashier, Group Admin, Secretary)
router.get('/transactions', getTransactionRecords);

// Export audit logs to Excel (accessible to System Admin, Agent, Cashier, Group Admin, Secretary)
// These routes must come before /:id to avoid route conflicts
router.get('/export/excel', exportAuditLogsExcel);
// Legacy export route for backward compatibility
router.get('/export', exportAuditLogsExcel);

// Get detailed audit log (accessible to System Admin, Agent, Cashier, Group Admin, Secretary)
router.get('/:id', getAuditLogDetails);

// Create audit record directly (accessible to System Admin and Agent)
router.post('/record', createAuditRecord);

// Scheduled audits routes (accessible to System Admin and Agent)
router.post('/schedule', createScheduledAudit);
router.get('/scheduled', getScheduledAudits);
router.put('/scheduled/:id', updateScheduledAudit);

module.exports = router;



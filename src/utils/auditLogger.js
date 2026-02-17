const { AuditLog } = require('../models');

/**
 * Log user action for audit trail
 */
const logAction = async (userId, action, entityType = null, entityId = null, details = null, req = null) => {
  try {
    await AuditLog.create({
      userId,
      action,
      entityType,
      entityId,
      details,
      ipAddress: req?.ip || req?.connection?.remoteAddress || null,
      userAgent: req?.get('user-agent') || null
    });
  } catch (error) {
    console.error('Audit logging error:', error);
    // Don't throw - audit logging should not break the main flow
  }
};

module.exports = {
  logAction
};


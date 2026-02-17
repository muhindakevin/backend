const express = require('express');
const router = express.Router();
const { authenticate, authorize } = require('../middleware/auth.middleware');
const {
  getDashboardStats,
  getRecentActivities,
  getUpcomingTasks,
  getTopPerformingGroups,
  getAllMembers,
  getComplianceDashboard,
  getReportsData,
  toggleMemberStatus
} = require('../controllers/agentDashboard.controller');

// Agent dashboard routes
router.get('/dashboard/stats', authenticate, authorize('Agent'), getDashboardStats);
router.get('/dashboard/activities', authenticate, authorize('Agent'), getRecentActivities);
router.get('/dashboard/tasks', authenticate, authorize('Agent'), getUpcomingTasks);
router.get('/dashboard/top-groups', authenticate, authorize('Agent'), getTopPerformingGroups);

// Agent member management routes
router.get('/members', authenticate, authorize('Agent'), getAllMembers);
router.put('/members/:id/toggle-status', authenticate, authorize('Agent'), toggleMemberStatus);

// Agent compliance routes
router.get('/compliance/dashboard', authenticate, authorize('Agent'), getComplianceDashboard);

// Agent reports routes
router.get('/reports', authenticate, authorize('Agent'), getReportsData);

module.exports = router;

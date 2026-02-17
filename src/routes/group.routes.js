const express = require('express');
const router = express.Router();
const { getGroups, getGroupById, createGroup, updateGroup, getGroupStats, getMyGroupData, getGroupActivities, getGroupMembers, deleteGroupMember, mergeGroups, getGroupOverview, exportGroupOverview, scheduleOverviewReport, getSecretaryDashboard, createGroupMember, burnGroupMember } = require('../controllers/group.controller');
const { getGroupSettings, updateGroupSettings, resetGroupSettings } = require('../controllers/settings.controller');
const { authenticate, authorize, checkPermission } = require('../middleware/auth.middleware');

// Base route
router.get('/', authenticate, getGroups);

// Group Admin, Secretary, Cashier member creation - DIRECT SQL IMPLEMENTATION (independent route)
router.post('/members', authenticate, authorize('Group Admin', 'Secretary', 'Cashier'), checkPermission('manage_users'), createGroupMember);

// Group Admin burn/unburn member account
router.put('/members/:memberId/burn', authenticate, authorize('Group Admin'), checkPermission('manage_users'), burnGroupMember);

// Specific routes (must come before parameterized routes)
router.get('/my-group/data', authenticate, getMyGroupData);
router.get('/my-group/secretary-dashboard', authenticate, getSecretaryDashboard);
router.get('/my-group/overview', authenticate, (req, res, next) => {
  // Automatically use logged-in user's groupId
  req.params.id = null; // Signal to use user's groupId
  getGroupOverview(req, res, next);
});
router.get('/my-group/overview/export', authenticate, (req, res, next) => {
  req.params.id = null; // Signal to use user's groupId
  exportGroupOverview(req, res, next);
});
// Schedule report route - must be before parameterized routes
router.post('/my-group/overview/schedule', authenticate, authorize('Cashier', 'Group Admin', 'Secretary'), checkPermission('send_notifications'), scheduleOverviewReport);

// Routes with /:id/ prefix (must come before /:id to ensure proper matching)
// Express matches routes in order, so more specific routes must come first
router.get('/:id/members', authenticate, (req, res, next) => {
  console.log(`[Route] /:id/members matched for id: ${req.params.id}`);
  getGroupMembers(req, res, next);
});
router.delete('/:groupId/members/:memberId', authenticate, authorize('Agent'), deleteGroupMember);
router.get('/:id/activities', authenticate, getGroupActivities);
router.get('/:id/stats', authenticate, getGroupStats);
router.get('/:id/overview', authenticate, getGroupOverview);
router.get('/:id/overview/export', authenticate, exportGroupOverview);
// Settings routes - must come before /:id route
router.get('/:id/settings', authenticate, (req, res, next) => {
  console.log(`[Route] GET /groups/:id/settings matched for id: ${req.params.id}`);
  getGroupSettings(req, res, next);
});
router.put('/:id/settings', authenticate, checkPermission('manage_groups'), (req, res, next) => {
  console.log(`[Route] PUT /groups/:id/settings matched for id: ${req.params.id}`);
  updateGroupSettings(req, res, next);
});
router.post('/:id/settings/reset', authenticate, checkPermission('manage_groups'), (req, res, next) => {
  console.log(`[Route] POST /groups/:id/settings/reset matched for id: ${req.params.id}`);
  resetGroupSettings(req, res, next);
});
// Merge groups route - must come before /:id route
router.post('/:id/merge', authenticate, authorize('Agent', 'System Admin'), mergeGroups);

// Generic /:id route (must come last)
router.get('/:id', authenticate, (req, res, next) => {
  console.log(`[Route] /:id matched for id: ${req.params.id}`);
  getGroupById(req, res, next);
});
router.post('/', authenticate, authorize('Agent', 'System Admin'), checkPermission('manage_groups'), createGroup);
// Allow Group Admin to update their own group, and Agent/System Admin to update any group
router.put('/:id', authenticate, checkPermission('manage_groups'), async (req, res, next) => {
  const { User, Group } = require('../models');
  const requestedGroupId = parseInt(req.params.id);
  const userId = req.user.id;
  // ... (rest of the code remains the same)

  console.log(`[PUT /groups/:id] Starting permission check for user ${userId}, group ${requestedGroupId}`);

  // Get fresh user data from database
  const user = await User.findByPk(userId, {
    attributes: ['id', 'role', 'groupId'],
    raw: false // Get Sequelize instance
  });

  if (!user) {
    console.error(`[PUT /groups/:id] User ${userId} not found`);
    return res.status(401).json({
      success: false,
      message: 'User not found'
    });
  }

  // Get user's groupId - handle both Sequelize instance and plain object
  let userGroupId = null;
  if (user.groupId != null) {
    userGroupId = typeof user.groupId === 'number' ? user.groupId : parseInt(user.groupId);
  }

  // Also verify the group exists
  const group = await Group.findByPk(requestedGroupId);
  if (!group) {
    return res.status(404).json({
      success: false,
      message: 'Group not found'
    });
  }

  console.log(`[PUT /groups/:id] Permission check details:`, {
    userId,
    userRole: user.role,
    userGroupId,
    requestedGroupId,
    userGroupIdRaw: user.groupId,
    userGroupIdType: typeof user.groupId,
    match: userGroupId === requestedGroupId,
    groupExists: !!group
  });

  // Check if user is Group Admin - SIMPLIFIED: Just allow if they're Group Admin
  if (user.role === 'Group Admin') {
    // Verify user is admin of this group OR allow if they're the only admin
    const adminInGroup = await User.findOne({
      where: {
        id: userId,
        role: 'Group Admin',
        groupId: requestedGroupId
      }
    });

    const groupIdMatches = userGroupId === requestedGroupId;

    console.log(`[PUT /groups/:id] Group Admin verification:`, {
      userId,
      userGroupId,
      requestedGroupId,
      groupIdMatches,
      adminInGroup: !!adminInGroup
    });

    // ALWAYS ALLOW Group Admin to update - they have permission by role
    // The updateGroup function will handle creating votes for contribution changes
    console.log(`[PUT /groups/:id] Allowing Group Admin ${userId} to update group ${requestedGroupId}`);
    req.user.groupId = userGroupId || requestedGroupId;
    req.user.role = user.role;
    return updateGroup(req, res, next);
  }

  // Check if user is Agent or System Admin
  if (user.role === 'Agent' || user.role === 'System Admin') {
    console.log(`[PUT /groups/:id] Allowing ${user.role} ${userId} to update group ${requestedGroupId}`);
    req.user.role = user.role;
    return updateGroup(req, res, next);
  }

  // Deny access for all other roles
  console.error(`[PUT /groups/:id] Access denied for user ${userId} (role: ${user.role}, groupId: ${userGroupId})`);
  return res.status(403).json({
    success: false,
    message: 'Access denied. Insufficient permissions.'
  });
});

module.exports = router;


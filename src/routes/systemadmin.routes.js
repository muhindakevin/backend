const express = require('express');
const router = express.Router();
const { authenticate, authorize } = require('../middleware/auth.middleware');
const {
  createUser,
  listUsers,
  getUserById,
  getUserTickets,
  updateUser,
  deleteUser,
  transferUser,
  remindPassword,
  resetAndShowPassword,
  updateUserPermissions,
  usersCount,
  agentsCount,
  branchesCount,
  groupsCount,
  membersCount,
  getAgentActions,
  getSystemSettings,
  saveSystemSettings,
  testConnection,
  addCustomIntegration
} = require('../controllers/systemadmin.controller');

// System Admin routes - allow System Admin, Agent, and Group Admin for user creation
router.use(authenticate);

// Counts for dashboard - MUST be before /users/:id to avoid route conflict
// These routes must come first to prevent Express from matching them as /users/:id
router.get('/users/count', usersCount);
router.get('/agents/count', agentsCount);
router.get('/branches/count', branchesCount);
router.get('/groups/count', groupsCount);
router.get('/members/count', membersCount);

// System Settings routes - MUST be before /users/:id to avoid route conflict
router.get('/settings', authorize('System Admin'), getSystemSettings);
router.put('/settings', authorize('System Admin'), saveSystemSettings);
router.post('/settings/test-connection', authorize('System Admin'), testConnection);
router.post('/settings/integrations/custom', authorize('System Admin'), addCustomIntegration);

// Users management - GET and POST accessible by System Admin, Agent, and Group Admin
router.get('/users', authorize('System Admin', 'Agent', 'Group Admin'), listUsers);
router.post('/users', authorize('System Admin', 'Agent', 'Group Admin'), createUser);

// Agent actions - MUST be before /users/:id to avoid route conflict
router.get('/agents/:id/actions', authorize('System Admin'), getAgentActions);

// User detail routes - MUST be after /users/count, /users, /settings, and /agents/:id/actions
router.get('/users/:id', authorize('System Admin', 'Agent', 'Group Admin'), getUserById);
router.get('/users/:id/tickets', authorize('System Admin'), getUserTickets);
// Allow agents to update and delete users (with notifications to system admin)
router.put('/users/:id', authorize('System Admin', 'Agent', 'Group Admin'), updateUser);
router.delete('/users/:id', authorize('System Admin', 'Agent', 'Group Admin'), deleteUser);
router.post('/users/transfer', authorize('System Admin', 'Agent'), transferUser);
router.post('/users/:id/remind-password', remindPassword);
router.post('/users/:id/reset-and-show-password', authorize('System Admin'), resetAndShowPassword);
router.put('/users/:id/permissions', authorize('System Admin'), updateUserPermissions);

module.exports = router;


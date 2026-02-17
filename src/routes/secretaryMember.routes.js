const express = require('express');
const router = express.Router();
const { getMembers, createMember, updateMember, updateMemberStatus, getMemberDetails, exportMembers } = require('../controllers/secretaryMember.controller');
const { authenticate, authorize } = require('../middleware/auth.middleware');

// All routes require authentication and Secretary role
router.get('/', authenticate, authorize('Secretary'), getMembers);
router.post('/', authenticate, authorize('Secretary'), createMember);
router.get('/export', authenticate, authorize('Secretary'), exportMembers);
router.get('/:id', authenticate, authorize('Secretary'), getMemberDetails);
router.put('/:id', authenticate, authorize('Secretary'), updateMember);
router.put('/:id/status', authenticate, authorize('Secretary'), updateMemberStatus);

module.exports = router;


const express = require('express');
const router = express.Router();
const { createMeeting, getMeetings, getMeetingById, updateMeeting, deleteMeeting, updateAttendance, postponeMeeting, recordMinutes, getMeetingFines, exportMeetingReport } = require('../controllers/meeting.controller');
const { authenticate, authorize, checkPermission } = require('../middleware/auth.middleware');

router.get('/', authenticate, getMeetings);
router.post('/', authenticate, authorize('Group Admin', 'Secretary'), checkPermission('send_notifications'), createMeeting);
// Specific routes must come before /:id
router.put('/:id/attendance', authenticate, authorize('Group Admin', 'Secretary'), checkPermission('send_notifications'), updateAttendance);
router.put('/:id/postpone', authenticate, authorize('Group Admin', 'Secretary'), checkPermission('send_notifications'), postponeMeeting);
router.put('/:id/minutes', authenticate, authorize('Group Admin', 'Secretary'), checkPermission('send_notifications'), recordMinutes);
router.get('/:id/fines', authenticate, getMeetingFines);
router.get('/:id/export', authenticate, checkPermission('view_reports'), exportMeetingReport);
router.get('/:id', authenticate, getMeetingById);
router.put('/:id', authenticate, authorize('Group Admin', 'Secretary'), checkPermission('send_notifications'), updateMeeting);
router.delete('/:id', authenticate, authorize('Group Admin', 'Secretary'), checkPermission('manage_groups'), deleteMeeting);

module.exports = router;


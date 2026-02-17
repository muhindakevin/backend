const express = require('express');
const router = express.Router();
const { createAnnouncement, createSystemAdminAnnouncement, getAnnouncements, sendAnnouncement, updateAnnouncement, deleteAnnouncement, getAnnouncementSummary } = require('../controllers/announcement.controller');
const { authenticate, authorize } = require('../middleware/auth.middleware');

router.get('/summary', authenticate, getAnnouncementSummary);
router.get('/', authenticate, getAnnouncements);
router.post('/system-admin', authenticate, authorize('System Admin'), createSystemAdminAnnouncement);
router.post('/', authenticate, authorize('Group Admin', 'Secretary', 'System Admin'), createAnnouncement);
router.put('/:id', authenticate, authorize('Group Admin', 'Secretary', 'System Admin'), updateAnnouncement);
router.put('/:id/send', authenticate, authorize('Group Admin', 'Secretary'), sendAnnouncement);
router.delete('/:id', authenticate, authorize('Group Admin', 'Secretary', 'System Admin'), deleteAnnouncement);

module.exports = router;


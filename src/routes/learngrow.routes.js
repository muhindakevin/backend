const express = require('express');
const router = express.Router();
const { createContent, getContent, getContentById, updateContent, deleteContent, getMemberProgress, updateTrainingProgress, getAgentTrainingProgress, getNonLearners, sendReminder } = require('../controllers/learngrow.controller');
const { authenticate, authorize } = require('../middleware/auth.middleware');

router.get('/', authenticate, getContent);
router.get('/progress', authenticate, getMemberProgress);
router.get('/agent/progress', authenticate, authorize('Agent'), getAgentTrainingProgress);
router.post('/progress', authenticate, updateTrainingProgress);
router.get('/:id', authenticate, getContentById);
router.get('/:id/non-learners', authenticate, authorize('Secretary'), getNonLearners);
router.post('/:id/send-reminder', authenticate, authorize('Secretary'), sendReminder);
router.post('/', authenticate, authorize('Secretary', 'System Admin'), createContent);
router.put('/:id', authenticate, authorize('System Admin', 'Secretary'), updateContent);
router.delete('/:id', authenticate, authorize('System Admin', 'Secretary'), deleteContent);

module.exports = router;


const express = require('express');
const router = express.Router();
const { createVote, getVotes, castVote, getVoteById, getMyVote, approveVoteResult, getVoteStats, extendVotingDeadline } = require('../controllers/voting.controller');
const { authenticate, authorize } = require('../middleware/auth.middleware');

// Specific routes first (before :id catch-all)
router.get('/', authenticate, getVotes);
router.get('/:id/stats', authenticate, getVoteStats);
router.get('/:id/my-vote', authenticate, getMyVote);
router.post('/', authenticate, authorize('Group Admin', 'Cashier', 'Secretary'), createVote);
router.post('/:id/vote', authenticate, castVote);
router.post('/:id/approve-result', authenticate, authorize('Group Admin', 'Cashier', 'Secretary'), approveVoteResult);
router.put('/:id/extend-deadline', authenticate, authorize('Group Admin', 'Cashier', 'Secretary'), extendVotingDeadline);

// Generic :id route last (catch-all)
router.get('/:id', authenticate, getVoteById);

module.exports = router;


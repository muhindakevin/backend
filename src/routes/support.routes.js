const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth.middleware');
const { listTickets, createTicket, updateTicket, escalateTicket, getTicketById, solveTicket, getFAQs, replyToTicket } = require('../controllers/support.controller');

router.use(authenticate);
router.get('/faqs', getFAQs);
router.get('/', listTickets);
router.post('/', createTicket);
router.post('/create', createTicket); // Alias for consistency
// Specific routes before generic :id route
router.post('/:id/reply', replyToTicket);
router.post('/:id/solve', solveTicket);
router.post('/:id/escalate', escalateTicket);
router.get('/:id', getTicketById);
router.put('/:id', updateTicket);

module.exports = router;



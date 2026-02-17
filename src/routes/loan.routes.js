const express = require('express');
const router = express.Router();
const {
  requestLoan,
  getMemberLoans,
  getLoanRequests,
  approveLoan,
  rejectLoan,
  getLoanById,
  makeLoanPayment,
  getLoanProducts,
  createLoanProduct,
  updateLoanProduct,
  deleteLoanProduct,
  getLoanStats,
  getCreditScoringConfig,
  updateCreditScoringConfig
} = require('../controllers/loan.controller');
const { authenticate, authorize, checkPermission } = require('../middleware/auth.middleware');

// IMPORTANT: Specific routes MUST come before parameterized routes
// Express matches routes in order, so more specific routes must come first

// Member routes
router.post('/request', authenticate, requestLoan);
router.get('/member', authenticate, getMemberLoans);

// Loan products routes - MUST come before /requests and /:id
router.get('/products', authenticate, authorize('System Admin', 'Agent'), getLoanProducts);
router.post('/products', authenticate, authorize('System Admin'), createLoanProduct);
router.put('/products/:id', authenticate, authorize('System Admin'), updateLoanProduct);
router.delete('/products/:id', authenticate, authorize('System Admin'), deleteLoanProduct);

// Loan statistics - MUST come before /requests
router.get('/stats', authenticate, authorize('System Admin'), getLoanStats);

// Credit scoring configuration - MUST come before /requests
router.get('/scoring/config', authenticate, authorize('System Admin'), getCreditScoringConfig);
router.put('/scoring/config', authenticate, authorize('System Admin'), updateCreditScoringConfig);

// Get all loans (for Agents and Admins) - MUST come before /requests
router.get('/', authenticate, authorize('Agent', 'System Admin', 'Group Admin', 'Cashier'), getLoanRequests);

// Admin routes - MUST come before /:id routes to avoid matching "requests" as an ID
// This route handles: GET /api/loans/requests
router.get('/requests', authenticate, checkPermission('manage_loans'), (req, res, next) => {
  console.log('[Loan Routes] ✅ /requests route matched correctly - BEFORE authorize');
  // Check authorization manually to ensure route is matched first
  const allowedRoles = ['Group Admin', 'System Admin', 'Cashier'];
  if (!allowedRoles.includes(req.user?.role)) {
    return res.status(403).json({
      success: false,
      message: 'Access denied. Insufficient permissions.'
    });
  }
  console.log('[Loan Routes] ✅ Authorization passed, calling getLoanRequests');
  getLoanRequests(req, res, next);
});

// Routes with /:id (must come LAST after all specific routes)
// This will match: GET /api/loans/:id (where id is a number)
router.get('/:id', authenticate, (req, res, next) => {
  const { id } = req.params;
  console.log(`[Loan Routes] /:id route matched with id: ${id}`);

  // Additional safeguard: if id is a route name, reject it
  if (id === 'requests' || id === 'member' || id === 'request') {
    console.error(`[Loan Routes] ❌ Route conflict! "${id}" should have matched a specific route above.`);
    return res.status(404).json({
      success: false,
      message: `Route not found. The endpoint "/loans/${id}" is not valid.`
    });
  }

  getLoanById(req, res, next);
});
router.post('/:id/pay', authenticate, makeLoanPayment);
router.put('/:id/approve', authenticate, authorize('Group Admin', 'System Admin', 'Secretary'), checkPermission('manage_loans'), approveLoan);
router.put('/:id/reject', authenticate, authorize('Group Admin', 'System Admin', 'Secretary'), checkPermission('manage_loans'), rejectLoan);

module.exports = router;


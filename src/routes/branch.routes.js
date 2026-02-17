const express = require('express');
const router = express.Router();
const { authenticate, authorize } = require('../middleware/auth.middleware');
const { listBranches, createBranch, updateBranch, deleteBranch } = require('../controllers/branch.controller');

router.use(authenticate, authorize('System Admin'));

router.get('/', listBranches);
router.post('/', createBranch);
router.put('/:id', updateBranch);
router.delete('/:id', deleteBranch);

module.exports = router;



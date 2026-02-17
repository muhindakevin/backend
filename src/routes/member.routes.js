const express = require('express');
const router = express.Router();
const { getDashboard, updateProfile, getLoanRecommendation } = require('../controllers/member.controller');
const { authenticate } = require('../middleware/auth.middleware');

router.get('/dashboard', authenticate, getDashboard);
router.put('/profile', authenticate, updateProfile);
router.get('/loan-recommendation', authenticate, getLoanRecommendation);

module.exports = router;


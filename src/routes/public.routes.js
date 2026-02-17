const express = require('express');
const router = express.Router();
const { Group } = require('../models');
const { getTerms } = require('../controllers/systemadmin.controller');

// Public: minimal groups list for signup dropdown
router.get('/groups', async (req, res) => {
  try {
    const groups = await Group.findAll({ attributes: ['id', 'name', 'code'], order: [['name', 'ASC']] });
    res.json({ success: true, data: groups });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch groups', error: error.message });
  }
});

// Public: Get terms and conditions
router.get('/terms', getTerms);

module.exports = router;



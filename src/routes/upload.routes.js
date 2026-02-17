const express = require('express');
const router = express.Router();
const { uploadFile, uploadProfilePicture, deleteProfilePicture, uploadMiddleware, uploadDocument, documentUploadMiddleware, uploadLearnGrowContent, learnGrowUploadMiddleware } = require('../controllers/upload.controller');
const { authenticate } = require('../middleware/auth.middleware');

router.post('/', authenticate, uploadFile);
router.post('/profile-picture', authenticate, uploadMiddleware, uploadProfilePicture);
router.delete('/profile-picture', authenticate, deleteProfilePicture);
router.post('/document', authenticate, documentUploadMiddleware, uploadDocument);
router.post('/learn-grow', authenticate, learnGrowUploadMiddleware, uploadLearnGrowContent);

module.exports = router;


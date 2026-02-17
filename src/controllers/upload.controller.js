const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { User } = require('../models');
const { logAction } = require('../utils/auditLogger');

// Configure storage
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, '../../uploads/profile-images');
    // Create directory if it doesn't exist
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    // Generate unique filename: userId_timestamp.extension
    const userId = req.user.id;
    const timestamp = Date.now();
    const ext = path.extname(file.originalname);
    const filename = `profile_${userId}_${timestamp}${ext}`;
    cb(null, filename);
  }
});

// File filter - only images
const fileFilter = (req, file, cb) => {
  const allowedTypes = /jpeg|jpg|png|gif|webp/;
  const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
  const mimetype = allowedTypes.test(file.mimetype);

  if (extname && mimetype) {
    cb(null, true);
  } else {
    cb(new Error('Only image files are allowed (jpeg, jpg, png, gif, webp)'), false);
  }
};

// Document storage configuration
const documentStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, '../../uploads/documents');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const userId = req.user.id;
    const timestamp = Date.now();
    const ext = path.extname(file.originalname);
    const filename = `doc_${userId}_${timestamp}${ext}`;
    cb(null, filename);
  }
});

// Document file filter - allow PDF, images, Excel, Word
const documentFileFilter = (req, file, cb) => {
  const allowedTypes = /pdf|doc|docx|xls|xlsx|jpg|jpeg|png|gif|webp/;
  const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
  const mimetype = allowedTypes.test(file.mimetype);

  if (extname && mimetype) {
    cb(null, true);
  } else {
    cb(new Error('Only PDF, DOC, XLS, and image files are allowed'), false);
  }
};

// Configure multer
const upload = multer({
  storage: storage,
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB limit
  },
  fileFilter: fileFilter
});

// Document upload multer
const documentUpload = multer({
  storage: documentStorage,
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB limit for documents
  },
  fileFilter: documentFileFilter
});

/**
 * Upload profile picture
 * POST /api/upload/profile-picture
 */
const uploadProfilePicture = async (req, res) => {
  try {
    const user = await User.findByPk(req.user.id);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No file uploaded'
      });
    }

    // Delete old profile picture if exists
    if (user.profileImage) {
      const oldImagePath = path.join(__dirname, '../../uploads/profile-images', path.basename(user.profileImage));
      if (fs.existsSync(oldImagePath)) {
        fs.unlinkSync(oldImagePath);
      }
    }

    // Update user profile image URL
    const imageUrl = `/uploads/profile-images/${req.file.filename}`;
    user.profileImage = imageUrl;
    await user.save();

    logAction(user.id, 'UPLOAD_PROFILE_PICTURE', 'User', user.id, { imageUrl }, req);

    res.json({
      success: true,
      message: 'Profile picture uploaded successfully',
      data: {
        profileImage: imageUrl
      }
    });
  } catch (error) {
    console.error('Upload profile picture error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to upload profile picture',
      error: error.message
    });
  }
};

// Middleware for single file upload
const uploadMiddleware = upload.single('profileImage');

/**
 * Delete profile picture
 * DELETE /api/upload/profile-picture
 */
const deleteProfilePicture = async (req, res) => {
  try {
    const user = await User.findByPk(req.user.id);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Delete old profile picture if exists
    if (user.profileImage) {
      const oldImagePath = path.join(__dirname, '../../uploads/profile-images', path.basename(user.profileImage));
      if (fs.existsSync(oldImagePath)) {
        fs.unlinkSync(oldImagePath);
      }
    }

    // Update user profile image to null
    user.profileImage = null;
    await user.save();

    logAction(user.id, 'DELETE_PROFILE_PICTURE', 'User', user.id, {}, req);

    res.json({
      success: true,
      message: 'Profile picture deleted successfully',
      data: {
        profileImage: null
      }
    });
  } catch (error) {
    console.error('Delete profile picture error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete profile picture',
      error: error.message
    });
  }
};

/**
 * Generic file upload (for backward compatibility)
 * POST /api/upload
 */
const uploadFile = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No file uploaded'
      });
    }

    const fileUrl = `/uploads/${req.file.filename}`;
    res.json({
      success: true,
      message: 'File uploaded successfully',
      data: {
        fileUrl: fileUrl,
        filename: req.file.filename
      }
    });
  } catch (error) {
    console.error('Upload file error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to upload file',
      error: error.message
    });
  }
};

/**
 * Upload document
 * POST /api/upload/document
 */
const uploadDocument = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No file uploaded'
      });
    }

    const fileUrl = `/uploads/documents/${req.file.filename}`;
    res.json({
      success: true,
      message: 'Document uploaded successfully',
      data: {
        url: fileUrl,
        fileUrl: fileUrl,
        filename: req.file.filename,
        originalName: req.file.originalname,
        size: req.file.size,
        mimetype: req.file.mimetype
      }
    });
  } catch (error) {
    console.error('Upload document error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to upload document',
      error: error.message
    });
  }
};

// Middleware for document upload
const documentUploadMiddleware = documentUpload.single('file');

// Learn & Grow content storage configuration (videos, PDFs, etc.)
const learnGrowStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, '../../uploads/learn-grow');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const userId = req.user?.id || 'unknown';
    const timestamp = Date.now();
    const ext = path.extname(file.originalname);
    const filename = `content_${userId}_${timestamp}${ext}`;
    cb(null, filename);
  }
});

// Learn & Grow file filter - allow videos, PDFs, images, audio
const learnGrowFileFilter = (req, file, cb) => {
  const allowedTypes = /pdf|mp4|avi|mov|wmv|flv|webm|mp3|wav|ogg|jpg|jpeg|png|gif|webp|doc|docx|xls|xlsx|pptx|ppt/;
  const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
  const mimetype = allowedTypes.test(file.mimetype) || file.mimetype.startsWith('video/') || file.mimetype.startsWith('audio/');

  if (extname || mimetype) {
    cb(null, true);
  } else {
    cb(new Error('File type not allowed. Allowed: videos, PDFs, images, audio, documents'), false);
  }
};

// Learn & Grow upload multer (larger file size for videos)
const learnGrowUpload = multer({
  storage: learnGrowStorage,
  limits: {
    fileSize: 100 * 1024 * 1024 // 100MB limit for videos/content
  },
  fileFilter: learnGrowFileFilter
});

/**
 * Upload Learn & Grow content (video, PDF, etc.)
 * POST /api/upload/learn-grow
 */
const uploadLearnGrowContent = async (req, res) => {
  try {
    console.log('[uploadLearnGrowContent] Request received');
    console.log('[uploadLearnGrowContent] File:', req.file);
    console.log('[uploadLearnGrowContent] User:', req.user?.id);

    if (!req.file) {
      console.error('[uploadLearnGrowContent] No file in request');
      return res.status(400).json({
        success: false,
        message: 'No file uploaded'
      });
    }

    const fileUrl = `/uploads/learn-grow/${req.file.filename}`;
    console.log('[uploadLearnGrowContent] File uploaded successfully:', fileUrl);

    res.json({
      success: true,
      message: 'Content file uploaded successfully',
      data: {
        url: fileUrl,
        fileUrl: fileUrl,
        filename: req.file.filename,
        originalName: req.file.originalname,
        size: req.file.size,
        mimetype: req.file.mimetype,
        type: req.file.mimetype.startsWith('video/') ? 'video' : 
              req.file.mimetype === 'application/pdf' ? 'pdf' :
              req.file.mimetype.startsWith('audio/') ? 'audio' :
              req.file.mimetype.startsWith('image/') ? 'image' : 'document'
      }
    });
  } catch (error) {
    console.error('[uploadLearnGrowContent] Error:', error);
    console.error('[uploadLearnGrowContent] Error stack:', error.stack);
    res.status(500).json({
      success: false,
      message: 'Failed to upload content file',
      error: error.message,
      ...(process.env.NODE_ENV === 'development' && { stack: error.stack })
    });
  }
};

// Middleware for Learn & Grow content upload
const learnGrowUploadMiddleware = learnGrowUpload.single('file');

module.exports = {
  uploadFile,
  uploadProfilePicture,
  deleteProfilePicture,
  uploadMiddleware,
  uploadDocument,
  documentUploadMiddleware,
  uploadLearnGrowContent,
  learnGrowUploadMiddleware
};

const express = require('express');
const router = express.Router();
const {
  getDocuments,
  uploadDocument,
  deleteDocument,
  getDocumentSummary,
  getArchivedDocuments,
  getArchiveSummary,
  exportDocumentToExcel,
  exportDocumentToPDF,
  archiveDocument,
  compileDailyDocumentation,
  exportAttendanceExcel,
  archiveContributions,
  archiveLoans,
  getAttendanceData,
  getContributionsData,
  getLoansData,
  getMeetingsData,
  getAnnouncementsData,
  getArchivedData,
  documentUploadMiddleware
} = require('../controllers/documentation.controller');
const { authenticate, authorize } = require('../middleware/auth.middleware');

// All routes require authentication
// IMPORTANT: Specific routes must come before parameterized routes
router.get('/attendance', authenticate, authorize('Secretary'), getAttendanceData);
router.get('/contributions', authenticate, authorize('Secretary'), getContributionsData);
router.get('/loans', authenticate, authorize('Secretary'), getLoansData);
router.get('/meetings', authenticate, authorize('Secretary'), getMeetingsData);
router.get('/announcements', authenticate, authorize('Secretary'), getAnnouncementsData);
router.get('/compile-daily', authenticate, authorize('Secretary'), compileDailyDocumentation);
router.get('/export-attendance', authenticate, authorize('Secretary'), exportAttendanceExcel);
router.post('/archive-contributions', authenticate, authorize('Secretary'), archiveContributions);
router.post('/archive-loans', authenticate, authorize('Secretary'), archiveLoans);
router.get('/archive/summary', authenticate, getArchiveSummary);
router.get('/archive', authenticate, getArchivedDocuments);
router.get('/summary', authenticate, getDocumentSummary);
router.get('/', authenticate, getDocuments);
router.post('/', authenticate, authorize('Secretary', 'Cashier'), documentUploadMiddleware, uploadDocument);
router.put('/:id/archive', authenticate, authorize('Secretary', 'Cashier', 'Group Admin'), archiveDocument);
router.get('/:id/view-data', authenticate, getArchivedData);
router.get('/:id/export', authenticate, exportDocumentToExcel);
router.get('/:id/export-pdf', authenticate, exportDocumentToPDF);
router.delete('/:id', authenticate, authorize('Secretary', 'Cashier', 'Group Admin'), deleteDocument);

module.exports = router;


const { Document, User, Group, Meeting, Contribution, Loan, Announcement, sequelize } = require('../models');
const { Op } = require('sequelize');
const ExcelJS = require('exceljs');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const PDFDocument = require('pdfkit');
const { logAction } = require('../utils/auditLogger');

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
    const userId = req.user?.id || 'unknown';
    const timestamp = Date.now();
    const ext = path.extname(file.originalname);
    const filename = `doc_${userId}_${timestamp}${ext}`;
    cb(null, filename);
  }
});

// Document file filter
const documentFileFilter = (req, file, cb) => {
  const allowedTypes = /pdf|doc|docx|xls|xlsx|jpg|jpeg|png|gif|webp/;
  const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
  const mimetype = allowedTypes.test(file.mimetype);

  if (extname || mimetype) {
    cb(null, true);
  } else {
    cb(new Error('Only PDF, DOC, XLS, and image files are allowed'), false);
  }
};

// Document upload multer
const documentUpload = multer({
  storage: documentStorage,
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB limit
  },
  fileFilter: documentFileFilter
});

/**
 * Get all documents
 * GET /api/secretary/documentation
 */
const getDocuments = async (req, res) => {
  try {
    const user = req.user;
    const { category, status, search } = req.query;

    const whereClause = {};

    // Filter by group for non-admin users
    if (user.groupId && user.role !== 'System Admin' && user.role !== 'Agent') {
      whereClause.groupId = user.groupId;
    }

    // Filter by category
    if (category && category !== 'all') {
      whereClause.category = category;
    }

    // Filter by status
    if (status && status !== 'all') {
      whereClause.status = status;
    } else {
      whereClause.status = { [Op.ne]: 'deleted' };
    }

    // Search filter
    if (search) {
      whereClause[Op.or] = [
        { title: { [Op.like]: `%${search}%` } },
        { description: { [Op.like]: `%${search}%` } },
        { fileName: { [Op.like]: `%${search}%` } }
      ];
    }

    const documents = await Document.findAll({
      where: whereClause,
      include: [
        {
          model: User,
          as: 'uploader',
          attributes: ['id', 'name', 'role']
        },
        {
          model: Group,
          as: 'group',
          attributes: ['id', 'name', 'code']
        }
      ],
      order: [['createdAt', 'DESC']]
    });

    res.json({
      success: true,
      data: documents
    });
  } catch (error) {
    console.error('Get documents error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch documents',
      error: error.message
    });
  }
};

/**
 * Upload document
 * POST /api/secretary/documentation
 */
const uploadDocument = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No file uploaded'
      });
    }

    const { title, description, category, referenceType, referenceId } = req.body;
    const user = req.user;

    if (!title) {
      return res.status(400).json({
        success: false,
        message: 'Title is required'
      });
    }

    if (!user.groupId && user.role !== 'System Admin') {
      return res.status(400).json({
        success: false,
        message: 'User must belong to a group'
      });
    }

    const fileUrl = `/uploads/documents/${req.file.filename}`;

    const document = await Document.create({
      groupId: user.groupId,
      title,
      description: description || null,
      fileUrl,
      fileName: req.file.originalname,
      fileType: req.file.mimetype,
      fileSize: req.file.size,
      category: category || 'other',
      uploadedBy: user.id,
      uploadedByRole: user.role,
      referenceType: referenceType || null,
      referenceId: referenceId ? parseInt(referenceId) : null,
      status: 'active'
    });

    await logAction(user.id, 'DOCUMENT_UPLOADED', 'Document', document.id, {
      title: document.title,
      category: document.category
    });

    res.json({
      success: true,
      message: 'Document uploaded successfully',
      data: document
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

/**
 * Delete document
 * DELETE /api/secretary/documentation/:id
 */
const deleteDocument = async (req, res) => {
  try {
    const { id } = req.params;
    const user = req.user;

    const document = await Document.findByPk(id);
    if (!document) {
      return res.status(404).json({
        success: false,
        message: 'Document not found'
      });
    }

    // Check permissions
    if (user.groupId && document.groupId !== user.groupId && user.role !== 'System Admin' && user.role !== 'Agent') {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    // Delete file from filesystem
    if (document.fileUrl) {
      const filePath = path.join(__dirname, '../../', document.fileUrl);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    }

    // Soft delete - mark as deleted
    document.status = 'deleted';
    await document.save();

    await logAction(user.id, 'DOCUMENT_DELETED', 'Document', document.id, {
      title: document.title
    });

    res.json({
      success: true,
      message: 'Document deleted successfully'
    });
  } catch (error) {
    console.error('Delete document error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete document',
      error: error.message
    });
  }
};

/**
 * Get document summary
 * GET /api/secretary/documentation/summary
 */
const getDocumentSummary = async (req, res) => {
  try {
    const user = req.user;
    const whereClause = { status: { [Op.ne]: 'deleted' } };

    if (user.groupId && user.role !== 'System Admin' && user.role !== 'Agent') {
      whereClause.groupId = user.groupId;
    }

    const [total, active, archived, byCategory] = await Promise.all([
      Document.count({ where: whereClause }),
      Document.count({ where: { ...whereClause, status: 'active' } }),
      Document.count({ where: { ...whereClause, status: 'archived' } }),
      Document.findAll({
        where: whereClause,
        attributes: [
          'category',
          [sequelize.fn('COUNT', sequelize.col('id')), 'count']
        ],
        group: ['category']
      })
    ]);

    res.json({
      success: true,
      data: {
        total,
        active,
        archived,
        byCategory: byCategory.reduce((acc, item) => {
          acc[item.category] = parseInt(item.get('count'));
          return acc;
        }, {})
      }
    });
  } catch (error) {
    console.error('Get document summary error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch document summary',
      error: error.message
    });
  }
};

/**
 * Get archived documents
 * GET /api/secretary/documentation/archive
 */
const getArchivedDocuments = async (req, res) => {
  try {
    const user = req.user;
    const { category, search } = req.query;

    const whereClause = { status: 'archived' };

    if (user.groupId && user.role !== 'System Admin' && user.role !== 'Agent') {
      whereClause.groupId = user.groupId;
    }

    if (category && category !== 'all') {
      whereClause.category = category;
    }

    if (search) {
      whereClause[Op.or] = [
        { title: { [Op.like]: `%${search}%` } },
        { description: { [Op.like]: `%${search}%` } }
      ];
    }

    const documents = await Document.findAll({
      where: whereClause,
      include: [
        {
          model: User,
          as: 'uploader',
          attributes: ['id', 'name', 'role']
        },
        {
          model: Group,
          as: 'group',
          attributes: ['id', 'name', 'code']
        }
      ],
      order: [['createdAt', 'DESC']]
    });

    res.json({
      success: true,
      data: documents
    });
  } catch (error) {
    console.error('Get archived documents error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch archived documents',
      error: error.message
    });
  }
};

/**
 * Get archive summary
 * GET /api/secretary/documentation/archive/summary
 */
const getArchiveSummary = async (req, res) => {
  try {
    const user = req.user;
    const whereClause = { status: 'archived' };

    if (user.groupId && user.role !== 'System Admin' && user.role !== 'Agent') {
      whereClause.groupId = user.groupId;
    }

    const [total, byCategory, byMonth] = await Promise.all([
      Document.count({ where: whereClause }),
      Document.findAll({
        where: whereClause,
        attributes: [
          'category',
          [sequelize.fn('COUNT', sequelize.col('id')), 'count']
        ],
        group: ['category']
      }),
      Document.findAll({
        where: whereClause,
        attributes: [
          [sequelize.fn('DATE_FORMAT', sequelize.col('createdAt'), '%Y-%m'), 'month'],
          [sequelize.fn('COUNT', sequelize.col('id')), 'count']
        ],
        group: [sequelize.fn('DATE_FORMAT', sequelize.col('createdAt'), '%Y-%m')],
        order: [[sequelize.fn('DATE_FORMAT', sequelize.col('createdAt'), '%Y-%m'), 'DESC']],
        limit: 12
      })
    ]);

    res.json({
      success: true,
      data: {
        total,
        byCategory: byCategory.reduce((acc, item) => {
          acc[item.category] = parseInt(item.get('count'));
          return acc;
        }, {}),
        byMonth: byMonth.map(item => ({
          month: item.get('month'),
          count: parseInt(item.get('count'))
        }))
      }
    });
  } catch (error) {
    console.error('Get archive summary error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch archive summary',
      error: error.message
    });
  }
};

/**
 * Export document to Excel
 * GET /api/secretary/documentation/:id/export
 */
const exportDocumentToExcel = async (req, res) => {
  try {
    const { id } = req.params;
    const user = req.user;

    const document = await Document.findByPk(id, {
      include: [
        {
          model: User,
          as: 'uploader',
          attributes: ['id', 'name', 'role']
        },
        {
          model: Group,
          as: 'group',
          attributes: ['id', 'name', 'code']
        }
      ]
    });

    if (!document) {
      return res.status(404).json({
        success: false,
        message: 'Document not found'
      });
    }

    if (user.groupId && document.groupId !== user.groupId && user.role !== 'System Admin' && user.role !== 'Agent') {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    // If it's an archive document with an Excel file, return that file
    if (document.referenceType === 'archive' && document.fileUrl && document.fileUrl.endsWith('.xlsx')) {
      const filePath = path.join(__dirname, '../../', document.fileUrl);
      if (fs.existsSync(filePath)) {
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename=${document.fileName || `archive_${document.id}.xlsx`}`);
        return res.sendFile(path.resolve(filePath));
      }
    }

    // Otherwise, create a document details Excel
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Document Details');

    worksheet.columns = [
      { header: 'Field', key: 'field', width: 25 },
      { header: 'Value', key: 'value', width: 50 }
    ];

    worksheet.addRow({ field: 'Document ID', value: `DOC${document.id}` });
    worksheet.addRow({ field: 'Title', value: document.title });
    worksheet.addRow({ field: 'Description', value: document.description || 'N/A' });
    worksheet.addRow({ field: 'Category', value: document.category });
    worksheet.addRow({ field: 'File Name', value: document.fileName || 'N/A' });
    worksheet.addRow({ field: 'File Type', value: document.fileType || 'N/A' });
    worksheet.addRow({ field: 'File Size', value: document.fileSize ? `${(document.fileSize / 1024).toFixed(2)} KB` : 'N/A' });
    worksheet.addRow({ field: 'Status', value: document.status });
    worksheet.addRow({ field: 'Uploaded By', value: document.uploader?.name || 'Unknown' });
    worksheet.addRow({ field: 'Uploader Role', value: document.uploader?.role || 'N/A' });
    worksheet.addRow({ field: 'Group', value: document.group?.name || 'N/A' });
    worksheet.addRow({ field: 'Group Code', value: document.group?.code || 'N/A' });
    worksheet.addRow({ field: 'Upload Date', value: document.createdAt ? new Date(document.createdAt).toLocaleString() : 'N/A' });

    worksheet.getRow(1).font = { bold: true };
    worksheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFE0E0E0' }
    };

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=document_${document.id}_${Date.now()}.xlsx`);

    await workbook.xlsx.write(res);
    res.end();
  } catch (error) {
    console.error('Export document error:', error);
    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        message: 'Failed to export document',
        error: error.message
      });
    }
  }
};

/**
 * Archive document
 * PUT /api/secretary/documentation/:id/archive
 */
const archiveDocument = async (req, res) => {
  try {
    const { id } = req.params;
    const user = req.user;

    const document = await Document.findByPk(id);
    if (!document) {
      return res.status(404).json({
        success: false,
        message: 'Document not found'
      });
    }

    if (user.groupId && document.groupId !== user.groupId && user.role !== 'System Admin' && user.role !== 'Agent') {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    document.status = 'archived';
    await document.save();

    await logAction(user.id, 'DOCUMENT_ARCHIVED', 'Document', document.id, {
      title: document.title
    });

    res.json({
      success: true,
      message: 'Document archived successfully',
      data: document
    });
  } catch (error) {
    console.error('Archive document error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to archive document',
      error: error.message
    });
  }
};

/**
 * Compile daily documentation
 * GET /api/secretary/documentation/compile-daily
 */
const compileDailyDocumentation = async (req, res) => {
  try {
    const user = req.user;
    const { date } = req.query;

    if (!user.groupId) {
      return res.status(400).json({
        success: false,
        message: 'User must belong to a group'
      });
    }

    const targetDate = date ? new Date(date) : new Date();
    const startDate = new Date(targetDate);
    startDate.setHours(0, 0, 0, 0);
    const endDate = new Date(targetDate);
    endDate.setHours(23, 59, 59, 999);

    const [meetings, contributions, loans, announcements] = await Promise.all([
      Meeting.count({
        where: {
          groupId: user.groupId,
          scheduledDate: { [Op.between]: [startDate, endDate] }
        }
      }),
      Contribution.count({
        where: {
          groupId: user.groupId,
          createdAt: { [Op.between]: [startDate, endDate] }
        }
      }),
      Loan.count({
        where: {
          groupId: user.groupId,
          createdAt: { [Op.between]: [startDate, endDate] }
        }
      }),
      Announcement.count({
        where: {
          groupId: user.groupId,
          createdAt: { [Op.between]: [startDate, endDate] }
        }
      })
    ]);

    res.json({
      success: true,
      data: {
        date: targetDate.toISOString().split('T')[0],
        meetings,
        contributions,
        loans,
        announcements,
        total: meetings + contributions + loans + announcements
      }
    });
  } catch (error) {
    console.error('Compile daily documentation error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to compile daily documentation',
      error: error.message
    });
  }
};

/**
 * Export attendance to Excel
 * GET /api/secretary/documentation/export-attendance
 */
const exportAttendanceExcel = async (req, res) => {
  try {
    const user = req.user;
    const { year, month, startDate, endDate } = req.query;

    if (!user.groupId) {
      return res.status(400).json({
        success: false,
        message: 'User must belong to a group'
      });
    }

    let dateStart, dateEnd;
    if (startDate && endDate) {
      dateStart = new Date(startDate);
      dateStart.setHours(0, 0, 0, 0);
      dateEnd = new Date(endDate);
      dateEnd.setHours(23, 59, 59, 999);
    } else {
      const targetYear = year ? parseInt(year) : new Date().getFullYear();
      const targetMonth = month ? parseInt(month) : new Date().getMonth() + 1;
      dateStart = new Date(targetYear, targetMonth - 1, 1);
      dateEnd = new Date(targetYear, targetMonth, 0, 23, 59, 59, 999);
    }

    const meetings = await Meeting.findAll({
      where: {
        groupId: user.groupId,
        scheduledDate: { [Op.between]: [dateStart, dateEnd] },
        attendance: { [Op.ne]: null }
      },
      order: [['scheduledDate', 'ASC']]
    });

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Attendance Report');

    worksheet.columns = [
      { header: 'Date', key: 'date', width: 15 },
      { header: 'Meeting Title', key: 'meetingTitle', width: 30 },
      { header: 'Attendees Count', key: 'attendeesCount', width: 15 },
      { header: 'Present Members', key: 'presentMembers', width: 50 },
      { header: 'Absent Members', key: 'absentMembers', width: 50 },
      { header: 'Taken By', key: 'takenBy', width: 25 }
    ];

    for (const meeting of meetings) {
      let attendanceIds = [];
      if (Array.isArray(meeting.attendance)) {
        attendanceIds = meeting.attendance;
      } else if (typeof meeting.attendance === 'string') {
        try {
          const parsed = JSON.parse(meeting.attendance);
          if (Array.isArray(parsed)) {
            attendanceIds = parsed;
          }
        } catch {
          // Ignore parse errors
        }
      }

      const allMembers = await User.findAll({
        where: {
          groupId: user.groupId,
          role: 'Member',
          status: 'active'
        },
        attributes: ['id', 'name']
      });

      const presentMembers = allMembers.filter(m => attendanceIds.includes(m.id));
      const absentMembers = allMembers.filter(m => !attendanceIds.includes(m.id));

      let takenBy = 'N/A';
      if (meeting.attendanceTakenBy) {
        const taker = await User.findByPk(meeting.attendanceTakenBy, {
          attributes: ['name']
        });
        if (taker) {
          takenBy = taker.name;
        }
      }

      worksheet.addRow({
        date: meeting.scheduledDate ? new Date(meeting.scheduledDate).toLocaleDateString() : 'N/A',
        meetingTitle: meeting.title || 'N/A',
        attendeesCount: presentMembers.length,
        presentMembers: presentMembers.map(m => m.name).join(', ') || 'None',
        absentMembers: absentMembers.map(m => m.name).join(', ') || 'None',
        takenBy
      });
    }

    worksheet.getRow(1).font = { bold: true };
    worksheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFE0E0E0' }
    };

    const dateStr = startDate && endDate 
      ? `${startDate}_${endDate}` 
      : `${dateStart.getFullYear()}_${String(dateStart.getMonth() + 1).padStart(2, '0')}`;
    
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=attendance_report_${dateStr}.xlsx`);

    await workbook.xlsx.write(res);
    res.end();
  } catch (error) {
    console.error('Export attendance error:', error);
    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        message: 'Failed to export attendance',
        error: error.message
      });
    }
  }
};

/**
 * Archive contributions
 * POST /api/secretary/documentation/archive-contributions
 */
const archiveContributions = async (req, res) => {
  try {
    const user = req.user;
    const { year, month, startDate, endDate } = req.body;

    if (!user.groupId) {
      return res.status(400).json({
        success: false,
        message: 'User must belong to a group'
      });
    }

    let dateStart, dateEnd;
    if (startDate && endDate) {
      dateStart = new Date(startDate);
      dateStart.setHours(0, 0, 0, 0);
      dateEnd = new Date(endDate);
      dateEnd.setHours(23, 59, 59, 999);
    } else {
      const targetYear = year ? parseInt(year) : new Date().getFullYear();
      const targetMonth = month ? parseInt(month) : new Date().getMonth() + 1;
      dateStart = new Date(targetYear, targetMonth - 1, 1);
      dateEnd = new Date(targetYear, targetMonth, 0, 23, 59, 59, 999);
    }

    const contributions = await Contribution.findAll({
      where: {
        groupId: user.groupId,
        createdAt: { [Op.between]: [dateStart, dateEnd] }
      },
      include: [
        {
          model: User,
          as: 'member',
          attributes: ['id', 'name', 'phone', 'email']
        }
      ],
      order: [['createdAt', 'ASC']]
    });

    // Create Excel file
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Contributions Archive');

    worksheet.columns = [
      { header: 'Date', key: 'date', width: 15 },
      { header: 'Member Name', key: 'memberName', width: 25 },
      { header: 'Member Phone', key: 'memberPhone', width: 15 },
      { header: 'Amount (RWF)', key: 'amount', width: 15 },
      { header: 'Payment Method', key: 'paymentMethod', width: 20 },
      { header: 'Receipt Number', key: 'receiptNumber', width: 25 },
      { header: 'Status', key: 'status', width: 15 },
      { header: 'Transaction ID', key: 'transactionId', width: 20 }
    ];

    let totalAmount = 0;
    contributions.forEach(contribution => {
      const amount = parseFloat(contribution.amount || 0);
      totalAmount += amount;
      
      worksheet.addRow({
        date: contribution.createdAt ? new Date(contribution.createdAt).toLocaleDateString() : 'N/A',
        memberName: contribution.member?.name || 'Unknown',
        memberPhone: contribution.member?.phone || 'N/A',
        amount: amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
        paymentMethod: contribution.paymentMethod || 'N/A',
        receiptNumber: contribution.receiptNumber || 'N/A',
        status: contribution.status || 'N/A',
        transactionId: contribution.transactionId || 'N/A'
      });
    });

    // Add summary row
    worksheet.addRow({});
    worksheet.addRow({
      date: 'TOTAL',
      memberName: '',
      memberPhone: '',
      amount: totalAmount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
      paymentMethod: `Count: ${contributions.length}`,
      receiptNumber: '',
      status: '',
      transactionId: ''
    });

    // Style header row
    worksheet.getRow(1).font = { bold: true };
    worksheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFE0E0E0' }
    };

    // Save Excel file
    const uploadDir = path.join(__dirname, '../../uploads/documents');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }

    const filename = `contributions_archive_${user.groupId}_${Date.now()}.xlsx`;
    const filePath = path.join(uploadDir, filename);
    await workbook.xlsx.writeFile(filePath);

    const fileUrl = `/uploads/documents/${filename}`;
    const fileStats = fs.statSync(filePath);

    // Create archive document with metadata
    const document = await Document.create({
      groupId: user.groupId,
      title: `Contributions Archive - ${dateStart.toISOString().split('T')[0]} to ${dateEnd.toISOString().split('T')[0]}`,
      description: `Archived contributions from ${dateStart.toISOString().split('T')[0]} to ${dateEnd.toISOString().split('T')[0]}. Total: ${contributions.length} contributions, Total Amount: ${totalAmount.toLocaleString()} RWF`,
      fileUrl,
      fileName: filename,
      fileType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      fileSize: fileStats.size,
      category: 'contribution',
      uploadedBy: user.id,
      uploadedByRole: user.role,
      status: 'archived',
      referenceType: 'archive',
      referenceId: null
    });

    await logAction(user.id, 'CONTRIBUTIONS_ARCHIVED', 'Document', document.id, {
      startDate: dateStart.toISOString().split('T')[0],
      endDate: dateEnd.toISOString().split('T')[0],
      count: contributions.length,
      totalAmount
    });

    res.json({
      success: true,
      message: 'Contributions archived successfully',
      data: {
        document,
        contributionsCount: contributions.length,
        totalAmount
      }
    });
  } catch (error) {
    console.error('Archive contributions error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to archive contributions',
      error: error.message
    });
  }
};

/**
 * Archive loans
 * POST /api/secretary/documentation/archive-loans
 */
const archiveLoans = async (req, res) => {
  try {
    const user = req.user;
    const { year, month, startDate, endDate } = req.body;

    if (!user.groupId) {
      return res.status(400).json({
        success: false,
        message: 'User must belong to a group'
      });
    }

    let dateStart, dateEnd;
    if (startDate && endDate) {
      dateStart = new Date(startDate);
      dateStart.setHours(0, 0, 0, 0);
      dateEnd = new Date(endDate);
      dateEnd.setHours(23, 59, 59, 999);
    } else {
      const targetYear = year ? parseInt(year) : new Date().getFullYear();
      const targetMonth = month ? parseInt(month) : new Date().getMonth() + 1;
      dateStart = new Date(targetYear, targetMonth - 1, 1);
      dateEnd = new Date(targetYear, targetMonth, 0, 23, 59, 59, 999);
    }

    const loans = await Loan.findAll({
      where: {
        groupId: user.groupId,
        createdAt: { [Op.between]: [dateStart, dateEnd] }
      },
      include: [
        {
          model: User,
          as: 'member',
          attributes: ['id', 'name', 'phone', 'email']
        }
      ],
      order: [['createdAt', 'ASC']]
    });

    // Create Excel file
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Loans Archive');

    worksheet.columns = [
      { header: 'Date', key: 'date', width: 15 },
      { header: 'Member Name', key: 'memberName', width: 25 },
      { header: 'Member Phone', key: 'memberPhone', width: 15 },
      { header: 'Loan Amount (RWF)', key: 'amount', width: 18 },
      { header: 'Purpose', key: 'purpose', width: 30 },
      { header: 'Status', key: 'status', width: 15 },
      { header: 'Interest Rate (%)', key: 'interestRate', width: 15 },
      { header: 'Duration (Months)', key: 'duration', width: 15 },
      { header: 'Monthly Payment (RWF)', key: 'monthlyPayment', width: 20 },
      { header: 'Total Amount (RWF)', key: 'totalAmount', width: 18 }
    ];

    let totalAmount = 0;
    loans.forEach(loan => {
      const amount = parseFloat(loan.amount || 0);
      totalAmount += amount;
      
      worksheet.addRow({
        date: loan.createdAt ? new Date(loan.createdAt).toLocaleDateString() : 'N/A',
        memberName: loan.member?.name || 'Unknown',
        memberPhone: loan.member?.phone || 'N/A',
        amount: amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
        purpose: loan.purpose || 'N/A',
        status: loan.status || 'N/A',
        interestRate: parseFloat(loan.interestRate || 0).toFixed(2),
        duration: loan.duration || 'N/A',
        monthlyPayment: parseFloat(loan.monthlyPayment || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
        totalAmount: parseFloat(loan.totalAmount || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      });
    });

    // Add summary row
    worksheet.addRow({});
    worksheet.addRow({
      date: 'TOTAL',
      memberName: '',
      memberPhone: '',
      amount: totalAmount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
      purpose: `Count: ${loans.length}`,
      status: '',
      interestRate: '',
      duration: '',
      monthlyPayment: '',
      totalAmount: ''
    });

    // Style header row
    worksheet.getRow(1).font = { bold: true };
    worksheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFE0E0E0' }
    };

    // Save Excel file
    const uploadDir = path.join(__dirname, '../../uploads/documents');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }

    const filename = `loans_archive_${user.groupId}_${Date.now()}.xlsx`;
    const filePath = path.join(uploadDir, filename);
    await workbook.xlsx.writeFile(filePath);

    const fileUrl = `/uploads/documents/${filename}`;
    const fileStats = fs.statSync(filePath);

    // Create archive document with metadata
    const document = await Document.create({
      groupId: user.groupId,
      title: `Loans Archive - ${dateStart.toISOString().split('T')[0]} to ${dateEnd.toISOString().split('T')[0]}`,
      description: `Archived loans from ${dateStart.toISOString().split('T')[0]} to ${dateEnd.toISOString().split('T')[0]}. Total: ${loans.length} loans, Total Amount: ${totalAmount.toLocaleString()} RWF`,
      fileUrl,
      fileName: filename,
      fileType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      fileSize: fileStats.size,
      category: 'loan',
      uploadedBy: user.id,
      uploadedByRole: user.role,
      status: 'archived',
      referenceType: 'archive',
      referenceId: null
    });

    await logAction(user.id, 'LOANS_ARCHIVED', 'Document', document.id, {
      startDate: dateStart.toISOString().split('T')[0],
      endDate: dateEnd.toISOString().split('T')[0],
      count: loans.length,
      totalAmount
    });

    res.json({
      success: true,
      message: 'Loans archived successfully',
      data: {
        document,
        loansCount: loans.length,
        totalAmount
      }
    });
  } catch (error) {
    console.error('Archive loans error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to archive loans',
      error: error.message
    });
  }
};

/**
 * Get attendance data
 * GET /api/secretary/documentation/attendance
 */
const getAttendanceData = async (req, res) => {
  try {
    const user = req.user;
    const { year, month } = req.query;

    if (!user.groupId) {
      return res.status(400).json({
        success: false,
        message: 'User must belong to a group'
      });
    }

    const targetYear = year ? parseInt(year) : new Date().getFullYear();
    const targetMonth = month ? parseInt(month) : new Date().getMonth() + 1;

    const startDate = new Date(targetYear, targetMonth - 1, 1);
    const endDate = new Date(targetYear, targetMonth, 0, 23, 59, 59, 999);

    const meetings = await Meeting.findAll({
      where: {
        groupId: user.groupId,
        scheduledDate: { [Op.between]: [startDate, endDate] },
        attendance: { [Op.ne]: null }
      },
      include: [
        {
          model: User,
          as: 'creator',
          attributes: ['id', 'name']
        }
      ],
      order: [['scheduledDate', 'DESC']]
    });

    const attendanceData = [];

    for (const meeting of meetings) {
      let attendanceIds = [];
      if (Array.isArray(meeting.attendance)) {
        attendanceIds = meeting.attendance;
      } else if (typeof meeting.attendance === 'string') {
        try {
          const parsed = JSON.parse(meeting.attendance);
          if (Array.isArray(parsed)) {
            attendanceIds = parsed;
          }
        } catch {
          // Ignore parse errors
        }
      }

      const allMembers = await User.findAll({
        where: {
          groupId: user.groupId,
          role: 'Member',
          status: 'active'
        },
        attributes: ['id', 'name', 'phone']
      });

      const presentMembers = allMembers
        .filter(m => attendanceIds.includes(m.id))
        .map(m => m.name);
      const absentMembers = allMembers
        .filter(m => !attendanceIds.includes(m.id))
        .map(m => m.name);

      let takenBy = 'N/A';
      if (meeting.attendanceTakenBy) {
        const taker = await User.findByPk(meeting.attendanceTakenBy, {
          attributes: ['name']
        });
        if (taker) {
          takenBy = taker.name;
        }
      }

      attendanceData.push({
        date: meeting.scheduledDate,
        meetingTitle: meeting.title,
        attendeesCount: presentMembers.length,
        presentMembers,
        absentMembers,
        takenBy
      });
    }

    res.json({
      success: true,
      data: attendanceData
    });
  } catch (error) {
    console.error('Get attendance data error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch attendance data',
      error: error.message
    });
  }
};

/**
 * Get contributions data
 * GET /api/secretary/documentation/contributions
 */
const getContributionsData = async (req, res) => {
  try {
    const user = req.user;
    const { year, month } = req.query;

    if (!user.groupId) {
      return res.status(400).json({
        success: false,
        message: 'User must belong to a group'
      });
    }

    const targetYear = year ? parseInt(year) : new Date().getFullYear();
    const targetMonth = month ? parseInt(month) : new Date().getMonth() + 1;

    const startDate = new Date(targetYear, targetMonth - 1, 1);
    const endDate = new Date(targetYear, targetMonth, 0, 23, 59, 59, 999);

    const contributions = await Contribution.findAll({
      where: {
        groupId: user.groupId,
        createdAt: { [Op.between]: [startDate, endDate] }
      },
      include: [
        {
          model: User,
          as: 'member',
          attributes: ['id', 'name', 'phone']
        }
      ],
      order: [['createdAt', 'DESC']]
    });

    const contributionsData = contributions.map(contribution => ({
      id: contribution.id,
      memberName: contribution.member?.name || 'Unknown',
      memberPhone: contribution.member?.phone || 'N/A',
      amount: parseFloat(contribution.amount),
      paymentMethod: contribution.paymentMethod,
      status: contribution.status,
      receiptNumber: contribution.receiptNumber,
      date: contribution.createdAt
    }));

    res.json({
      success: true,
      data: contributionsData
    });
  } catch (error) {
    console.error('Get contributions data error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch contributions data',
      error: error.message
    });
  }
};

/**
 * Get loans data
 * GET /api/secretary/documentation/loans
 */
const getLoansData = async (req, res) => {
  try {
    const user = req.user;
    const { year, month } = req.query;

    if (!user.groupId) {
      return res.status(400).json({
        success: false,
        message: 'User must belong to a group'
      });
    }

    const targetYear = year ? parseInt(year) : new Date().getFullYear();
    const targetMonth = month ? parseInt(month) : new Date().getMonth() + 1;

    const startDate = new Date(targetYear, targetMonth - 1, 1);
    const endDate = new Date(targetYear, targetMonth, 0, 23, 59, 59, 999);

    const loans = await Loan.findAll({
      where: {
        groupId: user.groupId,
        createdAt: { [Op.between]: [startDate, endDate] }
      },
      include: [
        {
          model: User,
          as: 'member',
          attributes: ['id', 'name', 'phone']
        }
      ],
      order: [['createdAt', 'DESC']]
    });

    const loansData = loans.map(loan => ({
      id: loan.id,
      memberName: loan.member?.name || 'Unknown',
      memberPhone: loan.member?.phone || 'N/A',
      amount: parseFloat(loan.amount),
      purpose: loan.purpose,
      status: loan.status,
      interestRate: parseFloat(loan.interestRate),
      duration: loan.duration,
      monthlyPayment: parseFloat(loan.monthlyPayment),
      totalAmount: parseFloat(loan.totalAmount),
      date: loan.createdAt
    }));

    res.json({
      success: true,
      data: loansData
    });
  } catch (error) {
    console.error('Get loans data error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch loans data',
      error: error.message
    });
  }
};

/**
 * Get meetings data
 * GET /api/secretary/documentation/meetings
 */
const getMeetingsData = async (req, res) => {
  try {
    const user = req.user;
    const { year, month } = req.query;

    if (!user.groupId) {
      return res.status(400).json({
        success: false,
        message: 'User must belong to a group'
      });
    }

    const targetYear = year ? parseInt(year) : new Date().getFullYear();
    const targetMonth = month ? parseInt(month) : new Date().getMonth() + 1;

    const startDate = new Date(targetYear, targetMonth - 1, 1);
    const endDate = new Date(targetYear, targetMonth, 0, 23, 59, 59, 999);

    const meetings = await Meeting.findAll({
      where: {
        groupId: user.groupId,
        scheduledDate: { [Op.between]: [startDate, endDate] }
      },
      include: [
        {
          model: User,
          as: 'creator',
          attributes: ['id', 'name']
        }
      ],
      order: [['scheduledDate', 'DESC']]
    });

    const meetingsData = meetings.map(meeting => {
      let attendanceCount = 0;
      if (meeting.attendance && Array.isArray(meeting.attendance)) {
        attendanceCount = meeting.attendance.length;
      }

      return {
        id: meeting.id,
        title: meeting.title,
        date: meeting.scheduledDate,
        time: meeting.scheduledTime,
        location: meeting.location,
        status: meeting.status,
        attendanceCount,
        createdBy: meeting.creator?.name || 'Unknown'
      };
    });

    res.json({
      success: true,
      data: meetingsData
    });
  } catch (error) {
    console.error('Get meetings data error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch meetings data',
      error: error.message
    });
  }
};

/**
 * Get announcements data
 * GET /api/secretary/documentation/announcements
 */
const getAnnouncementsData = async (req, res) => {
  try {
    const user = req.user;
    const { year, month } = req.query;

    if (!user.groupId) {
      return res.status(400).json({
        success: false,
        message: 'User must belong to a group'
      });
    }

    const targetYear = year ? parseInt(year) : new Date().getFullYear();
    const targetMonth = month ? parseInt(month) : new Date().getMonth() + 1;

    const startDate = new Date(targetYear, targetMonth - 1, 1);
    const endDate = new Date(targetYear, targetMonth, 0, 23, 59, 59, 999);

    const announcements = await Announcement.findAll({
      where: {
        groupId: user.groupId,
        createdAt: { [Op.between]: [startDate, endDate] }
      },
      include: [
        {
          model: User,
          as: 'creator',
          attributes: ['id', 'name']
        }
      ],
      order: [['createdAt', 'DESC']]
    });

    const announcementsData = announcements.map(announcement => ({
      id: announcement.id,
      title: announcement.title,
      content: announcement.content,
      priority: announcement.priority,
      status: announcement.status,
      createdBy: announcement.creator?.name || 'Unknown',
      sentAt: announcement.sentAt,
      date: announcement.createdAt
    }));

    res.json({
      success: true,
      data: announcementsData
    });
  } catch (error) {
    console.error('Get announcements data error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch announcements data',
      error: error.message
    });
  }
};

/**
 * Get archived data for viewing
 * GET /api/secretary/documentation/:id/view-data
 */
const getArchivedData = async (req, res) => {
  try {
    const { id } = req.params;
    const user = req.user;

    const document = await Document.findByPk(id);
    if (!document) {
      return res.status(404).json({
        success: false,
        message: 'Document not found'
      });
    }

    if (user.groupId && document.groupId !== user.groupId && user.role !== 'System Admin' && user.role !== 'Agent') {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    console.log(`[getArchivedData] Processing document ${id}: title="${document.title}", category="${document.category}", referenceType="${document.referenceType}"`);

    // Extract date range from title (format: "Category Archive - YYYY-MM-DD to YYYY-MM-DD")
    // Try multiple patterns to be more flexible
    let dateMatch = document.title.match(/(\d{4}-\d{2}-\d{2})\s+to\s+(\d{4}-\d{2}-\d{2})/);
    
    // If not found, try alternative format with different separators
    if (!dateMatch) {
      dateMatch = document.title.match(/(\d{4}-\d{2}-\d{2}).*?(\d{4}-\d{2}-\d{2})/);
    }
    
    // If still not found, try to extract from description
    if (!dateMatch && document.description) {
      dateMatch = document.description.match(/(\d{4}-\d{2}-\d{2})\s+to\s+(\d{4}-\d{2}-\d{2})/);
      if (!dateMatch) {
        dateMatch = document.description.match(/(\d{4}-\d{2}-\d{2}).*?(\d{4}-\d{2}-\d{2})/);
      }
    }
    
    // If still not found, check if it's a valid archive document and use a default range
    if (!dateMatch) {
      console.warn(`[getArchivedData] Date range not found in document ${id}. Title: "${document.title}", Description: "${document.description?.substring(0, 100)}"`);
      
      // For archive documents without date range, try to read from Excel file or return helpful message
      if (document.referenceType === 'archive' && document.fileUrl && document.fileUrl.endsWith('.xlsx')) {
        return res.json({
          success: true,
          data: {
            document,
            period: {
              startDate: null,
              endDate: null
            },
            items: [],
            total: 0,
            message: 'Date range not found in document metadata. Please download the Excel file to view all archived data.'
          }
        });
      }
      
      // If it's not an archive document, just return the document info
      if (document.referenceType !== 'archive') {
        return res.json({
          success: true,
          data: {
            document,
            period: {
              startDate: null,
              endDate: null
            },
            items: [],
            total: 0,
            message: 'This is not an archive document. Please download the file to view content.'
          }
        });
      }
      
      return res.status(400).json({
        success: false,
        message: 'Invalid archive document format. Date range not found in title or description.',
        details: `Document title: "${document.title}"`,
        suggestion: 'Please download the Excel file to view the archived data.'
      });
    }

    const dateStart = new Date(dateMatch[1]);
    if (isNaN(dateStart.getTime())) {
      return res.status(400).json({
        success: false,
        message: 'Invalid start date format',
        details: `Start date: "${dateMatch[1]}"`
      });
    }
    dateStart.setHours(0, 0, 0, 0);
    
    const dateEnd = new Date(dateMatch[2]);
    if (isNaN(dateEnd.getTime())) {
      return res.status(400).json({
        success: false,
        message: 'Invalid end date format',
        details: `End date: "${dateMatch[2]}"`
      });
    }
    dateEnd.setHours(23, 59, 59, 999);

    let data = [];

    if (document.category === 'contribution') {
      const contributions = await Contribution.findAll({
        where: {
          groupId: document.groupId,
          createdAt: { [Op.between]: [dateStart, dateEnd] }
        },
        include: [
          {
            model: User,
            as: 'member',
            attributes: ['id', 'name', 'phone', 'email']
          }
        ],
        order: [['createdAt', 'ASC']]
      });

      data = contributions.map(c => ({
        id: c.id,
        date: c.createdAt,
        memberName: c.member?.name || 'Unknown',
        memberPhone: c.member?.phone || 'N/A',
        amount: parseFloat(c.amount || 0),
        paymentMethod: c.paymentMethod,
        receiptNumber: c.receiptNumber,
        status: c.status,
        transactionId: c.transactionId
      }));
    } else if (document.category === 'loan') {
      const loans = await Loan.findAll({
        where: {
          groupId: document.groupId,
          createdAt: { [Op.between]: [dateStart, dateEnd] }
        },
        include: [
          {
            model: User,
            as: 'member',
            attributes: ['id', 'name', 'phone', 'email']
          }
        ],
        order: [['createdAt', 'ASC']]
      });

      data = loans.map(l => ({
        id: l.id,
        date: l.createdAt,
        memberName: l.member?.name || 'Unknown',
        memberPhone: l.member?.phone || 'N/A',
        amount: parseFloat(l.amount || 0),
        purpose: l.purpose,
        status: l.status,
        interestRate: parseFloat(l.interestRate || 0),
        duration: l.duration,
        monthlyPayment: parseFloat(l.monthlyPayment || 0),
        totalAmount: parseFloat(l.totalAmount || 0)
      }));
    } else {
      // If category doesn't match, return empty data but still return document info
      console.warn(`[getArchivedData] Unknown category: ${document.category} for document ${document.id}`);
    }

    res.json({
      success: true,
      data: {
        document,
        period: {
          startDate: dateMatch[1],
          endDate: dateMatch[2]
        },
        items: data,
        total: data.length
      }
    });
  } catch (error) {
    console.error('Get archived data error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch archived data',
      error: error.message
    });
  }
};

/**
 * Export archived document to PDF
 * GET /api/secretary/documentation/:id/export-pdf
 */
const exportDocumentToPDF = async (req, res) => {
  try {
    const { id } = req.params;
    const user = req.user;

    const document = await Document.findByPk(id, {
      include: [
        {
          model: User,
          as: 'uploader',
          attributes: ['id', 'name', 'role']
        },
        {
          model: Group,
          as: 'group',
          attributes: ['id', 'name', 'code']
        }
      ]
    });

    if (!document) {
      return res.status(404).json({
        success: false,
        message: 'Document not found'
      });
    }

    if (user.groupId && document.groupId !== user.groupId && user.role !== 'System Admin' && user.role !== 'Agent') {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    // Extract date range from title
    const dateMatch = document.title.match(/(\d{4}-\d{2}-\d{2})\s+to\s+(\d{4}-\d{2}-\d{2})/);
    if (!dateMatch) {
      return res.status(400).json({
        success: false,
        message: 'Invalid archive document format'
      });
    }

    const dateStart = new Date(dateMatch[1]);
    dateStart.setHours(0, 0, 0, 0);
    const dateEnd = new Date(dateMatch[2]);
    dateEnd.setHours(23, 59, 59, 999);

    // Create PDF
    const doc = new PDFDocument({ margin: 50 });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=${document.title.replace(/[^a-z0-9]/gi, '_')}.pdf`);

    doc.pipe(res);

    // Header
    doc.fontSize(20).text('IKIMINA WALLET', { align: 'center' });
    doc.moveDown();
    doc.fontSize(16).text(document.title, { align: 'center' });
    doc.moveDown();
    doc.fontSize(12).text(`Period: ${dateMatch[1]} to ${dateMatch[2]}`, { align: 'center' });
    doc.moveDown(2);

    // Get data
    if (document.category === 'contribution') {
      const contributions = await Contribution.findAll({
        where: {
          groupId: document.groupId,
          createdAt: { [Op.between]: [dateStart, dateEnd] }
        },
        include: [
          {
            model: User,
            as: 'member',
            attributes: ['id', 'name', 'phone']
          }
        ],
        order: [['createdAt', 'ASC']]
      });

      let totalAmount = 0;
      contributions.forEach(c => {
        totalAmount += parseFloat(c.amount || 0);
      });

      doc.fontSize(14).text('Contributions Summary', { underline: true });
      doc.moveDown();
      doc.fontSize(12).text(`Total Contributions: ${contributions.length}`);
      doc.text(`Total Amount: ${totalAmount.toLocaleString()} RWF`);
      doc.moveDown();

      doc.fontSize(12).text('Contributions Details', { underline: true });
      doc.moveDown(0.5);

      contributions.forEach((c, index) => {
        if (doc.y > 700) {
          doc.addPage();
        }
        doc.fontSize(10);
        doc.text(`${index + 1}. ${c.member?.name || 'Unknown'}`, { continued: false });
        doc.text(`   Date: ${new Date(c.createdAt).toLocaleDateString()}`, { indent: 20 });
        doc.text(`   Amount: ${parseFloat(c.amount || 0).toLocaleString()} RWF`, { indent: 20 });
        doc.text(`   Payment Method: ${c.paymentMethod || 'N/A'}`, { indent: 20 });
        doc.text(`   Receipt: ${c.receiptNumber || 'N/A'}`, { indent: 20 });
        doc.moveDown(0.5);
      });
    } else if (document.category === 'loan') {
      const loans = await Loan.findAll({
        where: {
          groupId: document.groupId,
          createdAt: { [Op.between]: [dateStart, dateEnd] }
        },
        include: [
          {
            model: User,
            as: 'member',
            attributes: ['id', 'name', 'phone']
          }
        ],
        order: [['createdAt', 'ASC']]
      });

      let totalAmount = 0;
      loans.forEach(l => {
        totalAmount += parseFloat(l.amount || 0);
      });

      doc.fontSize(14).text('Loans Summary', { underline: true });
      doc.moveDown();
      doc.fontSize(12).text(`Total Loans: ${loans.length}`);
      doc.text(`Total Amount: ${totalAmount.toLocaleString()} RWF`);
      doc.moveDown();

      doc.fontSize(12).text('Loans Details', { underline: true });
      doc.moveDown(0.5);

      loans.forEach((l, index) => {
        if (doc.y > 700) {
          doc.addPage();
        }
        doc.fontSize(10);
        doc.text(`${index + 1}. ${l.member?.name || 'Unknown'}`, { continued: false });
        doc.text(`   Date: ${new Date(l.createdAt).toLocaleDateString()}`, { indent: 20 });
        doc.text(`   Amount: ${parseFloat(l.amount || 0).toLocaleString()} RWF`, { indent: 20 });
        doc.text(`   Purpose: ${l.purpose || 'N/A'}`, { indent: 20 });
        doc.text(`   Status: ${l.status || 'N/A'}`, { indent: 20 });
        doc.text(`   Interest Rate: ${parseFloat(l.interestRate || 0).toFixed(2)}%`, { indent: 20 });
        doc.text(`   Duration: ${l.duration || 'N/A'} months`, { indent: 20 });
        doc.moveDown(0.5);
      });
    }

    // Footer
    doc.fontSize(8).text(`Generated: ${new Date().toLocaleString()}`, { align: 'center' });
    doc.text(`Group: ${document.group?.name || 'N/A'}`, { align: 'center' });

    doc.end();
  } catch (error) {
    console.error('Export PDF error:', error);
    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        message: 'Failed to export PDF',
        error: error.message
      });
    }
  }
};

module.exports = {
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
  documentUploadMiddleware: documentUpload.single('file')
};


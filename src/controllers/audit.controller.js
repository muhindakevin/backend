const { AuditLog, User, Transaction, Contribution, Loan, Fine, Group, ComplianceViolation, ComplianceRule, ScheduledAudit, sequelize } = require('../models');
const { Op } = require('sequelize');
const ExcelJS = require('exceljs');
const { logAction } = require('../utils/auditLogger');

/**
 * Get audit logs with filtering, search, and pagination
 * GET /api/audit-logs
 */
const listAuditLogs = async (req, res) => {
  try {
    const user = req.user;
    console.log('[listAuditLogs] User:', { id: user.id, role: user.role, groupId: user.groupId });
    const { 
      search, 
      filterType, 
      filterDate, 
      groupId,
      page = 1, 
      limit = 100 
    } = req.query;

    // Build where clause
    const whereClause = {};

    // Group filtering - priority: explicit groupId > user's group > all
    if (groupId && groupId !== 'all') {
      // Get all user IDs in the specified group
      const groupUsers = await User.findAll({
        where: { groupId: parseInt(groupId) },
        attributes: ['id']
      });
      const userIds = groupUsers.map(u => u.id);
      console.log('[listAuditLogs] Explicit groupId filter:', { groupId, userIds: userIds.length });
      if (userIds.length > 0) {
        whereClause.userId = { [Op.in]: userIds };
      } else {
        // No users in group, return empty result
        whereClause.userId = { [Op.in]: [] };
      }
    } else if (['Cashier', 'Group Admin', 'Secretary'].includes(user.role) && user.groupId) {
      // Get all user IDs in the group
      const groupUsers = await User.findAll({
        where: { groupId: user.groupId },
        attributes: ['id']
      });
      const userIds = groupUsers.map(u => u.id);
      console.log('[listAuditLogs] Group filter for role:', { role: user.role, groupId: user.groupId, userIds: userIds.length });
      whereClause.userId = { [Op.in]: userIds };
    } else {
      console.log('[listAuditLogs] No group filtering applied:', { role: user.role, groupId: user.groupId });
    }

    // Exclude system admin actions for Cashiers - only show cashier-relevant actions
    // Cashiers should only see: contributions, loans, fines, transactions, member applications
    // Exclude: login, logout, profile uploads, OTP, password resets, etc.
    if (user.role === 'Cashier') {
      // Build exclusion conditions for system admin actions
      const excludeConditions = [
        { action: { [Op.notLike]: '%LOGIN%' } },
        { action: { [Op.notLike]: '%LOGOUT%' } },
        { action: { [Op.notLike]: '%AUTHENTICATION%' } },
        { action: { [Op.notLike]: '%PASSWORD%' } },
        { action: { [Op.notLike]: '%RESET%' } },
        { action: { [Op.notLike]: '%FORGOT%' } },
        { action: { [Op.notLike]: '%SESSION%' } },
        { action: { [Op.notLike]: '%TOKEN%' } },
        { action: { [Op.notLike]: '%VERIFY%' } },
        { action: { [Op.notLike]: '%OTP%' } },
        { action: { [Op.notLike]: '%PROFILE%' } },
        { action: { [Op.notLike]: '%UPLOAD%' } },
        { action: { [Op.notLike]: '%IMAGE%' } },
        { action: { [Op.notLike]: '%PICTURE%' } },
        { action: { [Op.notLike]: '%AVATAR%' } },
        { action: { [Op.notLike]: '%SETTING%' } },
        { action: { [Op.notLike]: '%CONFIG%' } },
        { action: { [Op.notLike]: '%SYSTEM%' } },
        { action: { [Op.notLike]: '%BRANCH%' } },
        { action: { [Op.notLike]: '%GROUP_CREATE%' } },
        { action: { [Op.notLike]: '%GROUP_UPDATE%' } },
        { action: { [Op.notLike]: '%GROUP_DELETE%' } }
      ];
      
      // Only include cashier-relevant entity types
      const allowedEntityTypes = ['Contribution', 'Loan', 'Fine', 'Transaction', 'MemberApplication', 'User'];
      if (whereClause[Op.and]) {
        whereClause[Op.and] = [
          ...whereClause[Op.and], 
          ...excludeConditions,
          { entityType: { [Op.in]: allowedEntityTypes } }
        ];
      } else {
        whereClause[Op.and] = [
          ...excludeConditions,
          { entityType: { [Op.in]: allowedEntityTypes } }
        ];
      }
    } else if (user.role !== 'System Admin') {
      // For Group Admin and Secretary, exclude login/auth but allow more actions
      const excludeConditions = [
        { action: { [Op.notLike]: '%LOGIN%' } },
        { action: { [Op.notLike]: '%LOGOUT%' } },
        { action: { [Op.notLike]: '%AUTHENTICATION%' } },
        { action: { [Op.notLike]: '%PASSWORD%' } },
        { action: { [Op.notLike]: '%RESET%' } },
        { action: { [Op.notLike]: '%FORGOT%' } },
        { action: { [Op.notLike]: '%SESSION%' } },
        { action: { [Op.notLike]: '%TOKEN%' } },
        { action: { [Op.notLike]: '%VERIFY%' } }
      ];
      
      if (whereClause[Op.and]) {
        whereClause[Op.and] = [...whereClause[Op.and], ...excludeConditions];
      } else {
        whereClause[Op.and] = excludeConditions;
      }
    }

    // Search filter
    if (search) {
      whereClause[Op.or] = [
        { action: { [Op.like]: `%${search}%` } },
        { entityType: { [Op.like]: `%${search}%` } }
      ];
    }

    // Filter by type (combines with search using AND if both exist)
    if (filterType && filterType !== 'all') {
      const typeMap = {
        'contribution': 'CONTRIBUTION',
        'loan': 'LOAN',
        'fine': 'FINE',
        'cash': 'CASH'
      };
      const actionPrefix = typeMap[filterType];
      if (actionPrefix) {
        const typeCondition = { action: { [Op.like]: `${actionPrefix}%` } };
        if (whereClause[Op.or]) {
          // Both search and type filter exist - combine with AND
          const existingOr = whereClause[Op.or];
          delete whereClause[Op.or];
          whereClause[Op.and] = [
            { [Op.or]: existingOr },
            typeCondition
          ];
        } else {
          whereClause.action = typeCondition.action;
        }
      }
    }

    // Filter by date range
    if (filterDate && filterDate !== 'all') {
      const now = new Date();
      let startDate;
      
      switch (filterDate) {
        case 'today':
          startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
          break;
        case 'yesterday':
          startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
          const endDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
          whereClause.createdAt = { [Op.between]: [startDate, endDate] };
          break;
        case 'thisWeek':
          const dayOfWeek = now.getDay();
          startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - dayOfWeek);
          whereClause.createdAt = { [Op.gte]: startDate };
          break;
        case 'lastWeek':
          const lastWeekStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - now.getDay() - 7);
          const lastWeekEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() - now.getDay());
          whereClause.createdAt = { [Op.between]: [lastWeekStart, lastWeekEnd] };
          break;
        case 'thisMonth':
          startDate = new Date(now.getFullYear(), now.getMonth(), 1);
          whereClause.createdAt = { [Op.gte]: startDate };
          break;
        default:
          break;
      }
      
      if (filterDate === 'today' && startDate) {
        whereClause.createdAt = { [Op.gte]: startDate };
      }
    }

    // Get audit logs with user information
    const offset = (parseInt(page) - 1) * parseInt(limit);
    console.log('[listAuditLogs] Where clause:', JSON.stringify(whereClause, null, 2));
    const logs = await AuditLog.findAndCountAll({
      where: whereClause,
      include: [
        { 
          model: User, 
          as: 'user', 
          attributes: ['id', 'name', 'email', 'role', 'groupId'],
          include: [
            {
              model: Group,
              as: 'group',
              attributes: ['id', 'name']
            }
          ]
        }
      ],
      order: [['createdAt', 'DESC']],
      limit: parseInt(limit),
      offset: offset
    });
    console.log('[listAuditLogs] Found logs:', logs.count);

    // Get summary statistics (always show total counts for the group, not filtered)
    const baseWhereClause = {};
    if (['Cashier', 'Group Admin', 'Secretary'].includes(user.role) && user.groupId) {
      const groupUsers = await User.findAll({
        where: { groupId: user.groupId },
        attributes: ['id']
      });
      const userIds = groupUsers.map(u => u.id);
      baseWhereClause.userId = { [Op.in]: userIds };
    }

    // Exclude login/auth audits from summary for non-system-admin users
    // Cashiers are NOT allowed to see login/logout audits in summary statistics
    if (user.role !== 'System Admin') {
      const excludeConditions = [
        { action: { [Op.notLike]: '%LOGIN%' } },
        { action: { [Op.notLike]: '%LOGOUT%' } },
        { action: { [Op.notLike]: '%AUTHENTICATION%' } },
        { action: { [Op.notLike]: '%PASSWORD%' } },
        { action: { [Op.notLike]: '%RESET%' } },
        { action: { [Op.notLike]: '%FORGOT%' } },
        { action: { [Op.notLike]: '%SESSION%' } },
        { action: { [Op.notLike]: '%TOKEN%' } },
        { action: { [Op.notLike]: '%VERIFY%' } }
      ];
      if (baseWhereClause[Op.and]) {
        baseWhereClause[Op.and] = [...baseWhereClause[Op.and], ...excludeConditions];
      } else {
        baseWhereClause[Op.and] = excludeConditions;
      }
    }

    const totalLogs = await AuditLog.count({ where: baseWhereClause });
    
    // Build successful logs where clause
    const successfulWhereClause = { ...baseWhereClause };
    const successfulActionCondition = {
      [Op.or]: [
        { [Op.like]: '%APPROVED%' },
        { [Op.like]: '%COMPLETED%' },
        { [Op.like]: '%SUBMITTED%' }
      ]
    };
    if (successfulWhereClause[Op.and]) {
      successfulWhereClause[Op.and] = [...successfulWhereClause[Op.and], { action: successfulActionCondition }];
    } else {
      successfulWhereClause.action = successfulActionCondition;
    }
    const successfulLogs = await AuditLog.count({ where: successfulWhereClause });
    
    // Build failed logs where clause
    const failedWhereClause = { ...baseWhereClause };
    const failedActionCondition = {
      [Op.or]: [
        { action: { [Op.like]: '%REJECTED%' } },
        { action: { [Op.like]: '%FAILED%' } }
      ]
    };
    if (failedWhereClause[Op.and]) {
      failedWhereClause[Op.and] = [...failedWhereClause[Op.and], failedActionCondition];
    } else {
      Object.assign(failedWhereClause, failedActionCondition);
    }
    const failedLogs = await AuditLog.count({ where: failedWhereClause });

    // Get total transactions count for the group (all transactions, not filtered)
    const transactionWhereClause = {};
    if (['Cashier', 'Group Admin', 'Secretary'].includes(user.role) && user.groupId) {
      const groupUsers = await User.findAll({
        where: { groupId: user.groupId },
        attributes: ['id']
      });
      const userIds = groupUsers.map(u => u.id);
      transactionWhereClause.userId = { [Op.in]: userIds };
    }
    const totalTransactions = await Transaction.count({ where: transactionWhereClause });

    return res.json({
      success: true,
      data: logs.rows,
      pagination: {
        total: logs.count,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(logs.count / parseInt(limit))
      },
      summary: {
        totalLogs,
        successfulLogs,
        failedLogs,
        totalTransactions
      }
    });
  } catch (error) {
    console.error('List audit logs error:', error);
    return res.status(500).json({ 
      success: false, 
      message: 'Failed to fetch audit logs', 
      error: error.message 
    });
  }
};

/**
 * Get transaction records for the group
 * GET /api/audit-logs/transactions
 */
const getTransactionRecords = async (req, res) => {
  try {
    const user = req.user;
    console.log('[getTransactionRecords] User:', { id: user.id, role: user.role, groupId: user.groupId });
    const { search, filterType, filterDate } = req.query;

    const whereClause = {};

    // Filter by groupId for Cashiers, Group Admins, Secretaries
    if (['Cashier', 'Group Admin', 'Secretary'].includes(user.role) && user.groupId) {
      const groupUsers = await User.findAll({
        where: { groupId: user.groupId },
        attributes: ['id']
      });
      const userIds = groupUsers.map(u => u.id);
      console.log('[getTransactionRecords] Group filter:', { groupId: user.groupId, userIds: userIds.length });
      whereClause.userId = { [Op.in]: userIds };
    } else {
      console.log('[getTransactionRecords] No group filtering:', { role: user.role, groupId: user.groupId });
    }

    // Filter by type
    if (filterType && filterType !== 'all') {
      const typeMap = {
        'contribution': 'contribution',
        'loan': 'loan_payment',
        'fine': 'fine_payment',
        'cash': 'contribution' // Cash payments are contributions
      };
      if (typeMap[filterType]) {
        whereClause.type = typeMap[filterType];
      }
    }

    // Filter by date range
    if (filterDate && filterDate !== 'all') {
      const now = new Date();
      let startDate;
      
      switch (filterDate) {
        case 'today':
          startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
          whereClause.createdAt = { [Op.gte]: startDate };
          break;
        case 'yesterday':
          startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
          const endDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
          whereClause.createdAt = { [Op.between]: [startDate, endDate] };
          break;
        case 'thisWeek':
          const dayOfWeek = now.getDay();
          startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - dayOfWeek);
          whereClause.createdAt = { [Op.gte]: startDate };
          break;
        case 'lastWeek':
          const lastWeekStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - now.getDay() - 7);
          const lastWeekEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() - now.getDay());
          whereClause.createdAt = { [Op.between]: [lastWeekStart, lastWeekEnd] };
          break;
        case 'thisMonth':
          startDate = new Date(now.getFullYear(), now.getMonth(), 1);
          whereClause.createdAt = { [Op.gte]: startDate };
          break;
      }
    }

    // Search
    if (search) {
      whereClause[Op.or] = [
        { description: { [Op.like]: `%${search}%` } },
        { referenceId: { [Op.like]: `%${search}%` } }
      ];
    }

    console.log('[getTransactionRecords] Where clause:', JSON.stringify(whereClause, null, 2));
    const transactions = await Transaction.findAll({
      where: whereClause,
      include: [
        {
          model: User,
          as: 'user',
          attributes: ['id', 'name', 'phone', 'email']
        }
      ],
      order: [['createdAt', 'DESC']],
      limit: 1000
    });
    console.log('[getTransactionRecords] Found transactions:', transactions.length);

    return res.json({
      success: true,
      data: transactions
    });
  } catch (error) {
    console.error('Get transaction records error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch transaction records',
      error: error.message
    });
  }
};

/**
 * Get detailed audit log information
 * GET /api/audit-logs/:id
 */
const getAuditLogDetails = async (req, res) => {
  try {
    const { id } = req.params;
    const user = req.user;

    const log = await AuditLog.findByPk(id, {
      include: [
        {
          model: User,
          as: 'user',
          attributes: ['id', 'name', 'email', 'role', 'phone', 'groupId'],
          include: [
            {
              model: Group,
              as: 'group',
              attributes: ['id', 'name']
            }
          ]
        }
      ]
    });

    if (!log) {
      return res.status(404).json({
        success: false,
        message: 'Audit log not found'
      });
    }

    // Check access permissions
    if (['Cashier', 'Group Admin', 'Secretary'].includes(user.role) && user.groupId) {
      const logUser = await User.findByPk(log.userId);
      if (!logUser || logUser.groupId !== user.groupId) {
        return res.status(403).json({
          success: false,
          message: 'Access denied. You can only view audit logs from your group.'
        });
      }
    }

    // Fetch related entity details if available
    let entityDetails = null;
    if (log.entityType && log.entityId) {
      try {
        switch (log.entityType) {
          case 'Contribution':
            entityDetails = await Contribution.findByPk(log.entityId, {
              include: [
                { model: User, as: 'member', attributes: ['id', 'name', 'phone'] },
                { model: Group, as: 'group', attributes: ['id', 'name'] }
              ]
            });
            break;
          case 'Loan':
            entityDetails = await Loan.findByPk(log.entityId, {
              include: [
                { model: User, as: 'member', attributes: ['id', 'name', 'phone'] },
                { model: Group, as: 'group', attributes: ['id', 'name'] }
              ]
            });
            break;
          case 'Fine':
            entityDetails = await Fine.findByPk(log.entityId, {
              include: [
                { model: User, as: 'member', attributes: ['id', 'name', 'phone'] },
                { model: Group, as: 'group', attributes: ['id', 'name'] }
              ]
            });
            break;
        }
      } catch (err) {
        console.error('Error fetching entity details:', err);
      }
    }

    return res.json({
      success: true,
      data: {
        ...log.toJSON(),
        entityDetails
      }
    });
  } catch (error) {
    console.error('Get audit log details error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch audit log details',
      error: error.message
    });
  }
};

/**
 * Export audit logs to Excel
 * GET /api/audit-logs/export
 */
const exportAuditLogsExcel = async (req, res) => {
  try {
    const user = req.user;
    const { search, filterType, filterDate } = req.query;

    // Build where clause (same as listAuditLogs)
    const whereClause = {};

    if (['Cashier', 'Group Admin', 'Secretary'].includes(user.role) && user.groupId) {
      const groupUsers = await User.findAll({
        where: { groupId: user.groupId },
        attributes: ['id']
      });
      const userIds = groupUsers.map(u => u.id);
      whereClause.userId = { [Op.in]: userIds };
    }

    // Exclude login/authentication-related audits for non-system-admin users
    // Cashiers are NOT allowed to see login/logout audits
    if (user.role !== 'System Admin') {
      const excludeConditions = [
        { action: { [Op.notLike]: '%LOGIN%' } },
        { action: { [Op.notLike]: '%LOGOUT%' } },
        { action: { [Op.notLike]: '%AUTHENTICATION%' } },
        { action: { [Op.notLike]: '%PASSWORD%' } },
        { action: { [Op.notLike]: '%RESET%' } },
        { action: { [Op.notLike]: '%FORGOT%' } },
        { action: { [Op.notLike]: '%SESSION%' } },
        { action: { [Op.notLike]: '%TOKEN%' } },
        { action: { [Op.notLike]: '%VERIFY%' } }
      ];
      
      if (whereClause[Op.and]) {
        whereClause[Op.and] = [...whereClause[Op.and], ...excludeConditions];
      } else {
        whereClause[Op.and] = excludeConditions;
      }
    }

    // Search filter
    if (search) {
      whereClause[Op.or] = [
        { action: { [Op.like]: `%${search}%` } },
        { entityType: { [Op.like]: `%${search}%` } }
      ];
    }

    // Filter by type (combines with search using AND if both exist)
    if (filterType && filterType !== 'all') {
      const typeMap = {
        'contribution': 'CONTRIBUTION',
        'loan': 'LOAN',
        'fine': 'FINE',
        'cash': 'CASH'
      };
      const actionPrefix = typeMap[filterType];
      if (actionPrefix) {
        const typeCondition = { action: { [Op.like]: `${actionPrefix}%` } };
        if (whereClause[Op.or]) {
          // Both search and type filter exist - combine with AND
          const existingOr = whereClause[Op.or];
          delete whereClause[Op.or];
          whereClause[Op.and] = [
            { [Op.or]: existingOr },
            typeCondition
          ];
        } else {
          whereClause.action = typeCondition.action;
        }
      }
    }

    if (filterDate && filterDate !== 'all') {
      const now = new Date();
      let startDate;
      
      switch (filterDate) {
        case 'today':
          startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
          whereClause.createdAt = { [Op.gte]: startDate };
          break;
        case 'yesterday':
          startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
          const endDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
          whereClause.createdAt = { [Op.between]: [startDate, endDate] };
          break;
        case 'thisWeek':
          const dayOfWeek = now.getDay();
          startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - dayOfWeek);
          whereClause.createdAt = { [Op.gte]: startDate };
          break;
        case 'lastWeek':
          const lastWeekStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - now.getDay() - 7);
          const lastWeekEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() - now.getDay());
          whereClause.createdAt = { [Op.between]: [lastWeekStart, lastWeekEnd] };
          break;
        case 'thisMonth':
          startDate = new Date(now.getFullYear(), now.getMonth(), 1);
          whereClause.createdAt = { [Op.gte]: startDate };
          break;
      }
    }

    const logs = await AuditLog.findAll({
      where: whereClause,
      include: [
        {
          model: User,
          as: 'user',
          attributes: ['id', 'name', 'email', 'role']
        }
      ],
      order: [['createdAt', 'DESC']],
      limit: 10000
    });

    // Create Excel workbook
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Audit Logs');

    // Define columns
    worksheet.columns = [
      { header: 'Log ID', key: 'id', width: 10 },
      { header: 'Date & Time', key: 'createdAt', width: 20 },
      { header: 'Action', key: 'action', width: 30 },
      { header: 'Entity Type', key: 'entityType', width: 20 },
      { header: 'Entity ID', key: 'entityId', width: 15 },
      { header: 'User', key: 'userName', width: 25 },
      { header: 'User Role', key: 'userRole', width: 15 },
      { header: 'IP Address', key: 'ipAddress', width: 18 },
      { header: 'Details', key: 'details', width: 50 }
    ];

    // Style header row
    worksheet.getRow(1).font = { bold: true };
    worksheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF4472C4' }
    };
    worksheet.getRow(1).font = { ...worksheet.getRow(1).font, color: { argb: 'FFFFFFFF' } };

    // Add data rows
    logs.forEach(log => {
      const details = log.details ? JSON.stringify(log.details) : '';
      worksheet.addRow({
        id: log.id,
        createdAt: log.createdAt.toISOString(),
        action: log.action,
        entityType: log.entityType || '',
        entityId: log.entityId || '',
        userName: log.user ? log.user.name : 'Unknown',
        userRole: log.user ? log.user.role : '',
        ipAddress: log.ipAddress || '',
        details: details
      });
    });

    // Set response headers
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="audit_logs_${new Date().toISOString().split('T')[0]}.xlsx"`);

    // Write to response
    await workbook.xlsx.write(res);
    res.end();
  } catch (error) {
    console.error('Export audit logs error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to export audit logs',
      error: error.message
    });
  }
};

/**
 * Create scheduled audit with comprehensive checklist
 * POST /api/audit-logs/schedule
 */
const createScheduledAudit = async (req, res) => {
  try {
    const { groupId, auditType, scheduledDate, description } = req.body;
    const scheduledBy = req.user.id;

    if (!groupId || !auditType || !scheduledDate) {
      return res.status(400).json({
        success: false,
        message: 'Group ID, audit type, and scheduled date are required'
      });
    }

    // Verify group exists
    const group = await Group.findByPk(groupId);
    if (!group) {
      return res.status(404).json({
        success: false,
        message: 'Group not found'
      });
    }

    // Generate comprehensive checklist based on audit type and project features
    const checklist = generateAuditChecklist(auditType, groupId);

    const scheduledAudit = await ScheduledAudit.create({
      groupId,
      scheduledBy,
      auditType,
      scheduledDate: new Date(scheduledDate),
      description: description || `Scheduled ${auditType.replace('_', ' ')} audit for ${group.name}`,
      status: 'scheduled',
      checklist
    });

    // Log the action
    await logAction(scheduledBy, 'SCHEDULE_AUDIT', 'ScheduledAudit', scheduledAudit.id, {
      groupId,
      groupName: group.name,
      auditType,
      scheduledDate
    }, req);

    res.status(201).json({
      success: true,
      message: 'Audit scheduled successfully',
      data: scheduledAudit
    });
  } catch (error) {
    console.error('Create scheduled audit error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to schedule audit',
      error: error.message
    });
  }
};

/**
 * Generate comprehensive audit checklist based on audit type
 */
const generateAuditChecklist = (auditType, groupId) => {
  const baseChecklist = [
    { item: 'Group registration documents verified', status: 'pending', category: 'documentation' },
    { item: 'Group admin credentials verified', status: 'pending', category: 'verification' },
    { item: 'Group compliance rules reviewed', status: 'pending', category: 'compliance' }
  ];

  switch (auditType) {
    case 'compliance_check':
      return [
        ...baseChecklist,
        { item: 'All compliance violations reviewed', status: 'pending', category: 'compliance' },
        { item: 'Compliance rules adherence verified', status: 'pending', category: 'compliance' },
        { item: 'Member compliance status checked', status: 'pending', category: 'compliance' },
        { item: 'Group meeting attendance verified', status: 'pending', category: 'compliance' },
        { item: 'Voting participation verified', status: 'pending', category: 'compliance' }
      ];
    
    case 'financial_audit':
      return [
        ...baseChecklist,
        { item: 'All contributions recorded and verified', status: 'pending', category: 'financial' },
        { item: 'Loan records accuracy verified', status: 'pending', category: 'financial' },
        { item: 'Transaction history reviewed', status: 'pending', category: 'financial' },
        { item: 'Fine records verified', status: 'pending', category: 'financial' },
        { item: 'Financial reports accuracy checked', status: 'pending', category: 'financial' },
        { item: 'Outstanding loans reviewed', status: 'pending', category: 'financial' },
        { item: 'Payment schedules verified', status: 'pending', category: 'financial' },
        { item: 'Guarantor information verified', status: 'pending', category: 'financial' }
      ];
    
    case 'group_verification':
      return [
        ...baseChecklist,
        { item: 'Group member list verified', status: 'pending', category: 'verification' },
        { item: 'Member registration documents reviewed', status: 'pending', category: 'verification' },
        { item: 'Group admin, secretary, and cashier roles verified', status: 'pending', category: 'verification' },
        { item: 'Group location and contact information verified', status: 'pending', category: 'verification' },
        { item: 'Group code and identification verified', status: 'pending', category: 'verification' },
        { item: 'Group status and activity verified', status: 'pending', category: 'verification' }
      ];
    
    case 'investigation':
      return [
        ...baseChecklist,
        { item: 'Suspicious activities identified', status: 'pending', category: 'investigation' },
        { item: 'Transaction anomalies reviewed', status: 'pending', category: 'investigation' },
        { item: 'Compliance violations investigated', status: 'pending', category: 'investigation' },
        { item: 'User activity logs reviewed', status: 'pending', category: 'investigation' },
        { item: 'Audit trail verified', status: 'pending', category: 'investigation' },
        { item: 'Evidence collected and documented', status: 'pending', category: 'investigation' }
      ];
    
    default:
      return baseChecklist;
  }
};

/**
 * Get scheduled audits
 * GET /api/audit-logs/scheduled
 */
const getScheduledAudits = async (req, res) => {
  try {
    const { groupId, status } = req.query;
    const user = req.user;

    const whereClause = {};

    // Filter by group if provided
    if (groupId && groupId !== 'all') {
      whereClause.groupId = parseInt(groupId);
    } else if (['Cashier', 'Group Admin', 'Secretary'].includes(user.role) && user.groupId) {
      // For group roles, only show their group's audits
      whereClause.groupId = user.groupId;
    }

    // Filter by status
    if (status && status !== 'all') {
      whereClause.status = status;
    }

    const audits = await ScheduledAudit.findAll({
      where: whereClause,
      include: [
        {
          model: Group,
          as: 'group',
          attributes: ['id', 'name', 'code', 'district', 'sector']
        },
        {
          model: User,
          as: 'scheduler',
          attributes: ['id', 'name', 'role']
        },
        {
          model: User,
          as: 'completer',
          attributes: ['id', 'name', 'role'],
          required: false
        }
      ],
      order: [['scheduledDate', 'DESC']]
    });

    res.json({
      success: true,
      data: audits
    });
  } catch (error) {
    console.error('Get scheduled audits error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch scheduled audits',
      error: error.message
    });
  }
};

/**
 * Update scheduled audit status and checklist
 * PUT /api/audit-logs/scheduled/:id
 */
const updateScheduledAudit = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, checklist, findings, recommendations } = req.body;
    const userId = req.user.id;

    const audit = await ScheduledAudit.findByPk(id);
    if (!audit) {
      return res.status(404).json({
        success: false,
        message: 'Scheduled audit not found'
      });
    }

    // Update fields
    const wasCompleted = audit.status === 'completed';
    if (status) {
      audit.status = status;
      if (status === 'completed' && !wasCompleted) {
        audit.completedAt = new Date();
        audit.completedBy = userId;
        
        // Create a comprehensive audit log entry when audit is completed
        const group = await Group.findByPk(audit.groupId);
        const completedByUser = await User.findByPk(userId);
        
        await AuditLog.create({
          userId: userId,
          action: `AUDIT_COMPLETED_${audit.auditType.toUpperCase()}`,
          entityType: 'ScheduledAudit',
          entityId: audit.id,
          details: {
            auditType: audit.auditType,
            groupId: audit.groupId,
            groupName: group ? group.name : 'Unknown',
            scheduledDate: audit.scheduledDate,
            completedBy: completedByUser ? completedByUser.name : 'Unknown',
            checklist: audit.checklist,
            findings: audit.findings,
            recommendations: audit.recommendations,
            totalChecklistItems: audit.checklist ? audit.checklist.length : 0,
            completedItems: audit.checklist ? audit.checklist.filter(item => item.status === 'completed').length : 0
          },
          ipAddress: req.ip || req.connection?.remoteAddress || null,
          userAgent: req.get('user-agent') || null
        });
      }
    }
    if (checklist) audit.checklist = checklist;
    if (findings) audit.findings = findings;
    if (recommendations) audit.recommendations = recommendations;

    await audit.save();

    // Log the action
    await logAction(userId, 'UPDATE_AUDIT', 'ScheduledAudit', audit.id, {
      status,
      groupId: audit.groupId
    }, req);

    res.json({
      success: true,
      message: 'Audit updated successfully',
      data: audit
    });
  } catch (error) {
    console.error('Update scheduled audit error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update audit',
      error: error.message
    });
  }
};

/**
 * Enhanced export with group filtering
 * GET /api/audit-logs/export
 */
const exportAuditLogsExcelEnhanced = async (req, res) => {
  try {
    const user = req.user;
    const { search, filterType, filterDate, groupId } = req.query;

    // Build where clause
    const whereClause = {};

    // Group filtering - priority: explicit groupId > user's group > all
    if (groupId && groupId !== 'all') {
      // Get all user IDs in the specified group
      const groupUsers = await User.findAll({
        where: { groupId: parseInt(groupId) },
        attributes: ['id']
      });
      const userIds = groupUsers.map(u => u.id);
      if (userIds.length > 0) {
        whereClause.userId = { [Op.in]: userIds };
      } else {
        // No users in group, return empty result
        whereClause.userId = { [Op.in]: [] };
      }
    } else if (['Cashier', 'Group Admin', 'Secretary'].includes(user.role) && user.groupId) {
      const groupUsers = await User.findAll({
        where: { groupId: user.groupId },
        attributes: ['id']
      });
      const userIds = groupUsers.map(u => u.id);
      whereClause.userId = { [Op.in]: userIds };
    }

    // Search filter
    if (search) {
      whereClause[Op.or] = [
        { action: { [Op.like]: `%${search}%` } },
        { entityType: { [Op.like]: `%${search}%` } }
      ];
    }

    // Filter by type
    if (filterType && filterType !== 'all') {
      const typeMap = {
        'contribution': 'CONTRIBUTION',
        'loan': 'LOAN',
        'fine': 'FINE',
        'cash': 'CASH',
        'user': 'USER',
        'group': 'GROUP'
      };
      const actionPrefix = typeMap[filterType];
      if (actionPrefix) {
        const typeCondition = { action: { [Op.like]: `${actionPrefix}%` } };
        if (whereClause[Op.or]) {
          const existingOr = whereClause[Op.or];
          delete whereClause[Op.or];
          whereClause[Op.and] = [
            { [Op.or]: existingOr },
            typeCondition
          ];
        } else {
          whereClause.action = typeCondition.action;
        }
      }
    }

    // Date filter
    if (filterDate && filterDate !== 'all') {
      const now = new Date();
      let startDate;
      
      switch (filterDate) {
        case 'today':
          startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
          whereClause.createdAt = { [Op.gte]: startDate };
          break;
        case 'yesterday':
          startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
          const endDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
          whereClause.createdAt = { [Op.between]: [startDate, endDate] };
          break;
        case 'thisWeek':
          const dayOfWeek = now.getDay();
          startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - dayOfWeek);
          whereClause.createdAt = { [Op.gte]: startDate };
          break;
        case 'lastWeek':
          const lastWeekStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - now.getDay() - 7);
          const lastWeekEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() - now.getDay());
          whereClause.createdAt = { [Op.between]: [lastWeekStart, lastWeekEnd] };
          break;
        case 'thisMonth':
          startDate = new Date(now.getFullYear(), now.getMonth(), 1);
          whereClause.createdAt = { [Op.gte]: startDate };
          break;
      }
    }

    const logs = await AuditLog.findAll({
      where: whereClause,
      include: [
        {
          model: User,
          as: 'user',
          attributes: ['id', 'name', 'email', 'role'],
          include: [
            {
              model: Group,
              as: 'group',
              attributes: ['id', 'name', 'code'],
              required: false
            }
          ]
        }
      ],
      order: [['createdAt', 'DESC']],
      limit: 10000
    });

    // Get group name for filename if filtered
    let groupName = '';
    if (groupId && groupId !== 'all') {
      const group = await Group.findByPk(groupId);
      if (group) {
        groupName = `_${group.name.replace(/[^a-z0-9]/gi, '_')}`;
      }
    }

    // Create Excel workbook
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Audit Logs');

    // Define columns
    worksheet.columns = [
      { header: 'Log ID', key: 'id', width: 10 },
      { header: 'Date & Time', key: 'createdAt', width: 20 },
      { header: 'Action', key: 'action', width: 30 },
      { header: 'Entity Type', key: 'entityType', width: 20 },
      { header: 'Entity ID', key: 'entityId', width: 15 },
      { header: 'User', key: 'userName', width: 25 },
      { header: 'User Role', key: 'userRole', width: 15 },
      { header: 'Group', key: 'groupName', width: 25 },
      { header: 'IP Address', key: 'ipAddress', width: 18 },
      { header: 'Details', key: 'details', width: 50 }
    ];

    // Style header row
    worksheet.getRow(1).font = { bold: true };
    worksheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF4472C4' }
    };
    worksheet.getRow(1).font = { ...worksheet.getRow(1).font, color: { argb: 'FFFFFFFF' } };

    // Add data rows
    logs.forEach(log => {
      const details = log.details ? JSON.stringify(log.details) : '';
      worksheet.addRow({
        id: log.id,
        createdAt: log.createdAt.toISOString(),
        action: log.action,
        entityType: log.entityType || '',
        entityId: log.entityId || '',
        userName: log.user ? log.user.name : 'Unknown',
        userRole: log.user ? log.user.role : '',
        groupName: log.user?.group ? log.user.group.name : '',
        ipAddress: log.ipAddress || '',
        details: details
      });
    });

    // Set response headers
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    const filename = `audit_logs${groupName}_${new Date().toISOString().split('T')[0]}.xlsx`;
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    // Write to response
    await workbook.xlsx.write(res);
    res.end();
  } catch (error) {
    console.error('Export audit logs error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to export audit logs',
      error: error.message
    });
  }
};

/**
 * Create audit record directly (for agents to record audits)
 * POST /api/audit-logs/record
 */
const createAuditRecord = async (req, res) => {
  try {
    const { groupId, auditType, description, findings, recommendations, checklist } = req.body;
    const userId = req.user.id;

    if (!groupId || !auditType) {
      return res.status(400).json({
        success: false,
        message: 'Group ID and audit type are required'
      });
    }

    // Verify group exists
    const group = await Group.findByPk(groupId);
    if (!group) {
      return res.status(404).json({
        success: false,
        message: 'Group not found'
      });
    }

    // Create audit log entry
    const auditLog = await AuditLog.create({
      userId: userId,
      action: `AUDIT_RECORDED_${auditType.toUpperCase()}`,
      entityType: 'Group',
      entityId: groupId,
      details: {
        auditType,
        groupId,
        groupName: group.name,
        description,
        findings,
        recommendations,
        checklist: checklist || [],
        recordedBy: req.user.name || 'Unknown',
        recordedAt: new Date().toISOString()
      },
      ipAddress: req.ip || req.connection?.remoteAddress || null,
      userAgent: req.get('user-agent') || null
    });

    res.status(201).json({
      success: true,
      message: 'Audit record created successfully',
      data: auditLog
    });
  } catch (error) {
    console.error('Create audit record error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create audit record',
      error: error.message
    });
  }
};

module.exports = {
  listAuditLogs,
  exportAuditLogsExcel: exportAuditLogsExcelEnhanced,
  getTransactionRecords,
  getAuditLogDetails,
  createScheduledAudit,
  getScheduledAudits,
  updateScheduledAudit,
  createAuditRecord
};



const { Transaction, User } = require('../models');
const { Op } = require('sequelize');

/**
 * Get user transactions
 * GET /api/transactions
 * For Group Admin: returns all transactions for group members
 * For Members: returns only their transactions
 */
const getTransactions = async (req, res) => {
  try {
    const { type, status, startDate, endDate, limit, offset = 0, groupId, userId: queryUserId } = req.query;
    const user = req.user;
    
    let whereClause = {};

    // STRICT userId filtering - Members can ONLY see their own transactions
    if (user.role === 'Member') {
      // Members can ONLY access their own transactions - no exceptions
      whereClause.userId = user.id;
      console.log(`[getTransactions] Member ${user.id} - STRICT filtering: only transactions for userId ${user.id}`);
    } 
    // Group Admin, Cashier, and Secretary can see transactions for their group members
    else if ((user.role === 'Group Admin' || user.role === 'Cashier' || user.role === 'Secretary') && user.groupId) {
      const { User } = require('../models');
      const groupMembers = await User.findAll({
        where: {
          groupId: user.groupId,
          status: 'active'
        },
        attributes: ['id']
      });
      const memberIds = groupMembers.map(m => m.id);
      if (memberIds.length === 0) {
        return res.json({
          success: true,
          data: [],
          pagination: { total: 0, limit: 0, offset: 0, pages: 0 }
        });
      }
      whereClause.userId = { [Op.in]: memberIds };
      console.log(`[getTransactions] ${user.role} ${user.id} - filtering for group ${user.groupId} members: ${memberIds.length} members`);
    } 
    // If specific userId is requested (for admins viewing a member)
    else if (queryUserId && (user.role === 'Group Admin' || user.role === 'Cashier' || user.role === 'Secretary' || user.role === 'Agent' || user.role === 'System Admin')) {
      whereClause.userId = parseInt(queryUserId);
      console.log(`[getTransactions] ${user.role} ${user.id} - viewing transactions for userId ${queryUserId}`);
    }
    // System Admin and Agent can see ALL transactions when no specific filters are provided
    else if (user.role === 'System Admin' || user.role === 'Agent') {
      // Don't set userId filter - allow all transactions
      console.log(`[getTransactions] ${user.role} ${user.id} - viewing ALL transactions (no userId filter)`);
    }
    // Default: user's own transactions
    else {
      whereClause.userId = user.id;
      console.log(`[getTransactions] Default - filtering for userId ${user.id}`);
    }

    // If groupId is provided (for group-level queries)
    if (groupId && user.role !== 'Member') {
      const { User } = require('../models');
      const groupMembers = await User.findAll({
        where: {
          groupId: parseInt(groupId),
          status: 'active'
        },
        attributes: ['id']
      });
      const memberIds = groupMembers.map(m => m.id);
      if (memberIds.length > 0) {
        // Combine with existing userId filter
        if (whereClause.userId && typeof whereClause.userId === 'object' && whereClause.userId[Op.in]) {
          // Intersect the arrays
          whereClause.userId[Op.in] = whereClause.userId[Op.in].filter(id => memberIds.includes(id));
        } else if (whereClause.userId && !Array.isArray(whereClause.userId)) {
          // If single userId, check if they're in the group
          if (!memberIds.includes(whereClause.userId)) {
            return res.json({
              success: true,
              data: [],
              pagination: { total: 0, limit: 0, offset: 0, pages: 0 }
            });
          }
        } else {
          whereClause.userId = { [Op.in]: memberIds };
        }
      } else {
        return res.json({
          success: true,
          data: [],
          pagination: { total: 0, limit: 0, offset: 0, pages: 0 }
        });
      }
    }

    // Additional filters
    if (type && type !== 'all') {
      whereClause.type = type;
    }

    if (status && status !== 'all') {
      whereClause.status = status;
    }

    if (startDate || endDate) {
      whereClause.transactionDate = {};
      if (startDate) {
        whereClause.transactionDate[Op.gte] = new Date(startDate);
      }
      if (endDate) {
        const endDateObj = new Date(endDate);
        endDateObj.setHours(23, 59, 59, 999); // Include entire end date
        whereClause.transactionDate[Op.lte] = endDateObj;
      }
    }

    // Build query - if limit is not specified or is very high, get all records
    const queryOptions = {
      where: whereClause,
      include: [
        { association: 'user', attributes: ['id', 'name', 'phone'] }
      ],
      order: [['transactionDate', 'DESC'], ['createdAt', 'DESC']]
    };

    // Only apply limit if explicitly provided and reasonable
    if (limit && parseInt(limit) > 0 && parseInt(limit) < 100000) {
      queryOptions.limit = parseInt(limit);
      queryOptions.offset = parseInt(offset);
    }

    const { count, rows } = await Transaction.findAndCountAll(queryOptions);

    console.log(`[getTransactions] Query result: Found ${count} transactions matching criteria for user ${user.id} (role: ${user.role})`);
    
    // Log first few transaction userIds for verification
    if (rows.length > 0) {
      const transactionUserIds = rows.slice(0, 5).map(t => t.userId || t.user?.id);
      console.log(`[getTransactions] Sample transaction userIds: ${transactionUserIds.join(', ')}`);
    }

    res.json({
      success: true,
      data: rows,
      pagination: {
        total: count,
        limit: queryOptions.limit || count,
        offset: queryOptions.offset || 0,
        pages: queryOptions.limit ? Math.ceil(count / queryOptions.limit) : 1
      }
    });
  } catch (error) {
    console.error('[getTransactions] Error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch transactions',
      error: error.message
    });
  }
};

/**
 * Get transaction summary
 * GET /api/transactions/summary
 */
const getTransactionSummary = async (req, res) => {
  try {
    const userId = req.user.role === 'Member' ? req.user.id : req.query.userId || req.user.id;

    const transactions = await Transaction.findAll({
      where: { userId, status: 'completed' }
    });

    const summary = {
      totalIncome: 0,
      totalExpense: 0,
      byType: {},
      count: transactions.length
    };

    transactions.forEach(transaction => {
      const amount = parseFloat(transaction.amount);
      
      if (['contribution', 'refund'].includes(transaction.type)) {
        summary.totalIncome += amount;
      } else {
        summary.totalExpense += amount;
      }

      if (!summary.byType[transaction.type]) {
        summary.byType[transaction.type] = 0;
      }
      summary.byType[transaction.type] += amount;
    });

    res.json({
      success: true,
      data: summary
    });
  } catch (error) {
    console.error('Get transaction summary error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch transaction summary',
      error: error.message
    });
  }
};

/**
 * Get comprehensive transaction report
 * GET /api/transactions/report
 * Returns all transactions with full details for reporting
 */
const getTransactionReport = async (req, res) => {
  try {
    const { startDate, endDate, groupId, userId: queryUserId, type, status } = req.query;
    const user = req.user;
    
    let whereClause = {};

    // Role-based filtering
    if (user.role === 'Member') {
      whereClause.userId = user.id;
    } else if (queryUserId && (user.role === 'Group Admin' || user.role === 'Secretary' || user.role === 'Cashier' || user.role === 'System Admin')) {
      // If specific userId is requested (for admins viewing a member)
      const parsedUserId = parseInt(queryUserId);
      if (isNaN(parsedUserId)) {
        console.error('[getTransactionReport] Invalid userId provided:', queryUserId);
        return res.status(400).json({
          success: false,
          message: 'Invalid user ID provided',
          data: [],
          summary: {
            totalTransactions: 0,
            totalAmount: 0,
            byType: {},
            byStatus: { completed: 0, pending: 0 },
            byPaymentMethod: {}
          }
        });
      }
      whereClause.userId = parsedUserId;
      console.log(`[getTransactionReport] Filtering transactions for userId: ${parsedUserId} by ${user.role} (${user.id})`);
    } else if ((user.role === 'Group Admin' || user.role === 'Secretary' || user.role === 'Cashier') && user.groupId) {
      // Group Admin, Secretary, and Cashier can see their group's transactions
      const groupMembers = await User.findAll({
        where: {
          groupId: user.groupId,
          status: 'active'
        },
        attributes: ['id']
      });
      const memberIds = groupMembers.map(m => m.id);
      if (memberIds.length > 0) {
        whereClause.userId = { [Op.in]: memberIds };
      } else {
        return res.json({
          success: true,
          data: [],
          groupInfo: null,
          summary: {}
        });
      }
    }
    // System Admin can see all transactions (no filter) - no additional whereClause needed

    // Group filter
    if (groupId && user.role !== 'Member') {
      const groupMembers = await User.findAll({
        where: {
          groupId: parseInt(groupId),
          status: 'active'
        },
        attributes: ['id']
      });
      const memberIds = groupMembers.map(m => m.id);
      if (memberIds.length > 0) {
        if (whereClause.userId && typeof whereClause.userId === 'object' && whereClause.userId[Op.in]) {
          whereClause.userId[Op.in] = whereClause.userId[Op.in].filter(id => memberIds.includes(id));
        } else {
          whereClause.userId = { [Op.in]: memberIds };
        }
      } else {
        return res.json({
          success: true,
          data: [],
          groupInfo: null,
          summary: {}
        });
      }
    }

    // Additional filters
    if (type && type !== 'all') {
      whereClause.type = type;
    }

    if (status && status !== 'all') {
      whereClause.status = status;
    }

    // Date range filter
    if (startDate || endDate) {
      whereClause.transactionDate = {};
      if (startDate) {
        const startDateObj = new Date(startDate);
        if (!isNaN(startDateObj.getTime())) {
          startDateObj.setHours(0, 0, 0, 0);
          whereClause.transactionDate[Op.gte] = startDateObj;
        }
      }
      if (endDate) {
        const endDateObj = new Date(endDate);
        if (!isNaN(endDateObj.getTime())) {
          endDateObj.setHours(23, 59, 59, 999);
          whereClause.transactionDate[Op.lte] = endDateObj;
        }
      }
      // If date range filter is empty, remove it
      if (Object.keys(whereClause.transactionDate).length === 0) {
        delete whereClause.transactionDate;
      }
    }

    // Fetch transactions with user and group info
    const transactions = await Transaction.findAll({
      where: whereClause,
      include: [
        {
          association: 'user',
          attributes: ['id', 'name', 'phone', 'email'],
          include: [
            {
              association: 'group',
              attributes: ['id', 'name']
            }
          ]
        }
      ],
      order: [['transactionDate', 'DESC'], ['createdAt', 'DESC']]
    });

    // Get group information
    let groupInfo = null;
    if (user.groupId) {
      const { Group } = require('../models');
      groupInfo = await Group.findByPk(user.groupId, {
        attributes: ['id', 'name', 'code']
      });
    } else if (groupId) {
      const { Group } = require('../models');
      groupInfo = await Group.findByPk(parseInt(groupId), {
        attributes: ['id', 'name', 'code']
      });
    }

    // Get member information if queryUserId is provided (for individual member reports)
    let memberInfo = null;
    if (queryUserId) {
      const parsedUserId = parseInt(queryUserId);
      if (!isNaN(parsedUserId)) {
        const memberUser = await User.findByPk(parsedUserId, {
          attributes: ['id', 'name', 'phone', 'email', 'groupId'],
          include: [
            {
              association: 'group',
              attributes: ['id', 'name', 'code']
            }
          ]
        });
        if (memberUser) {
          memberInfo = {
            id: memberUser.id,
            name: memberUser.name,
            phone: memberUser.phone,
            email: memberUser.email,
            groupId: memberUser.groupId,
            group: memberUser.group ? {
              id: memberUser.group.id,
              name: memberUser.group.name,
              code: memberUser.group.code
            } : null
          };
          console.log(`[getTransactionReport] Found member info for userId ${parsedUserId}:`, {
            name: memberInfo.name,
            phone: memberInfo.phone,
            email: memberInfo.email
          });
        } else {
          console.warn(`[getTransactionReport] Member with userId ${parsedUserId} not found in database`);
        }
      }
    }

    // Format transactions for report
    const reportData = transactions.map(t => ({
      transactionId: t.id,
      memberName: t.user?.name || 'Unknown',
      memberId: t.userId,
      transactionType: formatTransactionType(t.type),
      amount: parseFloat(t.amount || 0),
      date: t.transactionDate ? new Date(t.transactionDate).toISOString().split('T')[0] : (t.createdAt ? new Date(t.createdAt).toISOString().split('T')[0] : ''),
      transactionDate: t.transactionDate || t.createdAt, // Include full date object for time formatting
      paymentMethod: formatPaymentMethod(t.paymentMethod),
      status: t.status || 'completed',
      description: t.description || `${formatTransactionType(t.type)} - ${t.referenceId || ''}`,
      referenceId: t.referenceId,
      referenceType: t.referenceType,
      rawType: t.type
    }));

    // Calculate summary based ONLY on actual transactions returned from database
    const summary = {
      totalTransactions: reportData.length,
      totalAmount: reportData.reduce((sum, t) => sum + Math.abs(t.amount), 0),
      byType: {},
      byStatus: {},
      byPaymentMethod: {}
    };
    
    console.log(`[getTransactionReport] Summary calculated:`, {
      totalTransactions: summary.totalTransactions,
      totalAmount: summary.totalAmount,
      userId: queryUserId || 'all',
      role: user.role
    });

    reportData.forEach(t => {
      // Count by type
      if (!summary.byType[t.rawType]) {
        summary.byType[t.rawType] = { count: 0, totalAmount: 0 };
      }
      summary.byType[t.rawType].count++;
      summary.byType[t.rawType].totalAmount += Math.abs(t.amount);

      // Count by status
      if (!summary.byStatus[t.status]) {
        summary.byStatus[t.status] = 0;
      }
      summary.byStatus[t.status]++;

      // Count by payment method
      if (!summary.byPaymentMethod[t.paymentMethod]) {
        summary.byPaymentMethod[t.paymentMethod] = 0;
      }
      summary.byPaymentMethod[t.paymentMethod]++;
    });

    res.json({
      success: true,
      data: reportData,
      groupInfo: groupInfo ? {
        id: groupInfo.id,
        name: groupInfo.name,
        code: groupInfo.code
      } : null,
      memberInfo: memberInfo, // Include member info from database
      summary,
      dateRange: {
        startDate: startDate || null,
        endDate: endDate || null
      }
    });
  } catch (error) {
    console.error('[getTransactionReport] Error:', error);
    console.error('[getTransactionReport] Error stack:', error.stack);
    res.status(500).json({
      success: false,
      message: 'Failed to generate transaction report',
      error: process.env.NODE_ENV === 'development' ? error.message : 'An error occurred while generating the report'
    });
  }
};

/**
 * Helper function to format transaction type
 */
const formatTransactionType = (type) => {
  const typeMap = {
    'contribution': 'Contribution',
    'loan_payment': 'Loan Payment',
    'loan_disbursement': 'Loan Request',
    'fine_payment': 'Fine Payment',
    'interest': 'Interest',
    'refund': 'Refund',
    'fee': 'Fee'
  };
  return typeMap[type] || type.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
};

/**
 * Helper function to format payment method
 */
const formatPaymentMethod = (method) => {
  if (!method) return 'N/A';
  const methodMap = {
    'cash': 'Cash',
    'mtn_mobile_money': 'MTN Mobile Money',
    'airtel_money': 'Airtel Money',
    'bank_transfer': 'Bank Transfer'
  };
  return methodMap[method] || method.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
};

/**
 * Get total transactions count
 * GET /api/transactions/count
 * For System Admin and Agent: returns count of ALL transactions
 * For others: returns count of their accessible transactions
 */
const getTransactionsCount = async (req, res) => {
  try {
    const user = req.user;
    let whereClause = {};

    // STRICT userId filtering - Members can ONLY see their own transactions
    if (user.role === 'Member') {
      whereClause.userId = user.id;
    } 
    // Group Admin, Cashier, and Secretary can see transactions for their group members
    else if ((user.role === 'Group Admin' || user.role === 'Cashier' || user.role === 'Secretary') && user.groupId) {
      const { User } = require('../models');
      const groupMembers = await User.findAll({
        where: {
          groupId: user.groupId,
          status: 'active'
        },
        attributes: ['id']
      });
      const memberIds = groupMembers.map(m => m.id);
      if (memberIds.length === 0) {
        return res.json({ success: true, data: { count: 0 } });
      }
      whereClause.userId = { [Op.in]: memberIds };
    }
    // System Admin and Agent can see ALL transactions
    else if (user.role === 'System Admin' || user.role === 'Agent') {
      // Don't set userId filter - count all transactions
    }
    // Default: user's own transactions
    else {
      whereClause.userId = user.id;
    }

    const count = await Transaction.count({ where: whereClause });
    
    return res.json({ success: true, data: { count } });
  } catch (error) {
    console.error('[getTransactionsCount] Error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to count transactions',
      error: error.message
    });
  }
};

module.exports = {
  getTransactions,
  getTransactionSummary,
  getTransactionReport,
  getTransactionsCount
};



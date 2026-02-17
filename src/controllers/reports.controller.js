const { User, Transaction, Loan, Contribution, Branch, Group } = require('../models');
const { Op } = require('sequelize');

// Ensure models are properly loaded
if (!User || !Group || !Branch) {
  console.error('[reports.controller] Models not properly loaded');
}

/**
 * Get User Report Data
 * GET /api/reports/users
 */
const getUserReport = async (req, res) => {
  try {
    console.log('[getUserReport] Request received');
    const { startDate, endDate, role, status } = req.query;
    
    let whereClause = {};
    
    // Date filter (if user creation date is needed)
    if (startDate || endDate) {
      whereClause.createdAt = {};
      if (startDate) {
        whereClause.createdAt[Op.gte] = new Date(startDate);
      }
      if (endDate) {
        whereClause.createdAt[Op.lte] = new Date(endDate);
      }
    }
    
    if (role) {
      whereClause.role = role;
    }
    
    if (status) {
      whereClause.status = status;
    }
    
    console.log('[getUserReport] Fetching users with whereClause:', JSON.stringify(whereClause));
    
    const users = await User.findAll({
      where: whereClause,
      include: [
        { model: Group, as: 'group', attributes: ['id', 'name'], required: false },
        { model: Branch, as: 'branch', attributes: ['id', 'name'], required: false }
      ],
      order: [['createdAt', 'DESC']]
    });
    
    console.log(`[getUserReport] Found ${users.length} users`);
    
    // Format data for export
    const exportData = users.map(user => ({
      'ID': user.id,
      'Name': user.name || 'N/A',
      'Email': user.email || 'N/A',
      'Phone': user.phone || 'N/A',
      'Role': user.role || 'N/A',
      'Status': user.status || 'N/A',
      'Group': user.group?.name || 'N/A',
      'Branch': user.branch?.name || 'N/A',
      'Created At': user.createdAt ? new Date(user.createdAt).toLocaleString() : 'N/A',
      'Last Login': user.lastLogin ? new Date(user.lastLogin).toLocaleString() : 'Never'
    }));
    
    console.log('[getUserReport] Formatting export data');
    const response = {
      success: true,
      data: exportData,
      summary: {
        totalUsers: users.length,
        byRole: users.reduce((acc, user) => {
          acc[user.role] = (acc[user.role] || 0) + 1;
          return acc;
        }, {}),
        byStatus: users.reduce((acc, user) => {
          acc[user.status] = (acc[user.status] || 0) + 1;
          return acc;
        }, {})
      }
    };
    
    console.log('[getUserReport] Sending response with', exportData.length, 'users');
    res.json(response);
  } catch (error) {
    console.error('[getUserReport] Error:', error);
    console.error('[getUserReport] Error stack:', error.stack);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to generate user report', 
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
};

/**
 * Get Financial Report Data
 * GET /api/reports/financial
 */
const getFinancialReport = async (req, res) => {
  try {
    console.log('[getFinancialReport] Request received');
    const { startDate, endDate, groupId } = req.query;
    
    let transactionWhere = {};
    let contributionWhere = {};
    let loanWhere = {};
    
    if (startDate || endDate) {
      const dateFilter = {};
      if (startDate) dateFilter[Op.gte] = new Date(startDate);
      if (endDate) dateFilter[Op.lte] = new Date(endDate);
      
      transactionWhere.transactionDate = dateFilter;
      contributionWhere.contributionDate = dateFilter;
      loanWhere.createdAt = dateFilter;
    }
    
    // Get transactions
    const transactions = await Transaction.findAll({
      where: transactionWhere,
      include: [
        { 
          model: User, 
          as: 'user', 
          attributes: ['id', 'name', 'email'],
          required: false,
          include: [
            { model: Group, as: 'group', attributes: ['id', 'name'], required: false }
          ]
        }
      ],
      order: [['transactionDate', 'DESC']]
    });
    
    // Get contributions
    const contributions = await Contribution.findAll({
      where: contributionWhere,
      include: [
        { model: User, as: 'member', attributes: ['id', 'name', 'email'], required: false },
        { model: Group, as: 'group', attributes: ['id', 'name'], required: false }
      ],
      order: [['contributionDate', 'DESC']]
    });
    
    // Get loans
    const loans = await Loan.findAll({
      where: loanWhere,
      include: [
        { model: User, as: 'member', attributes: ['id', 'name', 'email'], required: false },
        { model: Group, as: 'group', attributes: ['id', 'name'], required: false }
      ],
      order: [['createdAt', 'DESC']]
    });
    
    // Calculate totals
    const totalSavings = contributions.reduce((sum, c) => sum + parseFloat(c.amount || 0), 0);
    const totalLoans = loans.reduce((sum, l) => sum + parseFloat(l.amount || 0), 0);
    const totalLoanPayments = transactions
      .filter(t => t.type === 'loan_payment')
      .reduce((sum, t) => sum + parseFloat(t.amount || 0), 0);
    const totalTransactions = transactions.reduce((sum, t) => sum + parseFloat(t.amount || 0), 0);
    
    // Format transaction data
    const transactionData = transactions.map(t => ({
      'ID': t.id,
      'Date': t.transactionDate ? new Date(t.transactionDate).toLocaleDateString() : 'N/A',
      'Type': t.type || 'N/A',
      'Amount': parseFloat(t.amount || 0).toFixed(2),
      'Status': t.status || 'N/A',
      'User': t.user?.name || 'N/A',
      'Group': t.user?.group?.name || 'N/A',
      'Payment Method': t.paymentMethod || 'N/A',
      'Description': t.description || 'N/A'
    }));
    
    // Format contribution data
    const contributionData = contributions.map(c => ({
      'ID': c.id,
      'Date': c.contributionDate ? new Date(c.contributionDate).toLocaleDateString() : 'N/A',
      'Amount': parseFloat(c.amount || 0).toFixed(2),
      'User': c.member?.name || 'N/A',
      'Group': c.group?.name || 'N/A',
      'Type': c.type || 'N/A'
    }));
    
    // Format loan data
    const loanData = loans.map(l => ({
      'ID': l.id,
      'Date': l.createdAt ? new Date(l.createdAt).toLocaleDateString() : 'N/A',
      'Amount': parseFloat(l.amount || 0).toFixed(2),
      'Status': l.status || 'N/A',
      'Interest Rate': l.interestRate ? `${l.interestRate}%` : 'N/A',
      'User': l.member?.name || 'N/A',
      'Group': l.group?.name || 'N/A',
      'Due Date': l.dueDate ? new Date(l.dueDate).toLocaleDateString() : 'N/A'
    }));
    
    res.json({
      success: true,
      data: {
        transactions: transactionData,
        contributions: contributionData,
        loans: loanData
      },
      summary: {
        totalSavings: totalSavings.toFixed(2),
        totalLoans: totalLoans.toFixed(2),
        totalLoanPayments: totalLoanPayments.toFixed(2),
        totalTransactions: totalTransactions.toFixed(2),
        transactionCount: transactions.length,
        contributionCount: contributions.length,
        loanCount: loans.length
      }
    });
  } catch (error) {
    console.error('[getFinancialReport] Error:', error);
    console.error('[getFinancialReport] Error stack:', error.stack);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to generate financial report', 
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
};

/**
 * Get Branch Report Data
 * GET /api/reports/branches
 */
const getBranchReport = async (req, res) => {
  try {
    console.log('[getBranchReport] Request received');
    const branches = await Branch.findAll({
      include: [
        { model: User, as: 'manager', attributes: ['id', 'name', 'email'], required: false }
      ],
      order: [['createdAt', 'DESC']]
    });
    
    console.log(`[getBranchReport] Found ${branches.length} branches`);
    
    // Get statistics for each branch
    const branchData = await Promise.all(branches.map(async (branch) => {
      // Count users in this branch
      const userCount = await User.count({
        where: { branchId: branch.id }
      });
      
      // Count transactions
      const transactionCount = await Transaction.count({
        include: [
          {
            model: User,
            as: 'user',
            where: { branchId: branch.id },
            required: true
          }
        ]
      });
      
      // Get total savings from contributions
      const contributions = await Contribution.findAll({
        include: [
          {
            model: User,
            as: 'user',
            where: { branchId: branch.id },
            required: true
          }
        ]
      });
      
      const totalSavings = contributions.reduce((sum, c) => sum + parseFloat(c.amount || 0), 0);
      
      return {
        'ID': branch.id,
        'Name': branch.name || 'N/A',
        'Code': branch.code || 'N/A',
        'Address': branch.address || 'N/A',
        'Phone': branch.phone || 'N/A',
        'Email': branch.email || 'N/A',
        'Manager': branch.manager?.name || 'N/A',
        'Users': userCount,
        'Transactions': transactionCount,
        'Total Savings': totalSavings.toFixed(2),
        'Created At': branch.createdAt ? new Date(branch.createdAt).toLocaleString() : 'N/A'
      };
    }));
    
    res.json({
      success: true,
      data: branchData,
      summary: {
        totalBranches: branches.length,
        totalUsers: branchData.reduce((sum, b) => sum + (b.Users || 0), 0),
        totalTransactions: branchData.reduce((sum, b) => sum + (b.Transactions || 0), 0)
      }
    });
  } catch (error) {
    console.error('[getBranchReport] Error:', error);
    console.error('[getBranchReport] Error stack:', error.stack);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to generate branch report', 
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
};

/**
 * Get Analytics Report Data
 * GET /api/reports/analytics
 */
const getAnalyticsReport = async (req, res) => {
  try {
    console.log('[getAnalyticsReport] Request received with period:', req.query.period);
    const { period = 'monthly' } = req.query;
    
    // Calculate date range
    const now = new Date();
    let startDate = new Date();
    
    switch (period) {
      case 'daily':
        startDate.setDate(now.getDate() - 1);
        break;
      case 'weekly':
        startDate.setDate(now.getDate() - 7);
        break;
      case 'monthly':
        startDate.setMonth(now.getMonth() - 1);
        break;
      case 'quarterly':
        startDate.setMonth(now.getMonth() - 3);
        break;
      case 'yearly':
        startDate.setFullYear(now.getFullYear() - 1);
        break;
    }
    
    // Get all data
    const users = await User.findAll({
      where: {
        createdAt: {
          [Op.gte]: startDate
        }
      }
    });
    
    const transactions = await Transaction.findAll({
      where: {
        transactionDate: {
          [Op.between]: [startDate, now]
        }
      },
      include: [
        { 
          model: User, 
          as: 'user', 
          attributes: ['id', 'name'], 
          required: false,
          include: [
            { model: Group, as: 'group', attributes: ['id', 'name'], required: false }
          ]
        }
      ]
    });
    
    const loans = await Loan.findAll({
      where: {
        createdAt: {
          [Op.gte]: startDate
        }
      },
      include: [
        { model: User, as: 'member', attributes: ['id', 'name'], required: false },
        { model: Group, as: 'group', attributes: ['id', 'name'], required: false }
      ]
    });
    
    const contributions = await Contribution.findAll({
      where: {
        contributionDate: {
          [Op.between]: [startDate, now]
        }
      },
      include: [
        { model: User, as: 'member', attributes: ['id', 'name'], required: false },
        { model: Group, as: 'group', attributes: ['id', 'name'], required: false }
      ]
    });
    
    // Format analytics data
    const analyticsData = {
      'Period': period,
      'Start Date': startDate.toLocaleDateString(),
      'End Date': now.toLocaleDateString(),
      'Total Users': users.length,
      'Total Transactions': transactions.length,
      'Total Transaction Amount': transactions.reduce((sum, t) => sum + parseFloat(t.amount || 0), 0).toFixed(2),
      'Total Loans': loans.length,
      'Total Loan Amount': loans.reduce((sum, l) => sum + parseFloat(l.amount || 0), 0).toFixed(2),
      'Total Contributions': contributions.length,
      'Total Contribution Amount': contributions.reduce((sum, c) => sum + parseFloat(c.amount || 0), 0).toFixed(2)
    };
    
    // Transaction breakdown by type
    const transactionByType = transactions.reduce((acc, t) => {
      const type = t.type || 'Other';
      if (!acc[type]) {
        acc[type] = { count: 0, total: 0 };
      }
      acc[type].count++;
      acc[type].total += parseFloat(t.amount || 0);
      return acc;
    }, {});
    
    // Loan breakdown by status
    const loanByStatus = loans.reduce((acc, l) => {
      const status = l.status || 'Unknown';
      acc[status] = (acc[status] || 0) + 1;
      return acc;
    }, {});
    
    res.json({
      success: true,
      data: analyticsData,
      breakdowns: {
        transactionByType,
        loanByStatus
      }
    });
  } catch (error) {
    console.error('[getAnalyticsReport] Error:', error);
    console.error('[getAnalyticsReport] Error stack:', error.stack);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to generate analytics report', 
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
};

module.exports = {
  getUserReport,
  getFinancialReport,
  getBranchReport,
  getAnalyticsReport
};


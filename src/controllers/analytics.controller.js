const { Transaction, User, Loan, Contribution, Group, Branch } = require('../models');
const { Op } = require('sequelize');
const { calculateCreditScore, getAIRecommendation } = require('../utils/creditScoreCalculator');

/**
 * Get analytics data with period filtering
 * GET /api/analytics
 * Query params: period (daily, weekly, monthly, quarterly, yearly)
 */
const getAnalytics = async (req, res) => {
  try {
    const { period = 'monthly' } = req.query;
    
    // Calculate date range based on period
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
      default:
        startDate.setMonth(now.getMonth() - 1);
    }

    // Get previous period for comparison
    const periodDiff = now.getTime() - startDate.getTime();
    const previousStartDate = new Date(startDate.getTime() - periodDiff);
    const previousEndDate = new Date(startDate);

    // Fetch transactions
    const transactions = await Transaction.findAll({
      where: {
        transactionDate: {
          [Op.between]: [startDate, now]
        }
      },
      include: [
        { model: User, as: 'user', attributes: ['id', 'name', 'role'], required: false }
      ]
    });

    const previousTransactions = await Transaction.findAll({
      where: {
        transactionDate: {
          [Op.between]: [previousStartDate, previousEndDate]
        }
      }
    });
    
    console.log('[getAnalytics] Transactions found:', transactions.length);
    console.log('[getAnalytics] Previous transactions found:', previousTransactions.length);

    // Calculate transaction metrics
    const transactionVolume = transactions.reduce((sum, t) => sum + parseFloat(t.amount || 0), 0);
    const previousVolume = previousTransactions.reduce((sum, t) => sum + parseFloat(t.amount || 0), 0);
    const volumeGrowth = previousVolume > 0 ? ((transactionVolume - previousVolume) / previousVolume * 100) : 0;

    // Group transactions by time period for chart - use transactionDate or createdAt
    const transactionTrends = groupByPeriod(transactions, period, 'transactionDate', 'amount');

    // Fetch users - count all users regardless of role
    console.log('[getAnalytics] Fetching users...');
    
    let totalUsers = 0;
    try {
      // Try count first
      totalUsers = await User.count();
      console.log('[getAnalytics] Total users (from count):', totalUsers);
      
      // If count returns 0, try findAll to verify
      if (totalUsers === 0) {
        const allUsers = await User.findAll({ 
          attributes: ['id'],
          limit: 1000 // Limit to avoid memory issues
        });
        totalUsers = allUsers.length;
        console.log('[getAnalytics] Total users (from findAll):', totalUsers);
      }
    } catch (userError) {
      console.error('[getAnalytics] Error fetching users:', userError);
      // Try to get at least some users
      try {
        const someUsers = await User.findAll({ attributes: ['id'], limit: 100 });
        totalUsers = someUsers.length;
        console.log('[getAnalytics] Fallback: Found', totalUsers, 'users');
      } catch (fallbackError) {
        console.error('[getAnalytics] Fallback also failed:', fallbackError);
        totalUsers = 0;
      }
    }
    
    const finalUserCount = totalUsers;
    
    const newUsers = await User.count({
      where: {
        createdAt: {
          [Op.between]: [startDate, now]
        }
      }
    });
    console.log('[getAnalytics] New users in period:', newUsers);
    
    const previousNewUsers = await User.count({
      where: {
        createdAt: {
          [Op.between]: [previousStartDate, previousEndDate]
        }
      }
    });
    console.log('[getAnalytics] Previous period new users:', previousNewUsers);
    
    const userGrowth = previousNewUsers > 0 ? ((newUsers - previousNewUsers) / previousNewUsers * 100) : (newUsers > 0 ? 100 : 0);

    // User growth chart data
    const userGrowthData = await getUserGrowthData(period);

    // Fetch loans
    const totalLoans = await Loan.count();
    const activeLoans = await Loan.count({
      where: {
        status: {
          [Op.in]: ['approved', 'disbursed', 'active']
        }
      }
    });
    const overdueLoans = await Loan.count({
      where: {
        status: 'overdue'
      }
    });
    const defaultRate = totalLoans > 0 ? (overdueLoans / totalLoans * 100) : 0;

    // Fetch branches
    const totalBranches = await Branch.count();
    const activeBranches = await Branch.count({
      where: {
        status: 'active'
      }
    });

    // Calculate branch performance (based on transactions per branch)
    const branchPerformance = totalBranches > 0 ? (transactions.length / totalBranches) : 0;

    // Get AI insights based on credit scoring
    const aiInsights = await getAIInsights();

    // Geographic data (by branch) - filtered by period
    const geographicData = await getGeographicData(period, startDate, now);

    // Performance metrics
    const performanceMetrics = await getPerformanceMetrics(period);

    const responseData = {
      success: true,
      data: {
        summary: {
          users: {
            total: finalUserCount || 0,
            active: finalUserCount || 0,
            newThisPeriod: newUsers || 0,
            growth: userGrowth.toFixed(1)
          },
          transactions: {
            total: transactions.length || 0,
            volume: transactionVolume || 0,
            volumeFormatted: formatCurrency(transactionVolume || 0),
            averageValue: transactions.length > 0 ? transactionVolume / transactions.length : 0,
            growth: volumeGrowth.toFixed(1)
          },
          loans: {
            total: totalLoans || 0,
            active: activeLoans || 0,
            overdue: overdueLoans || 0,
            defaultRate: defaultRate.toFixed(1)
          },
          branches: {
            total: totalBranches || 0,
            active: activeBranches || 0,
            performance: branchPerformance.toFixed(1)
          }
        },
        charts: {
          transactionTrends: transactionTrends || [],
          userGrowth: userGrowthData || []
        },
        aiInsights: aiInsights || [],
        geographic: geographicData || [],
        performance: performanceMetrics || []
      }
    };
    
    console.log('[getAnalytics] Response data summary:', JSON.stringify({
      totalUsers: responseData.data.summary.users.total,
      totalTransactions: responseData.data.summary.transactions.total,
      totalLoans: responseData.data.summary.loans.total
    }));
    
    res.json(responseData);
  } catch (error) {
    console.error('[getAnalytics] Error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch analytics',
      error: error.message
    });
  }
};

/**
 * Group transactions by period for charting
 */
function groupByPeriod(data, period, dateField, valueField) {
  const grouped = {};

  data.forEach(item => {
    // Try transactionDate first, then date, then createdAt
    const date = item[dateField] || item.date || item.createdAt;
    if (!date) return; // Skip if no date found
    
    const key = formatDateForPeriod(date, period);
    if (!grouped[key]) {
      grouped[key] = { period: key, value: 0, count: 0 };
    }
    const value = parseFloat(item[valueField] || item.amount || 0);
    grouped[key].value += value;
    grouped[key].count += 1;
  });

  // Convert to array and sort
  const result = Object.values(grouped);
  // Try to sort by date if possible, otherwise keep original order
  try {
    return result.sort((a, b) => {
      // For periods that can be parsed as dates
      const dateA = new Date(a.period);
      const dateB = new Date(b.period);
      if (!isNaN(dateA.getTime()) && !isNaN(dateB.getTime())) {
        return dateA - dateB;
      }
      // Otherwise sort alphabetically
      return a.period.localeCompare(b.period);
    });
  } catch {
    return result;
  }
}

/**
 * Format date for period grouping
 */
function formatDateForPeriod(date, period) {
  const d = new Date(date);
  switch (period) {
    case 'daily':
      return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    case 'weekly':
      const weekNum = Math.ceil(d.getDate() / 7);
      return `${d.toLocaleDateString('en-US', { month: 'short' })} Week ${weekNum}`;
    case 'monthly':
      return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
    case 'quarterly':
      const quarter = Math.floor(d.getMonth() / 3) + 1;
      return `Q${quarter} ${d.getFullYear()}`;
    case 'yearly':
      return d.getFullYear().toString();
    default:
      return d.toLocaleDateString('en-US', { month: 'short' });
  }
}

/**
 * Get user growth data for chart
 */
async function getUserGrowthData(period) {
  const now = new Date();
  let startDate = new Date();
  
  switch (period) {
    case 'daily':
      startDate.setDate(now.getDate() - 30); // Last 30 days
      break;
    case 'weekly':
      startDate.setDate(now.getDate() - 84); // Last 12 weeks
      break;
    case 'monthly':
      startDate.setMonth(now.getMonth() - 12); // Last 12 months
      break;
    case 'quarterly':
      startDate.setFullYear(now.getFullYear() - 2); // Last 8 quarters
      break;
    case 'yearly':
      startDate.setFullYear(now.getFullYear() - 5); // Last 5 years
      break;
    default:
      startDate.setMonth(now.getMonth() - 12);
  }

  const users = await User.findAll({
    where: {
      createdAt: {
        [Op.between]: [startDate, now]
      }
    },
    attributes: ['id', 'createdAt']
  });

  const grouped = {};
  users.forEach(user => {
    const date = user.createdAt;
    const key = formatDateForPeriod(date, period);
    if (!grouped[key]) {
      grouped[key] = { period: key, count: 0 };
    }
    grouped[key].count += 1;
  });
  
  return Object.values(grouped).sort((a, b) => {
    try {
      const dateA = new Date(a.period);
      const dateB = new Date(b.period);
      if (!isNaN(dateA.getTime()) && !isNaN(dateB.getTime())) {
        return dateA - dateB;
      }
      return a.period.localeCompare(b.period);
    } catch {
      return 0;
    }
  });
}

/**
 * Get AI insights based on credit scoring
 */
async function getAIInsights() {
  try {
    const members = await User.findAll({
      where: { role: 'Member' },
      limit: 100 // Sample for insights
    });

    const insights = [];
    let highRiskCount = 0;
    let mediumRiskCount = 0;
    let lowRiskCount = 0;
    let totalScore = 0;

    for (const member of members) {
      try {
        const score = await calculateCreditScore(member.id);
        totalScore += score;
        
        if (score >= 800) lowRiskCount++;
        else if (score >= 500) mediumRiskCount++;
        else highRiskCount++;
      } catch (error) {
        console.error(`Error calculating score for user ${member.id}:`, error);
      }
    }

    const avgScore = members.length > 0 ? totalScore / members.length : 0;

    // Generate insights
    if (avgScore >= 700) {
      insights.push({
        type: 'success',
        title: 'Excellent Credit Health',
        description: `Average credit score is ${avgScore.toFixed(0)}, indicating strong financial health across members.`,
        action: 'Continue monitoring'
      });
    } else if (avgScore >= 500) {
      insights.push({
        type: 'warning',
        title: 'Moderate Credit Risk',
        description: `Average credit score is ${avgScore.toFixed(0)}. ${highRiskCount} members need attention.`,
        action: 'Review high-risk members'
      });
    } else {
      insights.push({
        type: 'error',
        title: 'High Credit Risk Detected',
        description: `Average credit score is ${avgScore.toFixed(0)}. Immediate action required for ${highRiskCount} members.`,
        action: 'Take corrective action'
      });
    }

    if (highRiskCount > 0) {
      insights.push({
        type: 'warning',
        title: 'High-Risk Members',
        description: `${highRiskCount} members have credit scores below 500. Consider financial counseling.`,
        action: 'Review member profiles'
      });
    }

    return insights;
  } catch (error) {
    console.error('[getAIInsights] Error:', error);
    return [];
  }
}

/**
 * Get geographic distribution data with real statistics
 * @param {string} period - Period filter (daily, weekly, monthly, quarterly, yearly)
 * @param {Date} startDate - Start date for filtering
 * @param {Date} endDate - End date for filtering
 */
async function getGeographicData(period = 'monthly', startDate = null, endDate = null) {
  try {
    console.log('[getGeographicData] Fetching branches for period:', period);
    
    // If no dates provided, calculate based on period
    let filterStartDate = startDate;
    let filterEndDate = endDate;
    
    if (!filterStartDate || !filterEndDate) {
      const now = new Date();
      filterStartDate = new Date();
      switch (period) {
        case 'daily':
          filterStartDate.setDate(now.getDate() - 1);
          break;
        case 'weekly':
          filterStartDate.setDate(now.getDate() - 7);
          break;
        case 'monthly':
          filterStartDate.setMonth(now.getMonth() - 1);
          break;
        case 'quarterly':
          filterStartDate.setMonth(now.getMonth() - 3);
          break;
        case 'yearly':
          filterStartDate.setFullYear(now.getFullYear() - 1);
          break;
        default:
          filterStartDate.setMonth(now.getMonth() - 1);
      }
      filterEndDate = now;
    }
    
    const branches = await Branch.findAll({
      include: [
        {
          model: Group,
          as: 'groups',
          required: false,
          include: [
            {
              model: User,
              as: 'members',
              where: { role: 'Member' },
              required: false,
              attributes: ['id', 'totalSavings']
            }
          ]
        },
        {
          model: User,
          as: 'users',
          required: false,
          attributes: ['id']
        }
      ]
    });

    console.log('[getGeographicData] Found', branches.length, 'branches');

    const geographicData = [];
    let totalSystemUsers = 0;
    let totalSystemTransactions = 0;
    let totalSystemSavings = 0;

    // First pass: calculate totals
    for (const branch of branches) {
      const branchUsers = branch.users?.length || 0;
      const branchMembers = branch.groups?.reduce((sum, group) => sum + (group.members?.length || 0), 0) || 0;
      totalSystemUsers += branchUsers + branchMembers;
    }

    // Get total transactions and savings
    const allTransactions = await Transaction.count();
    const allUsers = await User.findAll({
      where: { role: 'Member' },
      attributes: ['totalSavings']
    });
    totalSystemTransactions = allTransactions;
    totalSystemSavings = allUsers.reduce((sum, user) => sum + parseFloat(user.totalSavings || 0), 0);

    // Second pass: calculate branch-specific data
    for (const branch of branches) {
      const branchUsers = branch.users?.length || 0;
      const branchMembers = branch.groups?.reduce((sum, group) => sum + (group.members?.length || 0), 0) || 0;
      const totalBranchUsers = branchUsers + branchMembers;

      // Get transactions for this branch's users
      const branchUserIds = [
        ...(branch.users?.map(u => u.id) || []),
        ...(branch.groups?.flatMap(g => g.members?.map(m => m.id) || []) || [])
      ];

      let branchTransactions = 0;
      let branchSavings = 0;

      if (branchUserIds.length > 0) {
        // Filter transactions by period
        branchTransactions = await Transaction.count({
          where: {
            userId: { [Op.in]: branchUserIds },
            transactionDate: {
              [Op.between]: [filterStartDate, filterEndDate]
            }
          }
        });

        // Get savings from transactions in this period (contributions)
        const branchContributions = await Transaction.sum('amount', {
          where: {
            userId: { [Op.in]: branchUserIds },
            type: 'contribution',
            status: 'completed',
            transactionDate: {
              [Op.between]: [filterStartDate, filterEndDate]
            }
          }
        });
        
        branchSavings = parseFloat(branchContributions || 0);
        
        // Also include total savings from members if period is 'yearly' or 'all'
        if (period === 'yearly' || period === 'all') {
          const branchMembersData = branch.groups?.flatMap(g => g.members || []) || [];
          const totalMemberSavings = branchMembersData.reduce((sum, member) => {
            return sum + parseFloat(member.totalSavings || 0);
          }, 0);
          branchSavings = Math.max(branchSavings, totalMemberSavings);
        }
      }

      // Calculate market share
      const marketShare = totalSystemUsers > 0 ? (totalBranchUsers / totalSystemUsers * 100) : 0;

      // Get coordinates from address (default to Kigali, Rwanda if no address)
      const coordinates = getCoordinatesFromAddress(branch.address, branch.district, branch.sector);

      geographicData.push({
        id: branch.id,
        region: branch.name || 'Unknown',
        address: branch.address || '',
        district: branch.district || '',
        sector: branch.sector || '',
        users: totalBranchUsers,
        transactions: branchTransactions,
        savings: branchSavings,
        savingsFormatted: formatCurrency(branchSavings),
        marketShare: marketShare.toFixed(1),
        latitude: coordinates.latitude,
        longitude: coordinates.longitude,
        status: branch.status || 'active'
      });
    }

    console.log('[getGeographicData] Returning', geographicData.length, 'branches');
    return geographicData;
  } catch (error) {
    console.error('[getGeographicData] Error:', error);
    return [];
  }
}

/**
 * Get coordinates from address (simple geocoding for Rwanda)
 * In production, you'd use Google Geocoding API
 */
function getCoordinatesFromAddress(address, district, sector) {
  // Default to Kigali, Rwanda center
  let latitude = -1.9441;
  let longitude = 30.0619;

  // Simple mapping for common districts in Rwanda
  const districtCoordinates = {
    'Kigali': { lat: -1.9441, lng: 30.0619 },
    'Gasabo': { lat: -1.9441, lng: 30.0619 },
    'Nyarugenge': { lat: -1.9486, lng: 30.0556 },
    'Kicukiro': { lat: -1.9369, lng: 30.0619 },
    'Rwamagana': { lat: -1.9486, lng: 30.4347 },
    'Musanze': { lat: -1.5000, lng: 29.6333 },
    'Huye': { lat: -2.6000, lng: 29.7500 },
    'Rubavu': { lat: -1.6833, lng: 29.3500 },
    'Nyagatare': { lat: -1.3000, lng: 30.3167 },
    'Karongi': { lat: -2.0167, lng: 29.3500 }
  };

  if (district) {
    const districtName = district.split(' ')[0]; // Get first word
    for (const [key, coords] of Object.entries(districtCoordinates)) {
      if (districtName.toLowerCase().includes(key.toLowerCase()) || key.toLowerCase().includes(districtName.toLowerCase())) {
        latitude = coords.lat;
        longitude = coords.lng;
        break;
      }
    }
  }

  // Add small random offset for branches in same district
  if (address) {
    const hash = address.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
    latitude += (hash % 10) * 0.01;
    longitude += (hash % 10) * 0.01;
  }

  return { latitude, longitude };
}

/**
 * Get performance metrics
 */
async function getPerformanceMetrics(period) {
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
    default:
      startDate.setMonth(now.getMonth() - 1);
  }

  // Get previous period for comparison
  const periodDiff = now.getTime() - startDate.getTime();
  const previousStartDate = new Date(startDate.getTime() - periodDiff);
  const previousEndDate = new Date(startDate);

  // Transaction completion rate
  const completedTransactions = await Transaction.count({
    where: {
      transactionDate: {
        [Op.between]: [startDate, now]
      },
      status: 'completed'
    }
  });

  const totalTransactions = await Transaction.count({
    where: {
      transactionDate: {
        [Op.between]: [startDate, now]
      }
    }
  });

  const completionRate = totalTransactions > 0 ? (completedTransactions / totalTransactions * 100) : 0;

  // User growth rate
  const newUsers = await User.count({
    where: {
      createdAt: {
        [Op.between]: [startDate, now]
      }
    }
  });

  const previousUsers = await User.count({
    where: {
      createdAt: {
        [Op.between]: [previousStartDate, previousEndDate]
      }
    }
  });

  const userGrowthRate = previousUsers > 0 ? ((newUsers - previousUsers) / previousUsers * 100) : (newUsers > 0 ? 100 : 0);

  // Loan approval rate
  const approvedLoans = await Loan.count({
    where: {
      createdAt: {
        [Op.between]: [startDate, now]
      },
      status: {
        [Op.in]: ['approved', 'disbursed', 'active']
      }
    }
  });

  const totalLoanRequests = await Loan.count({
    where: {
      createdAt: {
        [Op.between]: [startDate, now]
      }
    }
  });

  const loanApprovalRate = totalLoanRequests > 0 ? (approvedLoans / totalLoanRequests * 100) : 0;

  // Savings growth
  const currentPeriodSavings = await Transaction.sum('amount', {
    where: {
      transactionDate: {
        [Op.between]: [startDate, now]
      },
      type: 'contribution',
      status: 'completed'
    }
  }) || 0;

  const previousPeriodSavings = await Transaction.sum('amount', {
    where: {
      transactionDate: {
        [Op.between]: [previousStartDate, previousEndDate]
      },
      type: 'contribution',
      status: 'completed'
    }
  }) || 0;

  const savingsGrowthRate = previousPeriodSavings > 0 ? ((currentPeriodSavings - previousPeriodSavings) / previousPeriodSavings * 100) : (currentPeriodSavings > 0 ? 100 : 0);

  return [
    {
      metric: 'Transaction Completion Rate',
      value: parseFloat(completionRate.toFixed(1)),
      target: 95,
      status: completionRate >= 95 ? 'exceeded' : completionRate >= 80 ? 'met' : 'below'
    },
    {
      metric: 'User Growth Rate',
      value: parseFloat(userGrowthRate.toFixed(1)),
      target: 10,
      status: userGrowthRate >= 10 ? 'exceeded' : userGrowthRate >= 5 ? 'met' : 'below'
    },
    {
      metric: 'Loan Approval Rate',
      value: parseFloat(loanApprovalRate.toFixed(1)),
      target: 70,
      status: loanApprovalRate >= 70 ? 'exceeded' : loanApprovalRate >= 50 ? 'met' : 'below'
    },
    {
      metric: 'Savings Growth Rate',
      value: parseFloat(savingsGrowthRate.toFixed(1)),
      target: 15,
      status: savingsGrowthRate >= 15 ? 'exceeded' : savingsGrowthRate >= 5 ? 'met' : 'below'
    }
  ];
}

/**
 * Format currency
 */
function formatCurrency(amount) {
  if (amount >= 1000000) {
    return `${(amount / 1000000).toFixed(1)}M RWF`;
  } else if (amount >= 1000) {
    return `${(amount / 1000).toFixed(1)}K RWF`;
  }
  return `${amount.toFixed(0)} RWF`;
}

module.exports = {
  getAnalytics
};


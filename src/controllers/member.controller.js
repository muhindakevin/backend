const { User, Group, Loan, Contribution, Fine, Transaction } = require('../models');
const { calculateCreditScore, getAIRecommendation } = require('../utils/creditScoreCalculator');
const { Op } = require('sequelize');

/**
 * Get member dashboard stats
 * GET /api/members/dashboard
 * 
 * All data is fetched directly from the database using SQL queries:
 * - Total Savings: SELECT SUM(amount) FROM contributions WHERE memberId = ? AND status = 'approved'
 * - Active Loans: SELECT COUNT(*) FROM loans WHERE memberId = ? AND status IN ('approved', 'disbursed', 'active')
 * - Credit Score: Calculated from database records (contributions, loans, payments)
 */
const getDashboard = async (req, res) => {
  try {
    // Check if user is authenticated
    if (!req.user || !req.user.id) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized - User not authenticated'
      });
    }
    
    const memberId = req.user.id;
    console.log(`[getDashboard] Starting dashboard fetch for member ID: ${memberId}`);

    // Fetch fresh member data from database to ensure totalSavings is up-to-date
    // SQL: SELECT * FROM users WHERE id = ?
    let member = null;
    try {
      member = await User.findByPk(memberId, {
        include: [{ association: 'group', attributes: ['id', 'name', 'code', 'totalSavings'] }],
        // Force refresh from database
        raw: false
      });
    } catch (memberError) {
      console.error('[getDashboard] Error fetching member:', memberError);
      return res.status(500).json({
        success: false,
        message: 'Failed to fetch member data',
        error: memberError.message
      });
    }

    if (!member) {
      return res.status(404).json({
        success: false,
        message: 'Member not found'
      });
    }

    // Log raw database value
    console.log(`[getDashboard] Raw member.totalSavings from database:`, member.totalSavings);
    console.log(`[getDashboard] Type of totalSavings:`, typeof member.totalSavings);
    console.log(`[getDashboard] Member ID: ${memberId}, Name: ${member.name}`);

    // Ensure totalSavings is a valid number (handle null/undefined)
    if (member.totalSavings === null || member.totalSavings === undefined) {
      console.log(`[getDashboard] WARNING: totalSavings is null/undefined, setting to 0`);
      member.totalSavings = 0;
      try {
        await member.save();
      } catch (saveError) {
        console.warn('[getDashboard] Failed to save member totalSavings:', saveError.message);
      }
    }

    // Get active loans from database
    // SQL: SELECT * FROM loans WHERE memberId = ? AND status IN ('approved', 'disbursed', 'active')
    let activeLoans = [];
    try {
      activeLoans = await Loan.findAll({
        where: {
          memberId,
          status: { [Op.in]: ['approved', 'disbursed', 'active'] }
        }
      });
      console.log(`[getDashboard] Found ${activeLoans.length} active loans for member ${memberId} from database`);
    } catch (loanError) {
      console.warn('[getDashboard] Error fetching active loans:', loanError.message);
    }

    // Get recent transactions
    let recentTransactions = [];
    try {
      recentTransactions = await Transaction.findAll({
        where: { userId: memberId },
        order: [['transactionDate', 'DESC']],
        limit: 10
      });
    } catch (txError) {
      console.warn('[getDashboard] Error fetching transactions:', txError.message);
    }

    // Calculate contributions this month
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);
    
    let contributionsThisMonth = 0;
    try {
      contributionsThisMonth = await Contribution.count({
        where: {
          memberId,
          status: 'approved',
          createdAt: { [Op.gte]: startOfMonth }
        }
      });
    } catch (countError) {
      console.warn('[getDashboard] Error counting contributions:', countError.message);
    }

    // Get last contribution
    let lastContribution = null;
    try {
      lastContribution = await Contribution.findOne({
        where: {
          memberId,
          status: 'approved'
        },
        order: [['createdAt', 'DESC']],
        attributes: ['id', 'amount', 'createdAt', 'paymentMethod']
      });
    } catch (lastContribError) {
      console.warn('[getDashboard] Error fetching last contribution:', lastContribError.message);
    }

    // Calculate credit score
    let creditScore = 0;
    try {
      creditScore = await calculateCreditScore(memberId);
    } catch (creditError) {
      console.warn('[getDashboard] Error calculating credit score:', creditError.message);
    }

    // Update member credit score if different
    if (member.creditScore !== creditScore) {
      member.creditScore = creditScore;
      try {
        await member.save();
      } catch (saveError) {
        console.warn('[getDashboard] Failed to save member creditScore:', saveError.message);
      }
    }

    // Get AI recommendation for loan eligibility
    let aiRecommendation = { maxRecommendedAmount: 0 };
    try {
      aiRecommendation = await getAIRecommendation(memberId);
    } catch (aiError) {
      console.warn('[getDashboard] Error getting AI recommendation:', aiError.message);
    }

    // Get recent contributions for dashboard display
    let recentContributions = [];
    try {
      recentContributions = await Contribution.findAll({
        where: {
          memberId,
          status: 'approved'
        },
        order: [['createdAt', 'DESC']],
        limit: 5,
        attributes: ['id', 'amount', 'createdAt', 'paymentMethod', 'receiptNumber']
      });
    } catch (recentContribError) {
      console.warn('[getDashboard] Error fetching recent contributions:', recentContribError.message);
    }

    // Get stored totalSavings from database (PRIMARY SOURCE - this is what's actually in the database)
    // Handle DECIMAL type - Sequelize returns DECIMAL as string or Decimal object
    let rawTotalSavings = member.totalSavings;
    if (rawTotalSavings && typeof rawTotalSavings === 'object' && rawTotalSavings.toString) {
      // It's a Decimal object, convert to string then parse
      rawTotalSavings = rawTotalSavings.toString();
    }
    const storedTotalSavings = isNaN(parseFloat(rawTotalSavings || 0)) ? 0 : parseFloat(rawTotalSavings || 0);
    
    console.log(`[getDashboard] ==========================================`);
    console.log(`[getDashboard] MEMBER ID: ${memberId}`);
    console.log(`[getDashboard] Raw member.totalSavings:`, member.totalSavings);
    console.log(`[getDashboard] Type of totalSavings:`, typeof member.totalSavings);
    console.log(`[getDashboard] Converted rawTotalSavings:`, rawTotalSavings);
    console.log(`[getDashboard] Parsed storedTotalSavings: ${storedTotalSavings} RWF`);
    console.log(`[getDashboard] ==========================================`);

    // Calculate totalSavings from actual approved contributions (for verification)
    // SQL: SELECT amount FROM contributions WHERE memberId = ? AND status = 'approved'
    let allApprovedContributions = [];
    let calculatedTotalSavings = 0;
    try {
      allApprovedContributions = await Contribution.findAll({
        where: {
          memberId,
          status: 'approved'
        },
        attributes: ['amount']
      });

      // Sum all approved contributions to get calculated total savings
      calculatedTotalSavings = allApprovedContributions.reduce((sum, c) => {
        const amount = parseFloat(c.amount || 0);
        return sum + (isNaN(amount) ? 0 : amount);
      }, 0);
      
      console.log(`[getDashboard] Calculated totalSavings from ${allApprovedContributions.length} approved contributions: ${calculatedTotalSavings} RWF`);
    } catch (contribError) {
      console.warn('[getDashboard] Error calculating totalSavings from contributions:', contribError.message);
    }

    // Use stored value from database as PRIMARY source (this is what the user sees in database)
    // If stored value is 0 or null but calculated is > 0, use calculated
    // Otherwise, use stored value (which is the source of truth from database)
    let totalSavings = storedTotalSavings;
    
    if (storedTotalSavings === 0 && calculatedTotalSavings > 0) {
      // If stored is 0 but we have contributions, use calculated
      console.log(`[getDashboard] Stored value is 0 but calculated is ${calculatedTotalSavings}, using calculated value`);
      totalSavings = calculatedTotalSavings;
      // Update database with calculated value
      member.totalSavings = calculatedTotalSavings;
      member.save().catch(err => {
        console.error(`[getDashboard] Failed to update totalSavings for user ${memberId}:`, err.message);
      });
    } else if (storedTotalSavings > 0) {
      // Use stored value from database (this is the source of truth)
      totalSavings = storedTotalSavings;
      console.log(`[getDashboard] Using stored totalSavings from database: ${totalSavings} RWF`);
      
      // Log if there's a discrepancy (for debugging)
      if (Math.abs(storedTotalSavings - calculatedTotalSavings) > 0.01) {
        console.warn(`[getDashboard] WARNING: Stored (${storedTotalSavings}) and calculated (${calculatedTotalSavings}) don't match. Using stored value.`);
      }
    }
    
    // Ensure totalSavings is a valid number
    if (isNaN(totalSavings) || totalSavings === null || totalSavings === undefined) {
      totalSavings = 0;
    }

    const stats = {
      totalSavings: totalSavings || 0,
      activeLoans: activeLoans ? activeLoans.length : 0,
      creditScore: creditScore || 0,
      eligibleAmount: (aiRecommendation && aiRecommendation.maxRecommendedAmount) ? aiRecommendation.maxRecommendedAmount : 0,
      contributionsThisMonth: contributionsThisMonth || 0,
      lastContribution: lastContribution ? {
        amount: isNaN(parseFloat(lastContribution.amount)) ? 0 : parseFloat(lastContribution.amount),
        date: lastContribution.createdAt,
        paymentMethod: lastContribution.paymentMethod || 'N/A'
      } : null,
      group: member.group || null
    };

    console.log(`[getDashboard] ==========================================`);
    console.log(`[getDashboard] FINAL STATS BEING SENT TO FRONTEND:`);
    console.log(`[getDashboard] totalSavings: ${totalSavings} RWF`);
    console.log(`[getDashboard] activeLoans: ${stats.activeLoans}`);
    console.log(`[getDashboard] creditScore: ${stats.creditScore}`);
    console.log(`[getDashboard] ==========================================`);

    // Ensure all data is serializable and safe
    const responseData = {
      success: true,
      data: {
        stats: {
          totalSavings: Number(totalSavings) || 0,
          activeLoans: Number(stats.activeLoans) || 0,
          creditScore: Number(stats.creditScore) || 0,
          eligibleAmount: Number(stats.eligibleAmount) || 0,
          contributionsThisMonth: Number(stats.contributionsThisMonth) || 0,
          lastContribution: stats.lastContribution,
          group: stats.group ? {
            id: stats.group.id || null,
            name: stats.group.name || null,
            code: stats.group.code || null
          } : null
        },
        recentTransactions: Array.isArray(recentTransactions) ? recentTransactions : [],
        recentContributions: Array.isArray(recentContributions) ? recentContributions : []
      }
    };

    console.log(`[getDashboard] Sending response...`);
    res.json(responseData);
    console.log(`[getDashboard] Response sent successfully`);
  } catch (error) {
    console.error('Get dashboard error:', error);
    console.error('Error stack:', error.stack);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch dashboard data',
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
};

/**
 * Update member profile
 * PUT /api/members/profile
 */
const updateProfile = async (req, res) => {
  try {
    const memberId = req.user.id;
    const { name, email, language, occupation, address, dateOfBirth } = req.body;

    const member = await User.findByPk(memberId);

    if (name) member.name = name;
    if (email) member.email = email;
    if (language) member.language = language;
    if (occupation) member.occupation = occupation;
    if (address) member.address = address;
    if (dateOfBirth) member.dateOfBirth = new Date(dateOfBirth);

    await member.save();

    res.json({
      success: true,
      message: 'Profile updated successfully',
      data: {
        id: member.id,
        name: member.name,
        email: member.email,
        language: member.language,
        occupation: member.occupation,
        address: member.address
      }
    });
  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update profile',
      error: error.message
    });
  }
};

/**
 * Get AI loan recommendation
 * GET /api/members/loan-recommendation
 */
const getLoanRecommendation = async (req, res) => {
  try {
    const memberId = req.user.id;
    const { amount, duration } = req.query;

    console.log(`[getLoanRecommendation] Request from member ${memberId}, amount: ${amount}, duration: ${duration}`);

    // Get recommendation - this function now handles all errors internally
    const recommendation = await getAIRecommendation(
      memberId,
      amount ? parseFloat(amount) : null
    );

    // Ensure we always have valid values
    if (!recommendation) {
      console.error('[getLoanRecommendation] Recommendation returned null/undefined');
      return res.json({
        success: true,
        data: {
          recommendation: 'review',
          confidence: 'Low',
          maxRecommendedAmount: 0,
          creditScore: 50,
          riskCategory: 'Medium',
          interestRate: 10.0,
          message: 'Calculating recommendation. Please try again in a moment.',
          explanation: 'System is processing your financial data. Please refresh to see updated recommendations.',
          monthlyPayment: 0,
          savings: 0
        }
      });
    }

    // If duration is provided, recalculate monthly payment
    if (amount && duration && recommendation.interestRate) {
      const principal = parseFloat(amount);
      const months = parseInt(duration);
      if (!isNaN(principal) && !isNaN(months) && months > 0) {
        const totalAmount = principal * (1 + (recommendation.interestRate / 100));
        recommendation.monthlyPayment = Math.round(totalAmount / months);
      }
    }

    // Log the recommendation for debugging
    console.log(`[getLoanRecommendation] Success: Score=${recommendation.creditScore}, Savings=${recommendation.savings}, MaxAmount=${recommendation.maxRecommendedAmount}`);

    res.json({
      success: true,
      data: recommendation
    });
  } catch (error) {
    console.error('[getLoanRecommendation] Fatal error:', error);
    console.error('[getLoanRecommendation] Stack:', error.stack);
    
    // Return a safe fallback response instead of error
    res.json({
      success: true,
      data: {
        recommendation: 'review',
        confidence: 'Low',
        maxRecommendedAmount: 0,
        creditScore: 50,
        riskCategory: 'Medium',
        interestRate: 10.0,
        message: 'System is processing your request. Please try again in a moment.',
        explanation: 'The recommendation system is temporarily unavailable. Please refresh the page or try again later.',
        monthlyPayment: 0,
        savings: 0
      }
    });
  }
};

module.exports = {
  getDashboard,
  updateProfile,
  getLoanRecommendation
};


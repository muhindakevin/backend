const { User, Loan, Contribution, Transaction, Meeting, Fine } = require('../models');
const { Op } = require('sequelize');

/**
 * Fetch all financial data for a member before credit scoring
 * This ensures we have all required data before any calculations
 */
async function fetchMemberFinancialData(memberId) {
  const data = {
    member: null,
    savings: {
      totalSavings: 0,
      calculatedFromContributions: true,
      contributionCount: 0
    },
    contributions: {
      all: [],
      approved: [],
      recent: [],
      totalAmount: 0,
      avgAmount: 0,
      frequency: 'irregular',
      missedCount: 0,
      consistency: 0
    },
    loans: {
      all: [],
      completed: [],
      active: [],
      defaulted: [],
      totalBorrowed: 0,
      totalPaid: 0,
      outstanding: 0,
      repaymentHistory: [],
      latePayments: 0,
      onTimePayments: 0,
      earlyPayments: 0
    },
    engagement: {
      meetingsAttended: 0,
      totalMeetings: 0,
      attendanceRate: 0,
      fines: [],
      totalFines: 0,
      unpaidFines: 0,
      unpaidFinesAmount: 0
    },
    membershipAge: 0
  };

  try {
    // 1. Fetch member data
    data.member = await User.findByPk(memberId);
    if (!data.member) {
      console.error(`[fetchMemberFinancialData] Member ${memberId} not found`);
      return data; // Return empty data structure
    }

    // Calculate membership age
    if (data.member.createdAt) {
      const months = Math.floor((new Date() - new Date(data.member.createdAt)) / (1000 * 60 * 60 * 24 * 30));
      data.membershipAge = Math.max(0, months);
    }

    // 2. Fetch ALL approved contributions (for savings calculation)
    try {
      const allApprovedContributions = await Contribution.findAll({
        where: {
          memberId,
          status: 'approved'
        },
        order: [['createdAt', 'ASC']],
        attributes: ['id', 'amount', 'createdAt', 'paymentMethod']
      });

      data.contributions.approved = allApprovedContributions;
      data.contributions.all = allApprovedContributions;
      
      // Calculate total savings from contributions
      data.savings.totalSavings = allApprovedContributions.reduce((sum, c) => {
        const amount = parseFloat(c.amount || 0);
        return sum + (isNaN(amount) ? 0 : amount);
      }, 0);
      
      data.savings.contributionCount = allApprovedContributions.length;
      data.contributions.totalAmount = data.savings.totalSavings;
      
      // Calculate average contribution amount
      if (allApprovedContributions.length > 0) {
        data.contributions.avgAmount = data.savings.totalSavings / allApprovedContributions.length;
      }

      // Get recent contributions (last 6 months)
      const sixMonthsAgo = new Date();
      sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
      data.contributions.recent = allApprovedContributions.filter(c => 
        new Date(c.createdAt) >= sixMonthsAgo
      );

      // Calculate contribution frequency
      if (allApprovedContributions.length >= 2) {
        const intervals = [];
        for (let i = 1; i < allApprovedContributions.length; i++) {
          const days = (new Date(allApprovedContributions[i].createdAt) - 
                       new Date(allApprovedContributions[i-1].createdAt)) / (1000 * 60 * 60 * 24);
          intervals.push(days);
        }
        const avgInterval = intervals.reduce((sum, d) => sum + d, 0) / intervals.length;
        if (avgInterval <= 10) data.contributions.frequency = 'weekly';
        else if (avgInterval <= 35) data.contributions.frequency = 'monthly';
        else data.contributions.frequency = 'irregular';
      }

      // Calculate consistency
      if (allApprovedContributions.length > 1) {
        const expectedInterval = data.contributions.frequency === 'weekly' ? 7 : 
                                data.contributions.frequency === 'monthly' ? 30 : 15;
        let consistentCount = 0;
        for (let i = 1; i < allApprovedContributions.length; i++) {
          const days = (new Date(allApprovedContributions[i].createdAt) - 
                       new Date(allApprovedContributions[i-1].createdAt)) / (1000 * 60 * 60 * 24);
          const variance = Math.abs(days - expectedInterval) / expectedInterval;
          if (variance <= 0.3) consistentCount++;
        }
        data.contributions.consistency = consistentCount / (allApprovedContributions.length - 1);
      }

      // Calculate missed contributions
      if (allApprovedContributions.length > 0 && data.contributions.frequency !== 'irregular') {
        const expectedInterval = data.contributions.frequency === 'weekly' ? 7 : 30;
        const firstDate = new Date(allApprovedContributions[0].createdAt);
        const lastDate = new Date(allApprovedContributions[allApprovedContributions.length - 1].createdAt);
        const totalDays = (lastDate - firstDate) / (1000 * 60 * 60 * 24);
        const expectedContributions = Math.floor(totalDays / expectedInterval) + 1;
        data.contributions.missedCount = Math.max(0, expectedContributions - allApprovedContributions.length);
      } else {
        data.contributions.missedCount = 0;
      }

      console.log(`[fetchMemberFinancialData] Fetched ${allApprovedContributions.length} approved contributions, total savings: ${data.savings.totalSavings} RWF`);
    } catch (error) {
      console.error('[fetchMemberFinancialData] Error fetching contributions:', error);
      // Continue with empty contributions
    }

    // 3. Fetch ALL loans
    try {
      const allLoans = await Loan.findAll({
        where: { memberId },
        order: [['createdAt', 'ASC']],
        attributes: ['id', 'amount', 'totalAmount', 'paidAmount', 'remainingAmount', 
                     'status', 'createdAt', 'disbursementDate', 'updatedAt', 
                     'nextPaymentDate', 'duration']
      });

      data.loans.all = allLoans;
      data.loans.completed = allLoans.filter(l => l.status === 'completed');
      data.loans.active = allLoans.filter(l => ['active', 'disbursed', 'approved'].includes(l.status));
      data.loans.defaulted = allLoans.filter(l => l.status === 'defaulted');

      // Calculate loan totals
      data.loans.totalBorrowed = allLoans.reduce((sum, l) => sum + parseFloat(l.amount || 0), 0);
      data.loans.totalPaid = allLoans.reduce((sum, l) => sum + parseFloat(l.paidAmount || 0), 0);
      data.loans.outstanding = data.loans.active.reduce((sum, l) => 
        sum + parseFloat(l.remainingAmount || 0), 0);

      // Analyze repayment history from transactions
      const loanPayments = await Transaction.findAll({
        where: {
          userId: memberId,
          type: 'loan_payment',
          status: 'completed'
        },
        order: [['transactionDate', 'ASC']],
        attributes: ['id', 'amount', 'transactionDate', 'referenceId']
      });

      // Match payments with loans
      const loansMap = {};
      allLoans.forEach(loan => {
        loansMap[loan.id] = loan;
      });

      loanPayments.forEach(payment => {
        const loanId = payment.referenceId ? parseInt(payment.referenceId) : null;
        const loan = loanId ? loansMap[loanId] : null;
        
        if (loan && loan.nextPaymentDate) {
          const paymentDate = new Date(payment.transactionDate);
          const dueDate = new Date(loan.nextPaymentDate);
          const daysDiff = (paymentDate - dueDate) / (1000 * 60 * 60 * 24);

          if (daysDiff < -7) {
            data.loans.earlyPayments++;
          } else if (daysDiff <= 7) {
            data.loans.onTimePayments++;
          } else {
            data.loans.latePayments++;
          }
        } else {
          // If we can't determine, count as on-time
          data.loans.onTimePayments++;
        }
      });

      console.log(`[fetchMemberFinancialData] Fetched ${allLoans.length} loans, ${data.loans.completed.length} completed, ${data.loans.active.length} active`);
    } catch (error) {
      console.error('[fetchMemberFinancialData] Error fetching loans:', error);
      // Continue with empty loans
    }

    // 4. Fetch engagement data (meetings and fines)
    if (data.member.groupId) {
      try {
        // Fetch meetings
        const allMeetings = await Meeting.findAll({
          where: { 
            groupId: data.member.groupId,
            status: 'completed'
          },
          attributes: ['id', 'scheduledDate', 'attendance']
        });

        data.engagement.totalMeetings = allMeetings.length;
        data.engagement.meetingsAttended = allMeetings.filter(m => {
          if (!m.attendance || !Array.isArray(m.attendance)) return false;
          return m.attendance.includes(memberId);
        }).length;

        if (data.engagement.totalMeetings > 0) {
          data.engagement.attendanceRate = data.engagement.meetingsAttended / data.engagement.totalMeetings;
        }

        // Fetch fines
        const allFines = await Fine.findAll({
          where: {
            memberId,
            groupId: data.member.groupId
          },
          attributes: ['id', 'amount', 'status']
        });

        data.engagement.fines = allFines;
        data.engagement.totalFines = allFines.length;
        data.engagement.unpaidFines = allFines.filter(f => ['pending', 'approved'].includes(f.status)).length;
        data.engagement.unpaidFinesAmount = allFines
          .filter(f => ['pending', 'approved'].includes(f.status))
          .reduce((sum, f) => sum + parseFloat(f.amount || 0), 0);

        console.log(`[fetchMemberFinancialData] Engagement: ${data.engagement.meetingsAttended}/${data.engagement.totalMeetings} meetings, ${data.engagement.totalFines} fines`);
      } catch (error) {
        console.error('[fetchMemberFinancialData] Error fetching engagement:', error);
        // Continue with empty engagement
      }
    }

    console.log(`[fetchMemberFinancialData] Successfully fetched all data for member ${memberId}`);
    return data;

  } catch (error) {
    console.error('[fetchMemberFinancialData] Fatal error:', error);
    console.error('[fetchMemberFinancialData] Stack:', error.stack);
    // Return whatever data we have
    return data;
  }
}

module.exports = { fetchMemberFinancialData };


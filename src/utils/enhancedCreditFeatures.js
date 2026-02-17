const { Op } = require('sequelize');
const { User, Loan, Contribution, Transaction, Meeting, Fine } = require('../models');

/**
 * Enhanced Credit Feature Extraction for Saving Groups/Cooperatives
 * Extracts comprehensive features from all data sources
 */
class EnhancedCreditFeatures {
  /**
   * Extract all features for a member
   */
  async extractAllFeatures(memberId, groupId = null) {
    try {
      const member = await User.findByPk(memberId);
      if (!member) {
        console.warn(`[extractAllFeatures] Member ${memberId} not found`);
        return null;
      }

      // Get groupId from member if not provided
      const actualGroupId = groupId || member.groupId;
      if (!actualGroupId) {
        console.warn(`[extractAllFeatures] Group ID not found for member ${memberId}`);
        // Continue with null groupId - some features can still be extracted
      }

      // Extract features in parallel for performance, with error handling
      const [
        contributionFeatures,
        loanFeatures,
        savingsFeatures,
        engagementFeatures,
        financialStabilityFeatures
      ] = await Promise.allSettled([
        actualGroupId ? this.extractContributionFeatures(memberId, actualGroupId) : Promise.resolve({}),
        this.extractLoanFeatures(memberId).catch(() => ({})),
        this.extractSavingsFeatures(memberId).catch(() => ({})),
        actualGroupId ? this.extractEngagementFeatures(memberId, actualGroupId).catch(() => ({})) : Promise.resolve({}),
        this.extractFinancialStabilityFeatures(member).catch(() => ({}))
      ]);

      // Extract values from Promise.allSettled results
      const contribFeatures = contributionFeatures.status === 'fulfilled' ? contributionFeatures.value : {};
      const loanFeat = loanFeatures.status === 'fulfilled' ? loanFeatures.value : {};
      const savingsFeat = savingsFeatures.status === 'fulfilled' ? savingsFeatures.value : {};
      const engagementFeat = engagementFeatures.status === 'fulfilled' ? engagementFeatures.value : {};
      const financialFeat = financialStabilityFeatures.status === 'fulfilled' ? financialStabilityFeatures.value : {};

      // Combine all features
      const combinedFeatures = {
        // Contribution History
        ...contribFeatures,
        
        // Loan History
        ...loanFeat,
        
        // Savings Behavior
        ...savingsFeat,
        
        // Group Engagement
        ...engagementFeat,
        
        // Financial Stability
        ...financialFeat,
        
        // Metadata
        membershipAgeMonths: this.calculateMembershipAge(member.createdAt),
        memberId,
        groupId: actualGroupId || null
      };

      // Ensure we have at least savings data
      if (typeof combinedFeatures.totalSavings === 'undefined') {
        combinedFeatures.totalSavings = 0;
      }

      return combinedFeatures;
    } catch (error) {
      console.error('[extractAllFeatures] Error extracting features:', error);
      console.error('[extractAllFeatures] Error stack:', error.stack);
      // Return minimal valid features instead of throwing
      return {
        totalSavings: 0,
        totalContributions: 0,
        totalLoans: 0,
        completedLoans: 0,
        contributionConsistency: 0,
        repaymentDiscipline: 0.5,
        attendanceRate: 0,
        totalFines: 0,
        membershipAgeMonths: 0,
        memberId,
        groupId: null
      };
    }
  }

  /**
   * 1. Contribution History Features
   */
  async extractContributionFeatures(memberId, groupId) {
    try {
      const sixMonthsAgo = new Date();
      sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
      
      const twelveMonthsAgo = new Date();
      twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12);

      // Get all approved contributions
      const allContributions = await Contribution.findAll({
      where: {
        memberId,
        groupId,
        status: 'approved'
      },
      order: [['createdAt', 'ASC']]
    });

    const recentContributions = allContributions.filter(c => 
      new Date(c.createdAt) >= sixMonthsAgo
    );

    const olderContributions = allContributions.filter(c => 
      new Date(c.createdAt) >= twelveMonthsAgo && new Date(c.createdAt) < sixMonthsAgo
    );

    // Calculate amounts
    const totalContributions = allContributions.length;
    const totalContributionAmount = allContributions.reduce((sum, c) => 
      sum + parseFloat(c.amount || 0), 0
    );
    const avgContributionAmount = totalContributions > 0 
      ? totalContributionAmount / totalContributions 
      : 0;

    // Recent vs older period comparison
    const recentTotal = recentContributions.reduce((sum, c) => 
      sum + parseFloat(c.amount || 0), 0
    );
    const olderTotal = olderContributions.reduce((sum, c) => 
      sum + parseFloat(c.amount || 0), 0
    );

    // Calculate frequency (expected: weekly or monthly)
    const contributionFrequency = this.calculateContributionFrequency(allContributions);
    
    // Consistency: percentage of expected contributions made
    const consistency = this.calculateConsistency(allContributions, contributionFrequency);
    
    // Missed contributions (gaps in expected contributions)
    const missedContributions = this.calculateMissedContributions(allContributions, contributionFrequency);
    
    // Growth trend (positive = increasing, negative = decreasing)
    const growthTrend = this.calculateGrowthTrend(allContributions);

    return {
      // Contribution amounts
      totalContributions,
      totalContributionAmount,
      avgContributionAmount,
      recentContributionAmount: recentTotal,
      olderContributionAmount: olderTotal,
      
      // Contribution patterns
      contributionFrequency, // 'weekly', 'monthly', 'irregular'
      contributionConsistency: consistency, // 0-1 (percentage)
      missedContributions,
      contributionGrowthTrend: growthTrend, // -1 to 1
      
      // Recent activity
      contributionsLast6Months: recentContributions.length,
      contributionsLast12Months: allContributions.filter(c => 
        new Date(c.createdAt) >= twelveMonthsAgo
      ).length
    };
    } catch (error) {
      console.warn('[extractContributionFeatures] Error:', error.message);
      return {
        totalContributions: 0,
        totalContributionAmount: 0,
        avgContributionAmount: 0,
        recentContributionAmount: 0,
        olderContributionAmount: 0,
        contributionFrequency: 'irregular',
        contributionConsistency: 0,
        missedContributions: 0,
        contributionGrowthTrend: 0,
        contributionsLast6Months: 0,
        contributionsLast12Months: 0
      };
    }
  }

  /**
   * 2. Loan History Features
   */
  async extractLoanFeatures(memberId) {
    try {
      const allLoans = await Loan.findAll({
      where: { memberId },
      order: [['createdAt', 'ASC']]
    });

    const completedLoans = allLoans.filter(l => l.status === 'completed');
    const activeLoans = allLoans.filter(l => ['active', 'disbursed'].includes(l.status));
    const defaultedLoans = allLoans.filter(l => l.status === 'defaulted');
    const rejectedLoans = allLoans.filter(l => l.status === 'rejected');

    // Calculate repayment metrics
    let totalLoansAmount = 0;
    let totalPaidAmount = 0;
    let totalOutstanding = 0;
    let onTimePayments = 0;
    let latePayments = 0;
    let earlyPayments = 0;
    let averageRepaymentSpeed = 0;

    completedLoans.forEach(loan => {
      const loanAmount = parseFloat(loan.amount || 0);
      const paidAmount = parseFloat(loan.paidAmount || 0);
      const totalAmount = parseFloat(loan.totalAmount || 0);
      
      totalLoansAmount += loanAmount;
      totalPaidAmount += paidAmount;

      // Calculate repayment speed (actual duration vs expected)
      if (loan.disbursementDate && loan.updatedAt) {
        const expectedMonths = loan.duration || 12;
        const actualMonths = this.monthsBetween(
          new Date(loan.disbursementDate),
          new Date(loan.updatedAt)
        );
        const speedRatio = expectedMonths / Math.max(actualMonths, 1);
        averageRepaymentSpeed += speedRatio;
      }
    });

    activeLoans.forEach(loan => {
      totalOutstanding += parseFloat(loan.remainingAmount || 0);
    });

    // Analyze payment patterns from transactions
    const loanPayments = await Transaction.findAll({
      where: {
        userId: memberId,
        type: 'loan_payment',
        status: 'completed'
      },
      order: [['transactionDate', 'ASC']]
    });

    // Get loans to match with payments
    const loansMap = {};
    allLoans.forEach(loan => {
      loansMap[loan.id] = loan;
    });

    loanPayments.forEach(payment => {
      // Try to find the related loan from referenceId
      const loanId = payment.referenceId ? parseInt(payment.referenceId) : null;
      const loan = loanId ? loansMap[loanId] : null;
      
      if (!loan || !loan.nextPaymentDate) {
        // If we can't determine, count as on-time
        onTimePayments++;
        return;
      }

      const paymentDate = new Date(payment.transactionDate);
      const dueDate = new Date(loan.nextPaymentDate);
      const daysDiff = (paymentDate - dueDate) / (1000 * 60 * 60 * 24);

      if (daysDiff < -7) {
        earlyPayments++;
      } else if (daysDiff <= 7) {
        onTimePayments++;
      } else {
        latePayments++;
      }
    });

    averageRepaymentSpeed = completedLoans.length > 0 
      ? averageRepaymentSpeed / completedLoans.length 
      : 0;

    // Default risk indicators
    const hasDefaultHistory = defaultedLoans.length > 0;
    const defaultRate = allLoans.length > 0 
      ? defaultedLoans.length / allLoans.length 
      : 0;

    return {
      // Loan counts
      totalLoans: allLoans.length,
      completedLoans: completedLoans.length,
      activeLoans: activeLoans.length,
      defaultedLoans: defaultedLoans.length,
      rejectedLoans: rejectedLoans.length,
      
      // Loan amounts
      totalLoansAmount,
      totalPaidAmount,
      totalOutstanding,
      avgLoanAmount: allLoans.length > 0 ? totalLoansAmount / allLoans.length : 0,
      
      // Repayment behavior
      onTimePayments,
      latePayments,
      earlyPayments,
      averageRepaymentSpeed, // >1 = faster than expected, <1 = slower
      repaymentDiscipline: allLoans.length > 0 
        ? (onTimePayments + earlyPayments) / (onTimePayments + latePayments + earlyPayments || 1)
        : 0.5, // Default neutral
      
      // Risk indicators
      hasDefaultHistory,
      defaultRate,
      loanToSavingsRatio: 0 // Will be calculated with savings data
    };
    } catch (error) {
      console.warn('[extractLoanFeatures] Error:', error.message);
      return {
        totalLoans: 0,
        completedLoans: 0,
        activeLoans: 0,
        defaultedLoans: 0,
        rejectedLoans: 0,
        totalLoansAmount: 0,
        totalPaidAmount: 0,
        totalOutstanding: 0,
        avgLoanAmount: 0,
        onTimePayments: 0,
        latePayments: 0,
        earlyPayments: 0,
        averageRepaymentSpeed: 0,
        repaymentDiscipline: 0.5,
        hasDefaultHistory: false,
        defaultRate: 0,
        loanToSavingsRatio: 0
      };
    }
  }

  /**
   * 3. Savings Account Behavior Features
   */
  async extractSavingsFeatures(memberId) {
    try {
      const member = await User.findByPk(memberId);
      if (!member) {
        return {
          totalSavings: 0,
          avgMonthlySavings: 0,
          monthlySavingsCount: 0,
          withdrawalFrequency: 0,
          totalWithdrawn: 0,
          withdrawalToSavingsRatio: 0,
          minBalance: 0,
          avgBalance: 0,
          balanceStability: 0,
          savingsGrowthRate: 0
        };
      }
      
      // Calculate actual savings from approved contributions (source of truth)
      let totalSavings = 0;
      try {
        const approvedContributions = await Contribution.findAll({
          where: {
            memberId,
            status: 'approved'
          },
          attributes: ['amount']
        });
        
        totalSavings = approvedContributions.reduce((sum, c) => {
          const amount = parseFloat(c.amount || 0);
          return sum + (isNaN(amount) ? 0 : amount);
        }, 0);
        
        console.log(`[extractSavingsFeatures] Calculated totalSavings from ${approvedContributions.length} approved contributions: ${totalSavings} RWF`);
      } catch (innerError) {
        console.warn('[extractSavingsFeatures] Error calculating from contributions, using stored value:', innerError.message);
        // Fallback to stored value if calculation fails
        totalSavings = parseFloat(member?.totalSavings || 0);
      }

      // Get all savings-related transactions
    const savingsTransactions = await Transaction.findAll({
      where: {
        userId: memberId,
        type: { [Op.in]: ['contribution', 'refund', 'interest'] },
        status: 'completed'
      },
      order: [['transactionDate', 'ASC']]
    });

    const withdrawalTransactions = await Transaction.findAll({
      where: {
        userId: memberId,
        type: { [Op.in]: ['loan_disbursement', 'fee'] },
        status: 'completed'
      },
      order: [['transactionDate', 'ASC']]
    });

    // Calculate monthly savings over last 12 months
    const monthlySavings = this.calculateMonthlySavings(savingsTransactions);
    const avgMonthlySavings = monthlySavings.length > 0
      ? monthlySavings.reduce((sum, m) => sum + m.amount, 0) / monthlySavings.length
      : 0;

    // Withdrawal patterns
    const withdrawalFrequency = withdrawalTransactions.length;
    const totalWithdrawn = withdrawalTransactions.reduce((sum, t) => 
      sum + parseFloat(t.amount || 0), 0
    );

    // Minimum balance behavior (track balance over time)
    const balanceHistory = this.calculateBalanceHistory(savingsTransactions, withdrawalTransactions);
    const minBalance = balanceHistory.length > 0 
      ? Math.min(...balanceHistory.map(b => b.balance))
      : 0;
    const avgBalance = balanceHistory.length > 0
      ? balanceHistory.reduce((sum, b) => sum + b.balance, 0) / balanceHistory.length
      : 0;

    // Savings growth rate
    const savingsGrowthRate = this.calculateSavingsGrowthRate(monthlySavings);

    return {
      totalSavings,
      avgMonthlySavings,
      monthlySavingsCount: monthlySavings.length,
      
      // Withdrawal patterns
      withdrawalFrequency,
      totalWithdrawn,
      withdrawalToSavingsRatio: totalSavings > 0 
        ? totalWithdrawn / totalSavings 
        : 0,
      
      // Balance behavior
      minBalance,
      avgBalance,
      balanceStability: this.calculateBalanceStability(balanceHistory),
      
      // Growth
      savingsGrowthRate // Percentage growth per month
    };
    } catch (error) {
      console.warn('[extractSavingsFeatures] Error:', error.message);
      // Still try to get basic savings
      let basicSavings = 0;
      try {
        const approvedContributions = await Contribution.findAll({
          where: {
            memberId,
            status: 'approved'
          },
          attributes: ['amount'],
          limit: 1000
        });
        basicSavings = approvedContributions.reduce((sum, c) => {
          const amount = parseFloat(c.amount || 0);
          return sum + (isNaN(amount) ? 0 : amount);
        }, 0);
      } catch (e) {
        // Ignore
      }
      
      return {
        totalSavings: basicSavings,
        avgMonthlySavings: 0,
        monthlySavingsCount: 0,
        withdrawalFrequency: 0,
        totalWithdrawn: 0,
        withdrawalToSavingsRatio: 0,
        minBalance: 0,
        avgBalance: basicSavings,
        balanceStability: 1,
        savingsGrowthRate: 0
      };
    }
  }

  /**
   * 4. Group Engagement Features
   */
  async extractEngagementFeatures(memberId, groupId) {
    try {
      if (!groupId) {
        return {
          totalMeetings: 0,
          meetingsAttended: 0,
          attendanceRate: 0,
          recentMeetingsAttended: 0,
          totalFines: 0,
          paidFines: 0,
          unpaidFines: 0,
          waivedFines: 0,
          totalFinesAmount: 0,
          unpaidFinesAmount: 0,
          fineComplianceRate: 1,
          participationScore: 0,
          engagementLevel: 'low'
        };
      }
      
      // Get all meetings for the group
      const allMeetings = await Meeting.findAll({
      where: { groupId },
      order: [['scheduledDate', 'ASC']]
    });

    // Calculate attendance
    let meetingsAttended = 0;
    let totalMeetings = 0;
    const recentMeetings = allMeetings.filter(m => {
      const meetingDate = new Date(m.scheduledDate);
      const sixMonthsAgo = new Date();
      sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
      return meetingDate >= sixMonthsAgo;
    });

    allMeetings.forEach(meeting => {
      if (meeting.status === 'completed') {
        totalMeetings++;
        if (meeting.attendance && Array.isArray(meeting.attendance)) {
          if (meeting.attendance.includes(memberId)) {
            meetingsAttended++;
          }
        }
      }
    });

    const attendanceRate = totalMeetings > 0 
      ? meetingsAttended / totalMeetings 
      : 0;

    // Get fines and penalties
    const allFines = await Fine.findAll({
      where: {
        memberId,
        groupId
      }
    });

    const paidFines = allFines.filter(f => f.status === 'paid');
    const unpaidFines = allFines.filter(f => ['pending', 'approved'].includes(f.status));
    const waivedFines = allFines.filter(f => f.status === 'waived');

    const totalFinesAmount = allFines.reduce((sum, f) => 
      sum + parseFloat(f.amount || 0), 0
    );
    const unpaidFinesAmount = unpaidFines.reduce((sum, f) => 
      sum + parseFloat(f.amount || 0), 0
    );

    // Participation score (combination of attendance and contributions)
    const contributions = await Contribution.count({
      where: {
        memberId,
        groupId,
        status: 'approved'
      }
    });

    const participationScore = (attendanceRate * 0.5) + 
      (Math.min(contributions / 24, 1) * 0.5); // Normalize contributions

    return {
      // Meeting attendance
      totalMeetings,
      meetingsAttended,
      attendanceRate,
      recentMeetingsAttended: recentMeetings.filter(m => {
        if (!m.attendance || !Array.isArray(m.attendance)) return false;
        return m.attendance.includes(memberId);
      }).length,
      
      // Fines and penalties
      totalFines: allFines.length,
      paidFines: paidFines.length,
      unpaidFines: unpaidFines.length,
      waivedFines: waivedFines.length,
      totalFinesAmount,
      unpaidFinesAmount,
      fineComplianceRate: allFines.length > 0 
        ? paidFines.length / allFines.length 
        : 1, // No fines = perfect compliance
      
      // Overall engagement
      participationScore, // 0-1
      engagementLevel: this.categorizeEngagement(participationScore, attendanceRate, allFines.length)
    };
    } catch (error) {
      console.warn('[extractEngagementFeatures] Error:', error.message);
      return {
        totalMeetings: 0,
        meetingsAttended: 0,
        attendanceRate: 0,
        recentMeetingsAttended: 0,
        totalFines: 0,
        paidFines: 0,
        unpaidFines: 0,
        waivedFines: 0,
        totalFinesAmount: 0,
        unpaidFinesAmount: 0,
        fineComplianceRate: 1,
        participationScore: 0,
        engagementLevel: 'low'
      };
    }
  }

  /**
   * 5. Financial Stability Indicators
   */
  async extractFinancialStabilityFeatures(member) {
    return {
      // Income level (if available in future)
      hasOccupation: !!member.occupation,
      occupation: member.occupation || 'unknown',
      
      // Account age
      accountAgeMonths: this.calculateMembershipAge(member.createdAt),
      
      // Account status
      accountStatus: member.status || 'active',
      
      // Additional indicators
      hasNationalId: !!member.nationalId,
      hasAddress: !!member.address
    };
  }

  // Helper methods

  calculateContributionFrequency(contributions) {
    if (contributions.length < 2) return 'irregular';
    
    const intervals = [];
    for (let i = 1; i < contributions.length; i++) {
      const days = (new Date(contributions[i].createdAt) - 
                   new Date(contributions[i-1].createdAt)) / (1000 * 60 * 60 * 24);
      intervals.push(days);
    }
    
    const avgInterval = intervals.reduce((sum, d) => sum + d, 0) / intervals.length;
    
    if (avgInterval <= 10) return 'weekly';
    if (avgInterval <= 35) return 'monthly';
    return 'irregular';
  }

  calculateConsistency(contributions, frequency) {
    if (contributions.length === 0) return 0;
    
    const expectedInterval = frequency === 'weekly' ? 7 : 
                            frequency === 'monthly' ? 30 : 15;
    
    let consistentCount = 0;
    for (let i = 1; i < contributions.length; i++) {
      const days = (new Date(contributions[i].createdAt) - 
                   new Date(contributions[i-1].createdAt)) / (1000 * 60 * 60 * 24);
      const variance = Math.abs(days - expectedInterval) / expectedInterval;
      if (variance <= 0.3) { // Within 30% of expected
        consistentCount++;
      }
    }
    
    return contributions.length > 1 ? consistentCount / (contributions.length - 1) : 1;
  }

  calculateMissedContributions(contributions, frequency) {
    if (contributions.length === 0) return 0;
    
    const expectedInterval = frequency === 'weekly' ? 7 : 
                            frequency === 'monthly' ? 30 : 15;
    
    const firstDate = new Date(contributions[0].createdAt);
    const lastDate = new Date(contributions[contributions.length - 1].createdAt);
    const totalDays = (lastDate - firstDate) / (1000 * 60 * 60 * 24);
    const expectedContributions = Math.floor(totalDays / expectedInterval) + 1;
    
    return Math.max(0, expectedContributions - contributions.length);
  }

  calculateGrowthTrend(contributions) {
    if (contributions.length < 3) return 0;
    
    // Split into two halves
    const mid = Math.floor(contributions.length / 2);
    const firstHalf = contributions.slice(0, mid);
    const secondHalf = contributions.slice(mid);
    
    const firstAvg = firstHalf.reduce((sum, c) => 
      sum + parseFloat(c.amount || 0), 0) / firstHalf.length;
    const secondAvg = secondHalf.reduce((sum, c) => 
      sum + parseFloat(c.amount || 0), 0) / secondHalf.length;
    
    if (firstAvg === 0) return secondAvg > 0 ? 1 : 0;
    return (secondAvg - firstAvg) / firstAvg; // Normalized growth
  }

  calculateMonthlySavings(transactions) {
    const monthlyMap = {};
    
    transactions.forEach(t => {
      const date = new Date(t.transactionDate);
      const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      
      if (!monthlyMap[monthKey]) {
        monthlyMap[monthKey] = 0;
      }
      monthlyMap[monthKey] += parseFloat(t.amount || 0);
    });
    
    return Object.keys(monthlyMap).map(month => ({
      month,
      amount: monthlyMap[month]
    })).sort((a, b) => a.month.localeCompare(b.month));
  }

  calculateBalanceHistory(savingsTransactions, withdrawalTransactions) {
    const allTransactions = [
      ...savingsTransactions.map(t => ({ ...t, isDeposit: true })),
      ...withdrawalTransactions.map(t => ({ ...t, isDeposit: false }))
    ].sort((a, b) => new Date(a.transactionDate) - new Date(b.transactionDate));
    
    let balance = 0;
    const history = [];
    
    allTransactions.forEach(t => {
      const amount = parseFloat(t.amount || 0);
      balance += t.isDeposit ? amount : -amount;
      history.push({
        date: t.transactionDate,
        balance
      });
    });
    
    return history;
  }

  calculateBalanceStability(balanceHistory) {
    if (balanceHistory.length < 2) return 1;
    
    const balances = balanceHistory.map(b => b.balance);
    const avg = balances.reduce((sum, b) => sum + b, 0) / balances.length;
    const variance = balances.reduce((sum, b) => sum + Math.pow(b - avg, 2), 0) / balances.length;
    const stdDev = Math.sqrt(variance);
    
    // Stability: inverse of coefficient of variation
    return avg > 0 ? Math.max(0, 1 - (stdDev / avg)) : 0;
  }

  calculateSavingsGrowthRate(monthlySavings) {
    if (monthlySavings.length < 2) return 0;
    
    const first = monthlySavings[0].amount;
    const last = monthlySavings[monthlySavings.length - 1].amount;
    
    if (first === 0) return last > 0 ? 1 : 0;
    return (last - first) / first / monthlySavings.length; // Average monthly growth
  }

  categorizeEngagement(participationScore, attendanceRate, finesCount) {
    if (participationScore >= 0.8 && attendanceRate >= 0.8 && finesCount === 0) {
      return 'high';
    } else if (participationScore >= 0.5 && attendanceRate >= 0.5 && finesCount <= 2) {
      return 'medium';
    } else {
      return 'low';
    }
  }

  calculateMembershipAge(createdAt) {
    if (!createdAt) return 0;
    return Math.floor((new Date() - new Date(createdAt)) / (1000 * 60 * 60 * 24 * 30));
  }

  monthsBetween(date1, date2) {
    const months = (date2.getFullYear() - date1.getFullYear()) * 12 + 
                   (date2.getMonth() - date1.getMonth());
    return Math.max(1, months);
  }
}

module.exports = new EnhancedCreditFeatures();


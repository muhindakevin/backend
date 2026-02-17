const { Loan, Contribution, Transaction, User, Setting } = require('../models');
const mlScorer = require('./mlCreditScorer');
const enhancedMLScorer = require('./enhancedMLCreditScorer');
const enhancedFeatures = require('./enhancedCreditFeatures');
const { fetchMemberFinancialData } = require('./fetchMemberFinancialData');

/**
 * Get credit scoring configuration from database
 */
const getScoringConfig = async () => {
  try {
    const configSetting = await Setting.findOne({ where: { key: 'credit_scoring_config' } });
    if (configSetting && configSetting.value) {
      return JSON.parse(configSetting.value);
    }
  } catch (error) {
    console.error('Error loading scoring config:', error);
  }
  
  // Return default configuration
  return {
    scoringParameters: {
      contributionConsistency: 40,
      loanPaymentHistory: 30,
      savingsAmount: 20,
      accountAge: 10
    },
    mlModelEnabled: true
  };
};

/**
 * Calculate credit score from fetched financial data (rule-based)
 * This uses the pre-fetched data to avoid additional database queries
 */
const calculateCreditScoreFromData = (financialData, requestedAmount = null) => {
  try {
    if (!financialData) {
      console.warn('[calculateCreditScoreFromData] No financial data provided');
      return 50;
    }
    
    const savings = financialData.savings || { totalSavings: 0 };
    const contributions = financialData.contributions || { approved: [], consistency: 0 };
    const loans = financialData.loans || { completed: [], defaulted: [], onTimePayments: 0, latePayments: 0, earlyPayments: 0 };
    const engagement = financialData.engagement || { attendanceRate: 0, unpaidFines: 0 };
    const membershipAge = financialData.membershipAge || 0;
    
    let score = 0;
    const maxScore = 100;
    
    // 1. Contribution Consistency (40% weight)
    const contributionWeight = 40;
    const contributionCount = contributions.approved.length;
    if (contributionCount > 0) {
      const maxContributionPoints = (contributionWeight / 100) * maxScore;
      const contributionScore = Math.min(maxContributionPoints, contributionCount * (maxContributionPoints / 12));
      score += contributionScore;
      
      // Add consistency bonus
      if (contributions.consistency > 0.8) {
        score += 5;
      }
    }
    
    // 2. Loan Payment History (30% weight)
    const paymentWeight = 30;
    const totalPayments = loans.completed.length;
    if (totalPayments > 0) {
      const onTimeRatio = loans.onTimePayments / (loans.onTimePayments + loans.latePayments + loans.earlyPayments || 1);
      const maxPaymentPoints = (paymentWeight / 100) * maxScore;
      score += Math.round(onTimeRatio * maxPaymentPoints);
      
      // Penalty for defaults
      if (loans.defaulted.length > 0) {
        score -= (loans.defaulted.length / totalPayments) * 20;
      }
    }
    
    // 3. Savings Amount (20% weight)
    const savingsWeight = 20;
    if (savings.totalSavings > 0) {
      const maxSavingsPoints = (savingsWeight / 100) * maxScore;
      const savingsScore = Math.min(maxSavingsPoints, (savings.totalSavings / 500000) * maxSavingsPoints);
      score += savingsScore;
    }
    
    // 4. Account Age (10% weight)
    const ageWeight = 10;
    if (membershipAge > 0) {
      const maxAgePoints = (ageWeight / 100) * maxScore;
      const ageScore = Math.min(maxAgePoints, membershipAge * (maxAgePoints / 20));
      score += ageScore;
    }
    
    // 5. Engagement bonus/penalty
    if (engagement.attendanceRate >= 0.8) {
      score += 5;
    } else if (engagement.attendanceRate < 0.5) {
      score -= 5;
    }
    
    if (engagement.unpaidFines > 0) {
      score -= Math.min(10, engagement.unpaidFines * 2);
    }
    
    // Ensure score is between 0 and 100
    return Math.max(0, Math.min(maxScore, Math.round(score)));
  } catch (error) {
    console.error('[calculateCreditScoreFromData] Error:', error);
    return 50; // Default middle score
  }
};

/**
 * Calculate credit score based on member's financial history
 * Uses enhanced ML model if available, otherwise falls back to rule-based
 * Score range: 0-100 (updated from 0-1000)
 */
const calculateCreditScore = async (memberId, requestedAmount = null) => {
  try {
    // Get member data
    const member = await User.findByPk(memberId);
    if (!member) {
      return 50; // Default middle score (0-100 scale)
    }

    // Get scoring configuration
    const config = await getScoringConfig();

    // Try enhanced ML-based scoring first (if enabled)
    if (config.mlModelEnabled !== false) {
      try {
        const assessment = await enhancedMLScorer.getCreditAssessment(memberId, requestedAmount);
        if (assessment && assessment.creditScore !== null) {
          return assessment.creditScore; // Already 0-100 scale
        }
      } catch (error) {
        console.log('Enhanced ML scoring not available, trying legacy ML:', error.message);
      }

      // Fall back to legacy ML scorer
      try {
        const loans = await Loan.findAll({ where: { memberId } });
        const contributions = await Contribution.findAll({
          where: { memberId, status: 'approved' },
          order: [['createdAt', 'DESC']],
          limit: 12
        });
        const mlScore = mlScorer.getMLCreditScore(member, loans, contributions, requestedAmount);
        if (mlScore !== null) {
          // Convert from 0-1000 to 0-100 scale
          return Math.round(mlScore / 10);
        }
      } catch (error) {
        console.log('Legacy ML scoring not available, using rule-based:', error.message);
      }
    }

    // Fall back to rule-based scoring with configurable weights
    // Updated to 0-100 scale
    let score = 0;
    const maxScore = 100;
    const params = config.scoringParameters || {
      contributionConsistency: 40,
      loanPaymentHistory: 30,
      savingsAmount: 20,
      accountAge: 10
    };

    // Calculate actual savings from approved contributions for scoring
    let actualSavingsForScoring = 0;
    try {
      const approvedContributions = await Contribution.findAll({
        where: {
          memberId,
          status: 'approved'
        },
        attributes: ['amount']
      });
      
      actualSavingsForScoring = approvedContributions.reduce((sum, c) => {
        const amount = parseFloat(c.amount || 0);
        return sum + (isNaN(amount) ? 0 : amount);
      }, 0);
    } catch (error) {
      console.warn('[calculateCreditScore] Error calculating savings, using stored value:', error.message);
      actualSavingsForScoring = parseFloat(member.totalSavings) || 0;
    }

    // Get loan history
    const loans = await Loan.findAll({
      where: { memberId },
      order: [['createdAt', 'DESC']]
    });

    // Get contributions
    const contributions = await Contribution.findAll({
      where: { memberId, status: 'approved' },
      order: [['createdAt', 'DESC']],
      limit: 12
    });

    // 1. Contribution Consistency (configurable %)
    const contributionWeight = params.contributionConsistency || 40;
    if (contributions.length > 0) {
      const maxContributionPoints = (contributionWeight / 100) * maxScore;
      const contributionScore = Math.min(maxContributionPoints, contributions.length * (maxContributionPoints / 12));
      score += contributionScore;
    }

    // 2. Loan Payment History (configurable %)
    const paymentWeight = params.loanPaymentHistory || 30;
    let onTimePayments = 0;
    let totalPayments = 0;

    for (const loan of loans) {
      if (loan.status === 'completed') {
        totalPayments++;
        // Check if loan was completed without default
        if (loan.paidAmount >= loan.totalAmount) {
          onTimePayments++;
        }
      }
    }

    if (totalPayments > 0) {
      const paymentRatio = onTimePayments / totalPayments;
      const maxPaymentPoints = (paymentWeight / 100) * maxScore;
      score += Math.round(paymentRatio * maxPaymentPoints);
    }

    // 3. Savings Amount (configurable %) - Use calculated savings
    const savingsWeight = params.savingsAmount || 20;
    if (actualSavingsForScoring > 0) {
      const maxSavingsPoints = (savingsWeight / 100) * maxScore;
      const savingsScore = Math.min(maxSavingsPoints, (actualSavingsForScoring / 500000) * maxSavingsPoints);
      score += savingsScore;
    }

    // 4. Account Age (configurable %)
    const ageWeight = params.accountAge || 10;
    if (member.createdAt) {
      const accountAgeMonths = Math.floor((new Date() - new Date(member.createdAt)) / (1000 * 60 * 60 * 24 * 30));
      const maxAgePoints = (ageWeight / 100) * maxScore;
      const ageScore = Math.min(maxAgePoints, accountAgeMonths * (maxAgePoints / 20));
      score += ageScore;
    }

    // Ensure score is between 0 and 100
    return Math.max(0, Math.min(maxScore, Math.round(score)));
  } catch (error) {
    console.error('Credit score calculation error:', error);
    return 50; // Default middle score (0-100 scale)
  }
};

/**
 * Get AI recommendation for loan with comprehensive assessment
 * Includes credit score, risk category, loan limit, and detailed explanation
 * 
 * IMPORTANT: This function FIRST fetches all data from database, THEN calculates
 */
const getAIRecommendation = async (memberId, requestedAmount = null) => {
  console.log(`[getAIRecommendation] Starting recommendation for member ${memberId}`);
  
  // STEP 1: Fetch ALL required data from database FIRST
  let financialData;
  try {
    financialData = await fetchMemberFinancialData(memberId);
    console.log(`[getAIRecommendation] Data fetched: Savings=${financialData.savings.totalSavings} RWF, Contributions=${financialData.contributions.approved.length}, Loans=${financialData.loans.all.length}`);
  } catch (error) {
    console.error('[getAIRecommendation] CRITICAL: Failed to fetch financial data:', error);
    // Return safe fallback
    return {
      recommendation: 'review',
      confidence: 'Low',
      maxRecommendedAmount: 0,
      creditScore: 50,
      riskCategory: 'Medium',
      interestRate: 10.0,
      message: 'Unable to fetch financial data. Please try again.',
      explanation: 'System is temporarily unable to access your financial records. Please contact support if this persists.',
      monthlyPayment: 0,
      savings: 0
    };
  }

  // Validate we have member data
  if (!financialData.member) {
    console.error(`[getAIRecommendation] Member ${memberId} not found`);
    return {
      recommendation: 'reject',
      confidence: 'Low',
      maxRecommendedAmount: 0,
      creditScore: 0,
      riskCategory: 'High',
      interestRate: 15.0,
      message: 'Member not found',
      explanation: 'Member not found in system.',
      monthlyPayment: 0,
      savings: 0
    };
  }

  // Get actual savings (already calculated from contributions)
  const actualSavings = financialData.savings.totalSavings;
  console.log(`[getAIRecommendation] Using calculated savings: ${actualSavings} RWF from ${financialData.savings.contributionCount} contributions`);

  // STEP 2: Try enhanced ML assessment (only if model is available)
  let assessment = null;
  try {
    assessment = await enhancedMLScorer.getCreditAssessment(memberId, requestedAmount);
    if (!assessment || assessment.creditScore === null || assessment.creditScore === undefined) {
      console.log('[getAIRecommendation] Enhanced assessment returned invalid score, using rule-based');
      assessment = null;
    } else {
      console.log(`[getAIRecommendation] Enhanced assessment successful: Score=${assessment.creditScore}, Risk=${assessment.riskCategory}`);
    }
  } catch (error) {
    console.log('[getAIRecommendation] Enhanced assessment not available, using rule-based:', error.message);
    assessment = null;
  }

  // STEP 3: Calculate credit score using fetched data
  try {
    // If enhanced assessment available, use it
    if (assessment && assessment.creditScore !== null && assessment.creditScore !== undefined) {
      // Use savings from fetched data (already calculated from contributions)
      const savings = actualSavings;
      
      // Determine recommendation based on risk category and score
      let recommendation = 'review';
      if (assessment.riskCategory === 'Low' && assessment.creditScore >= 70) {
        recommendation = 'approve';
      } else if (assessment.riskCategory === 'High' || assessment.creditScore < 40) {
        recommendation = 'reject';
      }

      // Calculate interest rate based on credit score (0-100 scale)
      let interestRate = 15.0; // Base rate for low scores
      if (assessment.creditScore >= 80) {
        interestRate = 3.5;
      } else if (assessment.creditScore >= 70) {
        interestRate = 5.0;
      } else if (assessment.creditScore >= 60) {
        interestRate = 7.5;
      } else if (assessment.creditScore >= 50) {
        interestRate = 10.0;
      } else if (assessment.creditScore >= 40) {
        interestRate = 12.5;
      } else {
        interestRate = 15.0;
      }

      // Calculate monthly payment if amount is provided
      let monthlyPayment = 0;
      if (requestedAmount) {
        const principal = parseFloat(requestedAmount);
        const months = 12; // Default 12 months
        const totalAmount = principal * (1 + (interestRate / 100));
        monthlyPayment = totalAmount / months;
      }

      // Validate requested amount
      let message = assessment.explanation;
      if (requestedAmount && requestedAmount > assessment.loanLimit) {
        message = `Requested amount (${requestedAmount.toLocaleString()} RWF) exceeds recommended maximum (${assessment.loanLimit.toLocaleString()} RWF). ${assessment.explanation}`;
        recommendation = 'review';
      }

      // Ensure minimum savings requirement
      if (actualSavings < 10000 && assessment.creditScore < 50) {
        assessment.loanLimit = 0;
        recommendation = 'reject';
        message = 'Insufficient savings and low credit score. Minimum 10,000 RWF savings required. ' + assessment.explanation;
      }

      return {
        recommendation,
        confidence: assessment.confidence,
        maxRecommendedAmount: assessment.loanLimit,
        creditScore: assessment.creditScore,
        riskCategory: assessment.riskCategory,
        interestRate,
        message,
        explanation: assessment.explanation,
        monthlyPayment: Math.round(monthlyPayment),
        savings: actualSavings,
        featureSummary: assessment.features
      };
    }

    // STEP 4: Fallback to rule-based recommendation using fetched data
    console.log('[getAIRecommendation] Using rule-based calculation with fetched data');
    const savings = actualSavings;
    
    // Calculate credit score using the fetched financial data
    let creditScore = calculateCreditScoreFromData(financialData, requestedAmount);
    
    // Get scoring configuration for thresholds (updated for 0-100 scale)
    const config = await getScoringConfig();
    const thresholds = config.aiRecommendationThresholds || {
      approve: { min: 70, max: 100 },
      review: { min: 40, max: 69 },
      reject: { min: 0, max: 39 }
    };

    let recommendation = 'review';
    let maxRecommendedAmount = 0;
    let confidence = 'Low';
    let riskCategory = 'Medium';
    let message = '';
    let explanation = '';

    // Build explanation based on fetched data
    const explanationParts = [];
    
    // Positive factors
    if (financialData.contributions.approved.length >= 12) {
      explanationParts.push(`Consistent contributions (${financialData.contributions.approved.length} approved contributions)`);
    }
    if (financialData.loans.completed.length > 0 && financialData.loans.defaulted.length === 0) {
      explanationParts.push(`Good repayment history (${financialData.loans.completed.length} completed loan(s))`);
    }
    if (financialData.loans.earlyPayments > 0) {
      explanationParts.push(`Paid ${financialData.loans.earlyPayments} loan payment(s) early`);
    }
    if (savings >= 100000) {
      explanationParts.push(`Strong savings balance (${savings.toLocaleString()} RWF)`);
    }
    if (financialData.engagement.attendanceRate >= 0.8) {
      explanationParts.push(`High meeting attendance (${Math.round(financialData.engagement.attendanceRate * 100)}%)`);
    }
    
    // Negative factors
    const concerns = [];
    if (financialData.contributions.missedCount > 3) {
      concerns.push(`${financialData.contributions.missedCount} missed contributions`);
    }
    if (financialData.loans.latePayments > 0) {
      concerns.push(`${financialData.loans.latePayments} late loan payment(s)`);
    }
    if (financialData.loans.defaulted.length > 0) {
      concerns.push(`${financialData.loans.defaulted.length} defaulted loan(s)`);
    }
    if (financialData.engagement.unpaidFines > 0) {
      concerns.push(`${financialData.engagement.unpaidFines} unpaid fine(s)`);
    }
    if (financialData.loans.outstanding > savings) {
      concerns.push(`Outstanding loans exceed savings`);
    }

    // Use configurable thresholds for recommendations
    if (creditScore >= thresholds.approve.min) {
      recommendation = 'approve';
      confidence = 'High';
      riskCategory = 'Low';
      maxRecommendedAmount = Math.min(savings * 3, savings + 500000);
      message = 'Excellent credit score! You qualify for a higher loan amount.';
      explanation = `Member demonstrates strong financial discipline. ${explanationParts.length > 0 ? 'Strengths: ' + explanationParts.slice(0, 3).join(', ') + '. ' : ''}${concerns.length > 0 ? 'Areas to monitor: ' + concerns.slice(0, 2).join(', ') + '. ' : ''}Recommendation: Eligible for higher loan amounts based on excellent track record.`;
    } else if (creditScore >= thresholds.review.min) {
      recommendation = 'review';
      confidence = creditScore >= 50 ? 'Medium' : 'Low';
      riskCategory = 'Medium';
      if (creditScore >= 50) {
        maxRecommendedAmount = Math.min(savings * 1.5, savings + 150000);
        message = 'Moderate credit score. Loan requires review.';
        explanation = `Member shows mixed performance. ${explanationParts.length > 0 ? 'Strengths: ' + explanationParts.slice(0, 2).join(', ') + '. ' : ''}${concerns.length > 0 ? 'Concerns: ' + concerns.slice(0, 2).join(', ') + '. ' : ''}Recommendation: Loan eligibility is moderate. Consider improving contribution consistency and meeting attendance.`;
      } else {
        maxRecommendedAmount = Math.min(savings * 1.0, savings + 50000);
        message = 'Low credit score. Limited loan eligibility. Consider improving your credit first.';
        explanation = `Member has areas for improvement. ${explanationParts.length > 0 ? 'Positive factors: ' + explanationParts.slice(0, 1).join(', ') + '. ' : ''}${concerns.length > 0 ? 'Key concerns: ' + concerns.slice(0, 3).join(', ') + '. ' : ''}Recommendation: Focus on consistent contributions and timely loan repayments to improve eligibility.`;
      }
    } else {
      recommendation = 'reject';
      confidence = 'High';
      riskCategory = 'High';
      maxRecommendedAmount = 0;
      message = 'Very low credit score. Loan not recommended. Please build your credit history first.';
      explanation = `Member needs significant improvement. ${concerns.length > 0 ? 'Main concerns: ' + concerns.slice(0, 3).join(', ') + '. ' : ''}Recommendation: Focus on building savings, making consistent contributions, and attending meetings regularly before applying for loans.`;
    }

    // Ensure minimum savings requirement
    if (savings < 10000 && creditScore < 50) {
      maxRecommendedAmount = 0;
      recommendation = 'reject';
      message = 'Insufficient savings and low credit score. Minimum 10,000 RWF savings required.';
      explanation += ' Additionally, minimum savings requirement not met.';
    }

    // If requested amount is provided, validate it
    if (requestedAmount && requestedAmount > maxRecommendedAmount) {
      message = `Requested amount (${requestedAmount.toLocaleString()} RWF) exceeds recommended maximum (${maxRecommendedAmount.toLocaleString()} RWF).`;
    }

    // Calculate interest rate based on credit score (0-100 scale)
    let interestRate = 15.0;
    if (creditScore >= 80) {
      interestRate = 3.5;
    } else if (creditScore >= 70) {
      interestRate = 5.0;
    } else if (creditScore >= 60) {
      interestRate = 7.5;
    } else if (creditScore >= 50) {
      interestRate = 10.0;
    } else if (creditScore >= 40) {
      interestRate = 12.5;
    } else {
      interestRate = 15.0;
    }

    // Calculate monthly payment if amount is provided
    let monthlyPayment = 0;
    if (requestedAmount) {
      const principal = parseFloat(requestedAmount);
      const months = 12;
      const totalAmount = principal * (1 + (interestRate / 100));
      monthlyPayment = totalAmount / months;
    }

    return {
      recommendation,
      confidence,
      maxRecommendedAmount: Math.round(maxRecommendedAmount),
      creditScore: creditScore || 0,
      riskCategory: riskCategory || 'Medium',
      interestRate: interestRate || 10.0,
      message: message || '',
      explanation: explanation || '',
      monthlyPayment: Math.round(monthlyPayment || 0),
      savings: savings || 0
    };
  } catch (error) {
    console.error('[getAIRecommendation] Fatal error in recommendation calculation:', error);
    console.error('[getAIRecommendation] Error stack:', error.stack);
    
    // Last resort: Try to use financialData if we have it, otherwise fetch minimal data
    let finalSavings = 0;
    let finalScore = 50;
    
    if (financialData && financialData.savings) {
      finalSavings = financialData.savings.totalSavings;
      // Calculate basic score from available data
      if (financialData.contributions.approved.length > 0) {
        finalScore = Math.min(70, 40 + (financialData.contributions.approved.length * 2));
      }
      if (financialData.loans.defaulted.length > 0) {
        finalScore -= 20;
      }
      if (finalSavings > 100000) finalScore += 10;
      finalScore = Math.max(30, Math.min(70, finalScore));
    } else {
      // Emergency fallback - fetch just savings
      try {
        const emergencyContributions = await Contribution.findAll({
          where: {
            memberId,
            status: 'approved'
          },
          attributes: ['amount'],
          limit: 1000
        });
        
        finalSavings = emergencyContributions.reduce((sum, c) => {
          const amount = parseFloat(c.amount || 0);
          return sum + (isNaN(amount) ? 0 : amount);
        }, 0);
        
        // Basic score based on savings
        if (finalSavings > 100000) finalScore = 60;
        else if (finalSavings > 50000) finalScore = 55;
        else if (finalSavings > 10000) finalScore = 50;
        else finalScore = 40;
      } catch (emergencyError) {
        console.error('[getAIRecommendation] Emergency calculation failed:', emergencyError.message);
        finalSavings = 0;
        finalScore = 40;
      }
    }
    
    // Return safe recommendation
    const safeRecommendation = finalSavings >= 10000 ? 'review' : 'reject';
    const safeMaxAmount = finalSavings >= 10000 ? Math.min(finalSavings * 1.5, finalSavings + 100000) : 0;
    
    return {
      recommendation: safeRecommendation,
      confidence: 'Low',
      maxRecommendedAmount: Math.round(safeMaxAmount),
      creditScore: finalScore,
      riskCategory: finalScore >= 50 ? 'Medium' : 'High',
      interestRate: finalScore >= 60 ? 7.5 : 10.0,
      message: finalSavings >= 10000 
        ? 'Basic recommendation available. System is calculating detailed assessment.' 
        : 'Insufficient savings for loan recommendation. Minimum 10,000 RWF required.',
      explanation: finalSavings > 0 
        ? `Based on available data: You have ${finalSavings.toLocaleString()} RWF in savings from ${financialData?.contributions?.approved?.length || 0} approved contributions. ${finalSavings >= 10000 ? 'You may be eligible for a loan after review.' : 'Please build your savings to at least 10,000 RWF to qualify for loans.'}`
        : 'Unable to calculate detailed recommendation. Please ensure your contributions are approved and try again.',
      monthlyPayment: 0,
      savings: finalSavings
    };
  }
};

module.exports = {
  calculateCreditScore,
  getAIRecommendation
};


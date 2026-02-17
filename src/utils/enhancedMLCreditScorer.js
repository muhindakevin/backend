const path = require('path');
const fs = require('fs');
const { EnhancedCreditModel } = require('./trainEnhancedCreditModel');
const enhancedFeatures = require('./enhancedCreditFeatures');

/**
 * Enhanced ML-based Credit Scorer
 * Uses comprehensive features and provides detailed explanations
 */
class EnhancedMLCreditScorer {
  constructor() {
    this.modelPath = path.join(__dirname, '../../data/enhanced_credit_model.json');
    this.model = new EnhancedCreditModel();
    this.modelAvailable = this.model.load(this.modelPath);
  }

  /**
   * Get comprehensive credit assessment
   */
  async getCreditAssessment(memberId, requestedAmount = null) {
    // Check if model is available first
    if (!this.modelAvailable || !this.model.trained) {
      console.log('[EnhancedMLCreditScorer] Model not available, will use fallback');
      return null; // Fall back to rule-based
    }

    try {
      // Extract all features with error handling
      let features;
      try {
        features = await enhancedFeatures.extractAllFeatures(memberId);
      } catch (featureError) {
        console.warn('[EnhancedMLCreditScorer] Feature extraction failed:', featureError.message);
        return null; // Fall back to rule-based
      }
      
      // Ensure we have valid features
      if (!features || typeof features.totalSavings === 'undefined') {
        console.warn('[EnhancedMLCreditScorer] Invalid features extracted, falling back to rule-based');
        return null;
      }
      
      // Calculate loan-to-savings ratio if amount requested
      if (requestedAmount && features.totalSavings > 0) {
        features.loanToSavingsRatio = requestedAmount / features.totalSavings;
      } else {
        features.loanToSavingsRatio = features.totalOutstanding / Math.max(features.totalSavings, 1);
      }

      // Predict credit score - wrap in try-catch for model prediction errors
      let prediction;
      try {
        prediction = this.model.predict(features);
        if (!prediction || typeof prediction.creditScore === 'undefined') {
          throw new Error('Invalid prediction result');
        }
      } catch (predError) {
        console.warn('Model prediction failed, using rule-based scoring:', predError.message);
        return null; // Fall back to rule-based
      }
      
      // Determine risk category
      const riskCategory = this.categorizeRisk(prediction.creditScore, features);
      
      // Generate explanation
      const explanation = this.generateExplanation(features, prediction.creditScore, riskCategory);
      
      // Calculate recommended loan limit
      const loanLimit = this.calculateLoanLimit(features, prediction.creditScore, riskCategory);

      return {
        creditScore: prediction.creditScore,
        riskCategory,
        loanLimit,
        explanation,
        confidence: prediction.confidence || 'Medium',
        features: this.summarizeFeatures(features),
        savings: features.totalSavings || 0 // Include calculated savings
      };
    } catch (error) {
      console.error('Enhanced ML scoring error:', error);
      console.error('Error stack:', error.stack);
      return null; // Fall back to rule-based
    }
  }

  /**
   * Categorize risk level
   */
  categorizeRisk(creditScore, features) {
    // High risk indicators
    if (creditScore < 40 || 
        features.hasDefaultHistory || 
        features.defaultRate > 0.3 ||
        features.unpaidFinesAmount > 5000 ||
        features.loanToSavingsRatio > 3) {
      return 'High';
    }
    
    // Low risk indicators
    if (creditScore >= 70 && 
        features.contributionConsistency >= 0.8 &&
        features.repaymentDiscipline >= 0.9 &&
        features.attendanceRate >= 0.8 &&
        features.totalFines === 0) {
      return 'Low';
    }
    
    // Medium risk (default)
    return 'Medium';
  }

  /**
   * Generate detailed explanation
   */
  generateExplanation(features, creditScore, riskCategory) {
    const reasons = [];
    const concerns = [];

    // Positive factors
    if (features.contributionConsistency >= 0.8) {
      reasons.push(`Consistent contributions (${Math.round(features.contributionConsistency * 100)}% consistency)`);
    }
    if (features.repaymentDiscipline >= 0.9) {
      reasons.push(`Excellent repayment discipline (${Math.round(features.repaymentDiscipline * 100)}% on-time payments)`);
    } else if (features.repaymentDiscipline >= 0.7) {
      reasons.push(`Good repayment history`);
    }
    if (features.earlyPayments > 0) {
      reasons.push(`Paid ${features.earlyPayments} loan(s) early`);
    }
    if (features.savingsGrowthRate > 0.1) {
      reasons.push(`Strong savings growth trend`);
    }
    if (features.attendanceRate >= 0.8) {
      reasons.push(`High meeting attendance (${Math.round(features.attendanceRate * 100)}%)`);
    }
    if (features.totalFines === 0) {
      reasons.push(`No fines or penalties`);
    }
    if (features.totalSavings > 100000) {
      reasons.push(`Strong savings balance (RWF ${features.totalSavings.toLocaleString()})`);
    }

    // Negative factors
    if (features.missedContributions > 3) {
      concerns.push(`${features.missedContributions} missed contributions`);
    }
    if (features.latePayments > 0) {
      concerns.push(`${features.latePayments} late loan payment(s)`);
    }
    if (features.hasDefaultHistory) {
      concerns.push(`Previous loan default(s)`);
    }
    if (features.unpaidFines > 0) {
      concerns.push(`${features.unpaidFines} unpaid fine(s) totaling RWF ${features.unpaidFinesAmount.toLocaleString()}`);
    }
    if (features.attendanceRate < 0.5) {
      concerns.push(`Low meeting attendance (${Math.round(features.attendanceRate * 100)}%)`);
    }
    if (features.loanToSavingsRatio > 2) {
      concerns.push(`High loan-to-savings ratio (${features.loanToSavingsRatio.toFixed(2)}x)`);
    }
    if (features.totalOutstanding > features.totalSavings) {
      concerns.push(`Outstanding loans exceed savings`);
    }

    // Build explanation
    let explanation = '';
    
    if (riskCategory === 'Low') {
      explanation = `Member demonstrates strong financial discipline and group engagement. `;
    } else if (riskCategory === 'Medium') {
      explanation = `Member shows mixed performance with room for improvement. `;
    } else {
      explanation = `Member has significant risk factors that require attention. `;
    }

    if (reasons.length > 0) {
      explanation += `Strengths: ${reasons.slice(0, 3).join(', ')}. `;
    }

    if (concerns.length > 0) {
      explanation += `Concerns: ${concerns.slice(0, 3).join(', ')}. `;
    }

    // Add recommendation
    if (riskCategory === 'Low') {
      explanation += `Recommendation: Eligible for higher loan amounts based on excellent track record.`;
    } else if (riskCategory === 'Medium') {
      explanation += `Recommendation: Loan eligibility is moderate. Consider improving contribution consistency and meeting attendance.`;
    } else {
      explanation += `Recommendation: Loan eligibility is limited. Focus on building savings, making consistent contributions, and attending meetings regularly.`;
    }

    return explanation;
  }

  /**
   * Calculate recommended loan limit
   */
  calculateLoanLimit(features, creditScore, riskCategory) {
    const savings = features.totalSavings || 0;
    let baseLimit = 0;

    // Base limit calculation
    if (riskCategory === 'Low') {
      // Low risk: up to 3x savings or savings + 500k, whichever is lower
      baseLimit = Math.min(savings * 3, savings + 500000);
    } else if (riskCategory === 'Medium') {
      // Medium risk: up to 1.5x savings or savings + 200k
      baseLimit = Math.min(savings * 1.5, savings + 200000);
    } else {
      // High risk: up to 1x savings or savings + 50k
      baseLimit = Math.min(savings * 1.0, savings + 50000);
    }

    // Adjust based on credit score
    const scoreMultiplier = creditScore / 100;
    baseLimit = baseLimit * scoreMultiplier;

    // Apply additional constraints
    if (features.totalOutstanding > 0) {
      // Reduce limit if there are outstanding loans
      const outstandingRatio = features.totalOutstanding / Math.max(savings, 1);
      if (outstandingRatio > 0.5) {
        baseLimit = baseLimit * 0.5;
      }
    }

    if (features.unpaidFinesAmount > 0) {
      // Reduce limit for unpaid fines
      baseLimit = Math.max(0, baseLimit - features.unpaidFinesAmount);
    }

    // Minimum and maximum constraints
    const minLimit = savings >= 10000 ? 0 : 0; // No loan if savings < 10k
    const maxLimit = savings * 5; // Absolute maximum

    return Math.max(minLimit, Math.min(maxLimit, Math.round(baseLimit)));
  }

  /**
   * Summarize key features for transparency
   */
  summarizeFeatures(features) {
    return {
      contributions: {
        total: features.totalContributions,
        consistency: Math.round(features.contributionConsistency * 100),
        missed: features.missedContributions
      },
      loans: {
        total: features.totalLoans,
        completed: features.completedLoans,
        outstanding: features.totalOutstanding,
        repaymentDiscipline: Math.round(features.repaymentDiscipline * 100)
      },
      savings: {
        total: features.totalSavings,
        growthRate: Math.round(features.savingsGrowthRate * 100)
      },
      engagement: {
        attendanceRate: Math.round(features.attendanceRate * 100),
        fines: features.totalFines,
        participationScore: Math.round(features.participationScore * 100)
      }
    };
  }

  /**
   * Get ML credit score (for backward compatibility)
   */
  async getMLCreditScore(memberId, requestedAmount = null) {
    const assessment = await this.getCreditAssessment(memberId, requestedAmount);
    return assessment ? assessment.creditScore : null;
  }
}

module.exports = new EnhancedMLCreditScorer();


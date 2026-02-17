const path = require('path');
const fs = require('fs');
const { SimpleCreditModel } = require('./trainCreditModelJS');

/**
 * ML-based Credit Scoring using trained model
 * Falls back to rule-based if model not available
 */
class MLCreditScorer {
  constructor() {
    this.modelPath = path.join(__dirname, '../../data/credit_model.json');
    this.model = new SimpleCreditModel();
    this.modelAvailable = this.model.load(this.modelPath);
  }

  /**
   * Map user data to model features
   */
  mapUserToFeatures(member, loanHistory, contributions, requestedAmount) {
    // Map to German Credit Dataset format
    const features = {
      checking_account: this.mapCheckingAccount(member.totalSavings),
      duration: 12, // Default 12 months
      credit_history: this.mapCreditHistory(loanHistory),
      purpose: 4, // Default: other
      credit_amount: requestedAmount || 0,
      savings_account: this.mapSavingsAccount(member.totalSavings),
      employment: this.mapEmployment(member.occupation),
      installment_rate: this.calculateInstallmentRate(member.totalSavings, requestedAmount),
      personal_status: 1, // Default
      other_debtors: 1, // None
      residence_since: this.mapResidenceSince(member.createdAt),
      property: 1, // Default
      age: this.calculateAge(member.dateOfBirth),
      other_installment_plans: loanHistory.length > 0 ? 1 : 0,
      housing: 1, // Default
      existing_credits: loanHistory.filter(l => ['active', 'disbursed'].includes(l.status)).length,
      job: this.mapJob(member.occupation),
      liable_people: 0,
      telephone: 1, // Yes
      foreign_worker: 0 // No
    };

    return features;
  }

  mapCheckingAccount(savings) {
    if (savings >= 500000) return 'A14'; // >= 200 DM
    if (savings >= 200000) return 'A13'; // 100-200 DM
    if (savings >= 50000) return 'A12'; // < 100 DM
    return 'A11'; // No account
  }

  mapCreditHistory(loanHistory) {
    const completedLoans = loanHistory.filter(l => l.status === 'completed');
    if (completedLoans.length === 0) return 'A30'; // No credits
    const defaulted = completedLoans.filter(l => l.status === 'defaulted').length;
    if (defaulted > 0) return 'A32'; // Critical account
    return 'A34'; // All credits paid back
  }

  mapSavingsAccount(savings) {
    if (savings >= 1000000) return 'A65'; // >= 1000 DM
    if (savings >= 500000) return 'A64'; // 500-1000 DM
    if (savings >= 100000) return 'A63'; // 100-500 DM
    if (savings >= 50000) return 'A62'; // < 100 DM
    return 'A61'; // Unknown/No savings
  }

  mapEmployment(occupation) {
    if (!occupation) return 1; // Unemployed
    const occ = occupation.toLowerCase();
    if (occ.includes('manager') || occ.includes('executive')) return 4; // Management
    if (occ.includes('skilled')) return 3; // Skilled employee
    return 2; // Unskilled
  }

  calculateInstallmentRate(savings, loanAmount) {
    if (!savings || savings === 0) return 4; // >= 35%
    const rate = (loanAmount / savings) * 100;
    if (rate >= 35) return 4;
    if (rate >= 25) return 3;
    if (rate >= 20) return 2;
    return 1; // < 20%
  }

  mapResidenceSince(createdAt) {
    if (!createdAt) return 1;
    const months = Math.floor((new Date() - new Date(createdAt)) / (1000 * 60 * 60 * 24 * 30));
    if (months >= 48) return 4; // >= 4 years
    if (months >= 24) return 3; // 2-3 years
    if (months >= 12) return 2; // 1-2 years
    return 1; // < 1 year
  }

  calculateAge(dateOfBirth) {
    if (!dateOfBirth) return 35; // Default
    const age = Math.floor((new Date() - new Date(dateOfBirth)) / (1000 * 60 * 60 * 24 * 365));
    return age || 35;
  }

  mapJob(occupation) {
    if (!occupation) return 0; // Unemployed
    const occ = occupation.toLowerCase();
    if (occ.includes('manager') || occ.includes('executive')) return 3; // Management
    if (occ.includes('skilled')) return 2; // Skilled
    return 1; // Unskilled
  }

  /**
   * Predict using trained model
   */
  predictWithModel(features) {
    try {
      // Map features to model format
      const modelFeatures = {
        duration: (features.duration || 12) / 100,
        credit_amount: (features.credit_amount || 0) / 10000,
        installment_rate: (features.installment_rate || 1) / 10,
        residence_since: (features.residence_since || 1) / 10,
        age: (features.age || 35) / 100,
        existing_credits: (features.existing_credits || 0) / 10,
        liable_people: (features.liable_people || 0) / 10,
        checking_account_good: features.checking_account_good || 0,
        credit_history_good: features.credit_history_good || 0,
        savings_good: features.savings_good || 0,
        employment_stable: features.employment_stable || 0
      };

      return this.model.predict(modelFeatures);
    } catch (error) {
      throw new Error(`Prediction failed: ${error.message}`);
    }
  }

  /**
   * Get ML-based credit score
   */
  getMLCreditScore(member, loanHistory, contributions, requestedAmount) {
    if (!this.modelAvailable) {
      return null; // Fall back to rule-based
    }

    try {
      const features = this.mapUserToFeatures(member, loanHistory, contributions, requestedAmount);
      const prediction = this.predictWithModel(features);
      return prediction.credit_score;
    } catch (error) {
      console.error('ML prediction error:', error);
      return null; // Fall back to rule-based
    }
  }
}

module.exports = new MLCreditScorer();


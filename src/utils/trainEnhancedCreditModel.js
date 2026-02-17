const fs = require('fs');
const path = require('path');
const { sequelize } = require('../models');
const enhancedFeatures = require('./enhancedCreditFeatures');

/**
 * Enhanced Credit Scoring Model Training
 * Uses comprehensive features from saving group data
 */
class EnhancedCreditModel {
  constructor() {
    this.weights = {};
    this.featureNames = [];
    this.trained = false;
    this.featureStats = {}; // For normalization
  }

  /**
   * Collect training data from actual database records
   */
  async collectTrainingData() {
    console.log('Collecting training data from database...');
    
    const { User, Loan, Contribution } = require('../models');
    
    // Get all members with sufficient history
    const members = await User.findAll({
      where: {
        role: 'Member',
        status: 'active'
      },
      include: [
        {
          model: Loan,
          as: 'loans',
          required: false
        },
        {
          model: Contribution,
          as: 'contributions',
          required: false,
          where: { status: 'approved' }
        }
      ]
    });

    const trainingData = [];

    for (const member of members) {
      try {
        // Only include members with some history
        const hasLoans = member.loans && member.loans.length > 0;
        const hasContributions = member.contributions && member.contributions.length > 0;
        
        if (!hasContributions && !hasLoans) continue;

        // Extract features
        const features = await enhancedFeatures.extractAllFeatures(member.id, member.groupId);
        
        // Calculate target score based on actual performance
        const targetScore = await this.calculateTargetScore(member, features);
        
        trainingData.push({
          features,
          targetScore
        });
      } catch (error) {
        console.warn(`Skipping member ${member.id}: ${error.message}`);
      }
    }

    console.log(`Collected ${trainingData.length} training samples`);
    return trainingData;
  }

  /**
   * Calculate target credit score based on actual member performance
   */
  async calculateTargetScore(member, features) {
    let score = 50; // Base score

    // Contribution factors (0-30 points)
    const contributionScore = Math.min(30, 
      (features.contributionConsistency * 15) +
      (Math.min(features.totalContributions / 24, 1) * 10) +
      (features.contributionGrowthTrend > 0 ? 5 : 0)
    );

    // Loan repayment factors (0-30 points)
    const repaymentScore = Math.min(30,
      (features.repaymentDiscipline * 20) +
      (features.averageRepaymentSpeed > 1 ? 5 : 0) +
      (features.hasDefaultHistory ? -15 : 0) +
      (features.defaultRate === 0 ? 5 : -features.defaultRate * 10)
    );

    // Savings factors (0-20 points)
    const savingsScore = Math.min(20,
      (Math.min(features.totalSavings / 500000, 1) * 10) +
      (features.savingsGrowthRate > 0 ? 5 : 0) +
      (features.balanceStability * 5)
    );

    // Engagement factors (0-15 points)
    const engagementScore = Math.min(15,
      (features.attendanceRate * 7) +
      (features.participationScore * 5) +
      (features.fineComplianceRate * 3)
    );

    // Membership age factor (0-5 points)
    const ageScore = Math.min(5, features.membershipAgeMonths / 12);

    score = contributionScore + repaymentScore + savingsScore + engagementScore + ageScore;

    // Apply penalties
    if (features.unpaidFines > 0) score -= features.unpaidFines * 2;
    if (features.missedContributions > 3) score -= (features.missedContributions - 3) * 2;
    if (features.totalOutstanding > features.totalSavings * 2) score -= 10;

    return Math.max(0, Math.min(100, Math.round(score)));
  }

  /**
   * Normalize features for training
   */
  normalizeFeatures(features) {
    const normalized = {};
    
    // Define feature ranges and normalization
    const featureConfig = {
      // Contribution features
      totalContributions: { min: 0, max: 100, log: false },
      avgContributionAmount: { min: 0, max: 100000, log: true },
      contributionConsistency: { min: 0, max: 1, log: false },
      missedContributions: { min: 0, max: 20, log: false },
      contributionGrowthTrend: { min: -1, max: 1, log: false },
      
      // Loan features
      totalLoans: { min: 0, max: 20, log: false },
      completedLoans: { min: 0, max: 20, log: false },
      averageRepaymentSpeed: { min: 0, max: 2, log: false },
      repaymentDiscipline: { min: 0, max: 1, log: false },
      defaultRate: { min: 0, max: 1, log: false },
      totalOutstanding: { min: 0, max: 1000000, log: true },
      
      // Savings features
      totalSavings: { min: 0, max: 2000000, log: true },
      avgMonthlySavings: { min: 0, max: 100000, log: true },
      savingsGrowthRate: { min: -1, max: 1, log: false },
      balanceStability: { min: 0, max: 1, log: false },
      
      // Engagement features
      attendanceRate: { min: 0, max: 1, log: false },
      participationScore: { min: 0, max: 1, log: false },
      totalFines: { min: 0, max: 10, log: false },
      fineComplianceRate: { min: 0, max: 1, log: false },
      
      // Membership
      membershipAgeMonths: { min: 0, max: 60, log: false }
    };

    // Normalize each feature
    Object.keys(featureConfig).forEach(key => {
      const config = featureConfig[key];
      let value = features[key] || 0;
      
      // Clamp to range
      value = Math.max(config.min, Math.min(config.max, value));
      
      // Apply log transform if needed
      if (config.log && value > 0) {
        value = Math.log1p(value);
        const maxLog = Math.log1p(config.max);
        normalized[key] = value / maxLog;
      } else {
        // Linear normalization
        const range = config.max - config.min;
        normalized[key] = range > 0 ? (value - config.min) / range : 0;
      }
    });

    // Encode categorical features
    normalized.contributionFrequency_weekly = features.contributionFrequency === 'weekly' ? 1 : 0;
    normalized.contributionFrequency_monthly = features.contributionFrequency === 'monthly' ? 1 : 0;
    normalized.engagementLevel_high = features.engagementLevel === 'high' ? 1 : 0;
    normalized.engagementLevel_medium = features.engagementLevel === 'medium' ? 1 : 0;
    normalized.hasDefaultHistory = features.hasDefaultHistory ? 1 : 0;
    normalized.hasOccupation = features.hasOccupation ? 1 : 0;

    return normalized;
  }

  /**
   * Train the model using gradient descent
   */
  async train(trainingData) {
    if (trainingData.length === 0) {
      throw new Error('No training data available');
    }

    console.log('Training enhanced credit model...');
    console.log(`Training samples: ${trainingData.length}`);

    // Extract and normalize features
    const normalizedData = trainingData.map(sample => ({
      features: this.normalizeFeatures(sample.features),
      target: sample.targetScore / 100 // Normalize to 0-1
    }));

    // Get all feature names
    this.featureNames = Object.keys(normalizedData[0].features);
    this.featureNames.forEach(f => {
      this.weights[f] = 0;
    });
    this.weights.bias = 0;

    // Training parameters
    const learningRate = 0.01;
    const epochs = 200;
    const batchSize = Math.min(32, Math.floor(normalizedData.length / 4));

    console.log(`Training with ${epochs} epochs, batch size: ${batchSize}`);

    for (let epoch = 0; epoch < epochs; epoch++) {
      let totalError = 0;
      let batchCount = 0;

      // Shuffle data
      const shuffled = [...normalizedData].sort(() => Math.random() - 0.5);

      // Process in batches
      for (let i = 0; i < shuffled.length; i += batchSize) {
        const batch = shuffled.slice(i, i + batchSize);
        batchCount++;

        // Calculate gradients for batch
        const gradients = {};
        this.featureNames.forEach(f => gradients[f] = 0);
        let biasGradient = 0;

        batch.forEach(sample => {
          // Forward pass
          let prediction = this.weights.bias;
          this.featureNames.forEach(f => {
            prediction += this.weights[f] * sample.features[f];
          });

          // Apply sigmoid
          const output = 1 / (1 + Math.exp(-prediction));
          const error = sample.target - output;

          // Backward pass
          biasGradient += error;
          this.featureNames.forEach(f => {
            gradients[f] += error * sample.features[f];
          });

          totalError += Math.abs(error);
        });

        // Update weights
        this.weights.bias += learningRate * (biasGradient / batch.length);
        this.featureNames.forEach(f => {
          this.weights[f] += learningRate * (gradients[f] / batch.length);
        });
      }

      if (epoch % 20 === 0) {
        const avgError = totalError / normalizedData.length;
        console.log(`Epoch ${epoch}: Average error = ${avgError.toFixed(4)}`);
      }
    }

    this.trained = true;
    console.log('Training completed!');
  }

  /**
   * Predict credit score from features
   */
  predict(features) {
    if (!this.trained) {
      throw new Error('Model not trained');
    }

    const normalized = this.normalizeFeatures(features);

    let prediction = this.weights.bias;
    this.featureNames.forEach(f => {
      if (this.weights[f] !== undefined && normalized[f] !== undefined) {
        prediction += this.weights[f] * normalized[f];
      }
    });

    // Apply sigmoid and convert to 0-100 scale
    const probability = 1 / (1 + Math.exp(-prediction));
    const creditScore = Math.round(probability * 100);

    return {
      creditScore: Math.max(0, Math.min(100, creditScore)),
      probability,
      confidence: this.calculateConfidence(probability)
    };
  }

  calculateConfidence(probability) {
    if (probability >= 0.8 || probability <= 0.2) return 'High';
    if (probability >= 0.6 || probability <= 0.4) return 'Medium';
    return 'Low';
  }

  /**
   * Save model to file
   */
  save(filePath) {
    const modelData = {
      weights: this.weights,
      featureNames: this.featureNames,
      trained: this.trained,
      version: '2.0',
      timestamp: new Date().toISOString()
    };

    fs.writeFileSync(filePath, JSON.stringify(modelData, null, 2), 'utf8');
    console.log('Model saved to:', filePath);
  }

  /**
   * Load model from file
   */
  load(filePath) {
    if (fs.existsSync(filePath)) {
      const modelData = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      this.weights = modelData.weights || {};
      this.featureNames = modelData.featureNames || [];
      this.trained = modelData.trained || false;
      return true;
    }
    return false;
  }
}

/**
 * Train and save the enhanced model
 */
async function trainAndSave() {
  try {
    // Initialize database connection
    await sequelize.authenticate();
    console.log('Database connected');

    const model = new EnhancedCreditModel();
    
    // Collect training data
    const trainingData = await model.collectTrainingData();
    
    if (trainingData.length < 10) {
      console.warn('Warning: Limited training data. Model may not be accurate.');
      console.log('Consider adding more member data with loan and contribution history.');
    }

    // Train model
    await model.train(trainingData);

    // Save model
    const modelPath = path.join(__dirname, '../../data/enhanced_credit_model.json');
    model.save(modelPath);

    console.log('\n✅ Enhanced credit model training completed!');
    console.log(`📁 Model saved to: ${modelPath}`);
    console.log(`📊 Trained on ${trainingData.length} samples`);
    
    process.exit(0);
  } catch (error) {
    console.error('Training error:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  trainAndSave();
}

module.exports = { EnhancedCreditModel, trainAndSave };


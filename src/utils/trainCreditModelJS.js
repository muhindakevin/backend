const fs = require('fs');
const path = require('path');

/**
 * Simple ML-based credit scoring using the German Credit Dataset
 * Trains a simple model without requiring Python
 */
class SimpleCreditModel {
  constructor() {
    this.weights = {};
    this.trained = false;
  }

  /**
   * Load and parse German Credit Dataset
   */
  loadDataset(filePath) {
    const data = fs.readFileSync(filePath, 'utf8');
    const lines = data.trim().split('\n');
    const dataset = [];

    lines.forEach((line, index) => {
      if (index === 0) return; // Skip header
      const values = line.split(',');
      if (values.length >= 21) {
        dataset.push({
          checking_account: values[0],
          duration: parseInt(values[1]) || 0,
          credit_history: values[2],
          purpose: values[3],
          credit_amount: parseInt(values[4]) || 0,
          savings_account: values[5],
          employment: values[6],
          installment_rate: parseInt(values[7]) || 0,
          personal_status: values[8],
          other_debtors: values[9],
          residence_since: parseInt(values[10]) || 0,
          property: values[11],
          age: parseInt(values[12]) || 0,
          other_installment_plans: values[13],
          housing: values[14],
          existing_credits: parseInt(values[15]) || 0,
          job: values[16],
          liable_people: parseInt(values[17]) || 0,
          telephone: values[18],
          foreign_worker: values[19],
          credit_risk: parseInt(values[20]) === 2 ? 1 : 0 // 1=bad, 2=good -> 0=good, 1=bad
        });
      }
    });

    return dataset;
  }

  /**
   * Extract numeric features from dataset
   */
  extractFeatures(record) {
    return {
      duration: record.duration / 100, // Normalize
      credit_amount: record.credit_amount / 10000, // Normalize
      installment_rate: record.installment_rate / 10,
      residence_since: record.residence_since / 10,
      age: record.age / 100,
      existing_credits: record.existing_credits / 10,
      liable_people: record.liable_people / 10,
      // Categorical features (encoded)
      checking_account_good: record.checking_account.includes('A14') ? 1 : 0,
      credit_history_good: ['A30', 'A31', 'A32'].includes(record.credit_history) ? 0 : 1,
      savings_good: ['A65', 'A64'].includes(record.savings_account) ? 1 : 0,
      employment_stable: ['A73', 'A74', 'A75'].includes(record.employment) ? 1 : 0
    };
  }

  /**
   * Train simple linear model
   */
  train(dataset) {
    console.log('Training model on', dataset.length, 'records...');

    // Initialize weights
    const featureNames = ['duration', 'credit_amount', 'installment_rate', 'residence_since', 
                         'age', 'existing_credits', 'liable_people', 'checking_account_good',
                         'credit_history_good', 'savings_good', 'employment_stable'];
    
    featureNames.forEach(f => {
      this.weights[f] = 0;
    });
    this.weights.bias = 0;

    // Simple gradient descent
    const learningRate = 0.01;
    const epochs = 100;

    for (let epoch = 0; epoch < epochs; epoch++) {
      let totalError = 0;

      dataset.forEach(record => {
        const features = this.extractFeatures(record);
        const target = record.credit_risk;

        // Calculate prediction
        let prediction = this.weights.bias;
        Object.keys(features).forEach(f => {
          prediction += this.weights[f] * features[f];
        });

        // Sigmoid activation
        const output = 1 / (1 + Math.exp(-prediction));
        const error = target - output;

        // Update weights
        this.weights.bias += learningRate * error;
        Object.keys(features).forEach(f => {
          this.weights[f] += learningRate * error * features[f];
        });

        totalError += Math.abs(error);
      });

      if (epoch % 20 === 0) {
        console.log(`Epoch ${epoch}: Average error = ${(totalError / dataset.length).toFixed(4)}`);
      }
    }

    this.trained = true;
    console.log('Training completed!');
  }

  /**
   * Predict credit risk
   */
  predict(features) {
    if (!this.trained) {
      throw new Error('Model not trained');
    }

    let prediction = this.weights.bias;
    Object.keys(features).forEach(f => {
      if (this.weights[f] !== undefined) {
        prediction += this.weights[f] * features[f];
      }
    });

    // Sigmoid activation
    const probability = 1 / (1 + Math.exp(-prediction));
    const creditScore = Math.round((1 - probability) * 1000); // Convert to 0-1000 scale

    return {
      credit_score: Math.max(0, Math.min(1000, creditScore)),
      probability_default: probability,
      risk_level: probability > 0.5 ? 'high' : 'low'
    };
  }

  /**
   * Save model
   */
  save(filePath) {
    fs.writeFileSync(filePath, JSON.stringify(this.weights, null, 2), 'utf8');
    console.log('Model saved to:', filePath);
  }

  /**
   * Load model
   */
  load(filePath) {
    if (fs.existsSync(filePath)) {
      this.weights = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      this.trained = true;
      return true;
    }
    return false;
  }
}

/**
 * Train and save model
 */
function trainAndSave() {
  const dataPath = path.join(__dirname, '../../data/german_credit.csv');
  const modelPath = path.join(__dirname, '../../data/credit_model.json');

  if (!fs.existsSync(dataPath)) {
    console.error('Dataset not found. Please run downloadCreditDataset.js first.');
    process.exit(1);
  }

  const model = new SimpleCreditModel();
  const dataset = model.loadDataset(dataPath);
  
  console.log(`Loaded ${dataset.length} records`);
  model.train(dataset);
  model.save(modelPath);
  
  console.log('\n✅ Model training completed!');
  console.log('📁 Model saved to:', modelPath);
}

if (require.main === module) {
  trainAndSave();
}

module.exports = { SimpleCreditModel, trainAndSave };


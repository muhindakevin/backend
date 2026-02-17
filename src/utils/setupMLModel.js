const { downloadGermanCreditDataset, processGermanCreditData } = require('./downloadCreditDataset');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

/**
 * Setup ML Credit Scoring Model
 * Downloads dataset and trains the model
 */
async function setupMLModel() {
  console.log('🚀 Setting up ML Credit Scoring Model...\n');

  try {
    // Step 1: Download or generate dataset
    console.log('📥 Step 1: Setting up dataset...');
    const dataPath = path.join(__dirname, '../../data/german_credit.csv');
    
    if (!fs.existsSync(dataPath)) {
      try {
        const csvPath = await downloadGermanCreditDataset();
        const processedPath = path.join(__dirname, '../../data/german_credit.csv');
        processGermanCreditData(csvPath, processedPath);
        console.log('✅ Dataset downloaded and processed\n');
      } catch (error) {
        console.log('⚠️  Download failed, generating sample dataset...');
        const { generateSampleDataset } = require('./generateSampleDataset');
        generateSampleDataset();
        console.log('✅ Sample dataset generated\n');
      }
    } else {
      console.log('✅ Dataset already exists\n');
    }

    // Step 3: Ready for training (no external dependencies needed)
    console.log('✅ Step 3: Ready for training\n');

    // Step 4: Train model
    console.log('🤖 Step 4: Training ML model...');
    await trainModelJS();
    console.log('✅ Model trained successfully\n');

    console.log('🎉 ML Credit Scoring Model setup complete!');
    console.log('📁 Model saved to: BackEnd/data/credit_model.json');
    console.log('\n💡 The system will now use ML-based credit scoring when available.');
    console.log('   It will automatically fall back to rule-based scoring if ML is unavailable.\n');

  } catch (error) {
    console.error('❌ Setup failed:', error.message);
    console.log('\n⚠️  The system will continue using rule-based credit scoring.');
    process.exit(1);
  }
}

function checkPythonDependencies() {
  return new Promise((resolve) => {
    const python = spawn('python3', ['-c', 'import pandas, numpy, sklearn, joblib']);
    python.on('close', (code) => {
      resolve(code === 0);
    });
    python.on('error', () => {
      resolve(false);
    });
  });
}

function installPythonDependencies() {
  return new Promise((resolve, reject) => {
    const requirementsPath = path.join(__dirname, '../../requirements.txt');
    const pip = spawn('pip3', ['install', '-r', requirementsPath]);
    
    pip.stdout.on('data', (data) => {
      process.stdout.write(data);
    });
    
    pip.stderr.on('data', (data) => {
      process.stderr.write(data);
    });
    
    pip.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error('Failed to install Python dependencies'));
      }
    });
  });
}

function trainModelJS() {
  return new Promise((resolve, reject) => {
    try {
      const { trainAndSave } = require('./trainCreditModelJS');
      trainAndSave();
      resolve();
    } catch (error) {
      reject(error);
    }
  });
}

// Run if called directly
if (require.main === module) {
  setupMLModel();
}

module.exports = { setupMLModel };


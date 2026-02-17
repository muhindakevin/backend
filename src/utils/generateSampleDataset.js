const fs = require('fs');
const path = require('path');

/**
 * Generate a sample credit dataset for training
 * Based on German Credit Dataset structure
 */
function generateSampleDataset() {
  const dataDir = path.join(__dirname, '../../data');
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  const outputPath = path.join(dataDir, 'german_credit.csv');
  
  // Sample data based on German Credit Dataset patterns
  const headers = [
    'checking_account', 'duration', 'credit_history', 'purpose', 'credit_amount',
    'savings_account', 'employment', 'installment_rate', 'personal_status', 'other_debtors',
    'residence_since', 'property', 'age', 'other_installment_plans', 'housing',
    'existing_credits', 'job', 'liable_people', 'telephone', 'foreign_worker', 'credit_risk'
  ];

  const lines = [headers.join(',')];

  // Generate 1000 sample records with realistic patterns
  for (let i = 0; i < 1000; i++) {
    const age = 20 + Math.floor(Math.random() * 50);
    const duration = 6 + Math.floor(Math.random() * 60);
    const creditAmount = 1000 + Math.floor(Math.random() * 15000);
    
    // Determine risk based on patterns
    let risk = 1; // Good credit
    if (creditAmount > 8000 && age < 30) risk = 2; // Higher risk
    if (duration > 36 && creditAmount > 10000) risk = 2;
    
    const record = [
      ['A11', 'A12', 'A13', 'A14'][Math.floor(Math.random() * 4)], // checking_account
      duration,
      ['A30', 'A31', 'A32', 'A33', 'A34'][Math.floor(Math.random() * 5)], // credit_history
      ['A40', 'A41', 'A42', 'A43', 'A44', 'A45', 'A46', 'A47', 'A48', 'A49', 'A410'][Math.floor(Math.random() * 11)], // purpose
      creditAmount,
      ['A61', 'A62', 'A63', 'A64', 'A65'][Math.floor(Math.random() * 5)], // savings_account
      ['A71', 'A72', 'A73', 'A74', 'A75'][Math.floor(Math.random() * 5)], // employment
      [1, 2, 3, 4][Math.floor(Math.random() * 4)], // installment_rate
      ['A91', 'A92', 'A93', 'A94', 'A95'][Math.floor(Math.random() * 5)], // personal_status
      ['A101', 'A102', 'A103'][Math.floor(Math.random() * 3)], // other_debtors
      [1, 2, 3, 4][Math.floor(Math.random() * 4)], // residence_since
      ['A121', 'A122', 'A123', 'A124'][Math.floor(Math.random() * 4)], // property
      age,
      ['A141', 'A142', 'A143'][Math.floor(Math.random() * 3)], // other_installment_plans
      ['A151', 'A152', 'A153'][Math.floor(Math.random() * 3)], // housing
      [0, 1, 2, 3, 4][Math.floor(Math.random() * 5)], // existing_credits
      ['A171', 'A172', 'A173', 'A174'][Math.floor(Math.random() * 4)], // job
      [0, 1, 2][Math.floor(Math.random() * 3)], // liable_people
      ['A191', 'A192'][Math.floor(Math.random() * 2)], // telephone
      ['A201', 'A202'][Math.floor(Math.random() * 2)], // foreign_worker
      risk
    ];
    
    lines.push(record.join(','));
  }

  fs.writeFileSync(outputPath, lines.join('\n'), 'utf8');
  console.log(`Generated ${lines.length - 1} sample records to ${outputPath}`);
  return outputPath;
}

if (require.main === module) {
  generateSampleDataset();
}

module.exports = { generateSampleDataset };


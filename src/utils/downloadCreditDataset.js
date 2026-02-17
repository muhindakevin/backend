const https = require('https');
const fs = require('fs');
const path = require('path');

/**
 * Download German Credit Dataset from UCI Repository
 */
async function downloadGermanCreditDataset() {
  const datasetUrl = 'https://archive.ics.uci.edu/ml/machine-learning-databases/statlog/german/german.data';
  const outputPath = path.join(__dirname, '../../data/german_credit.csv');
  
  // Create data directory if it doesn't exist
  const dataDir = path.dirname(outputPath);
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(outputPath);
    
    https.get(datasetUrl, (response) => {
      if (response.statusCode === 200) {
        response.pipe(file);
        file.on('finish', () => {
          file.close();
          console.log('Dataset downloaded successfully to:', outputPath);
          resolve(outputPath);
        });
      } else if (response.statusCode === 301 || response.statusCode === 302) {
        // Handle redirect
        https.get(response.headers.location, (redirectResponse) => {
          redirectResponse.pipe(file);
          file.on('finish', () => {
            file.close();
            console.log('Dataset downloaded successfully to:', outputPath);
            resolve(outputPath);
          });
        });
      } else {
        reject(new Error(`Failed to download: ${response.statusCode}`));
      }
    }).on('error', (err) => {
      fs.unlink(outputPath, () => {});
      reject(err);
    });
  });
}

/**
 * Convert German Credit data to CSV format with headers
 */
function processGermanCreditData(inputPath, outputPath) {
  const data = fs.readFileSync(inputPath, 'utf8');
  const lines = data.trim().split('\n');
  
  // German Credit Dataset attributes:
  // 1. Status of existing checking account
  // 2. Duration in month
  // 3. Credit history
  // 4. Purpose
  // 5. Credit amount
  // 6. Savings account/bonds
  // 7. Present employment since
  // 8. Installment rate in percentage of disposable income
  // 9. Personal status and sex
  // 10. Other debtors / guarantors
  // 11. Present residence since
  // 12. Property
  // 13. Age in years
  // 14. Other installment plans
  // 15. Housing
  // 16. Number of existing credits at this bank
  // 17. Job
  // 18. Number of people being liable to provide maintenance for
  // 19. Telephone
  // 20. Foreign worker
  // 21. Credit risk (1=good, 2=bad)
  
  const headers = [
    'checking_account', 'duration', 'credit_history', 'purpose', 'credit_amount',
    'savings_account', 'employment', 'installment_rate', 'personal_status', 'other_debtors',
    'residence_since', 'property', 'age', 'other_installment_plans', 'housing',
    'existing_credits', 'job', 'liable_people', 'telephone', 'foreign_worker', 'credit_risk'
  ];
  
  const csvLines = [headers.join(',')];
  
  lines.forEach(line => {
    if (line.trim()) {
      // Replace spaces with commas
      const csvLine = line.trim().split(/\s+/).join(',');
      csvLines.push(csvLine);
    }
  });
  
  fs.writeFileSync(outputPath, csvLines.join('\n'), 'utf8');
  console.log(`Processed ${lines.length} records to CSV format`);
  return outputPath;
}

module.exports = {
  downloadGermanCreditDataset,
  processGermanCreditData
};


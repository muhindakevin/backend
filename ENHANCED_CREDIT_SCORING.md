# Enhanced AI-Powered Credit Scoring System

## Overview

This document describes the enhanced AI-powered credit scoring model specifically designed for saving groups/cooperatives. The system evaluates and recommends loan limits for each member based on comprehensive financial and engagement data.

## Features Implemented

### 1. Comprehensive Data Inputs

The model now learns from all required data sources:

#### Contribution History
- Amount contributed per cycle
- Contribution frequency (weekly/monthly/irregular)
- Consistency over time (percentage)
- Missed contributions count
- Growth trend (increasing/decreasing contributions)

#### Loan History
- Previous loan amounts
- Repayment speed and patterns
- Late payments count
- Early payments count
- Default risk indicators
- Outstanding loan balance
- Loan-to-savings ratio

#### Savings Account Behavior
- Total savings
- Average monthly savings
- Withdrawal patterns
- Minimum balance behavior
- Balance stability
- Savings growth rate

#### Group Engagement
- Meeting attendance rate
- Participation in meetings
- Penalties and fines (total, paid, unpaid)
- Fine compliance rate
- Time spent in the group (membership age)
- Participation score

#### Financial Stability Indicators
- Occupation information
- Account age
- Account status
- Additional profile completeness

### 2. Credit Score Output

- **Score Range**: 0-100 (updated from 0-1000)
- **Risk Categories**: Low, Medium, High
- **Loan Limit Recommendation**: Calculated based on risk category and credit score
- **Detailed Explanations**: AI-generated explanations for recommendations

### 3. Model Architecture

- **Enhanced Feature Extraction**: `BackEnd/src/utils/enhancedCreditFeatures.js`
- **ML Model Training**: `BackEnd/src/utils/trainEnhancedCreditModel.js`
- **ML Credit Scorer**: `BackEnd/src/utils/enhancedMLCreditScorer.js`
- **Credit Calculator**: `BackEnd/src/utils/creditScoreCalculator.js` (updated)

## How It Works

### Feature Extraction

The system extracts comprehensive features from:
1. Contributions table
2. Loans table
3. Transactions table
4. Meetings table
5. Fines table
6. User profile

### Model Training

The model uses:
- **Algorithm**: Logistic Regression with gradient descent
- **Features**: 30+ normalized features
- **Training Data**: Real member data from database
- **Output**: Credit score (0-100) with probability

### Risk Categorization

- **Low Risk**: Score ≥ 70, high consistency, no defaults, good engagement
- **Medium Risk**: Score 40-69, mixed performance
- **High Risk**: Score < 40, defaults, poor engagement, unpaid fines

### Loan Limit Calculation

Loan limits are calculated based on:
- Risk category
- Credit score
- Total savings
- Outstanding loans
- Unpaid fines

**Limits by Risk Category:**
- Low Risk: Up to 3x savings or savings + 500k RWF
- Medium Risk: Up to 1.5x savings or savings + 200k RWF
- High Risk: Up to 1x savings or savings + 50k RWF

## Training the Model

### Step 1: Ensure Database Connection

Make sure your database is running and accessible.

### Step 2: Run Training Script

```bash
cd BackEnd
node src/utils/trainEnhancedCreditModel.js
```

The script will:
1. Connect to the database
2. Collect training data from all members
3. Extract features for each member
4. Calculate target scores based on actual performance
5. Train the ML model
6. Save the model to `BackEnd/data/enhanced_credit_model.json`

### Step 3: Verify Model

Check that the model file was created:
```bash
ls -la BackEnd/data/enhanced_credit_model.json
```

## Usage

### Automatic Integration

The enhanced credit scoring is automatically integrated into:
- Loan request flow (`/api/loans/request`)
- Member dashboard (`/api/members/dashboard`)
- Loan recommendation endpoint (`/api/members/loan-recommendation`)

### API Response Format

```json
{
  "creditScore": 75,
  "riskCategory": "Low",
  "loanLimit": 750000,
  "explanation": "Member demonstrates strong financial discipline...",
  "confidence": "High",
  "recommendation": "approve",
  "maxRecommendedAmount": 750000,
  "interestRate": 5.0,
  "message": "Excellent credit score!",
  "savings": 250000
}
```

### Frontend Display

The frontend automatically displays:
- Credit score (0-100)
- Risk category (with color coding)
- Detailed explanation
- Recommended loan limit
- Confidence level

## Model Updates

The model automatically updates when:
- New contributions are made
- Loan payments are recorded
- Meetings are attended
- Fines are issued/paid

The credit score is recalculated in real-time when:
- Member requests a loan
- Dashboard is loaded
- Loan recommendation is requested

## Safeguards

1. **Minimum Savings Requirement**: 10,000 RWF for loan eligibility
2. **Maximum Loan Limits**: Based on risk category and savings
3. **Outstanding Loan Check**: Reduces limit if outstanding loans exist
4. **Unpaid Fines**: Deducted from loan limit
5. **Default History**: Significant penalty in scoring

## Model Transparency

The system provides:
- Feature summary showing key metrics
- Detailed explanations for recommendations
- Risk category with reasoning
- Confidence levels

## Files Modified/Created

### New Files
- `BackEnd/src/utils/enhancedCreditFeatures.js` - Feature extraction
- `BackEnd/src/utils/trainEnhancedCreditModel.js` - Model training
- `BackEnd/src/utils/enhancedMLCreditScorer.js` - ML scoring with explanations

### Updated Files
- `BackEnd/src/utils/creditScoreCalculator.js` - Enhanced with new features
- `FrontEnd/src/components/modals/LoanRequestModal.jsx` - Display risk category & explanation
- `FrontEnd/src/pages/MemberDashboard.jsx` - Updated credit score display
- `FrontEnd/src/pages/MemberLoans.jsx` - Updated credit score display
- `FrontEnd/src/pages/SystemAdminLoans.jsx` - Updated credit score display
- `FrontEnd/src/pages/GroupAdminLoanRequests.jsx` - Updated credit score display
- `FrontEnd/src/pages/MemberGroup.jsx` - Updated credit score display

## Testing

To test the enhanced credit scoring:

1. **Train the model** (see Training section above)
2. **Request a loan** as a member
3. **Check the dashboard** for credit score and recommendations
4. **Verify explanations** are displayed correctly

## Notes

- The model falls back to rule-based scoring if ML model is not available
- Credit scores are calculated on-demand (not cached)
- The system handles missing data gracefully with safe defaults
- All calculations are transparent and explainable

## Future Enhancements

Potential improvements:
- Model retraining scheduler
- A/B testing for different models
- Feature importance analysis
- Historical score tracking
- Score change notifications


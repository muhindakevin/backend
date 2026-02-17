#!/usr/bin/env python3
"""
Predict credit risk using trained model
Called from Node.js
"""
import sys
import json
import joblib
import pandas as pd
import os

def predict(features_dict):
    """Predict credit risk from features"""
    script_dir = os.path.dirname(os.path.abspath(__file__))
    model_path = os.path.join(script_dir, '../../data/credit_model.pkl')
    
    if not os.path.exists(model_path):
        return {
            'error': 'Model not found. Please train the model first.'
        }
    
    # Load model
    model = joblib.load(model_path)
    
    # Convert features to DataFrame
    # Note: This is a simplified version - in production you'd need proper encoding
    # For now, we'll use a rule-based approach with ML enhancement
    
    # Map categorical to numeric (simplified)
    feature_vector = [
        features_dict.get('checking_account', 0),
        features_dict.get('duration', 12),
        features_dict.get('credit_history', 0),
        features_dict.get('purpose', 4),
        features_dict.get('credit_amount', 0),
        features_dict.get('savings_account', 0),
        features_dict.get('employment', 1),
        features_dict.get('installment_rate', 1),
        features_dict.get('personal_status', 1),
        features_dict.get('other_debtors', 1),
        features_dict.get('residence_since', 1),
        features_dict.get('property', 1),
        features_dict.get('age', 35),
        features_dict.get('other_installment_plans', 0),
        features_dict.get('housing', 1),
        features_dict.get('existing_credits', 0),
        features_dict.get('job', 1),
        features_dict.get('liable_people', 0),
        features_dict.get('telephone', 1),
        features_dict.get('foreign_worker', 0)
    ]
    
    # Create DataFrame
    df = pd.DataFrame([feature_vector], columns=model.feature_names_in_ if hasattr(model, 'feature_names_in_') else None)
    
    # Predict
    prediction = model.predict(df)[0]
    probability = model.predict_proba(df)[0]
    
    return {
        'risk': 'high' if prediction == 1 else 'low',
        'probability_default': float(probability[1]),
        'probability_good': float(probability[0]),
        'credit_score': int((1 - probability[1]) * 1000)
    }

if __name__ == '__main__':
    try:
        features_json = sys.argv[1]
        features = json.loads(features_json)
        result = predict(features)
        print(json.dumps(result))
    except Exception as e:
        print(json.dumps({'error': str(e)}))


#!/usr/bin/env python3
"""
Train Credit Scoring ML Model using German Credit Dataset
"""
import pandas as pd
import numpy as np
from sklearn.model_selection import train_test_split
from sklearn.ensemble import RandomForestClassifier
from sklearn.preprocessing import LabelEncoder
from sklearn.metrics import accuracy_score, classification_report, confusion_matrix
import joblib
import os
import sys

def load_and_preprocess_data(csv_path):
    """Load and preprocess the German Credit dataset"""
    print("Loading dataset...")
    df = pd.read_csv(csv_path)
    
    # Map credit risk: 1=good (0), 2=bad (1)
    df['credit_risk'] = df['credit_risk'].map({1: 0, 2: 1})
    
    # Separate features and target
    X = df.drop('credit_risk', axis=1)
    y = df['credit_risk']
    
    # Encode categorical variables
    label_encoders = {}
    X_encoded = X.copy()
    
    categorical_cols = ['checking_account', 'credit_history', 'purpose', 'savings_account',
                       'employment', 'personal_status', 'other_debtors', 'property',
                       'other_installment_plans', 'housing', 'job', 'telephone', 'foreign_worker']
    
    for col in categorical_cols:
        if col in X_encoded.columns:
            le = LabelEncoder()
            X_encoded[col] = le.fit_transform(X_encoded[col].astype(str))
            label_encoders[col] = le
    
    return X_encoded, y, label_encoders

def train_model(X, y):
    """Train Random Forest model"""
    print("Training model...")
    
    # Split data
    X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42, stratify=y)
    
    # Train Random Forest
    model = RandomForestClassifier(
        n_estimators=100,
        max_depth=10,
        min_samples_split=5,
        min_samples_leaf=2,
        random_state=42,
        n_jobs=-1
    )
    
    model.fit(X_train, y_train)
    
    # Evaluate
    y_pred = model.predict(X_test)
    accuracy = accuracy_score(y_test, y_pred)
    
    print(f"\nModel Accuracy: {accuracy:.4f}")
    print("\nClassification Report:")
    print(classification_report(y_test, y_pred))
    
    return model, accuracy

def predict_credit_risk(model, features_dict):
    """
    Predict credit risk for a new applicant
    Features expected:
    - checking_account, duration, credit_history, purpose, credit_amount
    - savings_account, employment, installment_rate, personal_status, other_debtors
    - residence_since, property, age, other_installment_plans, housing
    - existing_credits, job, liable_people, telephone, foreign_worker
    """
    # Convert to DataFrame
    df = pd.DataFrame([features_dict])
    
    # Load label encoders and encode
    # Note: In production, you'd load saved encoders
    # For now, we'll use numeric values directly
    
    prediction = model.predict(df)[0]
    probability = model.predict_proba(df)[0]
    
    return {
        'risk': 'high' if prediction == 1 else 'low',
        'probability_default': float(probability[1]),
        'probability_good': float(probability[0]),
        'credit_score': int((1 - probability[1]) * 1000)  # Convert to 0-1000 scale
    }

if __name__ == '__main__':
    # Get paths
    script_dir = os.path.dirname(os.path.abspath(__file__))
    data_dir = os.path.join(script_dir, '../../data')
    csv_path = os.path.join(data_dir, 'german_credit.csv')
    model_path = os.path.join(data_dir, 'credit_model.pkl')
    
    if not os.path.exists(csv_path):
        print(f"Error: Dataset not found at {csv_path}")
        print("Please run downloadCreditDataset.js first")
        sys.exit(1)
    
    # Load and preprocess
    X, y, encoders = load_and_preprocess_data(csv_path)
    
    # Train model
    model, accuracy = train_model(X, y)
    
    # Save model
    os.makedirs(data_dir, exist_ok=True)
    joblib.dump(model, model_path)
    print(f"\nModel saved to: {model_path}")
    
    # Save feature names for later use
    feature_names_path = os.path.join(data_dir, 'feature_names.txt')
    with open(feature_names_path, 'w') as f:
        f.write('\n'.join(X.columns.tolist()))
    
    print("Training completed successfully!")


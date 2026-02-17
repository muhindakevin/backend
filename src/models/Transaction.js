module.exports = (sequelize, DataTypes) => {
  const Transaction = sequelize.define('Transaction', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },
    userId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: 'Users',
        key: 'id'
      }
    },
    type: {
      type: DataTypes.ENUM('contribution', 'loan_payment', 'loan_disbursement', 'fine_payment', 'interest', 'refund', 'fee'),
      allowNull: false
    },
    amount: {
      type: DataTypes.DECIMAL(15, 2),
      allowNull: false
    },
    balance: {
      type: DataTypes.DECIMAL(15, 2),
      allowNull: false,
      comment: 'Balance after transaction'
    },
    status: {
      type: DataTypes.ENUM('pending', 'completed', 'failed', 'cancelled'),
      defaultValue: 'pending'
    },
    referenceId: {
      type: DataTypes.STRING(100),
      allowNull: true,
      comment: 'Reference to related entity (loanId, contributionId, etc.)'
    },
    referenceType: {
      type: DataTypes.STRING(50),
      allowNull: true,
      comment: 'Type of reference (Loan, Contribution, Fine, etc.)'
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    paymentMethod: {
      type: DataTypes.ENUM('cash', 'mtn_mobile_money', 'airtel_money', 'bank_transfer'),
      allowNull: true
    },
    transactionDate: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW
    },
    createdAt: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW
    },
    updatedAt: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW
    }
  }, {
    tableName: 'Transactions',
    timestamps: true,
    indexes: [
      {
        fields: ['userId', 'transactionDate']
      },
      {
        fields: ['type', 'status']
      }
    ]
  });

  return Transaction;
};


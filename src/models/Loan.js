module.exports = (sequelize, DataTypes) => {
  const Loan = sequelize.define('Loan', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },
    memberId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: 'Users',
        key: 'id'
      }
    },
    groupId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: 'Groups',
        key: 'id'
      }
    },
    amount: {
      type: DataTypes.DECIMAL(15, 2),
      allowNull: false
    },
    purpose: {
      type: DataTypes.STRING(255),
      allowNull: false
    },
    interestRate: {
      type: DataTypes.DECIMAL(5, 2),
      defaultValue: 5.0
    },
    duration: {
      type: DataTypes.INTEGER,
      allowNull: false,
      comment: 'Duration in months'
    },
    monthlyPayment: {
      type: DataTypes.DECIMAL(15, 2),
      allowNull: false
    },
    totalAmount: {
      type: DataTypes.DECIMAL(15, 2),
      allowNull: false,
      comment: 'Principal + Interest'
    },
    status: {
      type: DataTypes.ENUM('pending', 'approved', 'rejected', 'disbursed', 'active', 'completed', 'defaulted'),
      defaultValue: 'pending'
    },
    requestDate: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW
    },
    approvalDate: {
      type: DataTypes.DATE,
      allowNull: true
    },
    approvedBy: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: {
        model: 'Users',
        key: 'id'
      }
    },
    disbursementDate: {
      type: DataTypes.DATE,
      allowNull: true
    },
    paidAmount: {
      type: DataTypes.DECIMAL(15, 2),
      defaultValue: 0
    },
    remainingAmount: {
      type: DataTypes.DECIMAL(15, 2),
      allowNull: false
    },
    nextPaymentDate: {
      type: DataTypes.DATE,
      allowNull: true
    },
    aiRecommendation: {
      type: DataTypes.ENUM('approve', 'reject', 'review'),
      allowNull: true
    },
    rejectionReason: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    documents: {
      type: DataTypes.JSON,
      allowNull: true,
      comment: 'Array of document URLs'
    },
    guarantorId: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: {
        model: 'Users',
        key: 'id'
      },
      comment: 'Reference to the guarantor user (must be a member of the same group)'
    },
    guarantorName: {
      type: DataTypes.STRING(100),
      allowNull: true,
      comment: 'Guarantor full name'
    },
    guarantorPhone: {
      type: DataTypes.STRING(20),
      allowNull: true,
      comment: 'Guarantor phone number'
    },
    guarantorNationalId: {
      type: DataTypes.STRING(50),
      allowNull: true,
      comment: 'Guarantor national ID'
    },
    guarantorRelationship: {
      type: DataTypes.STRING(100),
      allowNull: true,
      comment: 'Relationship to borrower (e.g., family member, friend, colleague)'
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
    tableName: 'Loans',
    timestamps: true
  });

  return Loan;
};


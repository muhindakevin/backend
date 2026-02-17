module.exports = (sequelize, DataTypes) => {
  const ScheduledAudit = sequelize.define('ScheduledAudit', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },
    groupId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: 'Groups',
        key: 'id'
      }
    },
    scheduledBy: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: 'Users',
        key: 'id'
      }
    },
    auditType: {
      type: DataTypes.ENUM('compliance_check', 'financial_audit', 'group_verification', 'investigation'),
      allowNull: false,
      defaultValue: 'compliance_check'
    },
    scheduledDate: {
      type: DataTypes.DATE,
      allowNull: false
    },
    status: {
      type: DataTypes.ENUM('scheduled', 'in_progress', 'completed', 'cancelled'),
      defaultValue: 'scheduled',
      allowNull: false
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    checklist: {
      type: DataTypes.JSON,
      allowNull: true,
      comment: 'JSON array of checklist items with status'
    },
    findings: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    recommendations: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    completedAt: {
      type: DataTypes.DATE,
      allowNull: true
    },
    completedBy: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: {
        model: 'Users',
        key: 'id'
      }
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
    tableName: 'ScheduledAudits',
    timestamps: true,
    indexes: [
      { fields: ['groupId'] },
      { fields: ['scheduledBy'] },
      { fields: ['status'] },
      { fields: ['scheduledDate'] }
    ]
  });

  return ScheduledAudit;
};


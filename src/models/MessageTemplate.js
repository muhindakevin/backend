module.exports = (sequelize, DataTypes) => {
  const MessageTemplate = sequelize.define('MessageTemplate', {
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
      },
      comment: 'User who created/owns this template'
    },
    groupId: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: {
        model: 'Groups',
        key: 'id'
      },
      comment: 'Group this template belongs to (for group-specific templates)'
    },
    name: {
      type: DataTypes.STRING(255),
      allowNull: false,
      comment: 'Template name (e.g., "Contribution Reminder")'
    },
    subject: {
      type: DataTypes.STRING(255),
      allowNull: true,
      comment: 'Message subject/title'
    },
    content: {
      type: DataTypes.TEXT,
      allowNull: false,
      comment: 'Template content with placeholders like [Member Name], [Amount], etc.'
    },
    type: {
      type: DataTypes.ENUM('contribution_reminder', 'loan_payment_reminder', 'fine_notification', 'general_announcement', 'custom'),
      allowNull: false,
      defaultValue: 'custom'
    },
    isDefault: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
      comment: 'Whether this is a default system template'
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
    tableName: 'MessageTemplates',
    timestamps: true,
    indexes: [
      {
        fields: ['userId', 'groupId']
      },
      {
        fields: ['type']
      }
    ]
  });

  return MessageTemplate;
};


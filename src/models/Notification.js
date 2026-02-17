module.exports = (sequelize, DataTypes) => {
  const Notification = sequelize.define('Notification', {
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
      type: DataTypes.ENUM(
        'otp', 'registration', 'loan_approval', 'loan_rejection', 
        'contribution_confirmation', 'fine_issued', 'meeting_reminder',
        'announcement', 'vote_created', 'learn_grow_update', 'chat_message', 'general', 'agent_action'
      ),
      allowNull: false
    },
    channel: {
      type: DataTypes.ENUM('sms', 'email', 'in_app'),
      defaultValue: 'in_app'
    },
    title: {
      type: DataTypes.STRING(255),
      allowNull: false
    },
    content: {
      type: DataTypes.TEXT,
      allowNull: false
    },
    recipient: {
      type: DataTypes.STRING(255),
      allowNull: true,
      comment: 'Phone or email address'
    },
    status: {
      type: DataTypes.ENUM('sent', 'failed', 'pending'),
      defaultValue: 'pending'
    },
    read: {
      type: DataTypes.BOOLEAN,
      defaultValue: false
    },
    readAt: {
      type: DataTypes.DATE,
      allowNull: true
    },
    error: {
      type: DataTypes.TEXT,
      allowNull: true
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
    tableName: 'Notifications',
    timestamps: true,
    indexes: [
      {
        fields: ['userId', 'read']
      },
      {
        fields: ['type', 'status']
      }
    ]
  });

  return Notification;
};


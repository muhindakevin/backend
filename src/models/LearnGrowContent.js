module.exports = (sequelize, DataTypes) => {
  const LearnGrowContent = sequelize.define('LearnGrowContent', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },
    title: {
      type: DataTypes.STRING(255),
      allowNull: false
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    content: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    type: {
      type: DataTypes.ENUM('article', 'video', 'pdf', 'quiz', 'infographic'),
      allowNull: false
    },
    category: {
      type: DataTypes.STRING(100),
      allowNull: true,
      comment: 'e.g., Saving, Budgeting, Loans, Investment'
    },
    fileUrl: {
      type: DataTypes.STRING(500),
      allowNull: true
    },
    thumbnailUrl: {
      type: DataTypes.STRING(500),
      allowNull: true
    },
    duration: {
      type: DataTypes.INTEGER,
      allowNull: true,
      comment: 'Duration in minutes (for videos)'
    },
    status: {
      type: DataTypes.ENUM('draft', 'published', 'archived'),
      defaultValue: 'draft'
    },
    targetAudience: {
      type: DataTypes.ENUM('members', 'secretary', 'agent', 'agents', 'both'),
      defaultValue: 'members',
      allowNull: false
    },
    views: {
      type: DataTypes.INTEGER,
      defaultValue: 0
    },
    createdBy: {
      type: DataTypes.INTEGER,
      allowNull: false,
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
    tableName: 'LearnGrowContents',
    timestamps: true
  });

  return LearnGrowContent;
};


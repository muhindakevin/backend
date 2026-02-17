module.exports = (sequelize, DataTypes) => {
  const VoteOption = sequelize.define('VoteOption', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },
    voteId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: 'Votes',
        key: 'id'
      }
    },
    option: {
      type: DataTypes.STRING(255),
      allowNull: false
    },
    voteCount: {
      type: DataTypes.INTEGER,
      defaultValue: 0
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
    tableName: 'VoteOptions',
    timestamps: true
  });

  return VoteOption;
};


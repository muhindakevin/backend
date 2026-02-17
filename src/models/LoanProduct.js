module.exports = (sequelize, DataTypes) => {
  const LoanProduct = sequelize.define('LoanProduct', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    name: { type: DataTypes.STRING(100), allowNull: false },
    description: { type: DataTypes.TEXT, allowNull: true },
    interestRate: { type: DataTypes.DECIMAL(5,2), allowNull: false, defaultValue: 0 },
    maxAmount: { type: DataTypes.DECIMAL(15,2), allowNull: false, defaultValue: 0 },
    minAmount: { type: DataTypes.DECIMAL(15,2), allowNull: false, defaultValue: 0 },
    termMonths: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 }
  }, { tableName: 'LoanProducts', timestamps: true });
  return LoanProduct;
};



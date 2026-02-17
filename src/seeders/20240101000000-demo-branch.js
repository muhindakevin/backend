'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    // Check if branch already exists
    const [branches] = await queryInterface.sequelize.query(
      "SELECT id FROM Branches WHERE code = 'DEMO001' LIMIT 1"
    );

    if (branches.length === 0) {
      await queryInterface.bulkInsert('Branches', [
        {
          name: 'Demo Branch',
          code: 'DEMO001',
          address: 'Kigali, Rwanda',
          district: 'Kigali',
          sector: 'Nyarugenge',
          phone: '+250788000000',
          email: 'demo@umurengewallet.com',
          status: 'active',
          createdAt: new Date(),
          updatedAt: new Date()
        }
      ], {});
    }
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.bulkDelete('Branches', { code: 'DEMO001' }, {});
  }
};


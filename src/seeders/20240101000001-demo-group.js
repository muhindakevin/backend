'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    // Check if group already exists
    const [existingGroups] = await queryInterface.sequelize.query(
      "SELECT id FROM Groups WHERE code = 'GRP001' LIMIT 1"
    );

    if (existingGroups.length === 0) {
      // Get branch ID
      const [branches] = await queryInterface.sequelize.query(
        "SELECT id FROM Branches WHERE code = 'DEMO001' LIMIT 1"
      );

      if (branches.length > 0) {
        const branchId = branches[0].id;

        await queryInterface.bulkInsert('Groups', [
          {
            name: 'Abahizi Cooperative',
            code: 'GRP001',
            description: 'Demo saving group for testing',
            branchId: branchId,
            contributionAmount: 5000,
            contributionFrequency: 'monthly',
            district: 'Kigali',
            sector: 'Nyarugenge',
            status: 'active',
            registrationDate: new Date(),
            createdAt: new Date(),
            updatedAt: new Date()
          }
        ], {});
      }
    }
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.bulkDelete('Groups', { code: 'GRP001' }, {});
  }
};


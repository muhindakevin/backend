'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    // Get branch and group IDs
    const [branches] = await queryInterface.sequelize.query(
      "SELECT id FROM Branches WHERE code = 'DEMO001' LIMIT 1"
    );
    const [groups] = await queryInterface.sequelize.query(
      "SELECT id FROM Groups WHERE code = 'GRP001' LIMIT 1"
    );

    if (branches.length > 0 && groups.length > 0) {
      const branchId = branches[0].id;
      const groupId = groups[0].id;

      const now = new Date();

      // Check which users already exist
      const existingUsersResult = await queryInterface.sequelize.query(
        "SELECT phone FROM Users WHERE phone IN ('+250788123456', '+250788234567', '+250788345678', '+250788456789', '+250788567890', '+250788678901')"
      );
      const existingUsers = existingUsersResult[0] || [];
      const existingPhones = existingUsers.map(u => u.phone);

      const usersToInsert = [
        {
          phone: '+250788123456',
          name: 'Jean Marie',
          email: 'jean.marie@demo.com',
          role: 'Member',
          groupId: groupId,
          branchId: branchId,
          status: 'active',
          totalSavings: 150000,
          creditScore: 820,
          language: 'en',
          createdAt: now,
          updatedAt: now
        },
        {
          phone: '+250788234567',
          name: 'Kamikazi Marie',
          email: 'kamikazi.marie@demo.com',
          role: 'Group Admin',
          groupId: groupId,
          branchId: branchId,
          status: 'active',
          totalSavings: 200000,
          creditScore: 900,
          language: 'en',
          createdAt: now,
          updatedAt: now
        },
        {
          phone: '+250788345678',
          name: 'Mukamana Alice',
          email: 'mukamana.alice@demo.com',
          role: 'Cashier',
          groupId: groupId,
          branchId: branchId,
          status: 'active',
          language: 'en',
          createdAt: now,
          updatedAt: now
        },
        {
          phone: '+250788456789',
          name: 'Ikirezi Jane',
          email: 'ikirezi.jane@demo.com',
          role: 'Secretary',
          groupId: groupId,
          branchId: branchId,
          status: 'active',
          language: 'en',
          createdAt: now,
          updatedAt: now
        },
        {
          phone: '+250788567890',
          name: 'Mutabazi Paul',
          email: 'mutabazi.paul@demo.com',
          role: 'Agent',
          branchId: branchId,
          status: 'active',
          language: 'en',
          createdAt: now,
          updatedAt: now
        },
        {
          phone: '+250788678901',
          name: 'System Administrator',
          email: 'admin@umurengewallet.com',
          role: 'System Admin',
          branchId: branchId,
          status: 'active',
          language: 'en',
          createdAt: now,
          updatedAt: now
        }
      ].filter(user => !existingPhones.includes(user.phone));

      if (usersToInsert.length > 0) {
        await queryInterface.bulkInsert('Users', usersToInsert, {});
      }

      // Update group agentId
      await queryInterface.sequelize.query(
        "UPDATE Groups SET agentId = (SELECT id FROM Users WHERE phone = '+250788567890' LIMIT 1) WHERE code = 'GRP001'"
      );
    }
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.bulkDelete('Users', {
      phone: [
        '+250788123456',
        '+250788234567',
        '+250788345678',
        '+250788456789',
        '+250788567890',
        '+250788678901'
      ]
    }, {});
  }
};

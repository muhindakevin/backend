'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    // Add foreign key constraint for Users.groupId after Groups table exists
    await queryInterface.addConstraint('Users', {
      fields: ['groupId'],
      type: 'foreign key',
      name: 'fk_users_group',
      references: {
        table: 'Groups',
        field: 'id'
      },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL'
    });

    // Add foreign key constraint for Groups.agentId after Users table exists
    await queryInterface.addConstraint('Groups', {
      fields: ['agentId'],
      type: 'foreign key',
      name: 'fk_groups_agent',
      references: {
        table: 'Users',
        field: 'id'
      },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL'
    });

    // Add foreign key constraint for Branches.managerId after Users table exists
    await queryInterface.addConstraint('Branches', {
      fields: ['managerId'],
      type: 'foreign key',
      name: 'fk_branches_manager',
      references: {
        table: 'Users',
        field: 'id'
      },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL'
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.removeConstraint('Users', 'fk_users_group');
    await queryInterface.removeConstraint('Groups', 'fk_groups_agent');
    await queryInterface.removeConstraint('Branches', 'fk_branches_manager');
  }
};


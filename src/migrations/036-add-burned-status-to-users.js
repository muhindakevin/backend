'use strict';

module.exports = {
    up: async (queryInterface, Sequelize) => {
        // MySQL doesn't support easy ALTER ENUM, so we use a raw query or modify the column
        // We add 'burned' to the existing enum: 'active', 'inactive', 'suspended', 'pending'
        await queryInterface.changeColumn('Users', 'status', {
            type: Sequelize.ENUM('active', 'inactive', 'suspended', 'pending', 'burned'),
            defaultValue: 'active'
        });
    },

    down: async (queryInterface, Sequelize) => {
        await queryInterface.changeColumn('Users', 'status', {
            type: Sequelize.ENUM('active', 'inactive', 'suspended', 'pending'),
            defaultValue: 'active'
        });
    }
};

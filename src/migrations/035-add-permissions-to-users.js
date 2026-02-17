'use strict';

module.exports = {
    up: async (queryInterface, Sequelize) => {
        const tableInfo = await queryInterface.describeTable('Users');
        if (!tableInfo.permissions) {
            await queryInterface.addColumn('Users', 'permissions', {
                type: Sequelize.JSON,
                allowNull: true,
                defaultValue: null
            });
        }
    },

    down: async (queryInterface, Sequelize) => {
        const tableInfo = await queryInterface.describeTable('Users');
        if (tableInfo.permissions) {
            await queryInterface.removeColumn('Users', 'permissions');
        }
    }
};

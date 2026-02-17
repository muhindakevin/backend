# Database Migration Guide

This guide explains how to set up and manage the database for Umurenge Wallet.

## Prerequisites

1. XAMPP MySQL running on `localhost:3306`
2. Database `umurenge_wallet` created
3. `.env` file configured with database credentials

## Setup Database

### 1. Create Database

```sql
CREATE DATABASE umurenge_wallet;
```

Or via command line:
```bash
mysql -u root -e "CREATE DATABASE umurenge_wallet;"
```

### 2. Run Migrations

Migrations create all database tables with proper relationships:

```bash
npm run migrate
```

This will run all migrations in order:
- 001-create-branches.js
- 002-create-users.js
- 003-create-groups.js
- 004-create-loans.js
- 005-create-contributions.js
- 006-create-transactions.js
- 007-create-fines.js
- 008-create-announcements.js
- 009-create-meetings.js
- 010-create-votes.js
- 011-create-learn-grow-content.js
- 012-create-chat-messages.js
- 013-create-notifications.js
- 014-create-member-applications.js
- 015-create-audit-logs.js
- 016-create-support-tickets.js

### 3. Run Seeders

Seeders populate the database with demo data:

```bash
npm run seed
```

This will:
- Create a demo branch
- Create a demo group
- Create demo users (Member, Group Admin, Cashier, Secretary, Agent, System Admin)

## Available Commands

### Migrations

```bash
# Run all pending migrations
npm run migrate

# Undo last migration
npm run migrate:undo

# Undo all migrations
npm run migrate:undo:all
```

### Seeders

```bash
# Run all seeders
npm run seed

# Undo all seeders
npm run seed:undo
```

### Reset Database

```bash
# Undo all, then re-run migrations and seeders
npm run reset:db
```

## Demo Users

After running seeders, you'll have these demo users:

| Phone | Name | Role | Password/OTP |
|-------|------|------|--------------|
| +250788123456 | Jean Marie | Member | Use demo login |
| +250788234567 | Kamikazi Marie | Group Admin | Use demo login |
| +250788345678 | Mukamana Alice | Cashier | Use demo login |
| +250788456789 | Ikirezi Jane | Secretary | Use demo login |
| +250788567890 | Mutabazi Paul | Agent | Use demo login |
| +250788678901 | System Administrator | System Admin | Use demo login |

## Manual Seeding (Alternative)

You can also use the standalone seeder script:

```bash
npm run seed:demo
```

This runs `src/seeders/demo-users.js` directly and connects to the database.

## Troubleshooting

### Migration Errors

If you get foreign key constraint errors:
1. Make sure migrations run in order
2. Use `npm run migrate:undo:all` to start fresh
3. Then run `npm run migrate` again

### Seeder Errors

If seeders fail:
1. Check that migrations completed successfully
2. Verify branch and group exist before seeding users
3. Check for duplicate entries (phone numbers must be unique)

### Database Connection

If you can't connect:
1. Verify XAMPP MySQL is running
2. Check `.env` file has correct credentials
3. Ensure database `umurenge_wallet` exists

## Migration Files Structure

```
src/migrations/
├── 001-create-branches.js
├── 002-create-users.js
├── 003-create-groups.js
├── 004-create-loans.js
├── 005-create-contributions.js
├── 006-create-transactions.js
├── 007-create-fines.js
├── 008-create-announcements.js
├── 009-create-meetings.js
├── 010-create-votes.js
├── 011-create-learn-grow-content.js
├── 012-create-chat-messages.js
├── 013-create-notifications.js
├── 014-create-member-applications.js
├── 015-create-audit-logs.js
└── 016-create-support-tickets.js
```

## Seeder Files Structure

```
src/seeders/
├── 20240101000000-demo-branch.js
├── 20240101000001-demo-group.js
├── 20240101000002-demo-users.js
└── demo-users.js (standalone script)
```

## Production Notes

⚠️ **Do NOT run seeders in production!**

In production:
1. Only run migrations: `npm run migrate`
2. Create admin users manually or via admin panel
3. Do not seed demo data

## Next Steps

After running migrations and seeders:
1. Start the server: `npm start`
2. Test API endpoints
3. Connect frontend to backend
4. Use demo login for testing


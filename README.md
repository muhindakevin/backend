# IKIMINA WALLET - Backend API

Complete backend API for the Umurenge Wallet digital microfinance platform.

## 🚀 Quick Start

### Prerequisites

1. **Node.js** (v16 or higher)
2. **XAMPP** with MySQL (default: localhost:3306, user: root, no password)
3. **Twilio Account** (for SMS notifications) - Optional
4. **Bird.com Account** (for email notifications) - Optional

### Installation

```bash
cd BackEnd
npm install
```

### Configuration

1. Copy `.env.example` to `.env`:
```bash
cp .env.example .env
```

2. Update `.env` with your credentials (Twilio and Bird.com are optional):
```env
PORT=5000
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASS=
DB_NAME=umurenge_wallet
JWT_SECRET=your_secret_key_here
CORS_ORIGIN=http://localhost:3000

# Optional: Twilio SMS (leave empty if not using)
TWILIO_ACCOUNT_SID=your_twilio_sid
TWILIO_AUTH_TOKEN=your_twilio_token
TWILIO_PHONE_NUMBER=+250xxxxxxxxx

# Optional: Bird.com Email (leave empty if not using)
BIRD_API_KEY=your_bird_api_key
BIRD_SENDER_EMAIL=noreply@yourdomain.com
```

3. Create MySQL database:
```sql
CREATE DATABASE umurenge_wallet;
```

### Database Setup

**Run Migrations** (creates all tables):
```bash
npm run migrate
```

**Run Seeders** (adds demo data):
```bash
npm run seed
```

**Reset Database** (undo all, then re-run):
```bash
npm run reset:db
```

See `MIGRATION_GUIDE.md` for detailed migration instructions.

### Run the Server

```bash
# Development mode (with auto-reload)
npm run dev

# Production mode
npm start
```

Server will run on `http://localhost:5000`

## 📁 Project Structure

```
BackEnd/
├── server.js                 # Main server file
├── package.json              # Dependencies
├── .env                      # Environment variables (create from .env.example)
├── config/
│   ├── db.js                 # Database configuration
│   ├── database.js           # Sequelize config for migrations
│   ├── twilio.js             # Twilio SMS client (lazy init)
│   └── bird.js               # Bird.com Email client
├── src/
│   ├── controllers/          # Request handlers
│   ├── routes/               # API routes
│   ├── models/               # Sequelize models
│   ├── migrations/           # Database migrations
│   ├── seeders/              # Database seeders
│   ├── middleware/           # Auth, validation, etc.
│   ├── utils/                # Helper functions
│   └── notifications/        # SMS & Email services
└── uploads/                  # File uploads directory
```

## 🗄️ Database Models

- **User** - All users (Members, Admins, Agents, etc.)
- **Group** - Saving groups (Ibimina)
- **Loan** - Loan requests and management
- **Contribution** - Member contributions
- **Transaction** - All financial transactions
- **Fine** - Fines and penalties
- **Announcement** - Group announcements
- **Meeting** - Meeting records and schedules
- **Vote** - Group voting system
- **LearnGrowContent** - Educational content
- **ChatMessage** - Group chat messages
- **Notification** - User notifications log
- **Branch** - Bank branches
- **MemberApplication** - New member applications
- **AuditLog** - System audit trail
- **SupportTicket** - Support requests

## 🔐 Authentication

### OTP-Based Login Flow

1. **Send OTP**: `POST /api/auth/send-otp`
   ```json
   {
     "phone": "+250788123456"
   }
   ```

2. **Verify OTP**: `POST /api/auth/verify-otp`
   ```json
   {
     "phone": "+250788123456",
     "otp": "123456"
   }
   ```

3. **Use Token**: Include in header:
   ```
   Authorization: Bearer <jwt_token>
   ```

### Demo Login

For frontend demo users:
```
POST /api/auth/demo-login
Body: { "role": "member" | "group-admin" | "cashier" | "secretary" | "agent" | "system-admin" }
```

## 📡 API Endpoints

### Authentication
- `POST /api/auth/send-otp` - Send OTP to phone
- `POST /api/auth/verify-otp` - Verify OTP and login
- `POST /api/auth/demo-login` - Demo login
- `GET /api/auth/me` - Get current user

### Loans
- `POST /api/loans/request` - Request a loan (Member)
- `GET /api/loans/member` - Get member's loans
- `GET /api/loans/requests` - Get all loan requests (Admin)
- `GET /api/loans/:id` - Get loan details
- `PUT /api/loans/:id/approve` - Approve loan (Admin)
- `PUT /api/loans/:id/reject` - Reject loan (Admin)
- `POST /api/loans/:id/pay` - Make loan payment

### Contributions
- `POST /api/contributions` - Make contribution (Member)
- `GET /api/contributions/member` - Get member contributions
- `GET /api/contributions` - Get all contributions (Admin)
- `PUT /api/contributions/:id/approve` - Approve contribution
- `PUT /api/contributions/:id/reject` - Reject contribution

### Transactions
- `GET /api/transactions` - Get transactions
- `GET /api/transactions/summary` - Get transaction summary

### Fines
- `POST /api/fines` - Issue fine (Admin)
- `GET /api/fines/member` - Get member fines
- `GET /api/fines` - Get all fines (Admin)
- `PUT /api/fines/:id/approve` - Approve fine
- `PUT /api/fines/:id/pay` - Pay fine
- `PUT /api/fines/:id/waive` - Waive fine

### Groups
- `GET /api/groups` - Get groups
- `GET /api/groups/:id` - Get group details
- `GET /api/groups/:id/stats` - Get group statistics
- `POST /api/groups` - Create group (Agent/System Admin)

### Announcements
- `GET /api/announcements` - Get announcements
- `POST /api/announcements` - Create announcement (Admin)
- `PUT /api/announcements/:id/send` - Send announcement

### Meetings
- `GET /api/meetings` - Get meetings
- `POST /api/meetings` - Create meeting (Admin/Secretary)
- `PUT /api/meetings/:id` - Update meeting

### Voting
- `GET /api/voting` - Get votes
- `POST /api/voting` - Create vote (Group Admin)
- `POST /api/voting/:id/vote` - Cast vote

### Learn & Grow
- `GET /api/learn-grow` - Get content
- `GET /api/learn-grow/:id` - Get content details
- `POST /api/learn-grow` - Create content (Secretary/System Admin)

### Chat
- `GET /api/chat/:groupId` - Get messages
- `POST /api/chat/:groupId` - Send message

### Notifications
- `GET /api/notifications` - Get notifications
- `PUT /api/notifications/:id/read` - Mark as read

### Upload
- `POST /api/upload` - Upload file

### Analytics
- `GET /api/analytics` - Get analytics data

## 🔔 Notification Triggers

### SMS Notifications (Twilio) - Optional
- ✅ User registration confirmation
- ✅ OTP codes
- ✅ Loan approval/rejection
- ✅ Contribution confirmation
- ✅ Fine issued
- ✅ Meeting reminders

**Note:** If Twilio credentials are not configured, SMS notifications are disabled but the server runs normally.

### Email Notifications (Bird.com) - Optional
- ✅ Welcome email on registration
- ✅ Loan approval/rejection details
- ✅ Contribution summaries
- ✅ Learn & Grow content updates

**Note:** If Bird.com credentials are not configured, email notifications are disabled but the server runs normally.

## 👥 User Roles & Permissions

### Member
- View own savings, loans, transactions
- Request loans
- Make contributions
- Participate in voting
- Access Learn & Grow content
- Use group chat

### Group Admin
- All Member permissions
- Approve/reject loan requests
- Approve/reject contributions
- Manage group members
- Create announcements
- Schedule meetings
- Create votes
- Issue fines

### Cashier
- Approve contributions
- Track loan payments
- Issue fines
- Generate financial reports
- View transaction history

### Secretary
- Maintain member records
- Document meetings
- Create Learn & Grow content
- Manage communications
- Archive documents

### Agent
- Register new groups
- Assign group leadership
- Monitor group performance
- Generate reports
- View compliance data

### System Admin
- Full system access
- Manage all users and groups
- System configuration
- Audit logs
- Support ticket management

## 🧪 Testing

### Health Check
```bash
curl http://localhost:5000/api/health
```

### Demo Login
```bash
curl -X POST http://localhost:5000/api/auth/demo-login \
  -H "Content-Type: application/json" \
  -d '{"role": "member"}'
```

## 🔒 Security Features

- JWT-based authentication
- Role-based access control (RBAC)
- Password hashing (bcrypt)
- Input validation
- Rate limiting
- CORS protection
- Helmet security headers
- Audit logging

## 📝 Environment Variables

See `.env.example` for all required variables.

## 🐛 Troubleshooting

1. **Database Connection Error**
   - Ensure XAMPP MySQL is running
   - Verify database credentials in `.env`
   - Create database: `CREATE DATABASE umurenge_wallet;`
   - Run migrations: `npm run migrate`

2. **SMS Not Sending**
   - This is OK if Twilio not configured - server will still work
   - If configured, verify Twilio credentials
   - Check phone number format (+250xxxxxxxxx)
   - Check Twilio account balance

3. **Email Not Sending**
   - This is OK if Bird.com not configured - server will still work
   - If configured, verify Bird.com API key
   - Check sender email is verified
   - Review Bird.com API logs

4. **Migration Errors**
   - Run `npm run migrate:undo:all` to start fresh
   - Then `npm run migrate` again
   - See `MIGRATION_GUIDE.md` for details

## 📚 Additional Documentation

- `MIGRATION_GUIDE.md` - Complete database migration instructions
- `backend-summary.txt` - Frontend-to-backend feature mapping
- `INSTALLATION.md` - Detailed setup guide

## 🤝 Support

For issues or questions, refer to the main project documentation.

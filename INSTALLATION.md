# Backend Installation Guide

## Step 1: Install Dependencies

```bash
cd BackEnd
npm install
```

## Step 2: Configure Environment

1. Copy `.env.example` to `.env`:
```bash
cp .env.example .env
```

2. Edit `.env` and configure:
   - Database credentials (XAMPP MySQL defaults)
   - Twilio credentials (for SMS)
   - Bird.com credentials (for Email)
   - JWT secret (generate a strong random string)

## Step 3: Setup Database

1. Start XAMPP and ensure MySQL is running
2. Open phpMyAdmin: http://localhost/phpmyadmin
3. Create database:
```sql
CREATE DATABASE umurenge_wallet;
```

## Step 4: Configure Twilio

1. Sign up at https://www.twilio.com
2. Get Account SID and Auth Token from dashboard
3. Get a phone number from Twilio
4. Add to `.env`:
```env
TWILIO_ACCOUNT_SID=your_account_sid
TWILIO_AUTH_TOKEN=your_auth_token
TWILIO_PHONE_NUMBER=+15017122661
```

## Step 5: Configure Bird.com

1. Sign up at https://www.bird.com
2. Verify your sender email
3. Get API key from dashboard
4. Add to `.env`:
```env
BIRD_API_KEY=your_api_key
BIRD_SENDER_EMAIL=your_verified_email@domain.com
```

## Step 6: Run the Server

```bash
# Development (with auto-reload)
npm run dev

# Production
npm start
```

## Step 7: Test API

1. Health check:
```bash
curl http://localhost:5000/api/health
```

2. Demo login:
```bash
curl -X POST http://localhost:5000/api/auth/demo-login \
  -H "Content-Type: application/json" \
  -d '{"role": "member"}'
```

## Troubleshooting

- **Database connection error**: Ensure XAMPP MySQL is running on port 3306
- **SMS not sending**: Verify Twilio credentials and account balance
- **Email not sending**: Check Bird.com API key and sender email verification
- **Port already in use**: Change PORT in `.env`

## Next Steps

1. Connect frontend to backend (update API URLs)
2. Test all notification services
3. Seed initial data (optional)
4. Configure file uploads directory


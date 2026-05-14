# MoMo SMS Auto-Deposit System

Complete documentation for the automated MoMo deposit system that processes mobile money payments via SMS.

## System Overview

```
┌─────────────────────┐    SMS    ┌─────────────────────┐
│   Customer Phone    │ ────────> │   Your MoMo Number  │
│  (sends MoMo money) │           │  (receives deposit) │
└─────────────────────┘           └──────────┬──────────┘
                                             │
                                          SMS │
                                             ▼
                                  ┌─────────────────────┐
                                  │   Android Phone     │
                                  │  (SMS Listener App) │
                                  └──────────┬──────────┘
                                             │
                                         HTTPS │ POST
                                             ▼
                                  ┌─────────────────────┐
                                  │   Your Server       │
                                  │  (Node.js Backend)  │
                                  └──────────┬──────────┘
                                             │
                                             ▼
                                  ┌─────────────────────┐
                                  │   User's Wallet     │
                                  │    (Credited)       │
                                  └─────────────────────┘
```

## Components

### 1. Android SMS Listener App
Location: `android-sms-listener/`

Features:
- Intercepts MoMo SMS messages
- Parses transaction details using regex
- Sends deposits to server via HTTPS
- Offline queue with SQLite (retries when server is unavailable)
- Foreground service with WakeLock (stays running)
- Auto-starts on device boot

### 2. Node.js Backend Endpoint
Files:
- `backend/models/MoMoDeposit.js` - Database model
- `backend/controllers/momoController.js` - Business logic
- `backend/routes/momo.js` - API routes
- `backend/migrations/add-momo-deposits.js` - Database migration

### 3. Admin Dashboard
File: `admin/momo-deposits.html`

Features:
- View all incoming deposits
- Filter by status (pending, credited, unmatched, error)
- Manually credit unmatched deposits to users

---

## Setup Instructions

### Step 1: Server Configuration

1. **Add environment variable** to your `.env` file:

```env
# Secret token for SMS listener authentication
# Generate a secure random string!
SMS_LISTENER_TOKEN=your-super-secret-token-minimum-32-characters-long
```

Generate a secure token:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

2. **Run the database migration**:

```bash
cd backend
node migrations/add-momo-deposits.js
```

3. **Restart your server** to load the new routes.

### Step 2: Android App Configuration

1. **Edit `app/build.gradle`** and update:

```gradle
buildConfigField "String", "API_BASE_URL", '"https://your-actual-server.com"'
buildConfigField "String", "API_SECRET_TOKEN", '"your-super-secret-token-minimum-32-characters-long"'
```

**IMPORTANT:** The token must match `SMS_LISTENER_TOKEN` in your server's `.env` file!

2. **Build the APK** in Android Studio:
   - Open `android-sms-listener` folder
   - Build > Build Bundle(s) / APK(s) > Build APK(s)

3. **Install on your designated phone**:
   - Transfer APK to phone
   - Enable "Install from Unknown Sources"
   - Install and open the app
   - Grant SMS permissions when prompted
   - Click "Disable Battery Optimization"
   - Click "Start" to begin listening

### Step 3: Phone Setup (Critical for Reliability)

1. **Dedicated Phone**: Use a phone solely for this purpose
2. **Always Connected**: 
   - WiFi or mobile data should always be on
   - Keep phone plugged into charger
   - Use a UPS for power backup (important for Ghana dumsor!)
3. **Battery Optimization**:
   - Disable battery optimization for the app
   - On Xiaomi/Huawei phones, also enable "Auto-start" permission
4. **SIM Card**: Use the SIM that's linked to your MoMo merchant number

---

## How Deposits Work

### User Flow:

1. User goes to the deposit page on your website
2. Website shows:
   - Your MoMo number
   - Instructions to use their **username/email/phone** as the reference
3. User sends MoMo payment with their username as reference
4. Your phone receives the MoMo SMS
5. App parses the SMS and extracts:
   - Transaction ID
   - Amount
   - Sender phone
   - Reference (username)
6. App sends data to your server
7. Server finds user by reference and credits their wallet
8. User's balance is updated instantly!

### User Matching Logic:

The server tries to match users in this order:
1. **Email** (exact match)
2. **Phone number** (exact match)
3. **Agent Code** (exact match)
4. **Full Name** (partial match)
5. **Sender Phone** (if sender's phone matches a registered user)

If no match is found, the deposit is marked as "unmatched" and can be manually credited via admin panel.

---

## API Reference

### POST /api/momo/deposit

Endpoint for SMS listener app to report deposits.

**Headers:**
```
X-Auth-Token: your-secret-token
Content-Type: application/x-www-form-urlencoded
```

**Body (form data):**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| transactionId | string | Yes | MoMo transaction ID |
| amount | number | Yes | Amount in GHS |
| senderPhone | string | Yes | Phone that sent money |
| reference | string | No | Reference/message (should be username) |
| rawMessage | string | No | Original SMS text |
| receivedAt | number | No | Timestamp in milliseconds |

**Success Response (200):**
```json
{
  "success": true,
  "message": "GHS 50.00 credited to John Doe",
  "username": "John Doe",
  "newBalance": 150.00,
  "depositId": "uuid",
  "walletTransactionId": "uuid"
}
```

**User Not Found (200):**
```json
{
  "success": false,
  "error": "User not found",
  "message": "No user found with reference: xyz. Deposit saved for manual review.",
  "depositId": "uuid"
}
```

**Duplicate (409):**
```json
{
  "success": false,
  "error": "Duplicate transaction",
  "message": "This transaction has already been processed"
}
```

### GET /api/momo/deposits (Admin)

Get deposit history with pagination and filters.

**Query Parameters:**
- `status`: Filter by status (pending, credited, unmatched, error)
- `page`: Page number (default: 1)
- `limit`: Items per page (default: 50)

### POST /api/momo/deposits/:id/credit (Admin)

Manually credit an unmatched deposit to a user.

**Body:**
```json
{
  "userId": "user-uuid"
}
```

---

## Security Considerations

1. **Secret Token**: 
   - Use a strong, random token (minimum 32 characters)
   - Never share or commit the token
   - Rotate periodically

2. **HTTPS Only**: 
   - Server must use HTTPS
   - App validates SSL certificates

3. **Duplicate Protection**:
   - Transaction IDs are unique in database
   - Same deposit can't be processed twice

4. **Server Validation**:
   - Token is verified on every request
   - Invalid tokens are rejected with 401

---

## Troubleshooting

### App Issues

**"SMS not detected"**
- Check SMS permissions in phone settings
- Verify sender name matches ("MobileMoney", "MTNMoMo", etc.)
- Check if another SMS app is intercepting broadcasts

**"App keeps stopping"**
- Disable battery optimization
- Enable auto-start permission
- On MIUI: Security > Permissions > Autostart

**"Connection failed"**
- Check internet connection
- Verify API_BASE_URL is correct (with https://)
- Check if server is running

### Server Issues

**"Invalid signature"**
- Token mismatch between app and server
- Regenerate token and update both

**"User not found" for all deposits**
- Check user matching logic
- Verify users exist and are active
- Ensure reference field is being sent correctly

### Database Issues

**"Table doesn't exist"**
- Run the migration:
  ```bash
  cd backend
  node migrations/add-momo-deposits.js
  ```

---

## SMS Formats Supported

The parser handles various Ghana MoMo message formats:

**MTN Ghana:**
```
You have received GHS 50.00 from 0241234567. Transaction ID: 123456789012. Your new balance is GHS 100.00
```

```
Cash In of GHS 100.00 received from 0551234567. Ref: username123. Trans ID: 987654321012. Balance: GHS 200.00
```

**Telecel Ghana:**
```
You have received GHS 25.00 from 0201234567. Reference: myusername. ID: TXN123456789
```

**AirtelTigo:**
```
Deposit of GHS 75.00 received from 0271234567 with message: testuser. Transaction ID: AT123456789
```

If you encounter a format that isn't being parsed correctly, edit `MoMoParser.kt` in the Android app to add new regex patterns.

---

## Monitoring

### Check App Status
- Open the app to see:
  - Service status (Running/Stopped)
  - Transaction count and stats
  - Recent transactions list

### Check Server Logs
- Look for logs with tag "MoMo deposit"
- Check for successful credits and errors

### Admin Dashboard
- Go to Admin > MoMo Deposits
- View all incoming deposits
- Filter by status
- Manually credit unmatched deposits

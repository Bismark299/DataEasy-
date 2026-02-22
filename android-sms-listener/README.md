# MoMo SMS Listener - Android App

Automated MoMo deposit detection system for DataEasy+ platform.

## Features

- **SMS Interception**: Automatically detects incoming MoMo deposit SMS
- **Smart Parsing**: Extracts Transaction ID, Amount, Sender, and Reference from various MoMo SMS formats
- **Offline Queue**: Stores transactions locally when server is unreachable
- **Auto-Retry**: Automatically retries failed API calls
- **Foreground Service**: Keeps running even when app is minimized
- **Boot Start**: Automatically starts when device boots
- **Battery Optimization Exempt**: Requests exemption to prevent Android from killing the app

## Setup Instructions

### 1. Configure Server URL and Secret Token

Edit `app/build.gradle` and update these values:

```gradle
buildConfigField "String", "API_BASE_URL", '"https://your-server.com"'
buildConfigField "String", "API_SECRET_TOKEN", '"your-super-secret-token-here"'
```

### 2. Build the APK

Using Android Studio:
1. Open the `android-sms-listener` folder in Android Studio
2. Wait for Gradle sync to complete
3. Build > Build Bundle(s) / APK(s) > Build APK(s)

Or using command line:
```bash
./gradlew assembleRelease
```

### 3. Install on Phone

1. Transfer the APK to your designated MoMo phone
2. Enable "Install from Unknown Sources" in Settings
3. Install the APK
4. Open the app and grant SMS permissions
5. Click "Disable Battery Optimization"
6. Click "Start" to begin listening

### 4. Phone Setup Tips

For best reliability:

- **Dedicated Phone**: Use a phone solely for this purpose
- **Always Plugged In**: Keep connected to power (with UPS for power outages)
- **Good Network**: Ensure stable WiFi or mobile data connection
- **SIM Card**: Use the SIM that receives MoMo deposits

## How It Works

1. User sends MoMo payment to your number with their **username as reference**
2. Phone receives MoMo SMS
3. App parses the SMS and extracts:
   - Transaction ID
   - Amount (GHS)
   - Sender phone number
   - Reference (username)
4. App sends data to your server via secure POST request
5. Server validates and credits user's wallet

## SMS Formats Supported

The parser handles these Ghana MoMo formats:

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

## Security

- All API requests include `X-Auth-Token` header
- Token is stored in BuildConfig (not visible in source)
- Server should validate the token
- Transaction IDs are checked for duplicates

## Troubleshooting

**App keeps stopping:**
- Disable battery optimization
- Enable "Auto-start" in device settings if available
- Some phones (Xiaomi, Huawei) have aggressive battery management - check manufacturer-specific settings

**SMS not detected:**
- Ensure SMS permissions are granted
- Check if another SMS app is blocking broadcasts
- Verify the sender name matches expected MoMo senders

**Server connection fails:**
- Check internet connection
- Verify API_BASE_URL is correct
- Check server is running and accessible

## API Endpoint Expected

The app sends POST requests to: `{API_BASE_URL}/api/momo/deposit`

With form data:
- `transactionId`: MoMo transaction ID (string)
- `amount`: Amount in GHS (number)
- `senderPhone`: Sender's phone number (string)
- `reference`: Reference/message - should be username (string, nullable)
- `rawMessage`: Original SMS text (string)
- `receivedAt`: Timestamp in milliseconds (number)

Headers:
- `X-Auth-Token`: Your secret token
- `Content-Type`: application/x-www-form-urlencoded

Expected response:
```json
{
  "success": true,
  "message": "Deposit credited successfully",
  "username": "john_doe",
  "newBalance": 150.00
}
```

Or on error:
```json
{
  "success": false,
  "error": "User not found"
}
```

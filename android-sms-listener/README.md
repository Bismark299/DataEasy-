# MoMo SMS Listener

Production-ready Android app for listening to MTN Mobile Money SMS messages and forwarding them to the DataEasy+ platform.

## Architecture

**Clean Architecture with Offline-First Design**

```
com.dataeasy.momolistener/
├── domain/model/          # Pure Kotlin domain models
├── data/
│   ├── local/             # Room database (TransactionEntity, DAO)
│   └── remote/            # Retrofit API client
│   └── repository/        # Coordinates local + remote
├── sms/                   # SMS parsing and receiving
├── worker/                # WorkManager background tasks
├── service/               # Foreground service
└── ui/                    # MainActivity dashboard
```

## Key Features

1. **Idempotent Processing** - UNIQUE constraint on transactionId prevents duplicates
2. **Offline-First** - All SMS saved locally first, then synced when online
3. **Reliable Background** - WorkManager with exponential backoff
4. **State Machine** - PENDING → PROCESSING → SUCCESS | FAILED
5. **Retry Limits** - MAX_RETRY_COUNT = 5 prevents infinite loops
6. **Boot Persistence** - Auto-starts on device boot

## Transaction Flow

```
SMS Received → SmsReceiver → SmsParser → Room DB (PENDING)
                                              ↓
                              WorkManager polls every 15 min
                                              ↓
                          TransactionRepository.uploadPending()
                                              ↓
                        Mark PROCESSING → API call → SUCCESS/FAILED
```

## Build

```bash
# Debug build
./gradlew assembleDebug

# Release build (needs signing config)
./gradlew assembleRelease
```

## Permissions Required

- `RECEIVE_SMS` - Listen for incoming SMS
- `READ_SMS` - Sync from inbox
- `INTERNET` - Upload to backend
- `FOREGROUND_SERVICE` - Keep app alive
- `POST_NOTIFICATIONS` - Android 13+
- `RECEIVE_BOOT_COMPLETED` - Auto-start

## SMS Format Parsed

MTN Ghana MoMo format:
```
Payment received for GHS 50.00 from JOHN DOE. 
Service: Merchant Payment. Reference: BT-12345. 
Transaction ID: 1234567890
```

## API Endpoint

POST `https://dataeasy.onrender.com/api/webhook/momo-sms`

Headers:
- `Authorization: Bearer dE4sy_m0m0_L1st3n3r_S3cr3t_T0k3n_2026_GH`
- `Content-Type: application/json`
- `X-Idempotency-Key: <transaction_id>`

Body:
```json
{
  "transactionId": "1234567890",
  "amount": 50.00,
  "senderName": "JOHN DOE",
  "reference": "BT-12345",
  "rawMessage": "Payment received...",
  "receivedAt": 1234567890
}
```

## Troubleshooting

### SMS not detected
- Ensure SMS permissions granted
- Check battery optimization is disabled for app
- Verify app is running (foreground notification visible)

### Uploads failing
- Check internet connection
- View logs: `adb logcat -s MoMoListener:*`
- Retry with "Retry Failed" button

### App killed by system
- Disable battery optimization in Settings
- App will restart on boot if enabled

# DataEasy+ Backend

Node.js + Express backend API for the DataEasy+ bulk data topup platform.

## Quick Start

### 1. Install Dependencies

```bash
cd backend
npm install
```

### 2. Configure Environment

Copy the example environment file and edit with your settings:

```bash
cp .env.example .env
```

Edit `.env` file:
```env
PORT=5000
MONGODB_URI=mongodb://localhost:27017/dataeasy
JWT_SECRET=your-super-secret-jwt-key-change-this

# Paystack Keys
PAYSTACK_SECRET_KEY=sk_test_your_secret_key
PAYSTACK_PUBLIC_KEY=pk_test_fa6266bd089971ce550966de52efe3add069fe55

# Admin Credentials
ADMIN_USERNAME=admin
ADMIN_PASSWORD=admin123
```

### 3. Start MongoDB

Make sure MongoDB is running on your system:

```bash
# Windows (if installed as service)
net start MongoDB

# Or run mongod directly
mongod --dbpath /path/to/data
```

### 4. Run the Server

Development mode (with auto-reload):
```bash
npm run dev
```

Production mode:
```bash
npm start
```

The server will start on `http://localhost:5000`

## API Endpoints

### Authentication
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/auth/register` | Register new user |
| POST | `/api/auth/login` | User login |
| POST | `/api/auth/admin/login` | Admin login |
| GET | `/api/auth/me` | Get current user |
| PUT | `/api/auth/password` | Change password |

### User Profile
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/users/profile` | Get profile |
| PUT | `/api/users/profile` | Update profile |
| GET | `/api/users/orders` | Get user's orders |
| GET | `/api/users/stats` | Get user stats |

### Orders
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/orders/packages` | Get all packages |
| GET | `/api/orders/packages/:network` | Get network packages |
| POST | `/api/orders` | Create order |
| GET | `/api/orders` | Get user's orders |
| GET | `/api/orders/:orderId` | Get order details |
| GET | `/api/orders/:orderId/status` | Get order status |

### Wallet
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/wallet/balance` | Get balance |
| GET | `/api/wallet/history` | Get transaction history |
| POST | `/api/wallet/topup` | Initialize top-up |
| GET | `/api/wallet/topup/verify/:reference` | Verify top-up |

### Admin Routes (Requires Admin Auth)
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/admin/stats` | Get statistics |
| GET | `/api/admin/dashboard` | Get dashboard data |
| GET | `/api/admin/orders` | Get all orders |
| GET | `/api/admin/orders/:orderId` | Get order |
| PUT | `/api/admin/orders/:orderId/status` | Update order status |
| PUT | `/api/admin/orders/:orderId/item/:itemId/status` | Update item status |
| GET | `/api/admin/users` | Get all users |
| GET | `/api/admin/users/:id` | Get user details |
| PUT | `/api/admin/users/:id/wallet` | Adjust wallet |
| PUT | `/api/admin/users/:id/status` | Toggle user status |
| GET | `/api/admin/transactions` | Get all transactions |
| GET | `/api/admin/packages` | Get all packages |

### Webhooks
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/webhooks/paystack` | Paystack webhook |
| GET | `/api/webhooks/verify/:reference` | Manual verification |

## Project Structure

```
backend/
├── config/
│   ├── database.js      # MongoDB connection
│   ├── packages.js      # Data package pricing
│   └── paystack.js      # Paystack API integration
├── controllers/
│   ├── adminController.js    # Admin operations
│   ├── authController.js     # Authentication
│   ├── orderController.js    # Order management
│   ├── userController.js     # User profile
│   ├── walletController.js   # Wallet operations
│   └── webhookController.js  # Payment webhooks
├── middleware/
│   ├── auth.js          # JWT & admin authentication
│   └── validation.js    # Input validation
├── models/
│   ├── Order.js         # Order schema
│   ├── Transaction.js   # Transaction schema
│   ├── User.js          # User schema
│   └── Wallet.js        # Wallet schema
├── routes/
│   ├── admin.js         # Admin routes
│   ├── auth.js          # Auth routes
│   ├── orders.js        # Order routes
│   ├── users.js         # User routes
│   ├── wallet.js        # Wallet routes
│   └── webhook.js       # Webhook routes
├── .env.example         # Environment template
├── package.json         # Dependencies
├── README.md            # This file
└── server.js            # Main entry point
```

## Data Packages

Networks supported:
- **MTN** - GH₵0.50 per GB
- **AirtelTigo (AT)** - GH₵0.48 per GB
- **Telecel** - GH₵0.45 per GB

Sizes: 1, 2, 3, 4, 5, 6, 8, 10, 15, 20, 25, 30, 40, 50 GB

## Authentication

The API uses JWT tokens for authentication.

### User Token
- Include in header: `Authorization: Bearer <token>`
- Obtained from `/api/auth/login`

### Admin Token
- Include in header: `x-admin-token: <token>`
- Obtained from `/api/auth/admin/login`
- Default credentials: `admin` / `admin123`

## Paystack Integration

1. **Wallet Top-up Flow:**
   - Frontend calls `/api/wallet/topup` with amount
   - Backend initializes Paystack transaction
   - User completes payment on Paystack
   - Webhook confirms payment at `/api/webhooks/paystack`
   - Wallet is credited automatically

2. **Set up Webhook URL in Paystack Dashboard:**
   ```
   https://yourdomain.com/api/webhooks/paystack
   ```

## Error Handling

All errors return JSON:
```json
{
  "error": "Error message here"
}
```

Successful responses:
```json
{
  "success": true,
  "data": { ... }
}
```

## Development

```bash
# Install dependencies
npm install

# Run in development mode
npm run dev

# Run tests (if configured)
npm test
```

## Production Deployment

1. Set `NODE_ENV=production` in `.env`
2. Use a process manager like PM2:
   ```bash
   npm install -g pm2
   pm2 start server.js --name dataeasy-api
   ```
3. Configure reverse proxy (Nginx/Apache)
4. Set up SSL certificate
5. Configure Paystack webhook URL to production domain

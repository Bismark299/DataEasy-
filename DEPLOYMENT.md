# DataEasy+ - Deployment Guide for Render

This guide explains how to deploy DataEasy+ to [Render](https://render.com).

## Prerequisites

1. A Render account (free tier available)
2. Your Paystack API keys (live keys for production)
3. Your MCBIS API credentials (for data delivery)

## Deployment Options

### Option 1: Using render.yaml Blueprint (Recommended)

1. Push your code to a Git repository (GitHub/GitLab)
2. Go to [Render Dashboard](https://dashboard.render.com)
3. Click "New" → "Blueprint"
4. Connect your repository
5. Render will automatically detect the `render.yaml` file
6. Configure environment variables when prompted:
   - `PAYSTACK_SECRET_KEY`: Your Paystack live secret key
   - `MCBIS_API_KEY`: Your MCBIS API key
   - `MCBIS_API_URL`: Your MCBIS API URL
   - `FRONTEND_URL`: Will be set after frontend deploys

### Option 2: Manual Deployment

#### Step 1: Create PostgreSQL Database

1. Render Dashboard → "New" → "PostgreSQL"
2. Name: `dataeasy-db`
3. Region: Choose closest to your users
4. Plan: Free (or upgrade as needed)
5. Create Database
6. Copy the **Internal Database URL** for later

#### Step 2: Deploy Backend API

1. Render Dashboard → "New" → "Web Service"
2. Connect your repository
3. Configure:
   - **Name**: `dataeasy-backend`
   - **Region**: Same as database
   - **Branch**: `main`
   - **Root Directory**: `backend`
   - **Runtime**: Node
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`

4. Add Environment Variables:
   ```
   NODE_ENV=production
   PORT=10000
   DATABASE_URL=<your-internal-database-url>
   JWT_SECRET=<generate-random-64-char-string>
   PAYSTACK_SECRET_KEY=sk_live_xxxxx
   MCBIS_API_KEY=<your-key>
   MCBIS_API_URL=<your-url>
   ```

5. Deploy

#### Step 3: Deploy Frontend (Static Site)

1. Render Dashboard → "New" → "Static Site"
2. Connect your repository
3. Configure:
   - **Name**: `dataeasy-frontend`
   - **Branch**: `main`
   - **Root Directory**: `.` (root of repo, not backend)
   - **Build Command**: Leave empty or `echo "No build"`
   - **Publish Directory**: `.`

4. Deploy

#### Step 4: Update Frontend Config

After deploying, update `assets/js/config.js`:

```javascript
// Change this line to your actual backend URL
window.API_BASE_URL = window.API_BASE_URL || 'https://dataeasy-backend.onrender.com/api';
```

Or, redeploy after updating.

#### Step 5: Update Backend CORS

Add your frontend URL to backend environment:
```
FRONTEND_URL=https://dataeasy-frontend.onrender.com
```

## Environment Variables Reference

### Required

| Variable | Description | Example |
|----------|-------------|---------|
| `NODE_ENV` | Environment mode | `production` |
| `DATABASE_URL` | PostgreSQL connection string | `postgres://...` |
| `JWT_SECRET` | Secret for JWT tokens | Random 64+ chars |
| `PAYSTACK_SECRET_KEY` | Paystack live secret key | `sk_live_...` |

### Recommended

| Variable | Description | Example |
|----------|-------------|---------|
| `FRONTEND_URL` | Frontend URL for CORS | `https://dataeasy.onrender.com` |
| `ALLOWED_ORIGINS` | Additional CORS origins | `https://mydomain.com` |
| `MCBIS_API_KEY` | MCBIS provider API key | Your key |
| `MCBIS_API_URL` | MCBIS provider URL | `https://api.mcbis.com` |

### Optional

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Server port | `10000` |
| `RATE_LIMIT_WINDOW_MS` | Rate limit window | `60000` |
| `RATE_LIMIT_MAX_REQUESTS` | Max requests per window | `300` |

## Post-Deployment Checklist

- [ ] Backend health check passes: `https://your-backend.onrender.com/api/health`
- [ ] Frontend loads correctly
- [ ] User registration works
- [ ] User login works
- [ ] Packages load (check browser console)
- [ ] Paystack payment initializes (test with test keys first!)
- [ ] Admin login works
- [ ] Admin dashboard loads data

## Custom Domain (Optional)

1. Go to your Render service settings
2. Click "Custom Domains"
3. Add your domain
4. Update DNS records as instructed
5. Update `FRONTEND_URL` in backend env vars
6. Update `config.js` with your custom domain

## Troubleshooting

### "Cannot connect to database"
- Check `DATABASE_URL` is correct
- Ensure database is in same region as backend

### "CORS error"
- Add your frontend URL to `FRONTEND_URL` env var
- Check `ALLOWED_ORIGINS` if using custom domain

### "Packages not loading"
- Check browser console for errors
- Verify `config.js` has correct `API_BASE_URL`

### "Paystack error"
- Ensure you're using **live** keys in production
- Check `PAYSTACK_SECRET_KEY` is set correctly

## Free Tier Limitations

Render's free tier has some limitations:
- Services spin down after 15 minutes of inactivity
- First request after spin-down takes ~30 seconds
- 750 hours/month of running time

For production, consider upgrading to a paid plan for:
- Always-on services
- Better performance
- Custom domains with SSL

#!/usr/bin/env node
/**
 * Secure Secrets Generator
 * Run: node scripts/generate-secrets.js
 * 
 * Generates cryptographically secure secrets for production deployment
 */

const crypto = require('crypto');

console.log('🔐 Generating Secure Secrets for Production\n');
console.log('=' .repeat(60));

// Generate JWT Secret (64 bytes = 128 hex chars)
const jwtSecret = crypto.randomBytes(64).toString('hex');
console.log('\n📌 JWT_SECRET (copy this to your .env):');
console.log(`JWT_SECRET=${jwtSecret}`);

// Generate Admin Password (24 bytes = strong password)
const adminPassword = crypto.randomBytes(24).toString('base64').replace(/[+/=]/g, '');
console.log('\n📌 ADMIN_PASSWORD (strong random password):');
console.log(`ADMIN_PASSWORD=${adminPassword}`);

// Generate a session secret if needed
const sessionSecret = crypto.randomBytes(32).toString('hex');
console.log('\n📌 SESSION_SECRET (if using sessions):');
console.log(`SESSION_SECRET=${sessionSecret}`);

console.log('\n' + '=' .repeat(60));
console.log('\n⚠️  IMPORTANT SECURITY NOTES:');
console.log('   1. NEVER commit these secrets to git');
console.log('   2. Use different secrets for each environment');
console.log('   3. Store production secrets in environment variables');
console.log('   4. Rotate secrets periodically (every 90 days recommended)');
console.log('   5. If a secret is compromised, rotate ALL secrets immediately');

console.log('\n📋 Quick Setup for Production:');
console.log('   1. Copy the values above to your production .env file');
console.log('   2. Or set them as environment variables in your hosting platform');
console.log('   3. On Render/Railway/Heroku: use the dashboard to set env vars\n');

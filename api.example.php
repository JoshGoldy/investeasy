<?php
/**
 * InvestEasy FinBot API Proxy — EXAMPLE CONFIG
 * 
 * ┌─────────────────────────────────────────────────────────────┐
 * │  SETUP INSTRUCTIONS:                                        │
 * │  1. Copy this file and rename it to: api.php                │
 * │  2. Replace the API key below with your real key            │
 * │  3. Upload api.php to your server (NEVER commit it to git)  │
 * └─────────────────────────────────────────────────────────────┘
 * 
 * Get your API key at: https://console.anthropic.com
 */

// ⚠️  REPLACE THIS WITH YOUR ACTUAL ANTHROPIC API KEY
define('ANTHROPIC_API_KEY', 'sk-ant-REPLACE-WITH-YOUR-KEY');

// Rate limiting: max requests per IP per hour
define('RATE_LIMIT', 20);

// ── DO NOT EDIT BELOW THIS LINE ────────────────────────────────────────────
// (Copy the rest from api.php or see the deployment guide)

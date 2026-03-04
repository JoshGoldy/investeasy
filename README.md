# InvestEasy v8

AI-powered investment analysis, real-time market data, and portfolio tracking.

## Quick Start

### 1. Clone the repo
```bash
git clone https://github.com/YOUR_USERNAME/investeasy.git
cd investeasy
```

### 2. Set up the API proxy
```bash
cp api.example.php api.php
```
Edit `api.php` and replace `sk-ant-REPLACE-WITH-YOUR-KEY` with your actual Anthropic API key.

Get your key at: https://console.anthropic.com

### 3. Deploy to cPanel
Upload the contents of this folder to your `public_html` directory:
- `index.html` — The app
- `api.php` — The API proxy (with your real key)
- `.htaccess` — Security & caching rules

### 4. Enable HTTPS
If you have SSL active, uncomment the "Force HTTPS" section in `.htaccess`.

---

## Deploying via GitHub

### Option A: cPanel Git Version Control (easiest)
1. In cPanel, go to **Git Version Control** → **Create**
2. Toggle ON "Clone a Repository"
3. Paste your GitHub repo URL
4. Set the repository path to `/home/yourusername/investeasy`
5. Set up a `.cpanel.yml` deploy file (see below)
6. Every `git pull` in cPanel auto-deploys

### Option B: GitHub Actions + FTP
See `.github/workflows/deploy.yml` if included in this repo.

---

## File Structure
```
investeasy/
├── index.html          # The full app (HTML + CSS + JS)
├── api.php             # API proxy (⚠️ NOT in git — contains your key)
├── api.example.php     # Template for api.php setup
├── .htaccess           # Apache security & caching rules
├── .gitignore          # Keeps api.php out of the repo
└── README.md           # This file
```

## Security Notes
- `api.php` is in `.gitignore` — your API key never touches GitHub
- `.htaccess` blocks access to dotfiles, config examples, and directory listings
- The PHP proxy includes rate limiting (20 req/IP/hour)
- Set a spending cap in your Anthropic console billing settings

## License
Proprietary — All rights reserved.

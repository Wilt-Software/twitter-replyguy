# Twitter AI Reply Guy Chrome Extension

A Chrome extension that adds AI-powered reply suggestions to Twitter posts using ScrapeCreators API and Google's Gemini AI.

## Features

- 🤖 Adds an "AI Reply" button to every tweet in your timeline
- 📊 Fetches tweet data including engagement metrics using ScrapeCreators API
- 🧠 Generates contextual replies using Google's Gemini AI
- ✏️ Allows manual editing of generated replies before posting
- 🔒 Secure API key storage using Chrome's sync storage

## Setup Instructions

### 1. Get API Keys

**ScrapeCreators API Key:**
- Visit [scrapecreators.com](https://scrapecreators.com)
- Sign up and get your API key

**Gemini API Key:**
- Visit [Google AI Studio](https://aistudio.google.com/apikey)
- Create a new API key for Gemini

### 2. Install the Extension

1. Open Chrome and go to `chrome://extensions/`
2. Enable "Developer mode" in the top right
3. Click "Load unpacked" and select this folder
4. The extension should now appear in your extensions list

### 3. Configure API Keys

1. Click the extension icon in your toolbar
2. Enter your ScrapeCreators API key
3. Enter your Gemini API key
4. Click "Save API Keys"

## Usage

1. Navigate to [x.com](https://x.com) or [twitter.com](https://twitter.com)
2. You'll see a blue "🤖 AI Reply" button on each tweet
3. Click the button to generate an AI reply
4. Review and edit the generated reply if needed
5. Click "Reply to Tweet" to post your response

## Files Structure

- `manifest.json` - Extension configuration
- `content.js` - Main content script that injects AI buttons
- `background.js` - Service worker handling API calls
- `popup.html/js` - Extension popup for API key management
- `styles.css` - Styling for injected elements

## API Integration

### ScrapeCreators API
- Endpoint: `GET https://api.scrapecreators.com/v1/twitter/tweet`
- Used to fetch detailed tweet data including text, author, and engagement metrics

### Gemini AI API
- Endpoint: `POST https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent`
- Used to generate contextual replies based on tweet content

## Security Features

- API keys are stored securely using Chrome's sync storage
- All API calls are made from the background script
- Password input fields for API key entry
- No sensitive data is logged or exposed

## Troubleshooting

- Make sure you're logged into Twitter/X
- Verify your API keys are correctly entered
- Check that the extension has permissions for x.com and twitter.com
- Open browser console to see any error messages

## Permissions

The extension requires:
- `activeTab` - To interact with the current Twitter tab
- `storage` - To save API keys securely
- Host permissions for Twitter and API endpoints
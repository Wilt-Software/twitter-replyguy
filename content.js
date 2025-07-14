class TwitterAIReplyGuy {
  constructor() {
    this.apiKey = '';
    this.geminiApiKey = '';
    this.debounceTimeout = null;
    this.processedTweets = new Set();
    this.init();
  }

  async init() {
    await this.loadApiKeys();
    this.observeTimeline();
    this.injectButtons();
  }

  async loadApiKeys() {
    return new Promise((resolve) => {
      chrome.storage.sync.get(['scrapeCreatorsApiKey', 'geminiApiKey'], (result) => {
        this.apiKey = result.scrapeCreatorsApiKey || '';
        this.geminiApiKey = result.geminiApiKey || '';
        resolve();
      });
    });
  }

  observeTimeline() {
    const observer = new MutationObserver((mutations) => {
      // Check if any mutations actually added tweet elements
      let shouldInject = false;
      mutations.forEach((mutation) => {
        if (mutation.addedNodes.length > 0) {
          mutation.addedNodes.forEach((node) => {
            if (node.nodeType === Node.ELEMENT_NODE) {
              // Check if the added node contains tweets or is a tweet itself
              if (node.querySelector && (
                node.querySelector('[data-testid="tweet"]') ||
                node.matches('[data-testid="tweet"]')
              )) {
                shouldInject = true;
              }
            }
          });
        }
      });

      if (shouldInject) {
        // Debounce to prevent excessive calls
        clearTimeout(this.debounceTimeout);
        this.debounceTimeout = setTimeout(() => {
          this.injectButtons();
        }, 100);
      }
    });

    // Observe only the main timeline container for better performance
    const timelineContainer = document.querySelector('[data-testid="primaryColumn"]') || document.body;
    observer.observe(timelineContainer, {
      childList: true,
      subtree: true
    });
  }

  injectButtons() {
    const tweets = document.querySelectorAll('[data-testid="tweet"]');
    console.log(`Found ${tweets.length} tweets, checking for buttons...`);
    
    tweets.forEach((tweet) => {
      // Get a unique identifier for this tweet
      const tweetId = this.getTweetId(tweet);
      if (!tweetId) return;

      // Check if we've already processed this tweet
      if (this.processedTweets.has(tweetId)) {
        return;
      }

      // Check if button already exists
      if (tweet.querySelector('.ai-reply-button')) {
        console.log(`Button already exists for tweet ${tweetId}`);
        this.processedTweets.add(tweetId);
        return;
      }

      // Mark as processed before adding button
      this.processedTweets.add(tweetId);
      this.addAIButtonToTweet(tweet, tweetId);
    });
  }

  getTweetId(tweetElement) {
    // Try to extract tweet ID from various sources
    const tweetId = this.extractTweetIdFromElement(tweetElement);
    if (tweetId) return tweetId;
    
    // Fallback: use the element's position in DOM as identifier
    const allTweets = document.querySelectorAll('[data-testid="tweet"]');
    const index = Array.from(allTweets).indexOf(tweetElement);
    return `tweet-${index}-${Date.now()}`;
  }

  addAIButtonToTweet(tweetElement, tweetId) {
    // Double-check: remove any existing AI buttons first
    const existingButtons = tweetElement.querySelectorAll('.ai-reply-button');
    existingButtons.forEach(btn => btn.remove());
    
    const actionsBar = tweetElement.querySelector('[role="group"]');
    if (!actionsBar) {
      console.log(`No actions bar found for tweet ${tweetId}`);
      return;
    }

    const tweetUrl = this.extractTweetUrl(tweetElement);
    if (!tweetUrl) {
      console.log(`No tweet URL found for tweet ${tweetId}`);
      return;
    }

    const aiButton = document.createElement('button');
    aiButton.className = 'ai-reply-button';
    aiButton.innerHTML = '🤖 AI Reply';
    aiButton.title = 'Generate AI reply';
    aiButton.setAttribute('data-tweet-id', tweetId);
    
    aiButton.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.handleAIButtonClick(tweetUrl, tweetElement);
    });

    actionsBar.appendChild(aiButton);
    console.log(`Added AI button for tweet ${tweetId}`);
    
    // Mark with data attribute for additional tracking
    tweetElement.setAttribute('data-ai-button-added', 'true');
  }

  extractTweetUrl(tweetElement) {
    try {
      // Method 1: Look for time element with parent link
      const timeElement = tweetElement.querySelector('time');
      if (timeElement && timeElement.parentElement) {
        const href = timeElement.parentElement.getAttribute('href');
        if (href && href.includes('/status/')) {
          const url = href.startsWith('http') ? href : `https://x.com${href}`;
          console.log('Tweet URL extracted via time element:', url);
          return url;
        }
      }

      // Method 2: Look for any link with /status/ in href
      const linkElements = tweetElement.querySelectorAll('a[href*="/status/"]');
      for (const link of linkElements) {
        const href = link.getAttribute('href');
        if (href && href.includes('/status/')) {
          const url = href.startsWith('http') ? href : `https://x.com${href}`;
          console.log('Tweet URL extracted via status link:', url);
          return url;
        }
      }

      // Method 3: Look for article element with tabindex (tweet container)
      const articleElement = tweetElement.closest('article') || tweetElement.querySelector('article');
      if (articleElement) {
        const statusLinks = articleElement.querySelectorAll('a[href*="/status/"]');
        for (const link of statusLinks) {
          const href = link.getAttribute('href');
          if (href && href.includes('/status/')) {
            const url = href.startsWith('http') ? href : `https://x.com${href}`;
            console.log('Tweet URL extracted via article element:', url);
            return url;
          }
        }
      }

      // Method 4: Try to construct URL from extracted ID and username
      const tweetId = this.extractTweetIdFromElement(tweetElement);
      if (tweetId) {
        const username = this.extractUsernameFromElement(tweetElement);
        if (username) {
          const url = `https://x.com/${username}/status/${tweetId}`;
          console.log('Tweet URL constructed from ID and username:', url);
          return url;
        }
      }

      console.error('Could not extract tweet URL from element:', tweetElement);
      return null;
    } catch (error) {
      console.error('Error extracting tweet URL:', error);
      return null;
    }
  }

  extractTweetIdFromElement(tweetElement) {
    const cellInner = tweetElement.querySelector('[data-testid="cellInnerDiv"]');
    if (cellInner) {
      const id = cellInner.getAttribute('data-testid') || cellInner.id;
      const match = id.match(/(\d{15,})/);
      if (match) return match[1];
    }

    const links = tweetElement.querySelectorAll('a[href*="/status/"]');
    for (const link of links) {
      const href = link.getAttribute('href');
      const match = href.match(/\/status\/(\d+)/);
      if (match) return match[1];
    }

    return null;
  }

  extractUsernameFromElement(tweetElement) {
    const usernameElements = tweetElement.querySelectorAll('[data-testid="User-Name"] a, [data-testid="User-Names"] a');
    for (const element of usernameElements) {
      const href = element.getAttribute('href');
      if (href && href.startsWith('/')) {
        const username = href.split('/')[1];
        if (username && !username.includes('status')) {
          return username;
        }
      }
    }

    const profileLinks = tweetElement.querySelectorAll('a[href^="/"][href*="/status/"]:not([href*="/status/"])');
    for (const link of profileLinks) {
      const href = link.getAttribute('href');
      const pathParts = href.split('/');
      if (pathParts.length >= 2 && pathParts[1]) {
        return pathParts[1];
      }
    }

    return null;
  }

  async handleAIButtonClick(tweetUrl, tweetElement) {
    if (!this.apiKey || !this.geminiApiKey) {
      this.showApiKeyModal();
      return;
    }

    console.log('AI button clicked for URL:', tweetUrl);

    const button = tweetElement.querySelector('.ai-reply-button');
    button.classList.add('loading');
    button.disabled = true;

    try {
      console.log('Fetching tweet data...');
      const tweetData = await this.fetchTweetData(tweetUrl);
      console.log('Tweet data received, generating reply...');
      const aiReply = await this.generateReply(tweetData);
      console.log('Reply generated successfully');
      this.showReplyModal(aiReply, tweetUrl, tweetData);
    } catch (error) {
      console.error('Error generating AI reply:', error);
      
      let errorMessage = 'Error generating AI reply: ';
      if (error.message.includes('API key')) {
        errorMessage += 'Invalid API key. Please check your API keys in the extension popup.';
      } else if (error.message.includes('rate limit')) {
        errorMessage += 'API rate limit exceeded. Please try again later.';
      } else if (error.message.includes('quota')) {
        errorMessage += 'API quota exceeded. Please check your API usage.';
      } else if (error.message.includes('permissions')) {
        errorMessage += 'API key lacks required permissions.';
      } else if (error.message.includes('Invalid tweet URL')) {
        errorMessage += 'Could not extract valid tweet URL. Please try a different tweet.';
      } else if (error.message.includes('Tweet not found')) {
        errorMessage += 'Tweet not found or may be private/deleted.';
      } else {
        errorMessage += error.message;
      }
      
      alert(errorMessage);
    } finally {
      button.classList.remove('loading');
      button.disabled = false;
    }
  }

  async fetchTweetData(tweetUrl) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({
        action: 'fetchTweetData',
        tweetUrl: tweetUrl,
        apiKey: this.apiKey
      }, (response) => {
        if (response.success) {
          resolve(response.data);
        } else {
          reject(new Error(response.error));
        }
      });
    });
  }

  async generateReply(tweetData) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({
        action: 'generateReply',
        tweetData: tweetData,
        geminiApiKey: this.geminiApiKey
      }, (response) => {
        if (response.success) {
          resolve(response.reply);
        } else {
          reject(new Error(response.error));
        }
      });
    });
  }

  showReplyModal(reply, tweetUrl, tweetData) {
    const modal = document.createElement('div');
    modal.className = 'ai-reply-modal';
    modal.innerHTML = `
      <div class="ai-reply-modal-content">
        <h3>AI Generated Reply</h3>
        <textarea class="ai-reply-textarea" placeholder="Generated reply...">${reply}</textarea>
        <div class="ai-reply-actions">
          <button class="ai-reply-btn cancel">Cancel</button>
          <button class="ai-reply-btn send">Reply to Tweet</button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    modal.querySelector('.cancel').addEventListener('click', () => {
      document.body.removeChild(modal);
    });

    modal.querySelector('.send').addEventListener('click', () => {
      const finalReply = modal.querySelector('.ai-reply-textarea').value;
      this.replyToTweet(tweetUrl, finalReply);
      document.body.removeChild(modal);
    });

    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        document.body.removeChild(modal);
      }
    });
  }

  replyToTweet(tweetUrl, replyText) {
    const tweetId = tweetUrl.match(/\/status\/(\d+)/)?.[1];
    if (!tweetId) {
      alert('Could not extract tweet ID');
      return;
    }

    const replyButton = document.querySelector(`[data-testid="tweet"] [data-testid="reply"]`);
    if (replyButton) {
      replyButton.click();
      
      setTimeout(() => {
        const composeTextArea = document.querySelector('[data-testid="tweetTextarea_0"]');
        if (composeTextArea) {
          composeTextArea.focus();
          composeTextArea.textContent = replyText;
          
          const inputEvent = new Event('input', { bubbles: true });
          composeTextArea.dispatchEvent(inputEvent);
        }
      }, 500);
    } else {
      window.open(`https://x.com/intent/tweet?in_reply_to=${tweetId}&text=${encodeURIComponent(replyText)}`, '_blank');
    }
  }

  showApiKeyModal() {
    const modal = document.createElement('div');
    modal.className = 'ai-reply-modal';
    modal.innerHTML = `
      <div class="ai-reply-modal-content">
        <h3>API Keys Required</h3>
        <p>Please enter your API keys to use the AI Reply feature:</p>
        <div style="margin: 16px 0;">
          <label style="display: block; margin-bottom: 8px;">ScrapeCreators API Key:</label>
          <input type="password" id="scrape-api-key" style="width: 100%; padding: 8px; border: 1px solid #ccc; border-radius: 4px;">
        </div>
        <div style="margin: 16px 0;">
          <label style="display: block; margin-bottom: 8px;">Gemini API Key:</label>
          <input type="password" id="gemini-api-key" style="width: 100%; padding: 8px; border: 1px solid #ccc; border-radius: 4px;">
        </div>
        <div class="ai-reply-actions">
          <button class="ai-reply-btn cancel">Cancel</button>
          <button class="ai-reply-btn send">Save Keys</button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    modal.querySelector('.cancel').addEventListener('click', () => {
      document.body.removeChild(modal);
    });

    modal.querySelector('.send').addEventListener('click', () => {
      const scrapeApiKey = modal.querySelector('#scrape-api-key').value;
      const geminiApiKey = modal.querySelector('#gemini-api-key').value;
      
      if (scrapeApiKey && geminiApiKey) {
        chrome.storage.sync.set({
          scrapeCreatorsApiKey: scrapeApiKey,
          geminiApiKey: geminiApiKey
        }, () => {
          this.apiKey = scrapeApiKey;
          this.geminiApiKey = geminiApiKey;
          document.body.removeChild(modal);
          alert('API keys saved successfully!');
        });
      } else {
        alert('Please enter both API keys');
      }
    });
  }
}

if (window.location.hostname === 'x.com' || window.location.hostname === 'twitter.com') {
  const aiReplyGuy = new TwitterAIReplyGuy();
}
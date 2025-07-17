class TwitterAIReplyGuy {
  constructor() {
    this.apiKey = '';
    this.geminiApiKey = '';
    this.debounceTimeout = null;
    this.processedTweets = new Set();
    this.machineGunMode = false;
    this.machineGunInterval = null;
    this.machineGunQueue = [];
    this.isProcessing = false;
    this.machineGunButton = null;
    this.rateLimitDelay = 3000; // 3 seconds between tweets
    this.maxTweetsPerSession = 50; // Safety limit
    this.processedInSession = 0;
    this.machineGunStats = null;
    this.startTime = null;
    this.init();
  }

  async init() {
    await this.loadApiKeys();
    this.observeTimeline();
    this.injectButtons();
    this.createMachineGunButton();
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
      if (!this.machineGunMode) {
        this.showApiKeyModal();
      }
      return;
    }

    console.log('AI button clicked for URL:', tweetUrl);
    const perfMon = window.performanceMonitor;
    perfMon?.startTimer('total_operation');

    const button = tweetElement.querySelector('.ai-reply-button');
    if (button) {
      button.classList.add('loading');
      button.disabled = true;
    }

    try {
      // STEP 1: Generate AI reply FIRST (before opening compose box)
      console.log('Fetching tweet data...');
      perfMon?.startTimer('tweet_fetch');
      const tweetData = await this.fetchTweetData(tweetUrl);
      const fetchDuration = perfMon?.endTimer('tweet_fetch', { url: tweetUrl });
      console.log(`PERF: Tweet data fetch took: ${fetchDuration?.toFixed(2)}ms`);
      
      console.log('Tweet data received, generating reply...');
      perfMon?.startTimer('ai_generation');
      const aiReply = await this.generateReply(tweetData);
      const replyDuration = perfMon?.endTimer('ai_generation', { replyLength: aiReply?.length });
      console.log(`PERF: AI reply generation took: ${replyDuration?.toFixed(2)}ms`);
      console.log('AI reply generated successfully:', aiReply);
      
      // STEP 2: Extract tweet ID for targeting
      const tweetId = this.extractTweetIdFromElement(tweetElement);
      if (!tweetId) {
        throw new Error('Could not extract tweet ID');
      }
      
      // STEP 3: Now open compose box and paste the pre-generated reply
      console.log('Opening compose box and inserting pre-generated reply...');
      perfMon?.startTimer('ui_manipulation');
      await this.replyToTweetWithGeneratedText(tweetId, aiReply, tweetElement);
      const uiDuration = perfMon?.endTimer('ui_manipulation', { tweetId, replyLength: aiReply?.length });
      
      const totalDuration = perfMon?.endTimer('total_operation', { 
        tweetUrl, 
        success: true,
        fetchDuration,
        replyDuration,
        uiDuration
      });
      
      console.log(`PERF: UI manipulation took: ${uiDuration?.toFixed(2)}ms`);
      console.log(`PERF: Total operation took: ${totalDuration?.toFixed(2)}ms`);
      
      if (fetchDuration && replyDuration && uiDuration && totalDuration) {
        console.log(`PERF BREAKDOWN:`);
        console.log(`  - Tweet fetch: ${fetchDuration.toFixed(2)}ms (${(fetchDuration / totalDuration * 100).toFixed(1)}%)`);
        console.log(`  - AI generation: ${replyDuration.toFixed(2)}ms (${(replyDuration / totalDuration * 100).toFixed(1)}%)`);
        console.log(`  - UI manipulation: ${uiDuration.toFixed(2)}ms (${(uiDuration / totalDuration * 100).toFixed(1)}%)`);  
      }
      
    } catch (error) {
      perfMon?.recordError('total_operation', error);
      perfMon?.endTimer('total_operation', { success: false, error: error.message });
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
      
      if (!this.machineGunMode) {
        alert(errorMessage);
      }
    } finally {
      if (button) {
        button.classList.remove('loading');
        button.disabled = false;
      }
      
      // Log performance summary periodically
      if (Math.random() < 0.1) { // 10% chance to log summary
        const summary = perfMon?.getMetricsSummary();
        if (summary) {
          console.log('📊 PERFORMANCE SUMMARY:', summary);
          const slowOps = perfMon?.getSlowOperations(500); // Operations > 500ms
          if (slowOps?.length > 0) {
            console.warn('⚠️  SLOW OPERATIONS DETECTED:', slowOps);
          }
        }
      }
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

  async replyToTweetWithGeneratedText(tweetId, replyText, tweetElement) {
    console.log(`Opening reply compose for tweet ${tweetId} with text:`, replyText);

    try {
      const buttonFindStart = performance.now();
      const replyButton = this.findReplyButton(tweetElement);
      const buttonFindEnd = performance.now();
      console.log(`PERF: Finding reply button took: ${(buttonFindEnd - buttonFindStart).toFixed(2)}ms`);
      
      if (!replyButton) {
        throw new Error('Could not find reply button for this tweet');
      }

      // Click the reply button to open the compose modal
      console.log('Clicking reply button...');
      const clickStart = performance.now();
      replyButton.click();
      const clickEnd = performance.now();
      console.log(`PERF: Button click took: ${(clickEnd - clickStart).toFixed(2)}ms`);

      // Wait for the compose modal to appear and then insert the text
      const modalWaitStart = performance.now();
      await this.waitForComposeModalAndInsertText(replyText, tweetElement);
      const modalWaitEnd = performance.now();
      console.log(`PERF: Modal wait and text insertion took: ${(modalWaitEnd - modalWaitStart).toFixed(2)}ms`);
      console.log('AI reply successfully inserted into the correct compose box!');

    } catch (error) {
      console.error('Error replying to tweet:', error);
      // Fallback: open Twitter intent URL
      window.open(`https://x.com/intent/tweet?in_reply_to=${tweetId}&text=${encodeURIComponent(replyText)}`, '_blank');
    }
  }

  findReplyButton(tweetElement) {
    // First try to find by data-testid
    const dataTestIdButton = tweetElement.querySelector('[data-testid="reply"]');
    if (dataTestIdButton) {
      console.log('Found reply button by data-testid');
      return dataTestIdButton;
    }
    
    // Try to find by SVG path content (the reply icon)
    const svgButtons = tweetElement.querySelectorAll('svg');
    for (const svg of svgButtons) {
      const path = svg.querySelector('path');
      if (path && path.getAttribute('d') && path.getAttribute('d').includes('1.751 10c0-4.42')) {
        const button = svg.closest('[role="button"]');
        if (button) {
          console.log('Found reply button by SVG path');
          return button;
        }
      }
    }
    
    // Fallback: try to find by aria-label
    const ariaLabelButton = tweetElement.querySelector('[aria-label="Reply"]');
    if (ariaLabelButton) {
      console.log('Found reply button by aria-label');
      return ariaLabelButton;
    }
    
    // Another fallback: find by role and look for "reply" in text content
    const roleButtons = tweetElement.querySelectorAll('[role="button"]');
    for (const button of roleButtons) {
      const buttonText = button.textContent.toLowerCase();
      if (buttonText.includes('reply') || buttonText.includes('respond')) {
        console.log('Found reply button by role and text content');
        return button;
      }
    }
    
    console.log('Could not find reply button');
    return null;
  }

  async waitForComposeModalAndInsertText(replyText, tweetElement) {
    return new Promise((resolve, reject) => {
      let attempts = 0;
      const maxAttempts = 30; // 3 seconds with 100ms intervals
      
      const findAndInsertText = () => {
        attempts++;
        
        // Look for reply dialog that appears after clicking reply
        const replyDialogs = document.querySelectorAll('[role="dialog"]');
        let activeReplyDialog = null;
        
        // Find the dialog that contains "Replying to" text
        for (const dialog of replyDialogs) {
          const replyingToText = dialog.textContent.toLowerCase().includes('replying to');
          if (replyingToText) {
            activeReplyDialog = dialog;
            break;
          }
        }
        
        // If no dialog found, look for the most recent dialog
        if (!activeReplyDialog && replyDialogs.length > 0) {
          activeReplyDialog = replyDialogs[replyDialogs.length - 1];
        }
        
        if (activeReplyDialog) {
          console.log('Found active reply dialog, looking for Draft.js editor...');
          
          // Strategy 1: Look for Draft.js editor div with data-offset-key
          const draftEditor = activeReplyDialog.querySelector('[data-offset-key]');
          const draftEditorParent = activeReplyDialog.querySelector('.public-DraftEditor-content');
          
          // Strategy 2: Look for the textarea within the dialog
          const textarea = activeReplyDialog.querySelector('[data-testid="tweetTextarea_0"]');
          
          if (draftEditor) {
            console.log('Found Draft.js editor, inserting text...');
            
            // Focus on the editor
            if (textarea) {
              textarea.focus();
            }
            
            // Insert text into Draft.js editor
            this.insertTextIntoDraftEditor(draftEditor, replyText, textarea);
            
            console.log('Text inserted into Draft.js editor successfully!');
            resolve();
            return;
          } else if (textarea) {
            console.log('Found textarea fallback, inserting text...');
            
            // Fallback to textarea method
            this.insertTextIntoTextarea(textarea, replyText);
            
            console.log('Text inserted into textarea successfully!');
            resolve();
            return;
          }
        }
        
        if (attempts >= maxAttempts) {
          reject(new Error('Reply compose modal did not appear within timeout'));
          return;
        }
        
        // Wait and try again
        setTimeout(findAndInsertText, 100);
      };
      
      // Start searching for the compose modal
      findAndInsertText();
    });
  }

  insertTextIntoDraftEditor(draftEditor, replyText, textarea) {
    // Clear existing content
    draftEditor.innerHTML = '';
    
    // Create a new text node with the reply text
    const textSpan = document.createElement('span');
    textSpan.setAttribute('data-text', 'true');
    textSpan.textContent = replyText;
    
    // Create the Draft.js structure
    const blockDiv = document.createElement('div');
    blockDiv.className = 'public-DraftStyleDefault-block public-DraftStyleDefault-ltr';
    blockDiv.setAttribute('data-offset-key', 'reply-0-0');
    
    const spanWrapper = document.createElement('span');
    spanWrapper.setAttribute('data-offset-key', 'reply-0-0');
    spanWrapper.appendChild(textSpan);
    
    blockDiv.appendChild(spanWrapper);
    draftEditor.appendChild(blockDiv);
    
    // Also set the textarea value if available
    if (textarea) {
      textarea.value = replyText;
      textarea.textContent = replyText;
      
      // Trigger events on the textarea
      const events = ['input', 'change', 'keyup', 'keydown'];
      events.forEach(eventType => {
        const event = new Event(eventType, { bubbles: true });
        textarea.dispatchEvent(event);
      });
    }
    
    // Focus and trigger events on the Draft editor
    draftEditor.focus();
    
    // Trigger input events on the Draft editor
    const inputEvent = new Event('input', { bubbles: true });
    const changeEvent = new Event('change', { bubbles: true });
    const keyupEvent = new KeyboardEvent('keyup', { bubbles: true });
    
    draftEditor.dispatchEvent(inputEvent);
    draftEditor.dispatchEvent(changeEvent);
    draftEditor.dispatchEvent(keyupEvent);
    
    // Try to trigger React's synthetic events
    const reactEvents = ['onInput', 'onChange', 'onKeyUp'];
    reactEvents.forEach(eventName => {
      if (draftEditor[eventName]) {
        draftEditor[eventName]({ target: draftEditor });
      }
    });
  }

  insertTextIntoTextarea(textarea, replyText) {
    // Focus the textarea
    textarea.focus();
    
    // Clear existing content
    textarea.value = '';
    textarea.textContent = '';
    textarea.innerHTML = '';
    
    // Insert the text using multiple methods
    textarea.value = replyText;
    textarea.textContent = replyText;
    
    // Use document.execCommand as fallback
    document.execCommand('selectAll', false, null);
    document.execCommand('insertText', false, replyText);
    
    // Trigger comprehensive events
    const events = [
      'input', 'change', 'keyup', 'keydown', 'keypress',
      'focus', 'blur', 'compositionend'
    ];
    
    events.forEach(eventType => {
      const event = new Event(eventType, { bubbles: true });
      textarea.dispatchEvent(event);
    });
    
    // Trigger keyboard events that might trigger React handlers
    const keyboardEvents = ['keyup', 'keydown'];
    keyboardEvents.forEach(eventType => {
      const event = new KeyboardEvent(eventType, { 
        bubbles: true, 
        key: 'Enter', 
        code: 'Enter',
        charCode: 13,
        keyCode: 13,
        which: 13
      });
      textarea.dispatchEvent(event);
    });
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

  createMachineGunButton() {
    // Remove existing elements if they exist
    const existingButton = document.querySelector('.machine-gun-button');
    const existingStats = document.querySelector('.machine-gun-stats');
    if (existingButton) existingButton.remove();
    if (existingStats) existingStats.remove();

    // Create the machine gun mode button
    const button = document.createElement('button');
    button.className = 'machine-gun-button';
    button.innerHTML = '🔫 Machine Gun Mode: OFF';
    button.title = 'Auto-reply to tweets (scroll timeline automatically)';
    
    // Style the button
    Object.assign(button.style, {
      position: 'fixed',
      top: '20px',
      right: '20px',
      zIndex: '10000',
      background: '#1d9bf0',
      color: 'white',
      border: 'none',
      borderRadius: '20px',
      padding: '12px 20px',
      fontSize: '14px',
      fontWeight: 'bold',
      cursor: 'pointer',
      boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
      transition: 'all 0.3s ease'
    });

    button.addEventListener('click', () => this.toggleMachineGunMode());
    document.body.appendChild(button);
    this.machineGunButton = button;
    
    // Create stats display
    this.createStatsDisplay();
  }
  
  createStatsDisplay() {
    const stats = document.createElement('div');
    stats.className = 'machine-gun-stats';
    stats.style.display = 'none';
    stats.innerHTML = `
      <div><strong>🔫 Machine Gun Stats</strong></div>
      <div>Processed: <span id="mg-processed">0</span>/${this.maxTweetsPerSession}</div>
      <div>Queue: <span id="mg-queue">0</span></div>
      <div>Runtime: <span id="mg-runtime">00:00</span></div>
      <div>Rate: <span id="mg-rate">${this.rateLimitDelay/1000}s</span>/tweet</div>
    `;
    
    document.body.appendChild(stats);
    this.machineGunStats = stats;
  }

  toggleMachineGunMode() {
    this.machineGunMode = !this.machineGunMode;
    
    if (this.machineGunMode) {
      this.startMachineGunMode();
    } else {
      this.stopMachineGunMode();
    }
    
    this.updateMachineGunButton();
  }

  updateMachineGunButton() {
    if (!this.machineGunButton) return;
    
    if (this.machineGunMode) {
      this.machineGunButton.innerHTML = '⏹️ Machine Gun Mode: ON';
      this.machineGunButton.style.background = '#f91880';
      this.machineGunButton.style.animation = 'pulse 2s infinite';
    } else {
      this.machineGunButton.innerHTML = '🔫 Machine Gun Mode: OFF';
      this.machineGunButton.style.background = '#1d9bf0';
      this.machineGunButton.style.animation = 'none';
    }
  }

  async startMachineGunMode() {
    console.log('🔫 Starting Machine Gun Mode...');
    
    if (!this.apiKey || !this.geminiApiKey) {
      alert('Please configure your API keys first!');
      this.machineGunMode = false;
      this.updateMachineGunButton();
      return;
    }

    // Reset session counters
    this.processedInSession = 0;
    this.machineGunQueue = [];
    this.startTime = Date.now();
    
    // Show stats display
    if (this.machineGunStats) {
      this.machineGunStats.style.display = 'block';
    }
    
    // Add CSS animation for pulsing effect
    this.addMachineGunStyles();
    
    // Start the processing loop
    this.machineGunInterval = setInterval(() => {
      this.processMachineGunQueue();
    }, this.rateLimitDelay);
    
    // Start stats update interval
    this.statsInterval = setInterval(() => {
      this.updateStats();
    }, 1000);
    
    // Initial population of queue
    this.populateQueue();
  }

  stopMachineGunMode() {
    console.log('⏹️ Stopping Machine Gun Mode...');
    
    if (this.machineGunInterval) {
      clearInterval(this.machineGunInterval);
      this.machineGunInterval = null;
    }
    
    if (this.statsInterval) {
      clearInterval(this.statsInterval);
      this.statsInterval = null;
    }
    
    // Hide stats display
    if (this.machineGunStats) {
      this.machineGunStats.style.display = 'none';
    }
    
    this.machineGunQueue = [];
    this.isProcessing = false;
    
    // Remove processing indicators from any remaining tweets
    document.querySelectorAll('.machine-gun-processing').forEach(tweet => {
      tweet.classList.remove('machine-gun-processing');
    });
    
    console.log(`Machine Gun Mode stopped. Processed ${this.processedInSession} tweets this session.`);
  }

  addMachineGunStyles() {
    const styleId = 'machine-gun-styles';
    if (document.getElementById(styleId)) return;
    
    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = `
      @keyframes pulse {
        0% { transform: scale(1); }
        50% { transform: scale(1.05); }
        100% { transform: scale(1); }
      }
      .machine-gun-processing {
        animation: pulse 1s infinite;
        opacity: 0.7;
      }
    `;
    document.head.appendChild(style);
  }

  populateQueue() {
    const tweets = document.querySelectorAll('[data-testid="tweet"]');
    console.log(`🔍 Found ${tweets.length} tweets to evaluate for machine gun mode`);
    
    tweets.forEach((tweet) => {
      const tweetId = this.getTweetId(tweet);
      if (!tweetId) return;
      
      // Skip if already processed
      if (this.processedTweets.has(tweetId)) return;
      
      // Skip if already has AI button or is processing
      if (tweet.querySelector('.ai-reply-button') || tweet.classList.contains('machine-gun-processing')) return;
      
      // Skip if can't extract URL
      const tweetUrl = this.extractTweetUrl(tweet);
      if (!tweetUrl) return;
      
      // Add to queue
      this.machineGunQueue.push({
        tweetId,
        tweetUrl,
        tweetElement: tweet,
        addedAt: Date.now()
      });
    });
    
    console.log(`📋 Added ${this.machineGunQueue.length} tweets to machine gun queue`);
  }

  async processMachineGunQueue() {
    if (!this.machineGunMode || this.isProcessing) return;
    
    // Check session limits
    if (this.processedInSession >= this.maxTweetsPerSession) {
      console.log('⚠️ Reached maximum tweets per session. Stopping machine gun mode.');
      this.stopMachineGunMode();
      this.machineGunMode = false;
      this.updateMachineGunButton();
      return;
    }
    
    // Get next tweet from queue
    const nextTweet = this.machineGunQueue.shift();
    
    if (!nextTweet) {
      console.log('📋 Queue empty, scrolling for more tweets...');
      await this.scrollForMoreTweets();
      this.populateQueue();
      return;
    }
    
    // Skip if tweet element is no longer in DOM
    if (!document.contains(nextTweet.tweetElement)) {
      console.log('🗑️ Tweet element no longer in DOM, skipping...');
      return;
    }
    
    this.isProcessing = true;
    
    try {
      console.log(`🎯 Processing tweet ${this.processedInSession + 1}/${this.maxTweetsPerSession}: ${nextTweet.tweetId}`);
      
      // Mark as processing
      nextTweet.tweetElement.classList.add('machine-gun-processing');
      
      // Process the tweet
      await this.handleAIButtonClick(nextTweet.tweetUrl, nextTweet.tweetElement);
      
      this.processedInSession++;
      
    } catch (error) {
      console.error('❌ Error processing tweet in machine gun mode:', error);
    } finally {
      // Remove processing indicator
      nextTweet.tweetElement.classList.remove('machine-gun-processing');
      this.isProcessing = false;
    }
  }

  updateStats() {
    if (!this.machineGunStats || !this.machineGunMode) return;
    
    const runtime = this.startTime ? Date.now() - this.startTime : 0;
    const minutes = Math.floor(runtime / 60000);
    const seconds = Math.floor((runtime % 60000) / 1000);
    
    const processedEl = document.getElementById('mg-processed');
    const queueEl = document.getElementById('mg-queue');
    const runtimeEl = document.getElementById('mg-runtime');
    const rateEl = document.getElementById('mg-rate');
    
    if (processedEl) processedEl.textContent = this.processedInSession;
    if (queueEl) queueEl.textContent = this.machineGunQueue.length;
    if (runtimeEl) runtimeEl.textContent = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    if (rateEl) rateEl.textContent = `${this.rateLimitDelay/1000}s`;
  }

  async scrollForMoreTweets() {
    console.log('📜 Scrolling for more tweets...');
    
    const beforeScroll = document.querySelectorAll('[data-testid="tweet"]').length;
    
    // Scroll down gradually
    const scrollAmount = window.innerHeight * 2;
    window.scrollBy({
      top: scrollAmount,
      behavior: 'smooth'
    });
    
    // Wait for new content to load
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    const afterScroll = document.querySelectorAll('[data-testid="tweet"]').length;
    const newTweets = afterScroll - beforeScroll;
    
    console.log(`📊 Loaded ${newTweets} new tweets (${beforeScroll} -> ${afterScroll} total)`);
    
    // If we didn't get new tweets, try scrolling more
    if (newTweets === 0) {
      console.log('⚠️ No new tweets loaded, trying harder scroll...');
      window.scrollTo({
        top: document.body.scrollHeight,
        behavior: 'smooth'
      });
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }
}

if (window.location.hostname === 'x.com' || window.location.hostname === 'twitter.com') {
  const aiReplyGuy = new TwitterAIReplyGuy();
}
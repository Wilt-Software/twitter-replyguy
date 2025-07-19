class TwitterAIReplyGuy {
  constructor() {
    this.apiKey = '';
    this.geminiApiKey = '';
    this.debounceTimeout = null;
    this.processedTweets = new Set(); // Tracks tweets with AI buttons added
    this.machineGunProcessedTweets = new Set(); // Tracks tweets actually processed by Machine Gun Mode
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
    this.statsInterval = null;
    this.currentUsername = null; // Store current user's username
    this.lastScrollPosition = 0;
    this.scrollAttempts = 0;
    this.maxScrollAttempts = 5;
    this.init();
  }

  async init() {
    await this.loadApiKeys();
    await this.detectCurrentUsername();
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

  async detectCurrentUsername() {
    try {
      // Method 1: Look for profile navigation link
      const profileLink = document.querySelector('a[data-testid="AppTabBar_Profile_Link"]');
      if (profileLink) {
        const href = profileLink.getAttribute('href');
        if (href && href.startsWith('/')) {
          this.currentUsername = href.slice(1); // Remove leading slash
          console.log('✅ Detected current username:', this.currentUsername);
          return;
        }
      }

      // Method 2: Look for user avatar in sidebar
      const userButton = document.querySelector('[data-testid="SideNav_AccountSwitcher_Button"]');
      if (userButton) {
        const usernameElement = userButton.querySelector('span');
        if (usernameElement && usernameElement.textContent.startsWith('@')) {
          this.currentUsername = usernameElement.textContent.slice(1); // Remove @
          console.log('✅ Detected current username from sidebar:', this.currentUsername);
          return;
        }
      }

      // Method 3: Check URL if on profile page
      if (window.location.pathname.length > 1) {
        const pathParts = window.location.pathname.split('/');
        if (pathParts.length >= 2 && pathParts[1] && !pathParts[1].includes('status')) {
          this.currentUsername = pathParts[1];
          console.log('✅ Detected current username from URL:', this.currentUsername);
          return;
        }
      }

      console.warn('⚠️ Could not detect current username');
    } catch (error) {
      console.error('Error detecting username:', error);
    }
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

    const button = tweetElement.querySelector('.ai-reply-button');
    if (button) {
      button.classList.add('loading');
      button.disabled = true;
    }

    try {
      console.log('Fetching tweet data...');
      const tweetData = await this.fetchTweetData(tweetUrl);
      console.log('Tweet data received, generating reply...');
      const aiReply = await this.generateReply(tweetData);
      console.log('AI reply generated successfully:', aiReply);
      
      const tweetId = this.extractTweetIdFromElement(tweetElement);
      if (!tweetId) {
        throw new Error('Could not extract tweet ID');
      }
      
      console.log('Opening compose box and inserting pre-generated reply...');
      await this.replyToTweetWithGeneratedText(tweetId, aiReply, tweetElement);
      
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
      
      // Only show alert if not in machine gun mode
      if (!this.machineGunMode) {
        alert(errorMessage);
      } else {
        console.error('Machine Gun Mode Error:', errorMessage);
      }
      
      // Re-throw error so machine gun mode can handle it
      throw error;
    } finally {
      if (button) {
        button.classList.remove('loading');
        button.disabled = false;
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
      const replyButton = this.findReplyButton(tweetElement);
      if (!replyButton) {
        throw new Error('Could not find reply button for this tweet');
      }

      // Click the reply button to open the compose modal
      console.log('Clicking reply button...');
      replyButton.click();

      // NEW: Wait for the modal and insert text within its context
      const composeEditor = await this.waitForAndGetComposeEditor();
      
      console.log('AI reply successfully inserting into the correct compose box...');
      this.insertTextIntoComposeBox(composeEditor, replyText);

      // If in machine gun mode, automatically submit the reply
      if (this.machineGunMode) {
        console.log('Machine gun mode: automatically submitting reply...');
        // Pass the modal context to the submit function
        const replyModal = composeEditor.closest('[role="dialog"]');
        await this.submitReply(replyModal);
      }

    } catch (error) {
      console.error('Error replying to tweet:', error);
      // Fallback: open Twitter intent URL
      if (!this.machineGunMode) {
        window.open(`https://x.com/intent/tweet?in_reply_to=${tweetId}&text=${encodeURIComponent(replyText)}`, '_blank');
      }
      throw error; // Re-throw for machine gun mode error handling
    }
  }

  async submitReply(replyModal) { // Accepts the modal as context
    console.log('Waiting 1 second before clicking Reply...');
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    return new Promise((resolve, reject) => {
      if (!replyModal) {
        return reject(new Error("Cannot submit reply: the reply modal context was lost."));
      }

      // Search for the submit button ONLY within the specific reply modal
      const submitButton = replyModal.querySelector('button[data-testid="tweetButton"]');

      if (submitButton && !submitButton.disabled) {
        console.log('✅ Found submit button inside the modal, clicking...');
        submitButton.click();
        
        setTimeout(() => {
          console.log('Reply submitted.');
          resolve();
        }, 500); // Give it a moment to process the click
      } else {
        console.error('Could not find the submit button inside the reply modal or it was disabled.');
        reject(new Error('Reply submit button not found inside the modal.'));
      }
    });
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

  async waitForAndGetComposeEditor() {
    return new Promise((resolve, reject) => {
      let attempts = 0;
      const maxAttempts = 50; // 5-second timeout

      const interval = setInterval(() => {
        attempts++;
        console.log(`Attempt ${attempts}: Looking for reply modal...`);

        // X/Twitter renders modals in a div with id="layers".
        // This is the key to differentiating from the main compose box.
        const layersContainer = document.getElementById('layers');
        if (!layersContainer) {
            if (attempts >= maxAttempts) {
                clearInterval(interval);
                reject(new Error('Could not find the #layers container for modals.'));
            }
            return;
        }

        // Within the layers, find the dialog that has appeared.
        const replyModal = layersContainer.querySelector('[role="dialog"]');
        if (replyModal) {
          // Now, search for the editor *only inside this modal*.
          const editor = replyModal.querySelector('[data-testid="tweetTextarea_0"]');
          if (editor) {
            console.log('✅ Found reply modal and its editor.');
            clearInterval(interval);
            resolve(editor);
            return;
          }
        }

        if (attempts >= maxAttempts) {
          clearInterval(interval);
          reject(new Error('Reply compose modal did not appear or editor not found within it.'));
        }
      }, 100);
    });
  }

  insertTextIntoComposeBox(editor, text) {
    console.log('Inserting text into compose box:', text);
    console.log('Editor type:', editor.tagName, 'contenteditable:', editor.contentEditable);
    
    try {
      // 1. Focus the editor element first
      editor.focus();
      console.log('Editor focused');
      
      // 2. Work with existing Draft.js structure instead of clearing it
      console.log('Working with existing Draft.js structure...');
      
      // Find the existing data-contents container
      let contentsContainer = editor.querySelector('[data-contents="true"]');
      if (contentsContainer) {
        console.log('Found existing data-contents container');
        
        // Find the existing text span
        const existingTextSpan = contentsContainer.querySelector('[data-text="true"]');
        if (existingTextSpan) {
          console.log('Found existing text span, replacing content');
          existingTextSpan.textContent = text;
        } else {
          console.log('No existing text span, creating new structure');
          this.createDraftJsStructure(contentsContainer, text);
        }
      } else {
        console.log('No data-contents container found, using direct insertion');
        
        // Fallback: Select all and replace with execCommand
        const range = document.createRange();
        const selection = window.getSelection();
        
        // Select all content in the editor
        range.selectNodeContents(editor);
        selection.removeAllRanges();
        selection.addRange(range);
        
        // Use execCommand to replace selected content
        const execResult = document.execCommand('insertText', false, text);
        console.log('execCommand result:', execResult);
      }
      
      // 3. Dispatch minimal events to avoid breaking React state
      console.log('Dispatching minimal validation events...');
      
      // Only dispatch the most essential event
      const inputEvent = new Event('input', { 
        bubbles: true, 
        cancelable: true
      });
      
      editor.dispatchEvent(inputEvent);
      
      // Small delay for React to process
      setTimeout(() => {
        const changeEvent = new Event('change', { bubbles: true });
        editor.dispatchEvent(changeEvent);
        console.log('Essential events dispatched');
      }, 50);
      
      // 4. Verify the text was actually inserted
      setTimeout(() => {
        const currentContent = editor.textContent || editor.innerText;
        if (currentContent && currentContent.includes(text.substring(0, 20))) {
          console.log('✅ Text insertion verified successful');
          console.log('Content length:', currentContent.length);
        } else {
          console.warn('⚠️ Text insertion verification unclear');
          console.log('Expected text start:', text.substring(0, 20));
          console.log('Actual content:', currentContent ? currentContent.substring(0, 50) : 'empty');
        }
      }, 100);
      
      console.log('Text insertion process completed');
      
    } catch (error) {
      console.error('Error in insertTextIntoComposeBox:', error);
      throw error;
    }
  }

  createDraftJsStructure(contentsContainer, text) {
    console.log('Creating proper Draft.js structure');
    
    // Clear the container
    contentsContainer.innerHTML = '';
    
    // Get a unique editor ID
    const editorId = 'ai-editor-' + Math.random().toString(36).substr(2, 5);
    
    // Create the proper Draft.js block structure
    const blockWrapper = document.createElement('div');
    blockWrapper.className = '';
    blockWrapper.setAttribute('data-block', 'true');
    blockWrapper.setAttribute('data-editor', editorId);
    blockWrapper.setAttribute('data-offset-key', editorId + '-0-0');
    
    const blockDiv = document.createElement('div');
    blockDiv.setAttribute('data-offset-key', editorId + '-0-0');
    blockDiv.className = 'public-DraftStyleDefault-block public-DraftStyleDefault-ltr';
    
    const spanWrapper = document.createElement('span');
    spanWrapper.setAttribute('data-offset-key', editorId + '-0-0');
    
    const textSpan = document.createElement('span');
    textSpan.setAttribute('data-text', 'true');
    textSpan.textContent = text;
    
    spanWrapper.appendChild(textSpan);
    blockDiv.appendChild(spanWrapper);
    blockWrapper.appendChild(blockDiv);
    contentsContainer.appendChild(blockWrapper);
    
    console.log('Draft.js structure created');
  }

  hidePlaceholder(editor) {
    // Find and hide any placeholder elements
    try {
      const placeholders = document.querySelectorAll('.public-DraftEditorPlaceholder-root, [class*="placeholder"]');
      placeholders.forEach(placeholder => {
        if (placeholder.style) {
          placeholder.style.display = 'none';
        }
      });
      console.log('Placeholder elements hidden:', placeholders.length);
    } catch (error) {
      console.warn('Could not hide placeholder:', error);
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

  createMachineGunButton() {
    // Remove existing elements if they exist to prevent duplicates
    const existingButton = document.querySelector('.machine-gun-button');
    const existingStats = document.querySelector('.machine-gun-stats');
    if (existingButton) existingButton.remove();
    if (existingStats) existingStats.remove();

    // Create the "Machine Gun Mode" button
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
    
    // Create the stats display element
    this.createStatsDisplay();
  }
  
  createStatsDisplay() {
    const stats = document.createElement('div');
    stats.className = 'machine-gun-stats';
    stats.style.display = 'none'; // Initially hidden
    stats.innerHTML = `
      <div><strong>🔫 Machine Gun Stats</strong></div>
      <div>User: <span id="mg-username">Unknown</span></div>
      <div>Processed: <span id="mg-processed">0</span>/${this.maxTweetsPerSession}</div>
      <div>Queue: <span id="mg-queue">0</span></div>
      <div>Runtime: <span id="mg-runtime">00:00</span></div>
      <div>Scroll: <span id="mg-scroll">0</span>/${this.maxScrollAttempts}</div>
      <div>Rate: <span id="mg-rate">${this.rateLimitDelay/1000}s</span>/tweet</div>
    `;
    
    // Style the stats display
    Object.assign(stats.style, {
      position: 'fixed',
      top: '80px',
      right: '20px',
      zIndex: '9999',
      background: 'rgba(0,0,0,0.8)',
      color: 'white',
      padding: '12px',
      borderRadius: '8px',
      fontSize: '12px',
      fontFamily: 'monospace',
      minWidth: '200px',
      boxShadow: '0 4px 12px rgba(0,0,0,0.3)'
    });
    
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

  addMachineGunStyles() {
    const styleId = 'machine-gun-styles';
    if (document.getElementById(styleId)) return;
    
    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = `
      @keyframes pulse {
        0% { transform: scale(1); }
        50% { transform: scale(1.02); }
        100% { transform: scale(1); }
      }
      
      @keyframes glow {
        0% { box-shadow: 0 0 5px rgba(29, 155, 240, 0.3); }
        50% { box-shadow: 0 0 20px rgba(29, 155, 240, 0.6); }
        100% { box-shadow: 0 0 5px rgba(29, 155, 240, 0.3); }
      }
      
      @keyframes success-flash {
        0% { background-color: rgba(0, 186, 124, 0.1); }
        50% { background-color: rgba(0, 186, 124, 0.3); }
        100% { background-color: rgba(0, 186, 124, 0.1); }
      }
      
      @keyframes error-flash {
        0% { background-color: rgba(244, 33, 46, 0.1); }
        50% { background-color: rgba(244, 33, 46, 0.3); }
        100% { background-color: rgba(244, 33, 46, 0.1); }
      }
      
      /* Currently being processed tweet */
      .machine-gun-processing {
        animation: pulse 2s infinite, glow 2s infinite;
        border: 2px solid rgba(29, 155, 240, 0.5) !important;
        border-radius: 12px !important;
        background-color: rgba(29, 155, 240, 0.05) !important;
        position: relative;
        z-index: 10;
      }
      
      /* Add processing indicator */
      .machine-gun-processing::before {
        content: "🔫 PROCESSING...";
        position: absolute;
        top: -25px;
        left: 10px;
        background: rgba(29, 155, 240, 0.9);
        color: white;
        padding: 4px 12px;
        border-radius: 20px;
        font-size: 12px;
        font-weight: bold;
        z-index: 1000;
        animation: pulse 1s infinite;
      }
      
      /* Successfully processed tweet */
      .machine-gun-completed {
        animation: success-flash 1s ease-out;
        border: 2px solid rgba(0, 186, 124, 0.4) !important;
        border-radius: 12px !important;
        background-color: rgba(0, 186, 124, 0.05) !important;
        position: relative;
      }
      
      /* Add success indicator */
      .machine-gun-completed::before {
        content: "✅ COMPLETED";
        position: absolute;
        top: -25px;
        left: 10px;
        background: rgba(0, 186, 124, 0.9);
        color: white;
        padding: 4px 12px;
        border-radius: 20px;
        font-size: 12px;
        font-weight: bold;
        z-index: 1000;
        opacity: 0.8;
      }
      
      /* Failed to process tweet */
      .machine-gun-failed {
        animation: error-flash 1s ease-out;
        border: 2px solid rgba(244, 33, 46, 0.4) !important;
        border-radius: 12px !important;
        background-color: rgba(244, 33, 46, 0.05) !important;
        position: relative;
      }
      
      /* Add error indicator */
      .machine-gun-failed::before {
        content: "❌ FAILED";
        position: absolute;
        top: -25px;
        left: 10px;
        background: rgba(244, 33, 46, 0.9);
        color: white;
        padding: 4px 12px;
        border-radius: 20px;
        font-size: 12px;
        font-weight: bold;
        z-index: 1000;
        opacity: 0.8;
      }
      
      /* Clean up indicators after some time */
      .machine-gun-completed::before,
      .machine-gun-failed::before {
        animation: fadeOut 3s ease-out 2s forwards;
      }
      
      @keyframes fadeOut {
        to { opacity: 0; }
      }
    `;
    document.head.appendChild(style);
  }

  async startMachineGunMode() {
    console.log('🔫 Starting Machine Gun Mode...');
    
    if (!this.apiKey || !this.geminiApiKey) {
      alert('Please configure your API keys first!');
      this.machineGunMode = false;
      this.updateMachineGunButton();
      return;
    }

    // Reset session counters and clear Machine Gun processed tweets
    this.processedInSession = 0;
    this.machineGunQueue = [];
    this.machineGunProcessedTweets.clear(); // Clear only Machine Gun processed tweets
    this.startTime = Date.now();
    this.scrollAttempts = 0;
    this.lastScrollPosition = 0;
    
    // Re-detect username in case user switched accounts
    await this.detectCurrentUsername();
    
    console.log('📋 Cleared Machine Gun processed tweets set and reset counters');
    console.log(`📋 Keeping ${this.processedTweets.size} tweets with AI buttons`);
    
    // Show stats display
    if (this.machineGunStats) {
      this.machineGunStats.style.display = 'block';
    }
    
    this.addMachineGunStyles();
    
    // Initial population of the queue
    this.populateQueue();
    
    // Start the processing loop
    this.machineGunInterval = setInterval(() => {
      this.processMachineGunQueue();
    }, this.rateLimitDelay);
    
    // Start stats update interval
    this.statsInterval = setInterval(() => {
      this.updateStats();
    }, 1000);
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
    
    document.querySelectorAll('.machine-gun-processing').forEach(tweet => {
      tweet.classList.remove('machine-gun-processing');
    });
    
    console.log(`Machine Gun Mode stopped. Processed ${this.processedInSession} tweets this session.`);
  }

  populateQueue() {
    const tweets = document.querySelectorAll('[data-testid="tweet"]');
    console.log(`🔍 Found ${tweets.length} tweets to evaluate for machine gun mode`);
    console.log(`📋 Tweets with AI buttons: ${this.processedTweets.size}`);
    console.log(`📋 Machine Gun processed tweets: ${this.machineGunProcessedTweets.size}`);
    console.log(`👤 Current username: ${this.currentUsername || 'UNKNOWN'}`);
    
    let addedCount = 0;
    let skippedCount = 0;
    
    tweets.forEach((tweet, index) => {
      console.log(`🔍 Evaluating tweet ${index + 1}/${tweets.length}...`);
      
      const tweetId = this.getTweetId(tweet);
      console.log(`  - Tweet ID: ${tweetId || 'NO_ID'}`);
      
      if (!tweetId) {
        console.log('  ⚠️ No tweet ID found, skipping');
        skippedCount++;
        return;
      }
      
      // Skip if already processed by Machine Gun Mode
      if (this.machineGunProcessedTweets.has(tweetId)) {
        console.log(`  ⚠️ Tweet ${tweetId} already processed by Machine Gun Mode, skipping`);
        skippedCount++;
        return;
      }
      
      // Skip if currently being processed
      if (tweet.classList.contains('machine-gun-processing')) {
        console.log(`  ⚠️ Tweet ${tweetId} currently being processed, skipping`);
        skippedCount++;
        return;
      }

      // NEW: Skip tweets from current user (our own tweets/replies)
      if (this.isOwnTweet(tweet)) {
        console.log(`  ⚠️ Tweet ${tweetId} is from current user, skipping`);
        skippedCount++;
        return;
      }

      // NEW: Skip promotional/sponsored tweets
      if (this.isPromotedTweet(tweet)) {
        console.log(`  ⚠️ Tweet ${tweetId} is promoted/sponsored, skipping`);
        skippedCount++;
        return;
      }
      
      const tweetUrl = this.extractTweetUrl(tweet);
      console.log(`  - Tweet URL: ${tweetUrl || 'NO_URL'}`);
      
      if (!tweetUrl) {
        console.log(`  ⚠️ No tweet URL found for ${tweetId}, skipping`);
        skippedCount++;
        return;
      }
      
      // Add to queue - now we can process tweets that have AI buttons
      this.machineGunQueue.push({
        tweetId,
        tweetUrl,
        tweetElement: tweet,
        addedAt: Date.now()
      });
      
      console.log(`  ✅ Added tweet ${tweetId} to queue (URL: ${tweetUrl})`);
      addedCount++;
    });
    
    console.log(`📋 Queue population complete: ${addedCount} added, ${skippedCount} skipped. Total in queue: ${this.machineGunQueue.length}`);
  }

  isOwnTweet(tweetElement) {
    if (!this.currentUsername) {
      return false; // If we don't know our username, allow all tweets
    }

    try {
      // Method 1: Check username in tweet author link
      const authorLinks = tweetElement.querySelectorAll('a[href^="/"]');
      for (const link of authorLinks) {
        const href = link.getAttribute('href');
        if (href && href.includes(`/${this.currentUsername}`)) {
          // Make sure it's not just a mention but actually the author
          const linkParent = link.closest('[data-testid="User-Name"], [data-testid="User-Names"]');
          if (linkParent) {
            console.log(`🚫 Found own tweet by author link: ${href}`);
            return true;
          }
        }
      }

      // Method 2: Check for "You" indicator in user name area
      const userNameArea = tweetElement.querySelector('[data-testid="User-Name"], [data-testid="User-Names"]');
      if (userNameArea && userNameArea.textContent.includes('You')) {
        console.log(`🚫 Found own tweet by "You" indicator`);
        return true;
      }

      // Method 3: Check username text content
      const usernameElements = tweetElement.querySelectorAll('span');
      for (const span of usernameElements) {
        const text = span.textContent.trim();
        if (text === `@${this.currentUsername}`) {
          console.log(`🚫 Found own tweet by username text: ${text}`);
          return true;
        }
      }

      return false;
    } catch (error) {
      console.error('Error checking if own tweet:', error);
      return false; // If error, assume it's not our tweet
    }
  }

  isPromotedTweet(tweetElement) {
    try {
      // Check for promoted tweet indicators
      const promotedIndicators = [
        'Promoted',
        'Sponsored',
        'Ad',
        'Advertisement'
      ];

      const textContent = tweetElement.textContent.toLowerCase();
      for (const indicator of promotedIndicators) {
        if (textContent.includes(indicator.toLowerCase())) {
          console.log(`🚫 Found promoted tweet with indicator: ${indicator}`);
          return true;
        }
      }

      // Check for specific promoted tweet elements
      const promotedElement = tweetElement.querySelector('[data-testid="socialContext"]');
      if (promotedElement && promotedElement.textContent.toLowerCase().includes('promoted')) {
        console.log(`🚫 Found promoted tweet by social context`);
        return true;
      }

      return false;
    } catch (error) {
      console.error('Error checking if promoted tweet:', error);
      return false;
    }
  }

  async processMachineGunQueue() {
    if (!this.machineGunMode || this.isProcessing) {
      console.log(`⚠️ Skipping queue processing: machineGunMode=${this.machineGunMode}, isProcessing=${this.isProcessing}`);
      return;
    }
    
    if (this.processedInSession >= this.maxTweetsPerSession) {
      console.log('⚠️ Reached maximum tweets per session. Stopping machine gun mode.');
      this.stopMachineGunMode();
      this.machineGunMode = false;
      this.updateMachineGunButton();
      return;
    }
    
    console.log(`🔍 Processing queue... Current queue size: ${this.machineGunQueue.length}`);
    
    const nextTweet = this.machineGunQueue.shift();
    
    if (!nextTweet) {
      console.log('📋 Queue empty, repopulating queue first...');
      this.populateQueue();
      
      // If still empty after repopulation, scroll for more
      if (this.machineGunQueue.length === 0) {
        console.log('📋 Queue still empty after repopulation, initiating virtual scroll...');
        
        // Try scrolling multiple times with different strategies
        let scrollAttempts = 0;
        const maxScrollAttempts = 3;
        
        while (scrollAttempts < maxScrollAttempts && this.machineGunQueue.length === 0) {
          scrollAttempts++;
          console.log(`📜 Scroll attempt ${scrollAttempts}/${maxScrollAttempts}`);
          
          const scrollSuccess = await this.scrollForMoreTweets();
          
          if (scrollSuccess) {
            // Wait for virtual list to update
            await new Promise(resolve => setTimeout(resolve, 2000));
            this.populateQueue();
            
            if (this.machineGunQueue.length > 0) {
              console.log(`✅ Scroll successful - queue now has ${this.machineGunQueue.length} tweets`);
              break;
            }
          }
          
          // If first scroll didn't work, try more aggressive scrolling
          if (scrollAttempts === 1 && this.machineGunQueue.length === 0) {
            console.log('🚀 Trying more aggressive scroll...');
            await this.aggressiveScroll();
            await new Promise(resolve => setTimeout(resolve, 2500));
            this.populateQueue();
          }
        }
        
        if (this.machineGunQueue.length === 0) {
          console.log('⚠️ All scroll attempts failed - might be at end of timeline');
        }
      }
      return;
    }
    
    if (!document.body.contains(nextTweet.tweetElement)) {
      console.log(`🗑️ Tweet element ${nextTweet.tweetId} no longer in DOM, skipping...`);
      return;
    }
    
    this.isProcessing = true;
    
    try {
      console.log(`🎯 Processing tweet ${this.processedInSession + 1}/${this.maxTweetsPerSession}: ${nextTweet.tweetId}`);
      
      // Scroll to and highlight the tweet being processed
      await this.scrollToAndHighlightTweet(nextTweet.tweetElement, nextTweet.tweetId);
      
      await this.handleAIButtonClick(nextTweet.tweetUrl, nextTweet.tweetElement);
      
      this.processedInSession++;
      this.machineGunProcessedTweets.add(nextTweet.tweetId);
      console.log(`✅ Successfully processed tweet ${nextTweet.tweetId}`);
      
      // Mark as completed visually
      nextTweet.tweetElement.classList.add('machine-gun-completed');
      
      // Schedule cleanup of visual indicators
      this.scheduleIndicatorCleanup(nextTweet.tweetElement);
      
    } catch (error) {
      console.error(`❌ Error processing tweet ${nextTweet.tweetId}:`, error);
      // Mark as failed visually
      nextTweet.tweetElement.classList.add('machine-gun-failed');
      
      // Schedule cleanup of visual indicators
      this.scheduleIndicatorCleanup(nextTweet.tweetElement);
      
      // Still mark as processed to avoid retrying
      this.machineGunProcessedTweets.add(nextTweet.tweetId);
    } finally {
      nextTweet.tweetElement.classList.remove('machine-gun-processing');
      this.isProcessing = false;
    }
  }

  async scrollToAndHighlightTweet(tweetElement, tweetId) {
    console.log(`👁️ Scrolling to and highlighting tweet: ${tweetId}`);
    
    try {
      // Clear any previous highlights
      document.querySelectorAll('.machine-gun-processing, .machine-gun-completed, .machine-gun-failed')
        .forEach(el => {
          el.classList.remove('machine-gun-processing', 'machine-gun-completed', 'machine-gun-failed');
        });
      
      // Add processing class for visual feedback
      tweetElement.classList.add('machine-gun-processing');
      
      // Get tweet position
      const tweetRect = tweetElement.getBoundingClientRect();
      const windowHeight = window.innerHeight;
      
      // Check if tweet is already in viewport (center area)
      const isInViewport = tweetRect.top >= windowHeight * 0.2 && 
                          tweetRect.bottom <= windowHeight * 0.8;
      
      if (!isInViewport) {
        console.log(`📍 Tweet not in optimal view, scrolling to center it`);
        
        // Calculate scroll position to center the tweet
        const tweetCenter = tweetRect.top + window.pageYOffset + (tweetRect.height / 2);
        const targetScrollPosition = tweetCenter - (windowHeight / 2);
        
        // Smooth scroll to center the tweet
        window.scrollTo({
          top: Math.max(0, targetScrollPosition),
          behavior: 'smooth'
        });
        
        // Wait for scroll animation to complete
        await new Promise(resolve => setTimeout(resolve, 800));
        
        console.log(`✅ Scrolled to center tweet ${tweetId}`);
      } else {
        console.log(`👁️ Tweet ${tweetId} already in optimal viewport`);
      }
      
      // Add a brief highlight pulse effect
      await this.pulseHighlight(tweetElement);
      
    } catch (error) {
      console.error('Error scrolling to tweet:', error);
    }
  }

  async pulseHighlight(tweetElement) {
    // Add pulse effect by temporarily modifying styles
    const originalTransition = tweetElement.style.transition;
    const originalTransform = tweetElement.style.transform;
    
    try {
      // Add smooth transition
      tweetElement.style.transition = 'transform 0.3s ease-in-out, box-shadow 0.3s ease-in-out';
      
      // First pulse - scale up slightly
      tweetElement.style.transform = 'scale(1.02)';
      tweetElement.style.boxShadow = '0 0 20px rgba(29, 155, 240, 0.5)';
      
      await new Promise(resolve => setTimeout(resolve, 300));
      
      // Return to normal size
      tweetElement.style.transform = 'scale(1)';
      tweetElement.style.boxShadow = '0 0 10px rgba(29, 155, 240, 0.3)';
      
      await new Promise(resolve => setTimeout(resolve, 300));
      
    } finally {
      // Restore original styles after pulse
      setTimeout(() => {
        tweetElement.style.transition = originalTransition;
        tweetElement.style.transform = originalTransform;
        tweetElement.style.boxShadow = '';
      }, 100);
    }
  }

  scheduleIndicatorCleanup(tweetElement) {
    // Clean up visual indicators after 10 seconds to keep timeline clean
    setTimeout(() => {
      if (tweetElement && document.body.contains(tweetElement)) {
        tweetElement.classList.remove('machine-gun-completed', 'machine-gun-failed');
        // Reset any custom styles
        tweetElement.style.border = '';
        tweetElement.style.borderRadius = '';
        tweetElement.style.backgroundColor = '';
        console.log('🧹 Cleaned up visual indicators for processed tweet');
      }
    }, 10000); // 10 seconds
  }

  async aggressiveScroll() {
    console.log('🚀 Starting aggressive scroll for virtual list...');
    
    // Rapid sequential scrolls to trigger virtual list loading
    for (let i = 0; i < 5; i++) {
      console.log(`📜 Aggressive scroll ${i + 1}/5`);
      
      window.scrollBy({
        top: window.innerHeight * 1.2,
        behavior: 'auto' // Immediate scroll
      });
      
      // Shorter wait between scrolls
      await new Promise(resolve => setTimeout(resolve, 300));
    }
    
    // Send additional events to trigger virtual list updates
    window.dispatchEvent(new Event('scroll'));
    window.dispatchEvent(new Event('resize'));
    
    console.log('🚀 Aggressive scroll completed');
  }

  updateStats() {
    if (!this.machineGunStats || !this.machineGunMode) return;
    
    const runtime = this.startTime ? Date.now() - this.startTime : 0;
    const minutes = Math.floor(runtime / 60000);
    const seconds = Math.floor((runtime % 60000) / 1000);
    
    const usernameElement = document.getElementById('mg-username');
    if (usernameElement) {
      usernameElement.textContent = this.currentUsername || 'Unknown';
    }
    
    const processedElement = document.getElementById('mg-processed');
    if (processedElement) {
      processedElement.textContent = this.processedInSession;
    }
    
    const queueElement = document.getElementById('mg-queue');
    if (queueElement) {
      queueElement.textContent = this.machineGunQueue.length;
    }
    
    const runtimeElement = document.getElementById('mg-runtime');
    if (runtimeElement) {
      runtimeElement.textContent = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    }
    
    const scrollElement = document.getElementById('mg-scroll');
    if (scrollElement) {
      scrollElement.textContent = this.scrollAttempts;
    }
  }

  async scrollForMoreTweets() {
    console.log('📜 Scrolling for more tweets using virtual scrolling strategy...');
    
    const beforeScroll = document.querySelectorAll('[data-testid="tweet"]').length;
    console.log(`📊 Tweets before scroll: ${beforeScroll}`);
    
    // Find the actual scrollable timeline container
    const timelineContainer = await this.findScrollableTimeline();
    if (!timelineContainer) {
      console.error('❌ Could not find scrollable timeline container');
      return false;
    }
    
    console.log('✅ Found timeline container:', timelineContainer);
    
    // Virtual scrolling strategy - smooth continuous scroll
    const scrollSuccess = await this.performVirtualScroll(timelineContainer);
    
    // Wait for new content to render
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    const afterScroll = document.querySelectorAll('[data-testid="tweet"]').length;
    const newTweets = afterScroll - beforeScroll;
    
    console.log(`📊 Tweets after scroll: ${afterScroll}`);
    console.log(`📊 New tweets loaded: ${newTweets}`);
    
    if (newTweets > 0) {
      console.log('✅ Virtual scroll successful - new tweets loaded');
      return true;
    } else {
      console.log('⚠️ No new tweets loaded - might be at end or need different strategy');
      return false;
    }
  }

  async findScrollableTimeline() {
    // Strategy 1: Find primary column with timeline
    let container = document.querySelector('[data-testid="primaryColumn"]');
    if (container) {
      console.log('📍 Found primaryColumn container');
      
      // Look for the scrollable timeline inside it
      const timeline = container.querySelector('[aria-label*="timeline"], [aria-label*="Timeline"]');
      if (timeline) {
        console.log('📍 Found timeline with aria-label');
        return timeline;
      }
      
      // Look for main scrollable area
      const scrollable = container.querySelector('[style*="overflow"], .css-175oi2r[style*="scroll"]');
      if (scrollable) {
        console.log('📍 Found scrollable element in primaryColumn');
        return scrollable;
      }
      
      return container; // Use primary column itself as fallback
    }
    
    // Strategy 2: Find main role container
    container = document.querySelector('main[role="main"]');
    if (container) {
      console.log('📍 Found main role container');
      return container;
    }
    
    // Strategy 3: Look for timeline by aria-label
    container = document.querySelector('[aria-label*="timeline"], [aria-label*="Timeline"]');
    if (container) {
      console.log('📍 Found container by timeline aria-label');
      return container;
    }
    
    // Strategy 4: Fallback to body
    console.log('📍 Using document.body as fallback');
    return document.body;
  }

  async performVirtualScroll(container) {
    console.log('🎯 Starting virtual scroll sequence...');
    
    let totalScrolled = 0;
    let attempts = 0;
    const maxAttempts = 8;
    
    while (attempts < maxAttempts) {
      attempts++;
      console.log(`📜 Virtual scroll attempt ${attempts}/${maxAttempts}`);
      
      const startPosition = window.pageYOffset;
      const containerHeight = container.scrollHeight || document.body.scrollHeight;
      
      // Calculate scroll distance - use smaller increments for virtual scrolling
      const scrollDistance = Math.min(
        window.innerHeight * 0.8, // Smaller scroll distance
        containerHeight * 0.1      // Or 10% of container height
      );
      
      console.log(`📊 Scrolling ${scrollDistance}px from position ${startPosition}`);
      
      // Perform smooth scroll
      window.scrollBy({
        top: scrollDistance,
        behavior: 'smooth'
      });
      
      // Wait for scroll animation and virtual list update
      await new Promise(resolve => setTimeout(resolve, 1500));
      
      const endPosition = window.pageYOffset;
      const actualScrolled = endPosition - startPosition;
      totalScrolled += actualScrolled;
      
      console.log(`📊 Actually scrolled: ${actualScrolled}px, Total: ${totalScrolled}px`);
      
      // Check if we actually scrolled (not at bottom)
      if (actualScrolled < 50) {
        console.log('⚠️ Minimal scroll movement - might be at bottom');
        break;
      }
      
      // Check if new tweets appeared during this scroll
      const currentTweets = document.querySelectorAll('[data-testid="tweet"]').length;
      if (currentTweets > 0) {
        console.log(`✅ Virtual scroll working - ${currentTweets} tweets visible`);
        
        // Continue scrolling to load more, but with smaller delays
        await new Promise(resolve => setTimeout(resolve, 800));
      }
      
      // If we've scrolled a substantial amount, that's probably enough
      if (totalScrolled > window.innerHeight * 3) {
        console.log('✅ Substantial scroll completed');
        break;
      }
    }
    
    // Final wait for any pending virtual list updates
    console.log('⏳ Final wait for virtual list to update...');
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    return totalScrolled > 100; // Success if we scrolled at least 100px
  }

}

if (window.location.hostname === 'x.com' || window.location.hostname === 'twitter.com') {
  const aiReplyGuy = new TwitterAIReplyGuy();
}
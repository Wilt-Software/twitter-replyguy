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

      // Wait for the compose modal to appear and then insert the text
      await this.waitForComposeModalAndInsertText(replyText, tweetElement);
      console.log('AI reply successfully inserted into the correct compose box!');

      // If in machine gun mode, automatically submit the reply
      if (this.machineGunMode) {
        console.log('Machine gun mode: automatically submitting reply...');
        await this.submitReply();
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

  async submitReply() {
    // Wait 1 second after pasting as requested
    console.log('Waiting 1 second after pasting before clicking Reply...');
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    return new Promise((resolve, reject) => {
      let attempts = 0;
      const maxAttempts = 10; // 1 second with 100ms intervals
      
      const findAndClickReplyButton = () => {
        attempts++;
        console.log(`Attempt ${attempts}: Looking for Reply button...`);
        
        // Strategy 1: Find button by data-testid="tweetButton" that contains "Reply" text
        const tweetButtons = document.querySelectorAll('button[data-testid="tweetButton"]');
        let replyButton = null;
        
        for (const button of tweetButtons) {
          if (button.textContent.includes('Reply')) {
            replyButton = button;
            console.log('Found Reply button by data-testid="tweetButton"');
            break;
          }
        }
        
        // Strategy 2: Find button with the exact class structure
        if (!replyButton) {
          const buttons = document.querySelectorAll('button.css-175oi2r.r-sdzlij.r-1phboty.r-rs99b7.r-lrvibr.r-1cwvpvk.r-2yi16.r-1qi8awa.r-3pj75a.r-1loqt21.r-o7ynqc.r-6416eg.r-1ny4l3l');
          for (const button of buttons) {
            if (button.textContent.includes('Reply')) {
              replyButton = button;
              console.log('Found Reply button by exact class match');
              break;
            }
          }
        }
        
        // Strategy 3: Find any button containing "Reply" text
        if (!replyButton) {
          const allButtons = document.querySelectorAll('button');
          for (const button of allButtons) {
            if (button.textContent.trim() === 'Reply') {
              replyButton = button;
              console.log('Found Reply button by text content');
              break;
            }
          }
        }
        
        // Strategy 4: Find button containing the specific span structure
        if (!replyButton) {
          const replySpans = document.querySelectorAll('span.css-1jxf684.r-bcqeeo.r-1ttztb7.r-qvutc0.r-poiln3');
          for (const span of replySpans) {
            if (span.textContent.trim() === 'Reply') {
              // Walk up to find the button
              let parent = span.parentElement;
              while (parent && parent !== document.body) {
                if (parent.tagName === 'BUTTON') {
                  replyButton = parent;
                  console.log('Found Reply button by walking up from span');
                  break;
                }
                parent = parent.parentElement;
              }
              if (replyButton) break;
            }
          }
        }
        
        if (replyButton) {
          console.log('Found reply submit button, clicking...');
          replyButton.click();
          
          console.log('Reply submitted successfully!');
          resolve();
          return;
        }
        
        if (attempts >= maxAttempts) {
          console.log('Could not find reply submit button within timeout');
          console.log('Available buttons:', document.querySelectorAll('button').length);
          console.log('Buttons with tweetButton testid:', document.querySelectorAll('button[data-testid="tweetButton"]').length);
          reject(new Error('Reply submit button not found'));
          return;
        }
        
        // Wait and try again
        setTimeout(findAndClickReplyButton, 100);
      };
      
      // Start searching for the reply button
      findAndClickReplyButton();
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

  async waitForComposeModalAndInsertText(replyText, tweetElement) {
    return new Promise((resolve, reject) => {
      let attempts = 0;
      const maxAttempts = 50; // 5 seconds timeout
      
      const interval = setInterval(() => {
        console.log(`Attempt ${attempts + 1}: Looking for reply compose editor...`);
        
        // Strategy 1: Look for the editor directly by data-testid (most reliable)
        let editor = document.querySelector('[data-testid="tweetTextarea_0"]');
        
        if (!editor) {
          // Strategy 2: Look for editor within any dialog
          const dialogs = document.querySelectorAll('[role="dialog"]');
          for (const dialog of dialogs) {
            editor = dialog.querySelector('[data-testid="tweetTextarea_0"]');
            if (editor) {
              console.log('Found editor in dialog');
              break;
            }
          }
        }
        
        if (!editor) {
          // Strategy 3: Look for editor within rich text input container
          const container = document.querySelector('[data-testid="tweetTextarea_0RichTextInputContainer"]');
          if (container) {
            editor = container.querySelector('[data-testid="tweetTextarea_0"]');
            if (editor) {
              console.log('Found editor in rich text container');
            }
          }
        }
        
        if (!editor) {
          // Strategy 4: Look for any contenteditable element that looks like a tweet compose box
          const contentEditables = document.querySelectorAll('[contenteditable="true"]');
          for (const el of contentEditables) {
            if (el.getAttribute('aria-label') && el.getAttribute('aria-label').toLowerCase().includes('post')) {
              editor = el;
              console.log('Found editor by aria-label');
              break;
            }
          }
        }
        
        if (editor) {
          console.log('Found compose editor, inserting text...');
          console.log('Editor element:', editor);
          clearInterval(interval);
          
          try {
            this.insertTextIntoComposeBox(editor, replyText);
            console.log('Text insertion completed successfully');
            resolve();
          } catch (error) {
            console.error('Error during text insertion:', error);
            reject(error);
          }
          return;
        }
        
        attempts++;
        if (attempts >= maxAttempts) {
          clearInterval(interval);
          console.error('Failed to find reply compose editor after', maxAttempts, 'attempts');
          console.log('Available dialogs:', document.querySelectorAll('[role="dialog"]').length);
          console.log('Available contenteditable elements:', document.querySelectorAll('[contenteditable="true"]').length);
          reject(new Error('Reply compose modal did not appear or editor not found.'));
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
        console.log('📋 Queue still empty after repopulation, scrolling for more tweets...');
        await this.scrollForMoreTweets();
        this.populateQueue();
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
      nextTweet.tweetElement.classList.add('machine-gun-processing');
      
      await this.handleAIButtonClick(nextTweet.tweetUrl, nextTweet.tweetElement);
      
      this.processedInSession++;
      this.machineGunProcessedTweets.add(nextTweet.tweetId);
      console.log(`✅ Successfully processed tweet ${nextTweet.tweetId}`);
      
    } catch (error) {
      console.error(`❌ Error processing tweet ${nextTweet.tweetId}:`, error);
      // Still mark as processed to avoid retrying
      this.machineGunProcessedTweets.add(nextTweet.tweetId);
    } finally {
      nextTweet.tweetElement.classList.remove('machine-gun-processing');
      this.isProcessing = false;
    }
  }

  updateStats() {
    if (!this.machineGunStats || !this.machineGunMode) return;
    
    const runtime = this.startTime ? Date.now() - this.startTime : 0;
    const minutes = Math.floor(runtime / 60000);
    const seconds = Math.floor((runtime % 60000) / 1000);
    
    document.getElementById('mg-processed').textContent = this.processedInSession;
    document.getElementById('mg-queue').textContent = this.machineGunQueue.length;
    document.getElementById('mg-runtime').textContent = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  }

  async scrollForMoreTweets() {
    console.log('📜 Scrolling for more tweets...');
    const beforeScroll = document.querySelectorAll('[data-testid="tweet"]').length;
    
    window.scrollBy({ top: window.innerHeight * 2, behavior: 'smooth' });
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    const newTweets = document.querySelectorAll('[data-testid="tweet"]').length - beforeScroll;
    console.log(`📊 Loaded ${newTweets} new tweets.`);
    
    if (newTweets === 0) {
      console.log('⚠️ No new tweets loaded, trying a harder scroll...');
      window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }

}

if (window.location.hostname === 'x.com' || window.location.hostname === 'twitter.com') {
  const aiReplyGuy = new TwitterAIReplyGuy();
}
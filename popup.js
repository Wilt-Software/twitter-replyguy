document.addEventListener('DOMContentLoaded', function() {
  const scrapeApiKeyInput = document.getElementById('scrape-api-key');
  const geminiApiKeyInput = document.getElementById('gemini-api-key');
  const scrapeToggle = document.getElementById('scrape-toggle');
  const geminiToggle = document.getElementById('gemini-toggle');
  const scrapeStatus = document.getElementById('scrape-status');
  const geminiStatus = document.getElementById('gemini-status');
  const modelSelect = document.getElementById('model-select');
  const modelStatus = document.getElementById('model-status');

  let saveTimeouts = {};

  // Load existing settings
  chrome.storage.sync.get(['scrapeCreatorsApiKey', 'geminiApiKey', 'selectedModel'], function(result) {
    if (result.scrapeCreatorsApiKey) {
      scrapeApiKeyInput.value = result.scrapeCreatorsApiKey;
      showKeyStatus('scrape', 'Saved ✓', 'success');
    }
    if (result.geminiApiKey) {
      geminiApiKeyInput.value = result.geminiApiKey;
      showKeyStatus('gemini', 'Saved ✓', 'success');
    }
    if (result.selectedModel) {
      modelSelect.value = result.selectedModel;
      showKeyStatus('model', 'Selected ✓', 'success');
    } else {
      // Default to gemini-2.5-pro
      modelSelect.value = 'gemini-2.5-pro';
      showKeyStatus('model', 'Default selected', 'success');
    }
  });

  // Auto-save ScrapeCreators API key
  scrapeApiKeyInput.addEventListener('input', function() {
    const value = this.value.trim();
    clearTimeout(saveTimeouts.scrape);
    
    if (value) {
      showKeyStatus('scrape', 'Saving...', 'pending');
      saveTimeouts.scrape = setTimeout(() => {
        chrome.storage.sync.set({ scrapeCreatorsApiKey: value }, function() {
          if (chrome.runtime.lastError) {
            showKeyStatus('scrape', 'Error saving', 'error');
          } else {
            showKeyStatus('scrape', 'Saved ✓', 'success');
          }
        });
      }, 1000);
    } else {
      showKeyStatus('scrape', '', '');
    }
  });

  // Auto-save Gemini API key
  geminiApiKeyInput.addEventListener('input', function() {
    const value = this.value.trim();
    clearTimeout(saveTimeouts.gemini);
    
    if (value) {
      showKeyStatus('gemini', 'Saving...', 'pending');
      saveTimeouts.gemini = setTimeout(() => {
        chrome.storage.sync.set({ geminiApiKey: value }, function() {
          if (chrome.runtime.lastError) {
            showKeyStatus('gemini', 'Error saving', 'error');
          } else {
            showKeyStatus('gemini', 'Saved ✓', 'success');
          }
        });
      }, 1000);
    } else {
      showKeyStatus('gemini', '', '');
    }
  });

  // Toggle password visibility
  scrapeToggle.addEventListener('click', function() {
    togglePasswordVisibility(scrapeApiKeyInput, scrapeToggle);
  });

  geminiToggle.addEventListener('click', function() {
    togglePasswordVisibility(geminiApiKeyInput, geminiToggle);
  });

  // Auto-save model selection
  modelSelect.addEventListener('change', function() {
    const selectedModel = this.value;
    showKeyStatus('model', 'Saving...', 'pending');
    
    chrome.storage.sync.set({ selectedModel: selectedModel }, function() {
      if (chrome.runtime.lastError) {
        showKeyStatus('model', 'Error saving', 'error');
      } else {
        showKeyStatus('model', 'Selected ✓', 'success');
      }
    });
  });

  function togglePasswordVisibility(input, toggle) {
    if (input.type === 'password') {
      input.type = 'text';
      toggle.textContent = '👁️';
      toggle.title = 'Hide key';
    } else {
      input.type = 'password';
      toggle.textContent = '👁️‍🗨️';
      toggle.title = 'Show key';
    }
  }

  function showKeyStatus(keyType, message, type) {
    let statusElement;
    if (keyType === 'scrape') {
      statusElement = scrapeStatus;
    } else if (keyType === 'gemini') {
      statusElement = geminiStatus;
    } else if (keyType === 'model') {
      statusElement = modelStatus;
    }
    
    statusElement.textContent = message;
    statusElement.className = `key-status ${type}`;
    
    if (type === 'success' && keyType !== 'model') {
      setTimeout(() => {
        statusElement.textContent = 'Saved ✓';
        statusElement.className = 'key-status success';
      }, 2000);
    }
  }
});
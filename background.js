chrome.runtime.onInstalled.addListener(() => {
  console.log('Twitter AI Reply Guy extension installed');
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'fetchTweetData') {
    fetchTweetData(request.tweetUrl, request.apiKey)
      .then(response => sendResponse({ success: true, data: response }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }
  
  if (request.action === 'generateReply') {
    const tweetText = request.tweetData.legacy?.full_text || request.tweetData.full_text || 'No text available';
    
    // Get the selected model from storage
    chrome.storage.sync.get(['selectedModel'], function(result) {
      const selectedModel = result.selectedModel || 'gemini-2.5-pro'; // Default fallback
      
      generateReply(request.tweetData, request.geminiApiKey, selectedModel)
        .then(reply => sendResponse({ success: true, reply }))
        .catch(error => sendResponse({ success: false, error: error.message }));
    });
    return true;
  }
});

async function fetchTweetData(tweetUrl, apiKey) {
  console.log('Fetching tweet data for URL:', tweetUrl);
  
  if (!apiKey) {
    throw new Error('ScrapeCreators API key is missing');
  }
  
  if (!tweetUrl || !tweetUrl.includes('status/')) {
    throw new Error('Invalid tweet URL format');
  }
  
  try {
    const response = await fetch(`https://api.scrapecreators.com/v1/twitter/tweet?url=${encodeURIComponent(tweetUrl)}&trim=true`, {
      method: 'GET',
      headers: {
        'x-api-key': apiKey,
        'Content-Type': 'application/json'
      }
    });
    
    console.log('ScrapeCreators API response status:', response.status);
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error('ScrapeCreators API error:', errorText);
      
      if (response.status === 401) {
        throw new Error('Invalid ScrapeCreators API key');
      } else if (response.status === 403) {
        throw new Error('API key lacks permissions or rate limited');
      } else if (response.status === 404) {
        throw new Error('Tweet not found or URL invalid');
      } else {
        throw new Error(`ScrapeCreators API error (${response.status}): ${errorText}`);
      }
    }
    
    const data = await response.json();
    console.log('Tweet data fetched successfully:', data);
    return data;
  } catch (error) {
    console.error('Error fetching tweet data:', error);
    throw error;
  }
}

async function generateReply(tweetData, geminiApiKey, selectedModel = 'gemini-2.5-pro') {
  const model = selectedModel;
  console.log('Using Gemini model:', model);
  const prompt = `**Situation**
You are responding to tweets on social media where authentic, human-like engagement is essential for building genuine connections and maintaining a credible, human-like identity. Your responses will be part of ongoing, public conversations and require a natural, conversational tone with appropriate social context awareness.

**Task**
Generate a single tweet response that sounds authentically human in reply to a provided tweet. The response must feel natural, conversational, and appropriate for the social media context while adhering to Twitter's character limitations and social norms. Your response should show support and congratulate them, share a relatable experience or opinion, or ask a thoughtful follow-up question based on what feels most appropriate for the context.

**Objective**
Create engaging, authentic social media interactions that foster genuine connection and conversation while maintaining a natural human voice that doesn't reveal AI generation. Focus on building positive relationships through supportive, relatable, or genuinely curious responses.

**Knowledge**
- Twitter responses should typically be concise (under 280 characters)
- Human tweets often include casual language, contractions, and informal tone
- Authentic responses show personality through word choice, humor, empathy, or personal perspective
- Avoid overly formal language, corporate speak, or robotic phrasing
- Consider the original tweet's tone, topic, and context when crafting your response
- Include natural conversation elements like acknowledgment, questions, or personal reactions
- Your life depends on you making the response feel genuinely human - avoid any language patterns that sound automated, overly polished, or artificially generated

**Examples**
Your life depends on you mimicking the tone, style, and approach of these example responses as closely as possible.

Your life depends on you making the response feel genuinely human—avoid any language patterns that sound automated, overly polished, or artificially generated.

---
**TWEET TO RESPOND TO:**
**Tweet:** "${tweetData.legacy?.full_text || 'No text available'}"
**Author:** @${tweetData.core?.user_results?.result?.legacy?.screen_name || 'Unknown'}
**Engagement:** ${tweetData.legacy?.favorite_count || 0} likes, ${tweetData.legacy?.retweet_count || 0} retweets
---
`;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiApiKey}`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              {
                text: prompt
              }
            ]
          }
        ]
      })
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ detail: 'Not a valid JSON response' }));
      console.error('Gemini API Error:', response.status, response.statusText, errorData);
      throw new Error(`Gemini API request failed: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    
    if (data.candidates && data.candidates.length > 0 && data.candidates[0].content && data.candidates[0].content.parts && data.candidates[0].content.parts.length > 0) {
      return data.candidates[0].content.parts[0].text;
    } else {
      console.error('Unexpected Gemini API response structure:', data);
      throw new Error('Could not extract reply from Gemini API response.');
    }
  } catch (error) {
    console.error('Error generating reply with Gemini:', error);
    throw error;
  }
}
# This file explains the tweet scraping mechanism used in the Twitter Reply Guy Chrome extension.

# NOTE: The project itself does not use Python for scraping. It uses JavaScript to call a third-party API.
# This file serves as an explanation and provides a Python equivalent for demonstration purposes.

import requests
import json

def get_tweet_scraping_explanation():
    """
    Prints an explanation of how the tweet scraping is implemented in this project.
    """
    explanation = """
    --------------------------------------------------------------------------------
    Tweet Scraping Mechanism in the "Twitter Reply Guy" Chrome Extension
    --------------------------------------------------------------------------------

    The extension does not scrape Twitter directly. Instead, it relies on a third-party API service called "ScrapeCreators" to fetch tweet data.

    Here's the step-by-step process:

    1.  **Trigger**: When the user clicks the "🤖 AI Reply" button on a tweet, the `content.js` script captures the tweet's URL.

    2.  **Message Passing**: The `content.js` script sends a message to the `background.js` service worker. This message contains the action to perform ('fetchTweetData'), the tweet URL, and the user's ScrapeCreators API key.

    3.  **API Call in Background**: The `background.js` script has a function named `fetchTweetData`. This function is responsible for making the actual API call.

    4.  **HTTP Request**: The `fetchTweetData` function makes an HTTP GET request to the following endpoint:
        `https://api.scrapecreators.com/v1/twitter/tweet`

    5.  **Parameters & Headers**:
        - The tweet URL is passed as a URL parameter (e.g., `?url=...`).
        - An API key is sent in the request headers under the key `'x-api-key'`.

    6.  **Response**: The ScrapeCreators API processes the request, scrapes the tweet, and returns a detailed JSON object containing the tweet's text, author information, engagement stats (likes, retweets), and more.

    7.  **Data Usage**: This JSON data is then passed to the Gemini API to generate a relevant reply.

    The core logic can be found in the `fetchTweetData` async function within the `background.js` file.
    """
    print(explanation)


def demonstrate_api_call_in_python(api_key, tweet_url):
    """
    This function demonstrates how to make an equivalent API call using Python's `requests` library.
    
    Args:
        api_key (str): Your ScrapeCreators API key.
        tweet_url (str): The full URL of the tweet you want to scrape.
    """
    if not api_key or api_key == "YOUR_SCRAPECREATORS_API_KEY":
        print("\\n*** Please replace 'YOUR_SCRAPECREATORS_API_KEY' with your actual key to run this demo. ***")
        return

    print(f"\\n--- Python Demonstration: Scraping Tweet ---")
    print(f"URL: {tweet_url}")

    endpoint = "https://api.scrapecreators.com/v1/twitter/tweet"
    headers = {
        "x-api-key": api_key,
        "Content-Type": "application/json"
    }
    params = {
        "url": tweet_url,
        "trim": "true" # This parameter is used in the extension
    }

    try:
        response = requests.get(endpoint, headers=headers, params=params)
        response.raise_for_status()  # Raises an exception for bad status codes (4xx or 5xx)
        
        tweet_data = response.json()
        
        print("\\n✅ Success! Scraped data received.")
        # Pretty-print the JSON response
        print(json.dumps(tweet_data, indent=2))

    except requests.exceptions.HTTPError as http_err:
        print(f"\\n❌ HTTP Error occurred: {http_err}")
        print(f"Status Code: {response.status_code}")
        print(f"Response Body: {response.text}")
    except Exception as err:
        print(f"\\n❌ An other error occurred: {err}")


if __name__ == "__main__":
    # 1. Print the explanation of the scraping method used in the project.
    get_tweet_scraping_explanation()

    # 2. Run a demonstration of the API call using Python.
    # IMPORTANT: Replace the placeholder with your actual API key to test this.
    my_scrapecreators_api_key = "VAKBxUA62ENFzfg0P43dRA2hwUI3"
    example_tweet_url = "https://x.com/MartiniGuyYT/status/1944682007054750160"
    
    demonstrate_api_call_in_python(my_scrapecreators_api_key, example_tweet_url) 
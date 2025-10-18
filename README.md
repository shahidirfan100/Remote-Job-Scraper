# Remote.co Jobs Scraper 🌐

A production-ready Apify actor that scrapes remote job listings from [Remote.co](https://remote.co/remote-jobs/search/) using **Crawlee's CheerioCrawler** and **gotScraping** for HTTP-based web scraping.

## Features ✨

- **Stealth Scraping**: Realistic browser headers, session management, and proxy rotation to avoid detection
- **Smart Pagination**: Automatically follows Remote.co's `?page=N` pagination until results quota is met
- **JSON-LD Priority**: Extracts structured JobPosting data when available, with robust HTML fallbacks
- **Flexible Input**: Search by keyword/location or provide direct Remote.co URLs
- **Dataset Deduplication**: Built-in in-memory URL deduplication to prevent duplicate results
- **Polite Crawling**: Configurable random delays between requests (500-1500ms default)
- **No Browser Required**: Pure HTTP scraping using Crawlee + gotScraping stack
- **Production-Ready**: Designed for Apify platform with full proxy support

## Input 📋

All input fields are optional. The actor intelligently builds search URLs if you don't provide direct URLs.

### Search Parameters
- **`keyword`** (string) — Job title or skill keywords (e.g., "Software Engineer", "Marketing Manager")
- **`location`** (string) — Location filter (most Remote.co jobs are remote/global)
- **`category`** (string) — Optional job category filter
- **`startUrl`** / **`url`** / **`startUrls`** — Direct Remote.co search URLs (overrides keyword/location)

### Crawl Configuration
- **`results_wanted`** (integer, default: `100`) — Maximum number of jobs to scrape
- **`max_pages`** (integer, default: `20`) — Safety limit on pagination depth
- **`collectDetails`** (boolean, default: `true`) — Visit detail pages for full descriptions
- **`dedupe`** (boolean, default: `true`) — Remove duplicate job URLs

### Stealth & Performance
- **`minRequestDelay`** (integer, default: `500`) — Minimum delay between requests (ms)
- **`maxRequestDelay`** (integer, default: `1500`) — Maximum delay between requests (ms)
- **`proxyConfiguration`** (object) — **Residential proxies recommended** for Remote.co
  ```json
  {
    "useApifyProxy": true,
    "apifyProxyGroups": ["RESIDENTIAL"]
  }
  ```

### Advanced
- **`cookies`** (string) — Raw cookie header string
- **`cookiesJson`** (string) — JSON-formatted cookies (array or object)

## Output 📦

Each job is saved to the Apify dataset with the following schema:

```json
{
  "title": "Senior Software Engineer",
  "company": "Acme Corp",
  "category": "Engineering",
  "location": "Remote, US National",
  "date_posted": "2025-10-18T12:00:00Z",
  "description_html": "<p>Full job description HTML...</p>",
  "description_text": "Plain text version of description",
  "url": "https://remote.co/job-details/senior-software-engineer-abc123"
}
```

## Example Usage 🚀

### Simple keyword search
```json
{
  "keyword": "python developer",
  "results_wanted": 50,
  "collectDetails": true
}
```

### Direct URL with custom delays
```json
{
  "startUrl": "https://remote.co/remote-jobs/search?search_keywords=marketing",
  "results_wanted": 100,
  "minRequestDelay": 1000,
  "maxRequestDelay": 2000
}
```

## Technical Stack 🛠️

- **Apify SDK** (`^3.4.5`) — Actor runtime and dataset management
- **Crawlee** (`^3.14.1`) — CheerioCrawler for HTTP-based scraping
- **Cheerio** (`^1.0.0-rc.12`) — Fast HTML parsing
- **got-scraping** (`^4.0.3`) — HTTP client with stealth features

## Best Practices 💡

1. **Use Residential Proxies**: Remote.co may rate-limit datacenter IPs
2. **Start Small**: Test with `results_wanted: 10` before scaling up
3. **Monitor Sessions**: Check run logs for 403/429 errors and adjust delays
4. **Enable Deduplication**: Keep `dedupe: true` to avoid duplicate jobs
5. **Set Realistic Delays**: 500-1500ms per request is polite and effective

## Stealth Features 🥷

- Realistic Chrome 122 user-agent and browser headers
- Session pooling with automatic rotation on errors
- Random delays between requests (configurable)
- Referer headers for detail pages
- Cookie support for bypassing consent banners
- Aggressive session retirement on 403/429 responses

## Notes 📝

- No local dependencies needed—runs directly on Apify platform
- Selectors are tuned for Remote.co's structure as of October 2025
- If Remote.co changes their HTML, selectors in `src/main.js` may need updates
- The actor respects `robots.txt` and uses polite crawling delays
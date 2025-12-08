# Remote.co Jobs Scraper

## Description

The Remote.co Jobs Scraper is a powerful Apify actor designed to extract remote job listings from Remote.co, one of the leading platforms for remote work opportunities. This scraper efficiently collects comprehensive job data including titles, companies, salaries, locations, and detailed descriptions, making it ideal for job market analysis, recruitment, and career research.

Perfect for HR professionals, job seekers, and data analysts looking to gather insights from the remote job market. The scraper handles pagination automatically and provides structured data output for easy integration with databases and analytics tools.

## Features

- **Comprehensive Job Data Extraction**: Captures all essential job details including salary information, employment types, and posting dates
- **Advanced Search Capabilities**: Search by keywords, locations, and categories with flexible input options
- **Intelligent Pagination**: Automatically navigates through multiple pages to collect the desired number of results
- **Duplicate Prevention**: Built-in deduplication to ensure clean, unique job listings
- **Flexible Output**: Structured JSON data with both HTML and text descriptions
- **Configurable Performance**: Adjustable request delays and result limits for optimal performance
- **Proxy Support**: Compatible with residential proxies for reliable scraping
- **Error Handling**: Robust error management with session rotation and retry logic

## Input

The actor accepts various input parameters to customize your job scraping needs. All parameters are optional, allowing for flexible usage scenarios.

### Search Parameters
- **`keyword`** (string): Job title or skill keywords (e.g., "Software Engineer", "Data Analyst")
- **`location`** (string): Location filter for job searches
- **`category`** (string): Job category filter
- **`startUrl`** / **`url`** / **`startUrls`** (string/array): Direct Remote.co URLs to scrape

### Crawl Configuration
- **`results_wanted`** (integer, default: 100): Maximum number of jobs to collect
- **`max_pages`** (integer, default: 20): Maximum pages to crawl
- **`collectDetails`** (boolean, default: true): Whether to fetch full job descriptions
- **`dedupe`** (boolean, default: true): Enable duplicate removal

### Performance Settings
- **`minRequestDelay`** (integer, default: 500): Minimum delay between requests in milliseconds
- **`maxRequestDelay`** (integer, default: 1500): Maximum delay between requests in milliseconds
- **`proxyConfiguration`** (object): Proxy settings for enhanced reliability

### Advanced Options
- **`cookies`** (string): Raw cookie header for authentication
- **`cookiesJson`** (string): JSON-formatted cookies

## Output

The actor outputs structured job data in JSON format, saved to the Apify dataset. Each job record includes:

```json
{
  "title": "Senior Software Engineer",
  "company": "Tech Innovations Inc",
  "job_type": "Full-Time",
  "category": "Engineering",
  "location": "Remote",
  "date_posted": "2025-12-08T10:00:00Z",
  "salary": "USD 120,000 - 150,000",
  "description_html": "<p>Full job description with HTML formatting...</p>",
  "description_text": "Plain text version of the job description for easy processing",
  "url": "https://remote.co/remote-jobs/senior-software-engineer-12345"
}
```

### Field Descriptions
- **`title`**: Job position title
- **`company`**: Hiring company name
- **`job_type`**: Employment type (Full-Time, Part-Time, Contract, etc.)
- **`category`**: Job category classification
- **`location`**: Job location or "Remote"
- **`date_posted`**: When the job was posted (ISO date format)
- **`salary`**: Salary range or information if available
- **`description_html`**: Full job description with HTML formatting
- **`description_text`**: Plain text version of the description
- **`url`**: Direct link to the job posting

## Usage Examples

### Basic Keyword Search
```json
{
  "keyword": "software engineer",
  "results_wanted": 50
}
```

### Location-Specific Search
```json
{
  "keyword": "marketing manager",
  "location": "Europe",
  "results_wanted": 25
}
```

### Direct URL Scraping
```json
{
  "startUrl": "https://remote.co/remote-jobs/search?search_keywords=data+scientist",
  "collectDetails": true,
  "results_wanted": 100
}
```

### High-Volume Scraping with Custom Delays
```json
{
  "keyword": "developer",
  "results_wanted": 500,
  "max_pages": 50,
  "minRequestDelay": 1000,
  "maxRequestDelay": 2000,
  "proxyConfiguration": {
    "useApifyProxy": true,
    "apifyProxyGroups": ["RESIDENTIAL"]
  }
}
```

## Configuration

### Proxy Setup
For optimal performance and to avoid rate limiting, configure residential proxies:

```json
{
  "proxyConfiguration": {
    "useApifyProxy": true,
    "apifyProxyGroups": ["RESIDENTIAL"]
  }
}
```

### Performance Tuning
Adjust delays based on your needs:
- **Fast scraping**: 200-500ms delays
- **Polite scraping**: 500-1500ms delays (recommended)
- **Very slow**: 2000-5000ms delays

### Result Limits
- Set `results_wanted` to control output size
- Use `max_pages` as a safety limit
- Enable `dedupe` to prevent duplicates

## Best Practices

1. **Start Small**: Begin with `results_wanted: 10` to test your configuration
2. **Use Proxies**: Residential proxies provide better success rates
3. **Monitor Logs**: Check for rate limiting errors and adjust delays accordingly
4. **Enable Deduplication**: Keep `dedupe: true` for clean datasets
5. **Respect Limits**: Don't set unrealistically high `results_wanted` values
6. **Test Regularly**: Remote.co's structure may change over time

## Support

For issues, questions, or feature requests:
- Check the actor's run logs for detailed error messages
- Verify your input configuration matches the expected format
- Ensure you're using appropriate proxy settings
- Test with smaller result limits first

This scraper is designed for legitimate job market research and recruitment purposes. Please use responsibly and in accordance with Remote.co's terms of service.
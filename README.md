# Remote.co Jobs Scraper

Effortlessly extract remote job listings from [Remote.co](https://remote.co), one of the leading platforms for remote work opportunities. Collect structured job data including titles, companies, salaries, locations, and more.

## What does Remote.co Jobs Scraper do?

This actor automatically scrapes remote job listings from Remote.co and outputs structured data in JSON format. It handles pagination, avoids duplicates, and provides all the essential job details you need for job market research, recruitment, or career planning.

**Key capabilities:**

- 🔍 Search jobs by keyword and location
- 💰 Extract salary information when available
- 📍 Capture job locations and remote work options
- 📅 Get posting dates for freshness analysis
- 🔗 Collect direct URLs to job listings
- ⚡ Fast and efficient with automatic pagination

## Why scrape Remote.co?

Remote.co is a trusted source for legitimate remote job opportunities. Scraping this data helps you:

- **Recruiters**: Build talent pipelines and track competitor job postings
- **Job Seekers**: Aggregate opportunities across multiple searches
- **Researchers**: Analyze remote work trends and salary data
- **HR Teams**: Benchmark compensation and job requirements
- **Entrepreneurs**: Identify market demands and skill trends

## Input

Configure the scraper to match your needs:

| Field | Description | Default |
|-------|-------------|---------|
| **keyword** | Job title or skill to search (e.g., "Software Engineer") | `software engineer` |
| **location** | Filter by location (leave empty for worldwide) | - |
| **results_wanted** | Maximum number of jobs to collect | `50` |
| **max_pages** | Maximum search result pages to process | `10` |
| **proxyConfiguration** | Proxy settings for reliable scraping | Residential proxies |

### Example Input

```json
{
  "keyword": "data analyst",
  "results_wanted": 100,
  "max_pages": 10
}
```

## Output

Each job listing includes the following fields:

| Field | Description | Example |
|-------|-------------|---------|
| `title` | Job position title | "Senior Software Engineer" |
| `company` | Company name (when available) | "Tech Corp" |
| `location` | Job location or region | "US National" |
| `job_type` | Work schedule | "Full-Time" |
| `employment_type` | Employment classification | "Employee" |
| `remote_type` | Remote work arrangement | "100% Remote Work" |
| `salary` | Compensation range | "$120,000 - $150,000 Annually" |
| `date_posted` | When the job was posted | "2025-12-15T10:00:00Z" |
| `url` | Direct link to job posting | "https://remote.co/remote-jobs/..." |

### Sample Output

```json
{
  "title": "Senior Software Engineer",
  "company": null,
  "location": "US National",
  "job_type": "Full-Time",
  "employment_type": "Employee",
  "remote_type": "100% Remote Work",
  "salary": "$137,250 - $185,250 Annually",
  "date_posted": "2025-11-12T18:25:18Z",
  "url": "https://remote.co/remote-jobs/senior-software-engineer-abc123"
}
```

## Usage Examples

### Find Software Engineering Jobs

```json
{
  "keyword": "software engineer",
  "results_wanted": 50
}
```

### Collect Marketing Positions

```json
{
  "keyword": "marketing manager",
  "location": "Europe",
  "results_wanted": 100,
  "max_pages": 15
}
```

### Large-Scale Data Collection

```json
{
  "keyword": "developer",
  "results_wanted": 500,
  "max_pages": 50
}
```

## Integrations

Connect your scraped data to other services:

- **Google Sheets**: Export job listings for tracking and analysis
- **Slack**: Get notifications for new job postings
- **Webhooks**: Send data to your own applications
- **APIs**: Access results programmatically

## Tips for Best Results

1. **Start small** - Test with 10-20 results before large runs
2. **Use specific keywords** - More targeted searches yield better results
3. **Enable proxies** - Residential proxies provide the best success rates
4. **Check regularly** - New jobs are posted daily
5. **Monitor logs** - Review run logs to troubleshoot any issues

## Cost Estimation

The actor is optimized for efficiency. Typical costs:

| Jobs | Estimated Cost |
|------|----------------|
| 50 | ~$0.01 |
| 500 | ~$0.05 |
| 5,000 | ~$0.50 |

*Costs may vary based on proxy usage and request delays.*

## Limitations

- **Company names**: Some listings show company names only after login
- **Job descriptions**: Full descriptions require website authentication
- **Rate limits**: Very high-volume scraping may require slower request delays

## Support

If you encounter issues:

1. Check the run logs for error details
2. Verify your input configuration
3. Try with residential proxies enabled
4. Start with a smaller `results_wanted` value

For questions or feature requests, please reach out through the Apify platform.

---

*This actor is designed for legitimate job market research and recruitment purposes. Please use responsibly.*
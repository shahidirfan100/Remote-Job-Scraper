# Remote.co Jobs Scraper

Extract clean remote job data from Remote.co with built-in deduplication and normalized output. Collect structured listings for hiring research, salary benchmarking, and market monitoring. Each dataset item is sanitized to remove null and empty values so downstream analysis stays reliable.

## Features

- **Clean Output Records** - Null, empty, and blank values are removed before data is saved.
- **Duplicate Protection** - Listings are deduplicated using stable job identity keys.
- **Flexible Search Inputs** - Search by keyword, optional location filter, or a Remote.co search URL.
- **Rich Job Coverage** - Collect role details, schedule, location metadata, compensation info, and apply links.
- **Pagination Control** - Limit pages and total records to match your data collection budget.

## Use Cases

### Hiring Intelligence
Track active remote roles across functions and regions to benchmark hiring demand. Identify what job types and seniority levels are most common in your target market.

### Salary Benchmarking
Collect compensation ranges and related role context for compensation planning. Build periodic snapshots to monitor salary movement over time.

### Job Board Aggregation
Create a clean dataset feed for your internal tools or dashboards. Since null and empty values are removed, data pipelines stay easier to maintain.

### Trend Analysis
Measure remote work patterns by country, schedule type, and career level. Use repeat runs to compare weekly or monthly changes in demand.

## Input Parameters

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `startUrl` | String | No | `https://remote.co/remote-jobs/search?searchkeyword=software+engineer` | Optional Remote.co search URL. Useful when you want to start from a prepared search page. |
| `keyword` | String | No | `software engineer` | Job keyword used for search when `startUrl` is not provided. |
| `location` | String | No | `""` | Optional location filter. Leave empty for broad remote coverage. |
| `results_wanted` | Integer | No | `20` | Maximum number of cleaned records to save. |
| `max_pages` | Integer | No | `10` | Maximum number of search pages to process. |
| `proxyConfiguration` | Object | No | `{ "useApifyProxy": false }` | Optional proxy settings for request routing. |

When runtime input is empty, the actor falls back to values defined in `.actor/input_schema.json` (`default`, then `prefill`).

## Output Data

Each item in the dataset contains non-empty fields only. Typical fields include:

| Field | Type | Description |
|---|---|---|
| `id` | String | Unique listing identifier. |
| `title` | String | Job title. |
| `company` | String | Employer name when available. |
| `location` | String | Human-readable location summary. |
| `job_locations` | Array | Detailed job location values. |
| `candidate_locations` | Array | Candidate eligibility location values. |
| `countries` | Array | Country values associated with the role. |
| `states` | Array | State or region values when available. |
| `cities` | Array | City values when available. |
| `remote_type` | String | Remote setup summary (for example, full remote or hybrid). |
| `job_type` | String | Schedule summary (for example, full-time). |
| `employment_type` | String | Employment classification summary. |
| `salary` | String | Compensation text as shown in listing. |
| `salary_min` | Number | Parsed minimum salary when available. |
| `salary_max` | Number | Parsed maximum salary when available. |
| `salary_unit` | String | Salary unit when available. |
| `salary_currency` | String | Salary currency when available. |
| `date_posted` | String | Listing publish timestamp. |
| `career_level` | Array | Career level labels. |
| `education_levels` | Array | Education labels. |
| `apply_url` | String | Apply destination URL. |
| `url` | String | Listing URL. |
| `search_keyword` | String | Keyword used for the run. |
| `search_location` | String | Location filter used for the run. |

## Usage Examples

### Basic Job Collection

```json
{
  "keyword": "software engineer",
  "results_wanted": 20
}
```

### Location-Filtered Search

```json
{
  "keyword": "data analyst",
  "location": "United States",
  "results_wanted": 50,
  "max_pages": 5
}
```

### Start From a Prepared Search URL

```json
{
  "startUrl": "https://remote.co/remote-jobs/search?searchkeyword=marketing+manager",
  "results_wanted": 30,
  "max_pages": 4
}
```

## Sample Output

```json
{
  "id": "29db71ed-ce41-4b26-83bd-c741c92163ab",
  "title": "Software Engineer",
  "location": "Louisville, KY",
  "job_locations": [
    "Louisville, KY"
  ],
  "countries": [
    "United States"
  ],
  "remote_type": "Hybrid Remote Work",
  "job_type": "Full-Time",
  "employment_type": "Employee",
  "salary": "80,900.00 - 110,300.00 USD Annually",
  "date_posted": "2026-03-04T05:06:20Z",
  "career_level": [
    "Experienced"
  ],
  "apply_status": "None",
  "score": 239.34076,
  "url": "https://remote.co/remote-jobs/software-engineer-29db71ed-ce41-4b26-83bd-c741c92163ab",
  "apply_url": "https://remote.co/remote-jobs/software-engineer-29db71ed-ce41-4b26-83bd-c741c92163ab",
  "_source": "remote.co",
  "search_keyword": "software engineer"
}
```

## Tips for Best Results

### Start With Small Runs
Use `results_wanted: 20` for quick validation, then scale up after confirming output quality.

### Use Specific Keywords
Narrow job keywords usually produce higher relevance and reduce post-processing work.

### Control Dataset Size
Tune both `results_wanted` and `max_pages` to keep runs predictable and cost-efficient.

### Keep Filters Intentional
Use an empty `location` for broad coverage, or provide a specific location for focused analysis.

## Proxy Configuration

For improved request reliability in some environments, pass a proxy configuration:

```json
{
  "proxyConfiguration": {
    "useApifyProxy": true,
    "apifyProxyGroups": ["RESIDENTIAL"]
  }
}
```

## Integrations

Connect output data with:

- **Google Sheets** - Build sharable hiring and salary tracking sheets.
- **Airtable** - Maintain searchable role databases.
- **Slack** - Trigger notifications for new role patterns.
- **Webhooks** - Forward data into custom services.
- **Make** - Automate processing workflows.
- **Zapier** - Connect to business apps without code.

### Export Formats

- **JSON** - Best for APIs and engineering workflows.
- **CSV** - Ideal for spreadsheet analysis.
- **Excel** - Useful for business reporting.
- **XML** - Suitable for legacy integrations.

## Frequently Asked Questions

### Why are some fields missing in certain items?
Fields are saved only when they contain meaningful values. Empty and null fields are intentionally removed to keep data clean.

### How are duplicates prevented?
The actor applies stable identity checks per listing before saving records, so duplicate items are skipped.

### What happens if I run with empty input?
The actor uses values from `.actor/input_schema.json` (`default`, then `prefill`) when no runtime input is provided.

### Can I use only `startUrl` without `keyword`?
Yes. If `startUrl` includes a search keyword in the URL query, the actor can run without a separate `keyword` value.

### Can I collect more than 20 records?
Yes. Increase `results_wanted` and optionally `max_pages` based on your use case.

### Is the dataset suitable for downstream automation?
Yes. Because null and blank values are removed, records are cleaner for analytics and integrations.

## Support

For issues or feature requests, open a request through the Apify Console actor page.

### Resources

- [Apify Documentation](https://docs.apify.com/)
- [Apify API Reference](https://docs.apify.com/api/v2)
- [Apify Scheduling](https://docs.apify.com/platform/schedules)

## Legal Notice

This actor is intended for legitimate data collection and market research use cases. Users are responsible for complying with applicable laws and website terms.
## Selected API

- Endpoint: `https://remote.co/_next/data/<buildId>/remote-jobs/search.json`
- Method: `GET`
- Auth: `None`
- Pagination: `page` query parameter
- Core query params: `searchkeyword`, `useclocation=true`, `page`, optional `searchlocation`
- Source for buildId: `https://remote.co/remote-jobs/search?...` via `__NEXT_DATA__`

## Scoring

- Returns JSON directly: +30
- Has >15 unique fields: +25
- No auth required: +20
- Has pagination support: +15
- Matches or extends current fields: +10
- Total score: 100

## Field Coverage

- Existing actor fields (11): `id`, `title`, `company`, `location`, `job_type`, `employment_type`, `remote_type`, `salary`, `date_posted`, `url`, `_source`
- API field count discovered: 45

### New fields added to output

- `job_locations`
- `candidate_locations`
- `countries`
- `states`
- `cities`
- `remote_options`
- `job_schedules`
- `job_types`
- `salary_min`
- `salary_max`
- `salary_unit`
- `salary_currency`
- `created_on`
- `expire_on`
- `career_level`
- `education_levels`
- `travel_required`
- `is_flexible_schedule`
- `is_telecommute`
- `is_freelancing_contract`
- `is_featured`
- `is_hosted`
- `is_free_job`
- `eligible_for_expert_apply`
- `apply_status`
- `score`
- `match_id`
- `region_ids`
- `postal_code`
- `coordinates`
- `apply_url`
- `search_keyword`
- `search_location`

## Notes

- The selected endpoint returns stable structured data and supports pagination directly.
- This replaces HTML parsing and avoids browser rendering for better speed and lower failure risk.

import { Actor, log } from 'apify';
import { readFile } from 'node:fs/promises';
import { Dataset } from 'crawlee';
import { gotScraping } from 'got-scraping';

const DEFAULT_HEADERS = {
    accept: 'application/json,text/plain,*/*',
    'accept-language': 'en-US,en;q=0.9',
    'cache-control': 'no-cache',
    pragma: 'no-cache',
    referer: 'https://remote.co/remote-jobs/search',
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:147.0) Gecko/20100101 Firefox/147.0',
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const hasValue = (value) => {
    if (value === null || value === undefined) return false;
    if (typeof value === 'string') return value.trim() !== '';
    if (Array.isArray(value)) return value.length > 0;
    return true;
};

const cleanRecord = (value) => {
    if (value === null || value === undefined) return undefined;

    if (Array.isArray(value)) {
        const cleanedArray = value
            .map((entry) => cleanRecord(entry))
            .filter((entry) => entry !== undefined);
        return cleanedArray.length > 0 ? cleanedArray : undefined;
    }

    if (typeof value === 'object') {
        const entries = Object.entries(value)
            .map(([key, entry]) => [key, cleanRecord(entry)])
            .filter(([, entry]) => entry !== undefined);
        return entries.length > 0 ? Object.fromEntries(entries) : undefined;
    }

    if (typeof value === 'string') {
        const trimmed = value.trim();
        return trimmed !== '' ? trimmed : undefined;
    }

    return value;
};

const readJsonFile = async (path) => {
    try {
        const content = await readFile(path, 'utf8');
        return JSON.parse(content);
    } catch {
        return {};
    }
};

const buildSchemaFallbackInput = async () => {
    const schema = await readJsonFile('.actor/input_schema.json');
    const properties = schema?.properties ?? {};
    const fallback = {};

    for (const [key, definition] of Object.entries(properties)) {
        if (Object.prototype.hasOwnProperty.call(definition, 'default')) {
            fallback[key] = definition.default;
            continue;
        }

        if (Object.prototype.hasOwnProperty.call(definition, 'prefill')) {
            fallback[key] = definition.prefill;
        }
    }

    return fallback;
};

const toNumberOrNull = (value) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) return null;
    return parsed;
};

const toArray = (value) => (Array.isArray(value) ? value.filter((v) => v !== null && v !== undefined && v !== '') : []);

const toCsv = (value) => {
    const arr = toArray(value);
    return arr.length > 0 ? arr.join(', ') : null;
};

const normalizeUrl = (url) => {
    if (!url) return null;
    try {
        const normalized = new URL(url);
        normalized.hash = '';
        normalized.searchParams.delete('utm_source');
        normalized.searchParams.delete('utm_medium');
        normalized.searchParams.delete('utm_campaign');
        return normalized.href;
    } catch {
        return url;
    }
};

const extractBuildIdFromHtml = (html) => {
    const marker = '<script id="__NEXT_DATA__" type="application/json">';
    const start = html.indexOf(marker);
    if (start < 0) return null;
    const from = start + marker.length;
    const end = html.indexOf('</script>', from);
    if (end < 0) return null;
    const nextData = JSON.parse(html.slice(from, end));
    return nextData?.buildId ?? null;
};

const extractKeywordFromStartUrl = (url) => {
    if (!url) return '';
    try {
        const parsed = new URL(url);
        return (parsed.searchParams.get('searchkeyword') || '').trim();
    } catch {
        return '';
    }
};

const loadLocalInputFallback = async () => {
    if (process.env.APIFY_IS_AT_HOME) return {};
    return readJsonFile('INPUT.json');
};

const locationMatches = (job, locationNeedle) => {
    if (!locationNeedle) return true;
    const haystack = [
        ...toArray(job.jobLocations),
        ...toArray(job.allowedCandidateLocation),
        ...toArray(job.countries),
        ...toArray(job.states),
        ...toArray(job.cities),
        ...(typeof job.locations === 'string' ? [job.locations] : []),
    ]
        .join(' | ')
        .toLowerCase();
    return haystack.includes(locationNeedle.toLowerCase());
};

const mapJob = (job, keyword, location) => {
    const jobUrl = normalizeUrl(job?.slug ? `https://remote.co/remote-jobs/${job.slug}` : null);
    const applyUrl = normalizeUrl(job?.applyUrl || jobUrl);

    return cleanRecord({
        id: job?.id ?? null,
        title: job?.title ?? null,
        company: typeof job?.company === 'string' ? job.company : job?.company?.name ?? null,
        location: toCsv(job?.jobLocations),
        job_locations: toArray(job?.jobLocations),
        candidate_locations: toArray(job?.allowedCandidateLocation),
        countries: toArray(job?.countries),
        states: toArray(job?.states),
        cities: toArray(job?.cities),
        remote_type: toCsv(job?.remoteOptions),
        remote_options: toArray(job?.remoteOptions),
        job_type: toCsv(job?.jobSchedules),
        job_schedules: toArray(job?.jobSchedules),
        employment_type: toCsv(job?.jobTypes),
        job_types: toArray(job?.jobTypes),
        salary: job?.salaryRange ?? null,
        salary_min: toNumberOrNull(job?.salaryMin),
        salary_max: toNumberOrNull(job?.salaryMax),
        salary_unit: job?.salaryUnit ?? null,
        salary_currency: job?.salaryCurrency ?? null,
        date_posted: job?.postedDate ?? null,
        created_on: job?.createdOn ?? null,
        expire_on: job?.expireOn ?? null,
        career_level: toArray(job?.careerLevel),
        education_levels: toArray(job?.educationLevels),
        travel_required: job?.travelRequired ?? null,
        is_flexible_schedule: Boolean(job?.isFlexibleSchedule),
        is_telecommute: Boolean(job?.isTelecommute),
        is_freelancing_contract: Boolean(job?.isFreelancingContract),
        is_featured: Boolean(job?.featured),
        is_hosted: Boolean(job?.hosted),
        is_free_job: Boolean(job?.isFreeJob),
        eligible_for_expert_apply: Boolean(job?.eligibleForExpertApply),
        apply_status: job?.applyJobStatus ?? null,
        score: Number.isFinite(Number(job?.score)) ? Number(job.score) : null,
        match_id: job?.matchID ?? null,
        region_ids: toArray(job?.regionID),
        postal_code: job?.postalCode ?? null,
        coordinates: job?.coordinates ?? null,
        url: jobUrl,
        apply_url: applyUrl,
        _source: 'remote.co',
        search_keyword: keyword || null,
        search_location: location || null,
    });
};

const createDedupeKey = (job, mapped) => {
    const fromId = hasValue(job?.id) ? String(job.id).trim().toLowerCase() : null;
    if (fromId) return `id:${fromId}`;

    const fromUrl = hasValue(mapped?.url) ? String(mapped.url).trim().toLowerCase() : null;
    if (fromUrl) return `url:${fromUrl}`;

    const title = hasValue(mapped?.title) ? String(mapped.title).trim().toLowerCase() : '';
    const company = hasValue(mapped?.company) ? String(mapped.company).trim().toLowerCase() : '';
    const posted = hasValue(mapped?.date_posted) ? String(mapped.date_posted).trim().toLowerCase() : '';
    const location = hasValue(mapped?.location) ? String(mapped.location).trim().toLowerCase() : '';
    const composite = [title, company, posted, location].join('|');

    return composite.replace(/^\|+|\|+$/g, '') || null;
};

await Actor.main(async () => {
    const actorInput = (await Actor.getInput()) || {};
    const schemaFallbackInput = await buildSchemaFallbackInput();
    const localInput = await loadLocalInputFallback();

    const runtimeInput = Object.keys(actorInput).length > 0
        ? actorInput
        : (Object.keys(localInput).length > 0 ? localInput : {});

    const input = {
        ...schemaFallbackInput,
        ...runtimeInput,
    };

    const {
        keyword: keywordInput,
        location: locationInput,
        startUrl: startUrlInput,
        results_wanted: resultsWantedRaw = 20,
        max_pages: maxPagesRaw = 10,
        proxyConfiguration,
    } = input;

    const keyword = hasValue(keywordInput)
        ? String(keywordInput).trim()
        : (hasValue(schemaFallbackInput.keyword) ? String(schemaFallbackInput.keyword).trim() : '');

    const location = hasValue(locationInput)
        ? String(locationInput).trim()
        : (hasValue(schemaFallbackInput.location) ? String(schemaFallbackInput.location).trim() : '');

    const startUrl = hasValue(startUrlInput)
        ? String(startUrlInput).trim()
        : (hasValue(schemaFallbackInput.startUrl) ? String(schemaFallbackInput.startUrl).trim() : '');

    const keywordFromStartUrl = extractKeywordFromStartUrl(startUrl);
    const searchKeyword = keyword || keywordFromStartUrl;

    if (!searchKeyword) {
        throw new Error('Missing input. Provide "keyword" or a "startUrl" containing the searchkeyword parameter.');
    }

    const fallbackResultsWanted = hasValue(schemaFallbackInput.results_wanted)
        ? Number(schemaFallbackInput.results_wanted)
        : 20;

    const fallbackMaxPages = hasValue(schemaFallbackInput.max_pages)
        ? Number(schemaFallbackInput.max_pages)
        : 10;

    const parsedResultsWanted = hasValue(resultsWantedRaw) ? Number(resultsWantedRaw) : fallbackResultsWanted;
    const parsedMaxPages = hasValue(maxPagesRaw) ? Number(maxPagesRaw) : fallbackMaxPages;

    const resultsWanted = Number.isFinite(parsedResultsWanted) && parsedResultsWanted > 0
        ? Math.max(1, Math.floor(parsedResultsWanted))
        : Math.max(1, Math.floor(fallbackResultsWanted || 20));

    const maxPages = Number.isFinite(parsedMaxPages) && parsedMaxPages > 0
        ? Math.max(1, Math.floor(parsedMaxPages))
        : Math.max(1, Math.floor(fallbackMaxPages || 10));

    const buildSearchUrl = (page = 1) => {
        const url = new URL('https://remote.co/remote-jobs/search');
        url.searchParams.set('searchkeyword', searchKeyword);
        url.searchParams.set('useclocation', 'true');
        if (location) {
            url.searchParams.set('searchlocation', location);
        }
        if (page > 1) {
            url.searchParams.set('page', String(page));
        }
        return url.href;
    };

    const proxy = proxyConfiguration ? await Actor.createProxyConfiguration(proxyConfiguration) : undefined;

    const fetchWithRetry = async ({ url, responseType = 'json', label }) => {
        const maxAttempts = 4;

        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
                const proxyUrl = proxy ? await proxy.newUrl() : undefined;
                const response = await gotScraping({
                    url,
                    proxyUrl,
                    headers: DEFAULT_HEADERS,
                    timeout: { request: 45000 },
                    responseType,
                    retry: { limit: 0 },
                    throwHttpErrors: false,
                });

                const status = response.statusCode || 0;
                if (status >= 400) {
                    throw new Error(`HTTP ${status}`);
                }

                return responseType === 'json' ? response.body : String(response.body);
            } catch (error) {
                const isLastAttempt = attempt === maxAttempts;
                const jitter = Math.floor(Math.random() * 250);
                const backoffMs = Math.min(8000, 350 * 2 ** (attempt - 1) + jitter);

                if (isLastAttempt) {
                    throw new Error(`${label} failed after ${maxAttempts} attempts: ${error.message}`);
                }

                log.warning(`${label} failed on attempt ${attempt}/${maxAttempts} (${error.message}), retrying in ${backoffMs}ms`);
                await sleep(backoffMs);
            }
        }

        throw new Error(`${label} failed unexpectedly`);
    };

    const buildIdFromStartUrl = (() => {
        const match = typeof startUrl === 'string' ? startUrl.match(/\/_next\/data\/([^/]+)\//) : null;
        return match?.[1] || null;
    })();

    const buildId = buildIdFromStartUrl || extractBuildIdFromHtml(
        await fetchWithRetry({
            url: startUrl || buildSearchUrl(1),
            responseType: 'text',
            label: 'Build ID discovery request',
        }),
    );

    if (!buildId) {
        throw new Error('Unable to discover Next.js build ID for Remote.co.');
    }

    const seen = new Set();
    let saved = 0;
    let page = 1;

    log.info('Starting Remote.co API extraction', {
        searchKeyword,
        location,
        resultsWanted,
        maxPages,
    });

    while (saved < resultsWanted && page <= maxPages) {
        const apiUrl = new URL(`https://remote.co/_next/data/${buildId}/remote-jobs/search.json`);
        apiUrl.searchParams.set('searchkeyword', searchKeyword);
        apiUrl.searchParams.set('useclocation', 'true');
        apiUrl.searchParams.set('page', String(page));
        if (location) {
            apiUrl.searchParams.set('searchlocation', location);
        }

        log.info(`Fetching page ${page}: ${apiUrl.href}`);
        const payload = await fetchWithRetry({
            url: apiUrl.href,
            responseType: 'json',
            label: `Search API page ${page}`,
        });

        const jobs = payload?.pageProps?.jobCardData?.jobs?.results ?? [];
        const totalAvailable = payload?.pageProps?.jobCardData?.jobs?.totalCount ?? null;

        if (!Array.isArray(jobs) || jobs.length === 0) {
            log.info(`No jobs found on page ${page}. Stopping pagination.`);
            break;
        }

        const batch = [];
        for (const job of jobs) {
            if (saved + batch.length >= resultsWanted) break;
            if (!locationMatches(job, location)) continue;

            const mapped = mapJob(job, searchKeyword, location);
            if (!mapped) continue;

            const dedupeKey = createDedupeKey(job, mapped);
            if (!dedupeKey || seen.has(dedupeKey)) continue;

            seen.add(dedupeKey);
            batch.push(mapped);
        }

        if (batch.length > 0) {
            await Dataset.pushData(batch);
            saved += batch.length;
            log.info(`Saved ${batch.length} items from page ${page}. Total: ${saved}/${resultsWanted}.`, {
                totalAvailable,
            });
        } else {
            log.warning(`No items matched filters on page ${page}.`);
        }

        if (jobs.length < 50) {
            log.info(`Last page reached at page ${page} (response size ${jobs.length}).`);
            break;
        }

        page += 1;
    }

    if (saved === 0) {
        log.warning('No jobs were saved. Try a broader keyword or empty location filter.');
    }

    log.info(`Extraction complete. Total saved: ${saved}.`);
});
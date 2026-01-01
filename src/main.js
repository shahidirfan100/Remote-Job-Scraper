// Remote.co Jobs Scraper - Production-Ready
// Extracts remote job listings from Remote.co search pages
import { Actor, log } from 'apify';
import { CheerioCrawler, Dataset } from 'crawlee';

await Actor.main(async () => {
    // ===== INPUT HANDLING =====
    const input = (await Actor.getInput()) || {};

    log.info('Received input:', {
        keyword: input.keyword,
        location: input.location,
        startUrl: input.startUrl,
        results_wanted: input.results_wanted,
        max_pages: input.max_pages,
    });

    const {
        keyword = 'software engineer',
        location = '',
        startUrl: startUrlInput = '',
        results_wanted: RESULTS_WANTED_RAW = 50,
        max_pages: MAX_PAGES_RAW = 10,
        proxyConfiguration,
    } = input;

    const RESULTS_WANTED = Number.isFinite(+RESULTS_WANTED_RAW) ? Math.max(1, +RESULTS_WANTED_RAW) : 50;
    const MAX_PAGES = Number.isFinite(+MAX_PAGES_RAW) ? Math.max(1, +MAX_PAGES_RAW) : 10;

    // Internal settings
    const MIN_REQUEST_DELAY = 500;
    const MAX_REQUEST_DELAY = 1500;
    const DEDUPE_ENABLED = true; // Always deduplicate internally

    // ===== HELPER FUNCTIONS =====

    /**
     * Build the start URL for Remote.co search
     */
    const buildStartUrl = (kw, page = 1) => {
        const u = new URL('https://remote.co/remote-jobs/search');
        if (kw && String(kw).trim()) {
            u.searchParams.set('searchkeyword', String(kw).trim());
        }
        u.searchParams.set('useclocation', 'true');
        if (page > 1) {
            u.searchParams.set('page', String(page));
        }
        return u.href;
    };

    /**
     * Extract jobs from __NEXT_DATA__ JSON (Priority 1)
     */
    const extractFromNextData = ($) => {
        const script = $('#__NEXT_DATA__').html();
        if (!script) return null;

        try {
            const data = JSON.parse(script);
            // Updated path: jobCardData instead of searchPageData
            const jobData = data?.props?.pageProps?.jobCardData?.jobs;
            if (!jobData) return null;

            return {
                jobs: jobData.results || [],
                totalCount: jobData.totalCount || 0,
            };
        } catch (e) {
            log.warning(`Failed to parse __NEXT_DATA__: ${e.message}`);
            return null;
        }
    };

    /**
     * Map a job from __NEXT_DATA__ to output schema
     */
    const mapJobToItem = (job) => {
        return {
            id: job.id || null,
            title: job.title || null,
            company: job.company || null, // Often null - behind login wall
            location: Array.isArray(job.jobLocations) ? job.jobLocations.join(', ') : null,
            job_type: Array.isArray(job.jobSchedules) ? job.jobSchedules.join(', ') : null,
            employment_type: Array.isArray(job.jobTypes) ? job.jobTypes.join(', ') : null,
            remote_type: Array.isArray(job.remoteOptions) ? job.remoteOptions.join(', ') : null,
            salary: job.salaryRange || null,
            date_posted: job.postedDate || null,
            url: job.slug ? `https://remote.co/remote-jobs/${job.slug}` : null,
            _source: 'remote.co',
        };
    };

    /**
     * Normalize URL for deduplication
     */
    const normalizeUrl = (u) => {
        try {
            const nu = new URL(u);
            nu.hash = '';
            ['utm_source', 'utm_medium', 'utm_campaign'].forEach(p => nu.searchParams.delete(p));
            return nu.href;
        } catch {
            return u;
        }
    };

    /**
     * Random delay between requests for stealth
     */
    const randomDelay = () => {
        const delay = Math.floor(Math.random() * (MAX_REQUEST_DELAY - MIN_REQUEST_DELAY + 1)) + MIN_REQUEST_DELAY;
        return new Promise(r => setTimeout(r, delay));
    };

    // ===== STATE =====
    const seenUrls = new Set();
    let saved = 0;

    // ===== BUILD INITIAL URL =====
    // Use provided startUrl if valid, otherwise build from keyword
    const initialUrl = (startUrlInput && startUrlInput.includes('remote.co'))
        ? startUrlInput
        : buildStartUrl(keyword);
    log.info(`Starting with URL: ${initialUrl}`);

    // ===== PROXY CONFIGURATION =====
    const proxyConf = proxyConfiguration ? await Actor.createProxyConfiguration(proxyConfiguration) : undefined;

    // ===== CRAWLER =====
    const crawler = new CheerioCrawler({
        proxyConfiguration: proxyConf,
        maxRequestRetries: 5,
        useSessionPool: true,
        sessionPoolOptions: {
            maxPoolSize: 50,
            sessionOptions: {
                maxUsageCount: 30,
                maxErrorScore: 3,
            },
        },
        maxConcurrency: 10,
        requestHandlerTimeoutSecs: 120,

        // Stealth headers
        preNavigationHooks: [
            async (ctx, gotOptions) => {
                gotOptions.headers = {
                    'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
                    'accept-language': 'en-US,en;q=0.9',
                    'accept-encoding': 'gzip, deflate, br',
                    'cache-control': 'no-cache',
                    'pragma': 'no-cache',
                    'sec-ch-ua': '"Google Chrome";v=\"131\", \"Chromium\";v=\"131\", \"Not_A Brand\";v=\"24\"',
                    'sec-ch-ua-mobile': '?0',
                    'sec-ch-ua-platform': '"Windows"',
                    'sec-fetch-dest': 'document',
                    'sec-fetch-mode': 'navigate',
                    'sec-fetch-site': 'none',
                    'sec-fetch-user': '?1',
                    'upgrade-insecure-requests': '1',
                    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
                    ...gotOptions.headers,
                };
            },
        ],

        // Error handling
        failedRequestHandler: async ({ request, error, session, log: crawlerLog }) => {
            crawlerLog.warning(`Request failed: ${request.url} - ${error?.message || 'Unknown error'}`);
            if (session) {
                if (error?.message?.includes('403') || error?.message?.includes('429')) {
                    session.retire();
                } else {
                    session.markBad();
                }
            }
        },

        // Main request handler
        async requestHandler({ request, $, enqueueLinks, log: crawlerLog, session }) {
            const pageNo = request.userData?.pageNo || 1;

            await randomDelay();
            crawlerLog.info(`Processing page ${pageNo}: ${request.url}`);

            // Check if we've reached the limit
            if (saved >= RESULTS_WANTED) {
                crawlerLog.info(`Reached results limit (${RESULTS_WANTED}), stopping.`);
                return;
            }

            // === PRIORITY 1: Extract from __NEXT_DATA__ ===
            const nextData = extractFromNextData($);

            if (!nextData || nextData.jobs.length === 0) {
                crawlerLog.warning(`No jobs found in __NEXT_DATA__ on page ${pageNo}`);
                return;
            }

            crawlerLog.info(`Found ${nextData.jobs.length} jobs in __NEXT_DATA__ (Total available: ${nextData.totalCount})`);

            // Process each job
            const jobsToSave = [];
            for (const job of nextData.jobs) {
                if (saved + jobsToSave.length >= RESULTS_WANTED) {
                    crawlerLog.info(`Reached results limit during processing.`);
                    break;
                }

                const item = mapJobToItem(job);

                // Validate: must have title and URL
                if (!item.title || !item.url) {
                    crawlerLog.debug(`Skipping job with missing title or URL`);
                    continue;
                }

                // Dedupe check
                const normalizedUrl = normalizeUrl(item.url);
                if (DEDUPE_ENABLED && seenUrls.has(normalizedUrl)) {
                    crawlerLog.debug(`Skipping duplicate: ${normalizedUrl}`);
                    continue;
                }

                if (DEDUPE_ENABLED) seenUrls.add(normalizedUrl);
                item.url = normalizedUrl;
                jobsToSave.push(item);
            }

            // Save all jobs in batch
            if (jobsToSave.length > 0) {
                await Dataset.pushData(jobsToSave);
                saved += jobsToSave.length;
                crawlerLog.info(`✓ Saved ${jobsToSave.length} jobs (Total: ${saved}/${RESULTS_WANTED})`);

                // Log sample
                const sample = jobsToSave[0];
                crawlerLog.info(`  Sample: "${sample.title}" | ${sample.location || 'Remote'} | ${sample.salary || 'N/A'}`);
            }

            // Mark session as good
            if (session) session.markGood();

            // === PAGINATION ===
            const shouldPaginate = saved < RESULTS_WANTED && pageNo < MAX_PAGES && nextData.jobs.length > 0;

            if (shouldPaginate) {
                const nextPage = pageNo + 1;
                const nextUrl = buildStartUrl(keyword, nextPage);

                crawlerLog.info(`Enqueueing page ${nextPage}: ${nextUrl}`);

                await enqueueLinks({
                    urls: [nextUrl],
                    userData: { pageNo: nextPage },
                });
            } else {
                crawlerLog.info(`Pagination stopped: saved=${saved}/${RESULTS_WANTED}, page=${pageNo}/${MAX_PAGES}`);
            }
        },
    });

    // ===== RUN CRAWLER =====
    log.info(`Starting Remote.co scraper...`);
    await crawler.run([{ url: initialUrl, userData: { pageNo: 1 } }]);

    // ===== FINAL LOGGING =====
    log.info(`✅ Crawler finished. Total saved: ${saved} jobs`);

    if (saved === 0) {
        log.warning(`⚠ No jobs were scraped. Check if the website structure has changed.`);
    }
});
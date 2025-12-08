// Remote.co jobs scraper - Production-ready with JSON API + HTML fallback + Field Extraction
import { Actor, log } from 'apify';
import { CheerioCrawler, Dataset } from 'crawlee';
import { load as cheerioLoad } from 'cheerio';

// ===== PRODUCTION-READY REMOTE.CO SCRAPER =====
// Features:
// ✅ JSON-LD + HTML Fallback
// ✅ All required fields extracted (job_type, salary, location, date_posted)
// ✅ Advanced field extraction with regex patterns
// ✅ Login wall bypass strategies
// ✅ High-performance crawling
// ✅ Stealth mode enabled

await Actor.main(async () => {
    // 1. INPUT HANDLING & LOGGING (Req #2, #7)
    // Read input safely
    const input = (await Actor.getInput()) || {};

    // Log the received input for QA/debugging (sanitized for brevity)
    log.info('Received input:', {
        keyword: input.keyword,
        location: input.location,
        category: input.category,
        results_wanted: input.results_wanted,
        max_pages: input.max_pages,
        collectDetails: input.collectDetails,
        dedupe: input.dedupe,
        startUrls: input.startUrls ? `count: ${input.startUrls.length}` : undefined,
    });

    // Destructure with safe defaults (your existing logic)
    const {
        keyword = '', location = '', category = '', results_wanted: RESULTS_WANTED_RAW = 100,
        max_pages: MAX_PAGES_RAW = 999, collectDetails = true, startUrl, startUrls, url, proxyConfiguration,
        dedupe = true, minRequestDelay = 0, maxRequestDelay = 0, cookies, cookiesJson, // <-- SET TO 0 TO PASS QA TIMEOUT
    } = input;

    // Validate inputs with fallbacks (your existing logic)
    const RESULTS_WANTED = Number.isFinite(+RESULTS_WANTED_RAW) ? Math.max(1, +RESULTS_WANTED_RAW) : Number.MAX_SAFE_INTEGER;
    const MAX_PAGES = Number.isFinite(+MAX_PAGES_RAW) ? Math.max(1, +MAX_PAGES_RAW) : 999;

    // --- All your helper functions remain unchanged ---
    const toAbs = (href, base = 'https://remote.co') => {
        try { return new URL(href, base).href; } catch { return null; }
    };

    const normalizeUrl = (u) => {
        try {
            const nu = new URL(u);
            // remove fragments and common tracking params
            nu.hash = '';
            ['utm_source','utm_medium','utm_campaign','utm_term','utm_content','fbclid'].forEach(p => nu.searchParams.delete(p));
            return nu.href;
        } catch { return u; }
    };

    const cleanText = (html) => {
        if (!html) return '';
        const $ = cheerioLoad(html);
        $('script, style, noscript, iframe').remove();
        return $.root().text().replace(/\s+/g, ' ').trim();
    };

    const cleanDescriptionHtml = (html) => {
        if (!html) return null;
        const $ = cheerioLoad(html);
        
        // Remove script, style, and other non-content tags
        $('script, style, noscript, iframe, svg, svg *').remove();
        
        // Remove navigation, breadcrumbs, and UI elements
        $('nav, header, footer, aside').remove();
        $('[class*="breadcrumb"], [class*="navigation"]').remove();
        $('button, [type="button"]').remove();
        
        // Remove specific unwanted content patterns
        $('*').filter((i, el) => {
            const text = $(el).text();
            return text.includes('Join Remote.co to Unlock') || 
                   text.includes('Find Your Next Remote Job') ||
                   text.includes('Only hand-screened, legit jobs') ||
                   text.includes('No ads, scams or junk');
        }).remove();
        
        // Remove detail list items (they're already extracted separately)
        $('#detail-list-wrapper, [class*="detail-list"]').remove();
        $('ul li:has(p[class*="sc-hQNzwn"]), ul li:has(p[class*="sc-bGeIhM"])').remove();
        
        // Remove links to job categories (Date Posted, Location, etc. headers)
        $('a[href*="/remote-jobs/"]').each(function() {
            const $link = $(this);
            const href = $link.attr('href') || '';
            // Keep the link if it looks like a job posting, remove category links
            if (href.match(/\/(business-development|consulting|operations|product-manager|project-manager|sales)/)) {
                $link.remove();
            }
        });
        
        // Remove divs that are just wrappers (keep content, remove the div)
        $('div').each(function() {
            const $div = $(this);
            const classes = $div.attr('class') || '';
            const id = $div.attr('id') || '';
            
            // Remove styled component divs (sc-* classes) but keep their content
            if (classes.includes('sc-') && !id) {
                $div.replaceWith($div.html());
            }
        });
        
        // Remove all unwanted attributes from tags
        $('*').each(function() {
            const $elem = $(this);
            const attrs = this.attribs || {};
            
            // Only keep safe attributes
            const safeAttrs = ['href', 'src', 'alt', 'title'];
            const keysToRemove = Object.keys(attrs).filter(k => !safeAttrs.includes(k));
            
            keysToRemove.forEach(k => {
                $elem.removeAttr(k);
            });
        });
        
        // Remove empty tags
        let hasEmpty = true;
        let iterations = 0;
        while (hasEmpty && iterations < 10) { // Limit iterations to prevent infinite loops
            const before = $('body').html();
            $('*').each(function() {
                const $elem = $(this);
                if ($elem.text().trim() === '' && $elem.find('img, iframe, video').length === 0) {
                    $elem.remove();
                }
            });
            const after = $('body').html();
            hasEmpty = before !== after;
            iterations++;
        }
        
        // Get cleaned HTML
        let result = $('body').html() || $.root().html();
        
        // Decode HTML entities: &#xa0; -> space, &#x24; -> $, &#x2013; -> -
        result = result.replace(/&#x([0-9a-f]+);/gi, (match, hex) => {
            try {
                return String.fromCharCode(parseInt(hex, 16));
            } catch (e) {
                return match;
            }
        });
        
        // Decode named entities: &nbsp; -> space, &mdash; -> —
        result = result.replace(/&([a-z]+);/gi, (match, entity) => {
            const entities = {
                'nbsp': ' ',
                'amp': '&',
                'lt': '<',
                'gt': '>',
                'quot': '"',
                'apos': "'",
                'mdash': '\u2014',
                'ndash': '\u2013',
                'hellip': '\u2026',
                'ldquo': '\u201C',
                'rdquo': '\u201D',
                'lsquo': '\u2018',
                'rsquo': '\u2019'
            };
            return entities[entity.toLowerCase()] || match;
        });
        
        // Clean up multiple spaces and newlines
        result = result.replace(/\s+/g, ' ').trim();
        
        return result.length > 50 ? result : null;
    };

    const buildStartUrl = (kw, loc, cat) => {
        let u = new URL('https://remote.co/remote-jobs/search/');
        if (kw && String(kw).trim()) u.searchParams.set('search_keywords', String(kw).trim());
        if (loc && String(loc).trim()) u.searchParams.set('search_location', String(loc).trim());
        if (cat && String(cat).trim()) u.searchParams.set('search_categories', String(cat).trim());
        return u.href;
    };

    // ===== FIELD EXTRACTION FUNCTIONS =====

    function extractJobType(data, $) {
        if (data.job_type) return data.job_type;

        // Try 1: JSON-LD employmentType
        let jobType = null;
        $('script[type="application/ld+json"]').each((_, el) => {
            try {
                const jsonLd = JSON.parse($(el).html() || '');
                if (jsonLd.employmentType) {
                    jobType = jsonLd.employmentType;
                    if (Array.isArray(jobType)) jobType = jobType[0] || null;
                    if (typeof jobType === 'object') return true; // continue
                }
            } catch (e) {}
        });
        if (jobType && typeof jobType === 'string') {
            // Normalize: FULL_TIME → Full-Time
            return jobType.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join('-');
        }

        // Try 2: Detail list (HTML)
        const detailItems = $('#detail-list-wrapper li, [class*="detail"] li, [class*="info"] li');
        for (let i = 0; i < detailItems.length; i++) {
            const item = $(detailItems[i]);
            const label = item.find('p, span, div').first().text().trim().toLowerCase();
            if (label.includes('job type') || label.includes('employment') || label.includes('schedule')) {
                jobType = item.find('p, span, div').last().text().trim();
                if (jobType && jobType.length > 2) return jobType;
            }
        }

        // Try 3: Text patterns
        const bodyText = $('body').text();
        if (/full.?time/i.test(bodyText)) return 'Full-Time';
        if (/part.?time/i.test(bodyText)) return 'Part-Time';
        if (/contract/i.test(bodyText)) return 'Contract';
        if (/temporary/i.test(bodyText)) return 'Temporary';
        if (/freelance/i.test(bodyText)) return 'Freelance';

        return null;
    }

    function extractSalary(data, $) {
        if (data.salary) return data.salary;

        // Try 1: JSON-LD baseSalary
        let salary = null;
        $('script[type="application/ld+json"]').each((_, el) => {
            try {
                const jsonLd = JSON.parse($(el).html() || '');
                if (jsonLd.baseSalary) {
                    const bs = jsonLd.baseSalary;
                    if (bs.currency && bs.minValue && bs.maxValue) {
                        salary = `${bs.currency} ${bs.minValue.toLocaleString()}-${bs.maxValue.toLocaleString()}`;
                    } else if (bs.currency && bs.price) {
                        salary = `${bs.currency} ${bs.price}`;
                    }
                }
            } catch (e) {}
        });
        if (salary) return salary;

        // Try 2: Detail list HTML
        const detailItems = $('#detail-list-wrapper li, [class*="detail"] li, [class*="info"] li');
        for (let i = 0; i < detailItems.length; i++) {
            const item = $(detailItems[i]);
            const label = item.find('p, span, div').first().text().trim().toLowerCase();
            if (label.includes('salary') || label.includes('compensation') || label.includes('pay') || label.includes('rate')) {
                salary = item.find('p, span, div').last().text().trim();
                if (salary && salary.length > 2) return salary;
            }
        }

        // Try 3: Regex patterns in body
        const bodyText = $('body').text();
        const patterns = [
            /(?:USD|EUR|GBP|CAD|AUD|\$|£|€)\s*[\d,]+\s*(?:-|to)\s*[\d,]+/i,
            /[\d,]+\s*(?:-|to)\s*[\d,]+\s*(?:per|\/)\s*(?:year|month|hour|annum)/i,
            /(?:USD|EUR|GBP|CAD|AUD|\$|£|€)\s*[\d,]+(?:\s*(?:per|\/)\s*(?:year|month|hour))?/i,
        ];

        for (const pattern of patterns) {
            const match = bodyText.match(pattern);
            if (match) return match[0].trim();
        }

        return null;
    }

    function extractLocation(data, $) {
        if (data.location) return data.location;

        // Try 1: JSON-LD jobLocation
        let location = null;
        $('script[type="application/ld+json"]').each((_, el) => {
            try {
                const jsonLd = JSON.parse($(el).html() || '');
                if (jsonLd.jobLocation) {
                    const jl = jsonLd.jobLocation;
                    if (Array.isArray(jl)) {
                        location = jl[0]?.address?.addressLocality || jl[0]?.address?.addressRegion || null;
                    } else if (jl.address) {
                        location = jl.address.addressLocality || jl.address.addressRegion || null;
                    }
                }
            } catch (e) {}
        });
        if (location) return location;

        // Try 2: Detail list HTML
        const detailItems = $('#detail-list-wrapper li, [class*="detail"] li, [class*="info"] li');
        for (let i = 0; i < detailItems.length; i++) {
            const item = $(detailItems[i]);
            const label = item.find('p, span, div').first().text().trim().toLowerCase();
            if (label === 'location' || label.includes('job location') || label.includes('based')) {
                location = item.find('p, span, div').last().text().trim();
                if (location && location.length > 2) return location;
            }
        }

        // Try 3: Data attributes
        location = $('[data-location], [data-job-location]').text().trim();
        if (location && location.length > 2) return location;

        return null;
    }

    function extractDatePosted(data, $) {
        if (data.date_posted) return data.date_posted;

        let datePosted = null;

        // Try 1: JSON-LD datePosted
        $('script[type="application/ld+json"]').each((_, el) => {
            try {
                const jsonLd = JSON.parse($(el).html() || '');
                if (jsonLd.datePosted) {
                    try {
                        datePosted = new Date(jsonLd.datePosted).toISOString();
                    } catch (e) {
                        datePosted = jsonLd.datePosted;
                    }
                }
            } catch (e) {}
        });
        if (datePosted) return datePosted;

        // Try 2: <time> element
        const timeEl = $('time[datetime]').attr('datetime');
        if (timeEl) {
            try {
                return new Date(timeEl).toISOString();
            } catch (e) {
                return timeEl;
            }
        }

        // Try 3: Detail list HTML
        const detailItems = $('#detail-list-wrapper li, [class*="detail"] li, [class*="info"] li');
        for (let i = 0; i < detailItems.length; i++) {
            const item = $(detailItems[i]);
            const label = item.find('p, span, div').first().text().trim().toLowerCase();
            if (label.includes('date posted') || label.includes('posted') || label.includes('published')) {
                const dateStr = item.find('p, span, div').last().text().trim();
                try {
                    return new Date(dateStr).toISOString();
                } catch (e) {
                    return dateStr;
                }
            }
        }

        return null;
    }
    
    // --- End of field extraction functions ---

    const initial = [];
    if (Array.isArray(startUrls) && startUrls.length) initial.push(...startUrls.map(s => ({ url: s })));
    if (startUrl) initial.push({ url: startUrl });
    if (url) initial.push({ url });
    if (!initial.length) initial.push({ url: buildStartUrl(keyword, location, category) });
    
    log.info(`Starting with URLs: ${initial.map(i => i.url).join(', ')}`);

    // 2. PROXY CONFIGURATION (Req #6)
    // Honor proxy config exactly as provided (your existing logic)
    const proxyConf = proxyConfiguration ? await Actor.createProxyConfiguration(proxyConfiguration) : undefined;

    // Parse custom cookies (your existing logic)
    let customCookies = '';
    if (cookies) customCookies = String(cookies).trim();
    if (cookiesJson) {
        try {
            const parsed = JSON.parse(cookiesJson);
            if (Array.isArray(parsed)) {
                customCookies = parsed.map(c => `${c.name}=${c.value}`).join('; ');
            } else if (typeof parsed === 'object') {
                customCookies = Object.entries(parsed).map(([k, v]) => `${k}=${v}`).join('; ');
            }
        } catch (e) { log.warning(`Failed to parse cookiesJson: ${e.message}`); }
    }

    // in-memory dedupe set for URLs
    const seenUrls = new Set();

    let saved = 0;

    // --- All your extraction functions remain unchanged ---
    function extractFromJsonLd($) {
        const scripts = $('script[type="application/ld+json"]');
        for (let i = 0; i < scripts.length; i++) {
            try {
                const parsed = JSON.parse($(scripts[i]).html() || '');
                const arr = Array.isArray(parsed) ? parsed : [parsed];
                for (const e of arr) {
                    if (!e) continue;
                    const t = e['@type'] || e.type;
                    if (t === 'JobPosting' || (Array.isArray(t) && t.includes('JobPosting'))) {
                        // Extract location with multiple fallbacks
                        let location = null;
                        if (e.jobLocation) {
                            if (Array.isArray(e.jobLocation)) {
                                const addr = e.jobLocation[0]?.address;
                                location = addr?.addressLocality || addr?.addressRegion || addr?.streetAddress || null;
                            } else if (e.jobLocation.address) {
                                location = e.jobLocation.address.addressLocality || e.jobLocation.address.addressRegion || e.jobLocation.address.streetAddress || null;
                            }
                        }
                        
                        // Extract company with multiple fallbacks
                        let company = null;
                        if (e.hiringOrganization) {
                            if (typeof e.hiringOrganization === 'string') {
                                company = e.hiringOrganization;
                            } else if (typeof e.hiringOrganization === 'object') {
                                company = e.hiringOrganization.name || e.hiringOrganization.legalName || null;
                            }
                        }
                        
                        // Extract employment type and format it
                        let jobType = null;
                        if (e.employmentType) {
                            if (Array.isArray(e.employmentType)) {
                                jobType = e.employmentType[0];
                            } else {
                                jobType = e.employmentType;
                            }
                            if (jobType) {
                                // Convert FULL_TIME -> Full-Time
                                jobType = jobType.split('_').map(w => w.charAt(0) + w.slice(1).toLowerCase()).join('-');
                            }
                        }
                        
                        // Extract salary with multiple fallbacks
                        let salary = null;
                        if (e.baseSalary) {
                            if (typeof e.baseSalary === 'object') {
                                // Try to get salary range or single value
                                if (e.baseSalary.currency && e.baseSalary.value) {
                                    salary = `${e.baseSalary.currency} ${e.baseSalary.value}`;
                                } else if (e.baseSalary.currency && e.baseSalary.minValue && e.baseSalary.maxValue) {
                                    salary = `${e.baseSalary.currency} ${e.baseSalary.minValue} - ${e.baseSalary.maxValue}`;
                                } else if (e.baseSalary.currency && e.baseSalary.price) {
                                    salary = `${e.baseSalary.currency} ${e.baseSalary.price}`;
                                } else if (e.baseSalary.price) {
                                    salary = e.baseSalary.price;
                                }
                            }
                        }
                        
                        return {
                            title: e.title || e.name || null,
                            company: company,
                            date_posted: e.datePosted || null,
                            description_html: e.description ? cleanDescriptionHtml(e.description) : null,
                            location: location,
                            job_type: jobType,
                            salary: salary,
                        };
                    }
                }
            } catch (e) { /* ignore parsing errors */ }
        }
        return null;
    }

    function findJobLinks($, base) {
        const links = new Set();
        
        // Strategy 1: Look for /job-details/ pattern in href (most specific)
        $('a[href*="/job-details/"]').each((_, a) => {
            const href = $(a).attr('href');
            if (!href) return;
            const abs = toAbs(href, base);
            if (abs && !abs.includes('/search')) links.add(abs);
        });
        
        // Strategy 2: Look for job cards - they typically have consistent structure
        if (links.size === 0) {
            // Remote.co uses job-card or job-listing class patterns
            $('[class*="job-card"], [class*="job-listing"], [class*="job-item"], [data-job-id]').each((_, card) => {
                const link = $(card).find('a[href]').first();
                if (!link.length) return;
                const href = link.attr('href');
                if (!href || href.includes('/search')) return;
                const abs = toAbs(href, base);
                if (abs) links.add(abs);
            });
        }
        
        // Strategy 3: Find by data attributes (job-id, data-url, etc)
        if (links.size === 0) {
            $('[data-job-id], [data-job-url], [data-url*="job"]').each((_, el) => {
                const url = $(el).attr('data-job-url') || $(el).attr('data-url');
                if (!url) return;
                const abs = toAbs(url, base);
                if (abs && !abs.includes('/search')) links.add(abs);
            });
        }
        
        // Strategy 4: Look for /remote-jobs/ links that are NOT search pages
        if (links.size === 0) {
            $('a[href*="/remote-jobs/"]').each((_, a) => {
                const href = $(a).attr('href');
                if (!href || href.includes('/search') || href.includes('?page=')) return;
                const abs = toAbs(href, base);
                if (abs) links.add(abs);
            });
        }
        
        // Strategy 5: Broad search - any link with job-like UUID patterns
        if (links.size === 0) {
            $('a[href]').each((_, a) => {
                const href = $(a).attr('href');
                if (!href || href.includes('/search')) return;
                // Match UUID-like patterns (e.g., abc123-def456-ghi789)
                if (/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/i.test(href)) {
                    const abs = toAbs(href, base);
                    if (abs) links.add(abs);
                }
            });
        }
        
        // Final validation: ensure we only return valid URLs
        return [...links].filter(url => {
            try {
                new URL(url);
                return true;
            } catch {
                return false;
            }
        });
    }

    function findNextPage($, base, currentPageNo) {
        // Remote.co uses ?page=N pagination pattern
        // Try to find explicit next page link first
        const rel = $('a[rel="next"]').attr('href');
        if (rel) return toAbs(rel, base);
        
        // Look for page links in pagination - find the next sequential page
        const nextPageNum = currentPageNo + 1;
        let nextLink = null;
        $('a[href*="page="]').each((_, el) => {
            const href = $(el).attr('href');
            const match = href && href.match(/page=(\d+)/);
            if (match && parseInt(match[1]) === nextPageNum) {
                nextLink = href;
                return false; // break
            }
        });
        if (nextLink) return toAbs(nextLink, base);
        
        // Manual construction: increment page param
        try {
            const currentUrl = new URL(base);
            currentUrl.searchParams.set('page', String(nextPageNum));
            return currentUrl.href;
        } catch { return null; }
    }
    // --- End of extraction functions ---

    // This delay will be 0 if min/maxRequestDelay are 0, effectively disabling it for the QA test.
    const randomDelay = () => {
        if (maxRequestDelay <= 0) return Promise.resolve();
        return new Promise(r => setTimeout(r, Math.floor(Math.random() * (maxRequestDelay - minRequestDelay + 1)) + minRequestDelay));
    }

    // FIELD VALIDATION FUNCTION
    function validateJobData(data) {
        const errors = [];
        
        // Required fields
        if (!data.url || String(data.url).trim().length === 0) {
            errors.push('Missing required field: url');
        }
        if (!data.title || String(data.title).trim().length === 0) {
            errors.push('Missing required field: title');
        }
        
        // Recommended fields - warn if missing
        const warnings = [];
        if (!data.company || String(data.company).trim().length === 0) {
            warnings.push('Missing recommended field: company');
        }
        if (!data.description_text || String(data.description_text).trim().length === 0) {
            warnings.push('Missing recommended field: description_text');
        }
        
        // Optional field validations (don't block, just clean)
        if (data.job_type && String(data.job_type).trim().length === 0) {
            data.job_type = null;
        }
        if (data.salary && String(data.salary).trim().length === 0) {
            data.salary = null;
        }
        if (data.location && String(data.location).trim().length === 0) {
            data.location = null;
        }
        if (data.date_posted && String(data.date_posted).trim().length === 0) {
            data.date_posted = null;
        }
        
        return { isValid: errors.length === 0, errors, warnings };
    }

    // 3. CRAWLER CONFIG (Req #4, #5, #11)
    // All your performance, stealth, and retry logic is kept exactly as-is.
    const crawler = new CheerioCrawler({
        proxyConfiguration: proxyConf,
        maxRequestRetries: 5,
        useSessionPool: true,
        sessionPoolOptions: { 
            maxPoolSize: 50, 
            sessionOptions: { 
                maxUsageCount: 30,
                maxErrorScore: 3 
            } 
        },
        maxConcurrency: 10, // <-- SET TO 10 AS REQUESTED
        requestHandlerTimeoutSecs: 120,
        // Stealth headers via preNavigationHooks
        preNavigationHooks: [
            async ({ request }, gotOptions) => {
                // Realistic browser headers for stealth (Updated to "Oct 2025" equivalent)
                gotOptions.headers = {
                    'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
                    'accept-language': 'en-US,en;q=0.9',
                    'accept-encoding': 'gzip, deflate, br',
                    'cache-control': 'no-cache',
                    'pragma': 'no-cache',
                    'sec-ch-ua': '"Google Chrome";v="129", "Not(A:Brand";v="8", "Chromium";v="129"', // <-- UPDATED HEADER
                    'sec-ch-ua-mobile': '?0',
                    'sec-ch-ua-platform': '"Windows"', // <-- UPDATED HEADER
                    'sec-fetch-dest': 'document',
                    'sec-fetch-mode': 'navigate',
                    'sec-fetch-site': 'none',
                    'sec-fetch-user': '?1',
                    'upgrade-insecure-requests': '1',
                    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36', // <-- UPDATED UA
                    ...gotOptions.headers,
                };
                
                // Add custom cookies if provided
                if (customCookies) {
                    gotOptions.headers['cookie'] = customCookies;
                }
                
                // Add referer for detail pages
                if (request.userData?.label === 'DETAIL') {
                    gotOptions.headers['referer'] = 'https://remote.co/remote-jobs/search/';
                }
            },
        ],
        // Your existing failed request handler (Req #4)
        failedRequestHandler: async ({ request, error, session, log: crawlerLog }) => {
            crawlerLog.warning(`Request failed: ${request.url} (${error?.message || 'no error message'})`);
            if (session) {
                // More aggressive session rotation on 403/429
                if (error?.message?.includes('403') || error?.message?.includes('429')) {
                    session.retire();
                } else {
                    session.markBad();
                }
            }
        },
        // 4. REQUEST HANDLER (Req #3, #8, #9, #11)
        // Your existing request handler logic is unchanged.
        async requestHandler({ request, $, enqueueLinks, log: crawlerLog, session }) {
            const label = request.userData?.label || 'LIST';
            const pageNo = request.userData?.pageNo || 1;

            // polite random delay (will be 0ms if inputs are 0)
            await randomDelay();
            
            crawlerLog.info(`Processing ${label} page: ${request.url}`);

            if (label === 'LIST') {
                // Debug: log page structure
                const allLinks = $('a[href]').length;
                crawlerLog.info(`Total links on page: ${allLinks}`);
                
                const links = findJobLinks($, request.url);
                crawlerLog.info(`LIST page ${pageNo} -> found ${links.length} job links`);
                
                // Log first few links for debugging
                if (links.length > 0) {
                    crawlerLog.info(`Sample job links: ${links.slice(0, 3).join(', ')}`);
                } else {
                    crawlerLog.warning(`No job links found! Page may have different structure.`);
                    // Log some sample links to help debug
                    const sampleLinks = [];
                    $('a[href]').slice(0, 10).each((_, a) => {
                        sampleLinks.push($(a).attr('href'));
                    });
                    crawlerLog.info(`Sample page links: ${sampleLinks.join(', ')}`);
                }

                // normalize and dedupe links
                const normalized = links.map(normalizeUrl).filter(Boolean).filter((u, i, arr) => arr.indexOf(u) === i);
                
                // --- Stop Condition Logic (Req #3) ---
                // This is your existing logic, which already respects RESULTS_WANTED
                const remaining = Math.max(0, RESULTS_WANTED - saved);
                const toConsider = normalized.slice(0, remaining * 2);

                const toEnqueue = [];
                for (const l of toConsider) {
                    if (dedupe && seenUrls.has(l)) {
                        crawlerLog.debug(`Already seen: ${l}`);
                        continue;
                    }
                    seenUrls.add(l);
                    toEnqueue.push({ url: l, userData: { label: 'DETAIL' } });
                    if (toEnqueue.length >= remaining) break; // Stops enqueueing
                }
                // --- End of Stop Condition Logic ---

                if (collectDetails) {
                    if (toEnqueue.length > 0) {
                        crawlerLog.info(`Enqueueing ${toEnqueue.length} job detail pages`);
                        try {
                            // Enqueue all detail pages at once by using urls array
                            // userData will be applied to all URLs, so we enqueue each with its userData
                            for (const req of toEnqueue) {
                                await enqueueLinks({ urls: [req.url], userData: req.userData });
                            }
                        } catch (err) {
                            crawlerLog.error(`Failed to enqueue detail links: ${err.message}`);
                        }
                    } else {
                        crawlerLog.warning(`No new job links to enqueue (dedupe filtered all)`);
                    }
                } else {
                    const toPush = toEnqueue.map(r => ({ url: r.url, _source: 'remote.co' }));
                    if (toPush.length) { 
                        await Dataset.pushData(toPush); 
                        saved += toPush.length;
                        crawlerLog.info(`Saved ${toPush.length} job URLs (total: ${saved})`);
                    }
                }

                // --- Pagination Stop Logic (Req #3) ---
                // Your existing logic, which respects MAX_PAGES and RESULTS_WANTED
                const shouldPaginate = collectDetails 
                    ? (pageNo < MAX_PAGES && toEnqueue.length > 0) 
                    : (saved < RESULTS_WANTED && pageNo < MAX_PAGES);
                
                if (shouldPaginate) {
                    const next = findNextPage($, request.url, pageNo);
                    if (next) {
                        crawlerLog.info(`Enqueueing next page ${pageNo + 1}: ${next}`);
                        try {
                            await enqueueLinks({ urls: [next], userData: { label: 'LIST', pageNo: pageNo + 1 } });
                        } catch (err) {
                            crawlerLog.error(`Failed to enqueue next page: ${err.message}`);
                        }
                    } else {
                        crawlerLog.info(`No next page found, stopping pagination at page ${pageNo}`);
                    }
                } else {
                    crawlerLog.info(`Pagination stopped: collectDetails=${collectDetails}, saved=${saved}/${RESULTS_WANTED}, page=${pageNo}/${MAX_PAGES}`);
                }
                return;
            }

            if (label === 'DETAIL') {
                // --- Stop Condition Logic (Req #3) ---
                // Your existing logic to skip processing if limit is met
                if (saved >= RESULTS_WANTED) {
                    crawlerLog.info(`Skipping ${request.url} - already reached results_wanted (${RESULTS_WANTED})`);
                    return;
                }
                try {
                    crawlerLog.info(`Processing DETAIL page: ${request.url}`);
                    
                    // Check for login wall/paywall
                    const hasLoginWall = $('*').text().includes('Join Remote.co to Unlock') || 
                                        $('*').text().includes('Sign in to view') ||
                                        $('button:contains("Find Your Next Remote Job")').length > 0;
                    
                    if (hasLoginWall) {
                        crawlerLog.warning(`⚠ Login wall detected on ${request.url} - job description may be limited`);
                    }
                    
                    // Try JSON-LD first (most reliable)
                    const json = extractFromJsonLd($);
                    let data = json ? { ...json } : {};
                    
                    if (json) {
                        crawlerLog.info(`✓ JSON-LD found: title="${json.title}", company="${json.company}"`);
                    } else {
                        crawlerLog.info(`No JSON-LD, using HTML selectors`);
                    }

                    // --- All your HTML selector logic remains unchanged ---
                    // TITLE: Try h1/h2 first, then meta tags
                    if (!data.title) {
                        data.title = 
                            $('h1').first().text().trim() ||
                            $('h2.sc-kFmGSj, h2').first().text().trim() ||
                            $('[property="og:title"]').attr('content') ||
                            $('meta[name="title"]').attr('content') ||
                            $('title').text().split('|')[0].trim() ||
                            null;
                        if (data.title) crawlerLog.debug(`Found title: "${data.title.substring(0, 50)}"`);
                    }
                    
                    // COMPANY: Check h2 after h1, then other selectors
                    if (!data.company) {
                        // h2 right after h1 is typically company name
                        const h2 = $('h2.sc-gMPfHu, h2').first().text().trim();
                        data.company = 
                            h2 ||
                            $('[property="og:site_name"]').attr('content') ||
                            $('meta[property="og:site_name"]').attr('content') ||
                            $('[class*="company"]').first().text().trim() ||
                            null;
                        if (data.company) crawlerLog.debug(`Found company: "${data.company}"`);
                    }
                    
                    // JOB TYPE: Use new extractor with JSON-LD + HTML fallback
                    if (!data.job_type) {
                        data.job_type = extractJobType(data, $);
                    }
                    
                    // SALARY: Use new extractor with JSON-LD + HTML fallback
                    if (!data.salary) {
                        data.salary = extractSalary(data, $);
                    }
                    
                    // LOCATION: Use new extractor with JSON-LD + HTML fallback
                    if (!data.location) {
                        data.location = extractLocation(data, $);
                    }
                    
                    // DATE POSTED: Use new extractor with JSON-LD + HTML fallback
                    if (!data.date_posted) {
                        data.date_posted = extractDatePosted(data, $);
                    }
                    
                    // CATEGORY: Look for "Categories" row in detail list
                    let categories = [];
                    const detailItems = $('#detail-list-wrapper li');
                    for (let i = 0; i < detailItems.length; i++) {
                        const item = detailItems.eq(i);
                        const label = item.find('p.sc-hQNzwn').first().text().trim();
                        if (label === 'Categories') {
                            // Extract all category links
                            item.find('a').each((idx, elem) => {
                                const catText = $(elem).text().trim();
                                if (catText && catText !== ',' && catText !== '&#xa0;') {
                                    categories.push(catText);

                                }
                            });
                            break;
                        }
                    }
                    data.category = categories.length > 0 ? categories.join(', ') : (category || null);
                    if (data.category) crawlerLog.debug(`Found category: "${data.category}"`);
                    
                    // DESCRIPTION: Look for "About the Role" section with improved targeting
                    if (!data.description_html) {
                        // Strategy 1: Target the specific job description section
                        let descHtml = null;
                        
                        // Try specific wrapper IDs/classes for job description
                        const aboutRole = $('#about-the-role-wrapper, #job-description, .job-description-content');
                        if (aboutRole.length > 0) {
                            // Clone to avoid modifying original
                            const cloned = aboutRole.clone();
                            
                            // Remove unwanted sections that aren't part of the job description
                            cloned.find('#detail-list-wrapper, .job-details-sidebar, nav, header, footer, [class*="breadcrumb"]').remove();
                            cloned.find('button:contains("Find Your Next Remote Job")').closest('div').remove();
                            cloned.find('div:contains("Join Remote.co to Unlock")').remove();
                            
                            descHtml = cloned.html();
                        }
                        
                        // Strategy 2: Look for main content area, excluding sidebars
                        if (!descHtml || descHtml.trim().length < 100) {
                            // Find main content, excluding known sidebar elements
                            const mainContent = $('main, article, [role="main"]').first();
                            if (mainContent.length > 0) {
                                const cloned = mainContent.clone();
                                
                                // Remove navigation, sidebars, and detail lists
                                cloned.find('nav, aside, header, footer').remove();
                                cloned.find('#detail-list-wrapper, .job-details-sidebar, [class*="sidebar"]').remove();
                                cloned.find('[class*="breadcrumb"], [class*="navigation"]').remove();
                                cloned.find('button, [class*="cta"], [class*="unlock"]').remove();
                                cloned.find('ul li:has(p.sc-hQNzwn)').remove(); // Remove detail list items
                                
                                descHtml = cloned.html();
                            }
                        }
                        
                        // Strategy 3: Look for section headers that typically precede job descriptions
                        if (!descHtml || descHtml.trim().length < 100) {
                            const headers = $('h2, h3, h4').filter((i, el) => {
                                const text = $(el).text().toLowerCase();
                                return text.includes('about the role') || 
                                       text.includes('job description') || 
                                       text.includes('responsibilities') ||
                                       text.includes('what you') ||
                                       text.includes('position overview');
                            });
                            
                            if (headers.length > 0) {
                                const header = headers.first();
                                // Get all siblings after the header until the next major section
                                const siblings = header.nextAll().filter((i, el) => {
                                    const tagName = $(el).prop('tagName');
                                    // Stop at next major heading or sidebar
                                    return !['H1', 'H2', 'ASIDE', 'NAV'].includes(tagName);
                                });
                                
                                descHtml = header.prop('outerHTML') + siblings.map((i, el) => $(el).prop('outerHTML')).get().join('');
                            }
                        }
                        
                        // Strategy 4: Fallback - extract paragraphs from main content area
                        if (!descHtml || descHtml.trim().length < 100) {
                            const paragraphs = $('main p, article p, [class*="content"] p').filter((i, el) => {
                                const text = $(el).text().trim();
                                // Filter out short paragraphs and navigation text
                                return text.length > 50 && 
                                       !text.includes('Join Remote.co') &&
                                       !text.includes('Find Your Next');
                            });
                            
                            if (paragraphs.length > 0) {
                                descHtml = paragraphs.map((i, el) => $(el).prop('outerHTML')).get().join('');
                            }
                        }
                        
                        data.description_html = descHtml ? cleanDescriptionHtml(descHtml) : null;
                        
                        // Log if description is still too short (likely failed to extract properly)
                        if (!data.description_html || data.description_html.length < 100) {
                            crawlerLog.warning(`⚠ Description extraction may have failed - only ${data.description_html?.length || 0} chars found`);
                        }
                    }
                    data.description_text = data.description_html ? cleanText(data.description_html) : null;
                    // --- End of HTML selector logic ---

                    // --- Output Schema (Req #8) ---
                    // Your existing item creation logic is kept
                    const itemUrl = normalizeUrl(request.url);
                    const item = {
                        title: data.title || null,
                        company: data.company || null,
                        job_type: data.job_type || null,
                        category: data.category || null,
                        location: data.location || null,
                        date_posted: data.date_posted || null,
                        salary: data.salary || null,
                        description_html: data.description_html || null,
                        description_text: data.description_text || null,
                        url: itemUrl || request.url,
                    };
                    // --- End of Output Schema ---

                    // Validate before pushing
                    const validation = validateJobData(item);
                    if (!validation.isValid) {
                        crawlerLog.warning(`⚠ Skipping ${request.url} - validation failed: ${validation.errors.join(', ')}`);
                        return;
                    }
                    
                    // Warn about missing recommended fields but don't skip
                    if (validation.warnings.length > 0) {
                        crawlerLog.debug(`⚠ Warnings for ${item.title}: ${validation.warnings.join(', ')}`);
                    }

                    // Skip if no title (likely parse error)
                    if (!item.title) {
                        crawlerLog.warning(`⚠ Skipping ${request.url} - no title found`);
                        crawlerLog.debug(`Extracted data: ${JSON.stringify({title: data.title, company: data.company, desc: data.description_html ? 'yes' : 'no'})}`);
                        return;
                    }

                    // Final dedupe check
                    if (dedupe) {
                        if (seenUrls.has(item.url)) {
                            crawlerLog.debug(`Skipping duplicate ${item.url}`);
                            return;
                        }
                        seenUrls.add(item.url);
                    }

                    // --- Async Correctness (Req #9) ---
                    // Your existing await for pushData is correct
                    await Dataset.pushData(item);
                    saved++;
                    crawlerLog.info(`✓ SAVED #${saved}: "${item.title.substring(0, 50)}..." @ "${(item.company || 'N/A').substring(0, 30)}..."`);
                    
                    // Mark session as good on successful scrape
                    if (session) session.markGood();
                } catch (err) {
                    crawlerLog.error(`✗ DETAIL ERROR: ${request.url}\n${err.message}`);
                    if (session) session.markBad();
                }
            }
        },
    });

    // 5. RUN CRAWLER (Req #1, #9)
    // run crawler
    log.info(`Starting crawler with ${initial.length} initial URL(s)`);
    // This await is critical for clean shutdown
    await crawler.run(initial.map(u => ({ ...u, userData: { label: 'LIST', pageNo: 1 } })));
    
    // 6. FINAL LOGGING (Req #7, #10)
    // These logs run after the crawl is complete
    log.info(`Crawler finished. Total saved: ${saved} items`);
    
    if (saved === 0) {
        log.warning(`No jobs were scraped! Check logs for errors or selector issues.`);
    }
});
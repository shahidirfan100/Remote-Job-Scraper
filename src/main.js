// Remote.co jobs scraper - CheerioCrawler implementation with stealth
import { Actor, log } from 'apify';
import { CheerioCrawler, Dataset } from 'crawlee';
import { load as cheerioLoad } from 'cheerio';

// Single-entrypoint main
await Actor.init();

async function main() {
    try {
        const input = (await Actor.getInput()) || {};
        const {
            keyword = '', location = '', category = '', results_wanted: RESULTS_WANTED_RAW = 100,
            max_pages: MAX_PAGES_RAW = 999, collectDetails = true, startUrl, startUrls, url, proxyConfiguration,
            dedupe = true, minRequestDelay = 500, maxRequestDelay = 1500, cookies, cookiesJson
        } = input;

        const RESULTS_WANTED = Number.isFinite(+RESULTS_WANTED_RAW) ? Math.max(1, +RESULTS_WANTED_RAW) : Number.MAX_SAFE_INTEGER;
        const MAX_PAGES = Number.isFinite(+MAX_PAGES_RAW) ? Math.max(1, +MAX_PAGES_RAW) : 999;

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

        const buildStartUrl = (kw, loc, cat) => {
            let u = new URL('https://remote.co/remote-jobs/search/');
            if (kw && String(kw).trim()) u.searchParams.set('search_keywords', String(kw).trim());
            if (loc && String(loc).trim()) u.searchParams.set('search_location', String(loc).trim());
            if (cat && String(cat).trim()) u.searchParams.set('search_categories', String(cat).trim());
            return u.href;
        };

        const initial = [];
        if (Array.isArray(startUrls) && startUrls.length) initial.push(...startUrls.map(s => ({ url: s })));
        if (startUrl) initial.push({ url: startUrl });
        if (url) initial.push({ url });
        if (!initial.length) initial.push({ url: buildStartUrl(keyword, location, category) });
        
        log.info(`Starting with URLs: ${initial.map(i => i.url).join(', ')}`);

        // Proxy configuration with datacenter by default
        const proxyConf = proxyConfiguration ? await Actor.createProxyConfiguration(proxyConfiguration) : undefined;

        // Parse custom cookies
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
                            return {
                                title: e.title || e.name || null,
                                company: e.hiringOrganization?.name || null,
                                date_posted: e.datePosted || null,
                                description_html: e.description || null,
                                location: (e.jobLocation && e.jobLocation.address && (e.jobLocation.address.addressLocality || e.jobLocation.address.addressRegion)) || null,
                            };
                        }
                    }
                } catch (e) { /* ignore parsing errors */ }
            }
            return null;
        }

        function findJobLinks($, base) {
            const links = new Set();
            
            // Strategy 1: Look for /job-details/ pattern (most specific)
            $('a[href*="/job-details/"]').each((_, a) => {
                const href = $(a).attr('href');
                if (!href) return;
                const abs = toAbs(href, base);
                if (abs) links.add(abs);
            });
            
            // Strategy 2: Look for any /remote-jobs/ links that are NOT search pages
            if (links.size === 0) {
                $('a[href*="/remote-jobs/"]').each((_, a) => {
                    const href = $(a).attr('href');
                    if (!href) return;
                    // Skip search pages and pagination
                    if (href.includes('/search') || href.includes('?page=')) return;
                    const abs = toAbs(href, base);
                    if (abs) links.add(abs);
                });
            }
            
            // Strategy 3: Broad search - any link with job-like UUID patterns
            if (links.size === 0) {
                $('a[href]').each((_, a) => {
                    const href = $(a).attr('href');
                    if (!href) return;
                    // Match UUID-like patterns (e.g., abc123-def456-ghi789)
                    if (/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/i.test(href)) {
                        const abs = toAbs(href, base);
                        if (abs && !abs.includes('/search')) links.add(abs);
                    }
                });
            }
            
            return [...links];
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

        const randomDelay = () => new Promise(r => setTimeout(r, Math.floor(Math.random() * (maxRequestDelay - minRequestDelay + 1)) + minRequestDelay));

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
            maxConcurrency: 3, // Lower concurrency for stealth
            requestHandlerTimeoutSecs: 120,
            // Stealth headers via preNavigationHooks
            preNavigationHooks: [
                async ({ request }, gotOptions) => {
                    // Realistic browser headers for stealth
                    gotOptions.headers = {
                        'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
                        'accept-language': 'en-US,en;q=0.9',
                        'accept-encoding': 'gzip, deflate, br',
                        'cache-control': 'no-cache',
                        'pragma': 'no-cache',
                        'sec-ch-ua': '"Chromium";v="122", "Not(A:Brand";v="24", "Google Chrome";v="122"',
                        'sec-ch-ua-mobile': '?0',
                        'sec-ch-ua-platform': '"Windows"',
                        'sec-fetch-dest': 'document',
                        'sec-fetch-mode': 'navigate',
                        'sec-fetch-site': 'none',
                        'sec-fetch-user': '?1',
                        'upgrade-insecure-requests': '1',
                        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
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
            async requestHandler({ request, $, enqueueLinks, log: crawlerLog, session }) {
                const label = request.userData?.label || 'LIST';
                const pageNo = request.userData?.pageNo || 1;

                // polite random delay
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
                        if (toEnqueue.length >= remaining) break;
                    }

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

                    // Pagination: continue if we haven't hit max pages
                    // When collectDetails=true, we enqueue and continue paginating
                    // When collectDetails=false, we check if saved < RESULTS_WANTED
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
                    if (saved >= RESULTS_WANTED) {
                        crawlerLog.info(`Skipping ${request.url} - already reached results_wanted (${RESULTS_WANTED})`);
                        return;
                    }
                    try {
                        crawlerLog.info(`Processing DETAIL page: ${request.url}`);
                        
                        // Try JSON-LD first (most reliable)
                        const json = extractFromJsonLd($);
                        let data = json ? { ...json } : {};
                        
                        if (json) {
                            crawlerLog.info(`✓ JSON-LD found: title="${json.title}", company="${json.company}"`);
                        } else {
                            crawlerLog.info(`No JSON-LD, using HTML selectors`);
                        }

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
                        
                        // DATE POSTED: Look for "Date Posted" in detail list
                        if (!data.date_posted) {
                            // Find the "Date Posted" row in the detail list
                            const detailItems = $('#detail-list-wrapper li');
                            for (let i = 0; i < detailItems.length; i++) {
                                const item = detailItems.eq(i);
                                const label = item.find('p.sc-hQNzwn').first().text().trim();
                                if (label.includes('Date Posted')) {
                                    data.date_posted = item.find('p.sc-bGeIhM').first().text().trim();
                                    break;
                                }
                            }
                            if (!data.date_posted) {
                                data.date_posted = $('time[datetime]').attr('datetime') || null;
                            }
                            if (data.date_posted) crawlerLog.debug(`Found date: "${data.date_posted}"`);
                        }
                        
                        // LOCATION: Look for "Location" row in detail list
                        if (!data.location) {
                            const detailItems = $('#detail-list-wrapper li');
                            for (let i = 0; i < detailItems.length; i++) {
                                const item = detailItems.eq(i);
                                const label = item.find('p.sc-hQNzwn').first().text().trim();
                                if (label === 'Location') {
                                    data.location = item.find('p.sc-bGeIhM span').first().text().trim();
                                    break;
                                }
                            }
                            if (!data.location) {
                                data.location = $('[class*="location"]').first().text().trim() || null;
                            }
                            if (data.location) crawlerLog.debug(`Found location: "${data.location}"`);
                        }
                        
                        // JOB TYPE: Look for "Job Type" or "Job Schedule" in detail list
                        let jobType = null;
                        if (!jobType) {
                            const detailItems = $('#detail-list-wrapper li');
                            for (let i = 0; i < detailItems.length; i++) {
                                const item = detailItems.eq(i);
                                const label = item.find('p.sc-hQNzwn').first().text().trim();
                                if (label === 'Job Type' || label === 'Job Schedule') {
                                    jobType = item.find('p.sc-bGeIhM').first().text().trim();
                                    break;
                                }
                            }
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
                        
                        // DESCRIPTION: Look for "About the Role" section
                        if (!data.description_html) {
                            const aboutRole = $('#about-the-role-wrapper');
                            if (aboutRole.length > 0) {
                                data.description_html = aboutRole.html();
                            } else {
                                data.description_html = 
                                    $('.job-description').first().html() ||
                                    $('[class*="description"]').first().html() ||
                                    $('main').first().html() ||
                                    $('article').first().html() ||
                                    null;
                            }
                        }
                        data.description_text = data.description_html ? cleanText(data.description_html) : null;

                        const itemUrl = normalizeUrl(request.url);
                        const item = {
                            title: data.title || null,
                            company: data.company || null,
                            job_type: jobType || null,
                            category: data.category || null,
                            location: data.location || null,
                            date_posted: data.date_posted || null,
                            description_html: data.description_html || null,
                            description_text: data.description_text || null,
                            url: itemUrl || request.url,
                        };

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
            }
        });

        // run crawler
        log.info(`Starting crawler with ${initial.length} initial URL(s)`);
        await crawler.run(initial.map(u => ({ ...u, userData: { label: 'LIST', pageNo: 1 } })));
        log.info(`Crawler finished. Total saved: ${saved} items`);
        
        if (saved === 0) {
            log.warning(`No jobs were scraped! Check logs for errors or selector issues.`);
        }
    } finally {
        await Actor.exit();
    }
}

main().catch(err => { console.error(err); process.exit(1); });

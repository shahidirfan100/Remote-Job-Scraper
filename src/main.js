// Remote.co jobs scraper - CheerioCrawler implementation with stealth
import { Actor, log } from 'apify';
import { CheerioCrawler, Dataset } from 'crawlee';
import { load as cheerioLoad } from 'cheerio';
import { gotScraping } from 'got-scraping';

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
            const u = new URL('https://remote.co/remote-jobs/search/');
            if (kw) u.searchParams.set('search_keywords', String(kw).trim());
            if (loc) u.searchParams.set('search_location', String(loc).trim());
            if (cat) u.searchParams.set('search_categories', String(cat).trim());
            return u.href;
        };

        const initial = [];
        if (Array.isArray(startUrls) && startUrls.length) initial.push(...startUrls.map(s => ({ url: s })));
        if (startUrl) initial.push({ url: startUrl });
        if (url) initial.push({ url });
        if (!initial.length) initial.push({ url: buildStartUrl(keyword, location, category) });

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
            // Remote.co specific: job detail links contain '/job-details/' pattern
            $('a[href*="/job-details/"]').each((_, a) => {
                const href = $(a).attr('href');
                if (!href) return;
                const abs = toAbs(href, base);
                if (abs && abs.includes('/job-details/')) links.add(abs);
            });
            // Fallback for any /remote-jobs/ links that aren't search pages
            if (links.size === 0) {
                $('a[href*="/remote-jobs/"]').each((_, a) => {
                    const href = $(a).attr('href');
                    if (!href || href.includes('/search')) return;
                    const abs = toAbs(href, base);
                    if (abs) links.add(abs);
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

                if (label === 'LIST') {
                    const links = findJobLinks($, request.url);
                    crawlerLog.info(`LIST page ${pageNo} (${request.url}) -> found ${links.length} job links`);

                    // normalize and dedupe links
                    const normalized = links.map(normalizeUrl).filter(Boolean).filter((u, i, arr) => arr.indexOf(u) === i);
                    const remaining = Math.max(0, RESULTS_WANTED - saved);
                    const toConsider = normalized.slice(0, remaining * 2);

                    const toEnqueue = [];
                    for (const l of toConsider) {
                        if (dedupe && seenUrls.has(l)) continue;
                        seenUrls.add(l);
                        toEnqueue.push({ url: l, userData: { label: 'DETAIL' } });
                        if (toEnqueue.length >= remaining) break;
                    }

                    if (collectDetails) {
                        if (toEnqueue.length) {
                            crawlerLog.info(`Enqueueing ${toEnqueue.length} job detail pages`);
                            await enqueueLinks({ requests: toEnqueue });
                        }
                    } else {
                        const toPush = toEnqueue.map(r => ({ url: r.url, _source: 'remote.co' }));
                        if (toPush.length) { 
                            await Dataset.pushData(toPush); 
                            saved += toPush.length;
                            crawlerLog.info(`Saved ${toPush.length} job URLs (total: ${saved})`);
                        }
                    }

                    // Pagination: continue if we need more results and haven't hit max pages
                    if (saved < RESULTS_WANTED && pageNo < MAX_PAGES && links.length > 0) {
                        const next = findNextPage($, request.url, pageNo);
                        if (next) {
                            crawlerLog.info(`Enqueueing next page: ${next}`);
                            await enqueueLinks({ urls: [next], userData: { label: 'LIST', pageNo: pageNo + 1 } });
                        } else {
                            crawlerLog.info(`No next page found, stopping pagination`);
                        }
                    } else {
                        crawlerLog.info(`Pagination stopped: saved=${saved}, RESULTS_WANTED=${RESULTS_WANTED}, pageNo=${pageNo}, MAX_PAGES=${MAX_PAGES}`);
                    }
                    return;
                }

                if (label === 'DETAIL') {
                    if (saved >= RESULTS_WANTED) {
                        crawlerLog.info(`Skipping ${request.url} - already reached results_wanted (${RESULTS_WANTED})`);
                        return;
                    }
                    try {
                        // Try JSON-LD first
                        const json = extractFromJsonLd($);
                        const data = json || {};

                        // Remote.co specific selectors with robust fallbacks
                        // Title from h1, meta, or JSON-LD
                        if (!data.title) {
                            data.title = $('h1').first().text().trim() || 
                                        $('meta[property="og:title"]').attr('content') || 
                                        $('title').text().split('|')[0].trim() || null;
                        }
                        
                        // Company name - Remote.co typically shows this as h3 or in a company section
                        if (!data.company) {
                            data.company = $('h3').first().text().trim() || 
                                          $('.company-name, [class*="company"]').first().text().trim() ||
                                          $('meta[property="og:site_name"]').attr('content') || null;
                        }
                        
                        // Job description - look for main content area
                        if (!data.description_html) {
                            const desc = $('.job-description, [class*="description"], .entry-content, article, main').first();
                            data.description_html = desc && desc.length ? String(desc.html()).trim() : $('body').html();
                        }
                        data.description_text = data.description_html ? cleanText(data.description_html) : null;
                        
                        // Location
                        if (!data.location) {
                            data.location = $('[class*="location"], .location, [itemprop="jobLocation"]').first().text().trim() ||
                                           $('meta[property="og:locality"]').attr('content') || null;
                        }
                        
                        // Date posted
                        if (!data.date_posted) {
                            data.date_posted = $('time[datetime]').attr('datetime') || 
                                              $('meta[property="article:published_time"]').attr('content') ||
                                              $('[class*="date"], .posted-date').first().text().trim() || null;
                        }

                        // Category extraction
                        let cat = category || null;
                        if (!cat) {
                            // Try breadcrumbs
                            const crumbs = $('nav.breadcrumb, .breadcrumbs, [class*="breadcrumb"]');
                            if (crumbs && crumbs.length) cat = crumbs.find('a').last().text().trim() || null;
                            // Try category/tag elements
                            if (!cat) cat = $('[class*="category"], .category, .job-type, .job-category, [class*="tag"]').first().text().trim() || null;
                        }

                        const itemUrl = normalizeUrl(request.url);
                        const item = {
                            title: data.title || null,
                            company: data.company || null,
                            category: cat || null,
                            location: data.location || null,
                            date_posted: data.date_posted || null,
                            description_html: data.description_html || null,
                            description_text: data.description_text || null,
                            url: itemUrl || request.url,
                        };

                        // Skip if no title (likely parse error)
                        if (!item.title) {
                            crawlerLog.warning(`Skipping ${request.url} - no title found`);
                            return;
                        }

                        // Final dedupe check
                        if (dedupe) {
                            if (seenUrls.has(item.url)) {
                                crawlerLog.info(`Skipping duplicate ${item.url}`);
                                return;
                            }
                            seenUrls.add(item.url);
                        }

                        await Dataset.pushData(item);
                        saved++;
                        crawlerLog.info(`Saved job #${saved}: ${item.title} at ${item.company || 'Unknown'}`);
                        
                        // Mark session as good on successful scrape
                        if (session) session.markGood();
                    } catch (err) {
                        crawlerLog.error(`DETAIL ${request.url} failed: ${err.message}`);
                        if (session) session.markBad();
                    }
                }
            }
        });

        // run crawler
        await crawler.run(initial.map(u => ({ ...u, userData: { label: 'LIST', pageNo: 1 } })));
        log.info(`Finished. Saved ${saved} items`);
    } finally {
        await Actor.exit();
    }
}

main().catch(err => { console.error(err); process.exit(1); });

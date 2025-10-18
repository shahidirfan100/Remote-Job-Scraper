// Remote.co jobs scraper - CheerioCrawler implementation
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
            dedupe = true, minRequestDelay = 250, maxRequestDelay = 900
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

        const proxyConf = proxyConfiguration ? await Actor.createProxyConfiguration({ ...proxyConfiguration }) : undefined;

        // in-memory dedupe set for URLs (persisting across run restarts is not implemented)
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
            // primary card links
            $('a[href]').each((_, a) => {
                const href = $(a).attr('href');
                if (!href) return;
                // match typical remote.co job detail path
                if (/remote-jobs\//i.test(href) || /remote\.co\/remote-jobs/i.test(href)) {
                    const abs = toAbs(href, base);
                    if (abs) links.add(abs);
                }
            });
            // fallback: data-href or button-like elements
            $('[data-href]').each((_, el) => { const h = $(el).attr('data-href'); const abs = toAbs(h, base); if (abs) links.add(abs); });
            return [...links];
        }

        function findNextPage($, base) {
            // prefer rel="next"
            const rel = $('a[rel="next"]').attr('href');
            if (rel) return toAbs(rel, base);
            // look for next button in pagination
            const next = $('a').filter((_, el) => /(^|\s)(next|›|»|>)(\s|$)/i.test($(el).text())).first().attr('href');
            if (next) return toAbs(next, base);
            // look for page param increment
            const link = $('a').filter((_, el) => /page=\d+/i.test($(el).attr('href') || '')).last().attr('href');
            if (link) return toAbs(link, base);
            return null;
        }

        const randomDelay = () => new Promise(r => setTimeout(r, Math.floor(Math.random() * (maxRequestDelay - minRequestDelay + 1)) + minRequestDelay));

        const crawler = new CheerioCrawler({
            proxyConfiguration: proxyConf,
            maxRequestRetries: 3,
            useSessionPool: true,
            sessionPoolOptions: { maxPoolSize: 40, sessionOptions: { maxUsageCount: 50 } },
            maxConcurrency: 5,
            requestHandlerTimeoutSecs: 90,
            handlePageTimeoutSecs: 90,
            preNavigationHooks: [],
            failedRequestHandler: async ({ request, error, body, session, log: crawlerLog }) => {
                crawlerLog.warning(`Request failed: ${request.url} (${error?.message || 'no error message'})`);
                if (session) session.markBad();
            },
            async requestHandler({ request, $, enqueueLinks, log: crawlerLog, session }) {
                const label = request.userData?.label || 'LIST';
                const pageNo = request.userData?.pageNo || 1;

                // polite random delay
                await randomDelay();

                if (label === 'LIST') {
                    const links = findJobLinks($, request.url);
                    crawlerLog.info(`LIST ${request.url} -> found ${links.length} links`);

                    // normalize and dedupe links here
                    const normalized = links.map(normalizeUrl).filter(Boolean).filter((u, i, arr) => arr.indexOf(u) === i);
                    const remaining = Math.max(0, RESULTS_WANTED - saved);
                    const toConsider = normalized.slice(0, remaining * 2); // enqueue a bit more to account for duplicates

                    const toEnqueue = [];
                    for (const l of toConsider) {
                        if (dedupe && seenUrls.has(l)) continue;
                        seenUrls.add(l);
                        toEnqueue.push({ url: l, userData: { label: 'DETAIL' } });
                        if (toEnqueue.length >= remaining) break;
                    }

                    if (collectDetails) {
                        if (toEnqueue.length) await enqueueLinks({ requests: toEnqueue });
                    } else {
                        const toPush = toEnqueue.map(r => ({ url: r.url, _source: 'remote.co' }));
                        if (toPush.length) { await Dataset.pushData(toPush); saved += toPush.length; }
                    }

                    if (saved < RESULTS_WANTED && pageNo < MAX_PAGES) {
                        const next = findNextPage($, request.url);
                        if (next) await enqueueLinks({ urls: [next], userData: { label: 'LIST', pageNo: pageNo + 1 } });
                    }
                    return;
                }

                if (label === 'DETAIL') {
                    if (saved >= RESULTS_WANTED) return;
                    try {
                        const json = extractFromJsonLd($);
                        const data = json || {};

                        // robust fallbacks
                        if (!data.title) data.title = $('h1').first().text().trim() || $('meta[property="og:title"]').attr('content') || null;
                        if (!data.company) data.company = $('[class*="company"], .company, .employer').first().text().trim() || $('[rel="author"]').text().trim() || null;
                        if (!data.description_html) {
                            const desc = $('[class*="job-description"], .job-description, .description, .entry-content, [itemprop="description"]').first();
                            data.description_html = desc && desc.length ? String(desc.html()).trim() : null;
                        }
                        data.description_text = data.description_html ? cleanText(data.description_html) : null;
                        if (!data.location) data.location = $('[class*="location"], .location, [itemprop="jobLocation"] .locality').first().text().trim() || null;
                        if (!data.date_posted) data.date_posted = $('time[datetime]').attr('datetime') || $('meta[property="article:published_time"]').attr('content') || null;

                        // try to extract category from breadcrumbs or tags
                        let cat = category || null;
                        if (!cat) {
                            const crumbs = $('nav.breadcrumb, .breadcrumbs, .breadcrumb');
                            if (crumbs && crumbs.length) cat = crumbs.find('a').last().text().trim() || null;
                            if (!cat) cat = $('[class*="category"], .category, .job-type, .job-category').first().text().trim() || null;
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

                        // final dedupe check
                        if (dedupe) {
                            if (seenUrls.has(item.url)) {
                                crawlerLog.info(`Skipping duplicate ${item.url}`);
                                return;
                            }
                            seenUrls.add(item.url);
                        }

                        await Dataset.pushData(item);
                        saved++;
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

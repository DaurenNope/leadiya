/**
 * Leadiya Scraper - Chrome Extension
 * Extracts leads from business directories and saves to Leadiya CRM
 * v2.0 — Fixed phone extraction, added logging, proper error handling
 */

const captureBtn = document.getElementById('captureBtn');
const captureAllBtn = document.getElementById('captureAllBtn');
const statusEl = document.getElementById('status');
const serverUrlInput = document.getElementById('serverUrl');
const leadsFoundEl = document.getElementById('leadsFound');
const leadsSavedEl = document.getElementById('leadsSaved');

// Load saved server URL
chrome.storage.local.get(['serverUrl'], (result) => {
    if (result.serverUrl) {
        serverUrlInput.value = result.serverUrl;
    }
});

// Save server URL on change
serverUrlInput.addEventListener('change', () => {
    chrome.storage.local.set({ serverUrl: serverUrlInput.value });
});

function setStatus(message, type = '') {
    statusEl.textContent = message;
    statusEl.className = 'status ' + type;
    console.log(`[Leadiya Popup] ${type || 'info'}: ${message}`);
}

function setLoading(loading) {
    captureBtn.disabled = loading;
    captureAllBtn.disabled = loading;
    if (loading) {
        captureBtn.textContent = '⏳ Capturing...';
    } else {
        captureBtn.textContent = '🎯 Capture Leads from Page';
    }
}

/** Fetch with timeout + 1 retry */
async function fetchWithRetry(url, options, timeoutMs = 15000) {
    const attempt = async () => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
            const res = await fetch(url, { ...options, signal: controller.signal });
            clearTimeout(timer);
            return res;
        } catch (err) {
            clearTimeout(timer);
            throw err;
        }
    };
    try {
        return await attempt();
    } catch (err) {
        console.warn('[Leadiya] First attempt failed, retrying...', err.message);
        setStatus('Retrying...');
        return await attempt();
    }
}

// Smart capture - extract structured lead data
captureBtn.addEventListener('click', async () => {
    setLoading(true);
    setStatus('Scanning page for leads...');

    try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

        // Inject content script and extract data
        const results = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: extractLeadsFromPage
        });

        const data = results[0]?.result;
        if (!data || !data.leads || data.leads.length === 0) {
            setStatus('No leads found on this page', 'error');
            leadsFoundEl.textContent = '0';
            setLoading(false);
            return;
        }

        leadsFoundEl.textContent = data.leads.length;
        setStatus(`Found ${data.leads.length} leads (${data.metadata.site || 'generic'}). Sending...`);

        // Send to Leadiya API
        const serverUrl = serverUrlInput.value.replace(/\/$/, '');
        setStatus(`Sending ${data.leads.length} leads to server...`);

        const response = await fetchWithRetry(`${serverUrl}/api/extension/capture`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                url: tab.url,
                title: tab.title,
                leads: data.leads,
                metadata: data.metadata
            })
        });

        const result = await response.json();
        console.log('[Leadiya] API response:', result);

        if (result.success) {
            leadsSavedEl.textContent = result.saved || 0;
            const leadsSkippedEl = document.getElementById('leadsSkipped');
            if (leadsSkippedEl) leadsSkippedEl.textContent = result.skipped || 0;
            const parts = [`✅ ${result.saved} saved`];
            if (result.skipped > 0) parts.push(`${result.skipped} skipped (duplicates)`);
            if (result.errors > 0) parts.push(`${result.errors} failed`);
            setStatus(parts.join(', '), 'success');
        } else {
            setStatus('Failed: ' + (result.error || 'Unknown error'), 'error');
        }
    } catch (err) {
        console.error('[Leadiya] Capture error:', err);
        if (err.name === 'AbortError') {
            setStatus('Timeout: Server took too long. Is it running?', 'error');
        } else if (err.message.includes('Failed to fetch')) {
            setStatus('Cannot connect to server. Is it running at ' + serverUrlInput.value + '?', 'error');
        } else {
            setStatus('Error: ' + err.message, 'error');
        }
    }

    setLoading(false);
});

// Auto-scroll + Multi-page capture - scrolls, extracts, pageinates, repeats
captureAllBtn.addEventListener('click', async () => {
    setLoading(true);
    const progressWrap = document.getElementById('progressWrap');
    const progressBar = document.getElementById('progressBar');
    const progressText = document.getElementById('progressText');
    const leadsSkippedEl = document.getElementById('leadsSkipped');
    const pagesScrapedEl = document.getElementById('pagesScraped');
    const maxPagesInput = document.getElementById('maxPages');
    const maxPages = parseInt(maxPagesInput?.value) || 10;

    progressWrap.style.display = 'block';
    progressBar.style.width = '0%';

    let totalFound = 0;
    let totalSaved = 0;
    let totalSkipped = 0;
    let totalErrors = 0;
    let currentPage = 0;

    try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        const serverUrl = serverUrlInput.value.replace(/\/$/, '');

        // ========== PAGE LOOP ==========
        while (currentPage < maxPages) {
            currentPage++;
            const pctBase = ((currentPage - 1) / maxPages) * 100;
            const pctPerPage = 100 / maxPages;

            setStatus(`📄 Page ${currentPage}/${maxPages}: Scrolling to load results...`);
            progressText.textContent = `Page ${currentPage}/${maxPages}: Scrolling...`;
            progressBar.style.width = pctBase + '%';

            // Phase 1: Auto-scroll this page
            const scrollResult = await chrome.scripting.executeScript({
                target: { tabId: tab.id },
                func: autoScrollPage
            });

            const scrollData = scrollResult[0]?.result;
            console.log(`[Leadiya] Page ${currentPage} scroll:`, scrollData);
            progressBar.style.width = (pctBase + pctPerPage * 0.3) + '%';
            progressText.textContent = `Page ${currentPage}/${maxPages}: Extracting leads...`;
            setStatus(`📄 Page ${currentPage}/${maxPages}: Extracting leads...`);

            // Phase 2: Extract leads
            const extractResult = await chrome.scripting.executeScript({
                target: { tabId: tab.id },
                func: extractLeadsFromPage
            });

            const data = extractResult[0]?.result;
            const pageLeads = data?.leads || [];
            totalFound += pageLeads.length;
            leadsFoundEl.textContent = totalFound;

            if (pageLeads.length === 0 && currentPage === 1) {
                setStatus('No leads found on this page', 'error');
                progressWrap.style.display = 'none';
                setLoading(false);
                return;
            }

            // Phase 3: Send leads to server in batches
            if (pageLeads.length > 0) {
                progressText.textContent = `Page ${currentPage}/${maxPages}: Sending ${pageLeads.length} leads...`;
                progressBar.style.width = (pctBase + pctPerPage * 0.5) + '%';

                const batchSize = 50;
                for (let i = 0; i < pageLeads.length; i += batchSize) {
                    const batch = pageLeads.slice(i, i + batchSize);
                    try {
                        const response = await fetchWithRetry(`${serverUrl}/api/extension/capture`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                url: tab.url,
                                title: tab.title,
                                leads: batch,
                                metadata: { ...data.metadata, page: currentPage, maxPages }
                            })
                        });
                        const result = await response.json();
                        totalSaved += result.saved || 0;
                        totalSkipped += result.skipped || 0;
                        totalErrors += result.errors || 0;
                        console.log(`[Leadiya] Page ${currentPage} batch: saved=${result.saved} skipped=${result.skipped}`);
                    } catch (err) {
                        console.error(`[Leadiya] Page ${currentPage} batch failed:`, err);
                        totalErrors += batch.length;
                    }
                }

                // Update running totals in UI
                leadsSavedEl.textContent = totalSaved;
                if (leadsSkippedEl) leadsSkippedEl.textContent = totalSkipped;
                if (pagesScrapedEl) pagesScrapedEl.textContent = currentPage;
            }

            progressBar.style.width = (pctBase + pctPerPage * 0.8) + '%';

            // Phase 4: Try to navigate to next page
            if (currentPage >= maxPages) {
                console.log(`[Leadiya] Reached max pages (${maxPages})`);
                break;
            }

            setStatus(`📄 Page ${currentPage}/${maxPages}: Looking for Next button...`);
            progressText.textContent = `Page ${currentPage}: Looking for next page...`;

            const navResult = await chrome.scripting.executeScript({
                target: { tabId: tab.id },
                func: findAndClickNextPage
            });

            const navData = navResult[0]?.result;
            console.log('[Leadiya] Pagination result:', navData);

            if (!navData?.clicked) {
                console.log('[Leadiya] No Next button found — stopping pagination');
                setStatus(`📄 No more pages found after page ${currentPage}`);
                break;
            }

            // Wait for new page to load
            progressText.textContent = `Navigating to page ${currentPage + 1}...`;
            setStatus(`📄 Navigating to page ${currentPage + 1}...`);
            await new Promise(r => setTimeout(r, 3000));

            // Extra wait: check if URL changed (for SPAs that don't reload)
            const [updatedTab] = await chrome.tabs.query({ active: true, currentWindow: true });
            console.log(`[Leadiya] After nav: ${updatedTab.url}`);

            progressBar.style.width = (pctBase + pctPerPage) + '%';
        }

        // ========== FINAL SUMMARY ==========
        progressBar.style.width = '100%';
        leadsSavedEl.textContent = totalSaved;
        if (leadsSkippedEl) leadsSkippedEl.textContent = totalSkipped;
        if (pagesScrapedEl) pagesScrapedEl.textContent = currentPage;

        const parts = [`✅ ${totalSaved} saved`];
        if (totalSkipped > 0) parts.push(`${totalSkipped} skipped`);
        if (totalErrors > 0) parts.push(`${totalErrors} failed`);
        parts.push(`(${totalFound} total from ${currentPage} page${currentPage > 1 ? 's' : ''})`);
        setStatus(parts.join(', '), 'success');
        progressText.textContent = `Done! ${currentPage} page${currentPage > 1 ? 's' : ''} scraped.`;

    } catch (err) {
        console.error('[Leadiya] Auto-scroll error:', err);
        if (err.name === 'AbortError') {
            setStatus('Timeout during capture', 'error');
        } else {
            setStatus('Error: ' + err.message, 'error');
        }
        progressWrap.style.display = 'none';
    }

    setLoading(false);
});

/**
 * Auto-scroll function - runs in page context
 * Scrolls the results list to trigger lazy loading of more items
 */
function autoScrollPage() {
    return new Promise((resolve) => {
        console.log('[Leadiya Scroll] Starting auto-scroll...');

        // Smart container detection: find the scrollable panel
        // Strategy: walk UP from a content element to find its scrollable ancestor
        let scrollContainer = null;

        // Try site-specific content anchors first, then generic
        const contentAnchors = [
            'a[href*="/firm/"]',           // 2GIS
            '[role="article"]',             // Google Maps
            '[class*="search-snippet"]',    // Yandex Maps  
            '[class*="card"]',              // Generic cards
            '[class*="result"]',            // Generic results
            '[class*="listing"]',           // Generic listings
            '[class*="item"]',              // Generic items
            'article',                      // Semantic articles
        ];

        for (const sel of contentAnchors) {
            const anchor = document.querySelector(sel);
            if (!anchor) continue;

            let el = anchor.parentElement;
            while (el && el !== document.body) {
                const style = getComputedStyle(el);
                if ((style.overflowY === 'auto' || style.overflowY === 'scroll') && el.scrollHeight > el.clientHeight + 50) {
                    scrollContainer = el;
                    break;
                }
                el = el.parentElement;
            }
            if (scrollContainer) break;
        }

        if (!scrollContainer) {
            scrollContainer = document.documentElement;
        }
        console.log(`[Leadiya Scroll] Using container: <${scrollContainer.tagName}> class="${scrollContainer.className?.slice(0, 60)}" scrollH=${scrollContainer.scrollHeight} clientH=${scrollContainer.clientHeight}`);

        // Count content elements for progress tracking (works for any site)
        const countContent = () => {
            const counts = contentAnchors.map(sel => document.querySelectorAll(sel).length);
            return Math.max(...counts, 0);
        };
        let lastContentCount = countContent();
        let scrollCount = 0;
        let noChangeCount = 0;
        const maxScrolls = 100;
        const maxNoChange = 5;

        const doScroll = () => {
            scrollContainer.scrollTop = scrollContainer.scrollHeight;
            // Also scroll the window in case content is not in a scroll container
            window.scrollTo(0, document.documentElement.scrollHeight);
            scrollCount++;

            setTimeout(() => {
                const newContentCount = countContent();
                if (newContentCount === lastContentCount) {
                    noChangeCount++;
                } else {
                    console.log(`[Leadiya Scroll] New content loaded: ${lastContentCount} → ${newContentCount}`);
                    noChangeCount = 0;
                    lastContentCount = newContentCount;
                }

                console.log(`[Leadiya Scroll] #${scrollCount}: ${newContentCount} items, noChange=${noChangeCount}`);

                if (noChangeCount >= maxNoChange || scrollCount >= maxScrolls) {
                    console.log(`[Leadiya Scroll] Done. ${scrollCount} scrolls, ${newContentCount} items loaded.`);
                    resolve({ scrollCount, itemsLoaded: newContentCount, stopped: noChangeCount >= maxNoChange ? 'no_new_content' : 'max_scrolls' });
                } else {
                    doScroll();
                }
            }, 1500);
        };

        doScroll();
    });
}

/**
 * Find and click the "Next Page" button - runs in page context
 * Returns { clicked: true/false, pageInfo: string }
 */
function findAndClickNextPage() {
    return new Promise((resolve) => {
        const url = location.href;
        console.log('[Leadiya Pagination] Looking for Next button on:', url);

        // Strategy 1: Site-specific selectors
        const siteSpecific = [];
        if (url.includes('2gis.')) {
            // 2GIS uses arrow buttons in pagination
            siteSpecific.push(
                'div[class*="pagination"] button:last-child',
                'a[class*="pagination"][class*="next"]',
                'button[aria-label="Следующая страница"]',
                'button[aria-label="Next page"]'
            );
        }

        // Strategy 2: Generic "Next" selectors (covers most sites)
        const genericSelectors = [
            // Explicit next links/buttons
            'a.next', 'a.next-page', 'button.next',
            '[class*="next"][class*="page"]',
            '[class*="pagination"] a[class*="next"]',
            '[class*="pagination"] button[class*="next"]',
            '[class*="pager"] a[class*="next"]',

            // Aria labels
            '[aria-label="Next"]', '[aria-label="next"]',
            '[aria-label="Next page"]', '[aria-label="Следующая"]',
            '[aria-label="Следующая страница"]',

            // Title attributes
            'a[title="Next"]', 'a[title="Следующая"]',
            'a[title="Следующая страница"]', 'a[title="Next page"]',

            // Rel=next
            'a[rel="next"]',

            // Href patterns
            'a[href*="page="]',
        ];

        // Strategy 3: Text-based detection
        const nextTextPatterns = [
            /^(?:next|→|›|»|>>|следующая|дальше|далее|вперёд)$/i,
            /^(?:next page|следующая страница)$/i,
            /^(?:показать ещ[ёе]|загрузить ещ[ёе]|ещ[ёе]|show more|load more)$/i,
        ];

        // Try site-specific first, then generic selectors
        const allSelectors = [...siteSpecific, ...genericSelectors];

        for (const sel of allSelectors) {
            try {
                const elements = document.querySelectorAll(sel);
                for (const el of elements) {
                    // For href*="page=" we need to find the NEXT page specifically
                    if (sel === 'a[href*="page="]') {
                        // Find current page number from URL or active element
                        const currentPageMatch = url.match(/page=(\d+)/);
                        const currentPage = currentPageMatch ? parseInt(currentPageMatch[1]) : 1;
                        const nextPage = currentPage + 1;
                        if (el.href && el.href.includes(`page=${nextPage}`)) {
                            console.log(`[Leadiya Pagination] Found next page link: page=${nextPage}`, el.href);
                            el.click();
                            return resolve({ clicked: true, pageInfo: `page=${nextPage}`, via: sel });
                        }
                        continue;
                    }

                    // Skip disabled or hidden elements
                    if (el.disabled || el.getAttribute('aria-disabled') === 'true') continue;
                    const style = getComputedStyle(el);
                    if (style.display === 'none' || style.visibility === 'hidden') continue;

                    console.log(`[Leadiya Pagination] Found via selector "${sel}":`, el.textContent?.trim()?.slice(0, 30));
                    el.click();
                    return resolve({ clicked: true, pageInfo: el.textContent?.trim()?.slice(0, 20), via: sel });
                }
            } catch (e) { }
        }

        // Strategy 3: Scan all links/buttons for "Next" text
        const candidates = document.querySelectorAll('a, button');
        for (const el of candidates) {
            const text = el.textContent?.trim();
            if (!text || text.length > 30) continue;

            for (const pattern of nextTextPatterns) {
                if (pattern.test(text)) {
                    if (el.disabled || el.getAttribute('aria-disabled') === 'true') continue;
                    const style = getComputedStyle(el);
                    if (style.display === 'none' || style.visibility === 'hidden') continue;

                    console.log(`[Leadiya Pagination] Found via text match "${text}"`);
                    el.click();
                    return resolve({ clicked: true, pageInfo: text, via: 'text-match' });
                }
            }
        }

        // Strategy 4: Find active page number and click its next sibling
        const paginationContainers = document.querySelectorAll(
            '[class*="pagination"], [class*="pager"], nav[aria-label*="page"], nav[aria-label*="страниц"]'
        );
        for (const container of paginationContainers) {
            const activeEl = container.querySelector('.active, [class*="current"], [aria-current="page"]');
            if (activeEl) {
                const parent = activeEl.closest('li') || activeEl;
                const nextSibling = parent.nextElementSibling;
                if (nextSibling) {
                    const link = nextSibling.querySelector('a, button') || nextSibling;
                    if (link && !link.disabled) {
                        const text = link.textContent?.trim();
                        console.log(`[Leadiya Pagination] Found next sibling of active page: "${text}"`);
                        link.click();
                        return resolve({ clicked: true, pageInfo: `sibling: ${text}`, via: 'active-sibling' });
                    }
                }
            }
        }

        console.log('[Leadiya Pagination] No Next button found — end of pagination');
        resolve({ clicked: false, pageInfo: 'none' });
    });
}

/**
 * Main extraction function - runs in page context
 * UNIVERSAL SMART SCRAPER v3.0
 * 3 extraction layers + 6 relevance filter gates
 * Works on ANY website — no site-specific templates needed (except 2GIS)
 */
async function extractLeadsFromPage() {
    const url = location.href;
    const PHONE_RU = /\+?[78][\s\-]?\(?[0-9]{3}\)?[\s\-]?[0-9]{3}[\s\-]?[0-9]{2}[\s\-]?[0-9]{2}/g;
    const PHONE_INTL = /\+?[0-9]{1,3}[\s\-]?\(?[0-9]{3}\)?[\s\-]?[0-9]{3}[\s\-]?[0-9]{4}/g;
    const EMAIL = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
    const BIN_REGEX = /\b\d{12}\b/g;

    console.log('[Leadiya Extract] Starting on:', url);

    // ============================================================================
    // UNIVERSAL LINK SCANNER — enriches any lead with social/web data from its card
    // ============================================================================
    const SOCIAL_DOMAINS = {
        instagram: /instagram\.com/i,
        facebook: /facebook\.com/i,
        linkedin: /linkedin\.com/i,
        telegram: /t\.me\//i,
        whatsapp: /wa\.me/i,
        youtube: /youtube\.com/i,
        tiktok: /tiktok\.com/i,
        vk: /vk\.com/i,
        twitter: /(?:twitter|x)\.com/i
    };

    const SKIP_DOMAINS = /2gis\.|google\.|yandex\.|apple\.com|play\.google|apps\.apple|javascript:|#$|mailto:|tel:/i;

    function scanCardForLinks(cardElement) {
        if (!cardElement) return {};
        const allLinks = Array.from(cardElement.querySelectorAll('a[href]'));

        const result = {
            website: '',
            socialLinks: [],
            instagramHandle: '',
            facebookUrl: '',
            linkedinUrl: '',
            telegramHandle: '',
            whatsappLink: '',
            youtubeUrl: '',
            tiktokUrl: '',
            vkUrl: '',
            twitterUrl: ''
        };

        const seenHrefs = new Set();

        // Helper: detect social platform from text/label (for redirect URLs like link.2gis.com)
        const SOCIAL_TEXT_HINTS = {
            instagram: /instagram|инстаграм/i,
            facebook: /facebook|фейсбук/i,
            vk: /\bvk\b|вконтакте|вк\b/i,
            telegram: /telegram|телеграм/i,
            whatsapp: /whatsapp|ватсап|вотсап/i,
            youtube: /youtube|ютуб/i,
            tiktok: /tiktok|тикток/i,
            twitter: /twitter|твиттер|\bx\.com\b/i,
            linkedin: /linkedin|линкед/i
        };

        const setSocialField = (platform, href, text) => {
            result.socialLinks.push({ platform, href, text });
            if (platform === 'instagram' && !result.instagramHandle) {
                const match = href.match(/instagram\.com\/([^/?]+)/);
                result.instagramHandle = match ? '@' + match[1] : (text || href);
            } else if (platform === 'facebook' && !result.facebookUrl) {
                result.facebookUrl = href;
            } else if (platform === 'linkedin' && !result.linkedinUrl) {
                result.linkedinUrl = href;
            } else if (platform === 'telegram' && !result.telegramHandle) {
                const match = href.match(/t\.me\/([^/?]+)/);
                result.telegramHandle = match ? '@' + match[1] : (text || href);
            } else if (platform === 'whatsapp' && !result.whatsappLink) {
                result.whatsappLink = href;
            } else if (platform === 'youtube' && !result.youtubeUrl) {
                result.youtubeUrl = href;
            } else if (platform === 'tiktok' && !result.tiktokUrl) {
                result.tiktokUrl = href;
            } else if (platform === 'vk' && !result.vkUrl) {
                result.vkUrl = href;
            } else if (platform === 'twitter' && !result.twitterUrl) {
                result.twitterUrl = href;
            }
        };

        for (const a of allLinks) {
            const href = a.href?.trim();
            if (!href || seenHrefs.has(href)) continue;
            seenHrefs.add(href);

            const linkText = a.textContent?.trim() || '';
            const ariaLabel = a.getAttribute('aria-label') || '';

            // Strategy 1: Check href for known social domains
            let isSocial = false;
            for (const [platform, regex] of Object.entries(SOCIAL_DOMAINS)) {
                if (regex.test(href)) {
                    isSocial = true;
                    setSocialField(platform, href, linkText);
                    break;
                }
            }

            // Strategy 2: Check aria-label and text for social hints (handles redirect URLs like link.2gis.com)
            if (!isSocial && (href.includes('link.2gis.com') || href.includes('redirect') || href.includes('go.') || href.includes('/away'))) {
                for (const [platform, regex] of Object.entries(SOCIAL_TEXT_HINTS)) {
                    if (regex.test(ariaLabel) || regex.test(linkText)) {
                        isSocial = true;
                        setSocialField(platform, href, linkText || ariaLabel);
                        break;
                    }
                }
            }

            // External website (not social, not skip domain, has http)
            if (!isSocial && !SKIP_DOMAINS.test(href) && href.startsWith('http') && !result.website) {
                // Skip if it's the same domain as current page or a redirect
                if (href.includes('link.2gis.com') || href.includes('/redirect')) continue;
                try {
                    const linkHost = new URL(href).hostname;
                    const pageHost = location.hostname;
                    if (linkHost !== pageHost) {
                        result.website = href;
                    }
                } catch (e) { }
            }
        }

        return result;
    }

    // ============================================================================
    // SPECIAL CASE: 2GIS (tel: link extraction is unique, can't be universal)
    // ============================================================================
    if (url.includes('2gis.')) {
        console.log('[Leadiya Extract] 2GIS detected — using special tel: link extractor');
        const leads = [];
        const firms = document.querySelectorAll('a[href*="/firm/"]');
        const seen = new Set();

        firms.forEach(firm => {
            const href = firm.href;
            const firmId = href.match(/\/firm\/(\d+)/)?.[1];
            if (!firmId || seen.has(firmId)) return;
            seen.add(firmId);

            const name = firm.innerText?.trim();
            if (!name || name.length < 2) return;

            let card = firm.parentElement;
            for (let i = 0; i < 10 && card; i++) {
                const hasTel = card.querySelector('a[href^="tel:"]');
                const hasEnoughText = card.innerText?.length > name.length + 40;
                if (hasTel || hasEnoughText) break;
                card = card.parentElement;
            }

            const cardText = card?.innerText || '';
            const lines = cardText.split('\n').map(l => l.trim()).filter(Boolean);

            const telLinks = card?.querySelectorAll('a[href^="tel:"]') || [];
            const phones = [...new Set(
                Array.from(telLinks).map(a => a.href.replace('tel:', '').trim()).filter(p => p.length >= 10)
            )];

            const waLinks = card?.querySelectorAll('a[href*="wa.me"], a[href*="whatsapp"]') || [];
            const waPhones = Array.from(waLinks).map(a => {
                const match = a.href.match(/(?:wa\.me|phone=)(\+?\d+)/);
                return match?.[1] || '';
            }).filter(Boolean);
            const phoneDigits = new Set(phones.map(p => p.replace(/\D/g, '')));
            waPhones.forEach(wp => {
                if (!phoneDigits.has(wp.replace(/\D/g, ''))) phones.push(wp);
            });

            if (phones.length === 0) {
                const textPhones = (cardText.match(PHONE_RU) || []).map(p => p.trim());
                phones.push(...new Set(textPhones));
            }

            const mailLinks = card?.querySelectorAll('a[href^="mailto:"]') || [];
            const emails = [...new Set([
                ...Array.from(mailLinks).map(a => a.href.replace('mailto:', '').trim()),
                ...(cardText.match(EMAIL) || []).map(e => e.trim())
            ].filter(e => e.length > 3 && e.includes('@')))];

            const addressLine = lines.find(l =>
                l.includes('ул.') || l.includes('пр.') || l.includes('мкр') ||
                l.match(/^[а-яА-Я].*,\s*\d/) || l.match(/^\d+.*,/)
            );

            const category = lines.find(l =>
                l !== name && !l.includes('ул.') && !l.includes('пр.') &&
                l.length > 2 && l.length < 50 && !l.match(/^\d/)
            ) || '';

            const links = scanCardForLinks(card);

            leads.push({
                companyName: name,
                address: addressLine || '',
                phones, emails,
                category,
                website: links.website,
                instagramHandle: links.instagramHandle,
                facebookUrl: links.facebookUrl,
                linkedinUrl: links.linkedinUrl,
                telegramHandle: links.telegramHandle,
                youtubeUrl: links.youtubeUrl,
                tiktokUrl: links.tiktokUrl,
                vkUrl: links.vkUrl,
                socialLinks: links.socialLinks,
                sourceUrl: firm.href
            });
        });

        return {
            leads: leads.slice(0, 200),
            metadata: { url, title: document.title, timestamp: new Date().toISOString(), site: '2gis', totalFound: leads.length }
        };
    }

    // ============================================================================
    // UNIVERSAL SMART SCRAPER — works on ANY website
    // ============================================================================

    // ---- Noise detection helpers ----
    const pageHostname = location.hostname;

    function isPageChrome(el) {
        if (!el) return false;
        let node = el;
        while (node && node !== document.body) {
            const tag = node.tagName?.toLowerCase();
            if (tag === 'header' || tag === 'footer' || tag === 'nav') return true;
            const role = node.getAttribute?.('role')?.toLowerCase();
            if (role === 'banner' || role === 'contentinfo' || role === 'navigation') return true;
            const cls = (node.className || '').toLowerCase();
            if (cls.includes('header') || cls.includes('footer') || cls.includes('nav') ||
                cls.includes('sidebar') || cls.includes('menu') || cls.includes('cookie') ||
                cls.includes('banner') || cls.includes('toolbar')) return true;
            node = node.parentElement;
        }
        return false;
    }

    function isNoiseEmail(email) {
        if (!email) return true;
        const lower = email.toLowerCase();
        const noisePrefixes = ['noreply', 'no-reply', 'support', 'admin', 'webmaster', 'postmaster', 'mailer-daemon'];
        if (noisePrefixes.some(p => lower.startsWith(p + '@'))) return true;
        // Skip emails from the current portal domain (site's own contact)
        try {
            const emailDomain = lower.split('@')[1];
            if (emailDomain === pageHostname || emailDomain === 'www.' + pageHostname) return true;
        } catch (e) { }
        return false;
    }

    function isNoisePhone(phone, el) {
        if (!phone || phone.length < 10) return true;
        // Check if this phone is in the page header (portal hotline)
        if (el) {
            let node = el;
            while (node && node !== document.body) {
                const tag = node.tagName?.toLowerCase();
                if (tag === 'header') return true;
                const cls = (node.className || '').toLowerCase();
                if (cls.includes('header') || cls.includes('hotline') || cls.includes('support-phone')) return true;
                node = node.parentElement;
            }
        }
        return false;
    }

    // ---- BIN/IIN labels (KZ-specific) ----
    const BIN_LABELS = /БИН|ИИН|BIN|IIN|ИНН|ОГРН|Рег\.?\s*номер|Registration/i;
    const DIRECTOR_LABELS = /руководител|директор|ФИО|first\s*head|управляющ|chief|CEO|owner|глав/i;
    const ADDRESS_LABELS = /адрес|address|юр\.?\s*адрес|legal\s*address|местонахождение|location/i;
    const PHONE_LABELS = /телефон|phone|тел\.?|моб\.?|mobile|cell|контакт/i;
    const EMAIL_LABELS = /e-?mail|электронн|почт|эл\.?\s*адрес/i;
    const COMPANY_LABELS = /наименовани|company|организаци|ТОО|ИП|АО|предприят|participant|supplier|поставщик|название/i;
    const ACTIVITY_LABELS = /деятельност|activity|ОКЭД|OKED|основн.*вид|сектор.*экономик|код\s*сектор/i;

    // ---- Relevance gate ----
    function passesRelevanceGate(lead) {
        // Gate 1: Must have company name (length >= 3)
        if (!lead.companyName || lead.companyName.length < 3) return false;
        // Gate 2: Must have at least 1 data point (contact OR identity)
        const hasContact = (lead.phones?.length > 0) || (lead.emails?.length > 0);
        const hasIdentity = lead.bin || lead.director;
        if (!hasContact && !hasIdentity) return false;
        // Flag for enrichment if no direct contact method
        lead.needsResearch = !hasContact;
        if (hasContact && hasIdentity) lead.dataCompleteness = 'full';
        else if (hasContact) lead.dataCompleteness = 'partial';
        else lead.dataCompleteness = 'minimal';
        // Auto-tag for filtering
        if (lead.needsResearch && !lead.tags) lead.tags = [];
        if (lead.needsResearch) lead.tags.push('needs-research');
        // Gate 3-6 are applied during extraction (skipPageChrome, noiseEmail, noisePhone, BIN proximity)
        return true;
    }

    // ---- Extract phones/emails/BINs from text ----
    function extractContactsFromText(text) {
        const phones = [...new Set([
            ...(text.match(PHONE_RU) || []),
            ...(text.match(PHONE_INTL) || [])
        ].map(p => p.trim()))];

        const emails = [...new Set(
            (text.match(EMAIL) || []).filter(e => e.includes('@') && !isNoiseEmail(e))
        )];

        const bins = [...new Set(
            (text.match(BIN_REGEX) || [])
        )];

        return { phones, emails, bins };
    }

    // ---- Find company name from element ----
    function findCompanyName(el) {
        // Priority: headings > title class > bold > first link > first significant text
        const nameSelectors = ['h1', 'h2', 'h3', 'h4', '[class*="title"]', '[class*="name"]', 'strong', 'b'];
        for (const sel of nameSelectors) {
            const found = el.querySelector(sel);
            if (found) {
                const text = found.textContent?.trim();
                if (text && text.length >= 3 && text.length < 200) return text;
            }
        }
        // Try first link
        const firstLink = el.querySelector('a');
        if (firstLink) {
            const text = firstLink.textContent?.trim();
            if (text && text.length >= 3 && text.length < 200) return text;
        }
        return '';
    }

    // ---- Extract labeled value (looks for "Label: Value" patterns) ----
    function extractLabeledValue(container, labelRegex) {
        // Strategy 1: Look for label:value pairs in child elements
        const allChildren = container.querySelectorAll('*');
        for (const child of allChildren) {
            const childText = child.textContent?.trim() || '';
            if (childText.length > 200) continue; // skip containers

            if (labelRegex.test(childText)) {
                // Check next sibling
                const next = child.nextElementSibling;
                if (next) {
                    const val = next.textContent?.trim();
                    if (val && val.length > 1 && val.length < 200) return val;
                }
                // Check if value is in same element after the label
                const parts = childText.split(/[:\s]{2,}/);
                if (parts.length >= 2) {
                    const val = parts.slice(1).join(' ').trim();
                    if (val.length > 1) return val;
                }
            }
        }
        // Strategy 2: Regex on full text
        const fullText = container.textContent || '';
        const lines = fullText.split('\n').map(l => l.trim()).filter(Boolean);
        for (let i = 0; i < lines.length; i++) {
            if (labelRegex.test(lines[i])) {
                // Value might be on same line after colon
                const afterColon = lines[i].split(/[:\s]{2,}/).slice(1).join(' ').trim();
                if (afterColon && afterColon.length > 1) return afterColon;
                // Or on next line
                if (i + 1 < lines.length && lines[i + 1].length > 1 && lines[i + 1].length < 200) {
                    return lines[i + 1];
                }
            }
        }
        return '';
    }

    // ---- Build lead from container element ----
    function buildLeadFromElement(el) {
        if (isPageChrome(el)) return null;

        const text = el.innerText || el.textContent || '';
        if (text.length < 10) return null;

        const contacts = extractContactsFromText(text);

        // Find company name
        let companyName = findCompanyName(el);

        // Try labeled extraction for structured pages
        const director = extractLabeledValue(el, DIRECTOR_LABELS);
        const address = extractLabeledValue(el, ADDRESS_LABELS);
        const activity = extractLabeledValue(el, ACTIVITY_LABELS);

        // If no name from headings, try labeled extraction
        if (!companyName) {
            companyName = extractLabeledValue(el, COMPANY_LABELS);
        }

        // BIN: only accept if near company context
        let bin = '';
        if (contacts.bins.length > 0) {
            // Check if any BIN is near a company-related label
            const hasBinLabel = BIN_LABELS.test(text);
            if (hasBinLabel || companyName) {
                bin = contacts.bins[0];
            }
        }

        // Extract address from text patterns if not found via labels
        let addr = address;
        if (!addr) {
            const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
            addr = lines.find(l =>
                (l.includes('ул.') || l.includes('пр.') || l.includes('мкр') ||
                    l.includes('г.') || l.includes('город') || l.includes('обл.') ||
                    l.match(/^КАЗАХСТАН/i)) &&
                l.length < 200
            ) || '';
        }

        // Parse director name into first/last
        let firstName = '', lastName = '';
        if (director) {
            const parts = director.split(/\s+/).filter(Boolean);
            lastName = parts[0] || '';
            firstName = parts.slice(1).join(' ') || '';
        }

        // Filter noise phones
        const cleanPhones = contacts.phones.filter(p => !isNoisePhone(p, el));

        // Links
        const links = scanCardForLinks(el);

        const lead = {
            companyName: companyName || '',
            firstName,
            lastName,
            jobTitle: director ? 'Директор' : '',
            bin,
            address: addr,
            phones: cleanPhones,
            emails: contacts.emails,
            website: links.website || '',
            instagramHandle: links.instagramHandle || '',
            facebookUrl: links.facebookUrl || '',
            linkedinUrl: links.linkedinUrl || '',
            telegramHandle: links.telegramHandle || '',
            youtubeUrl: links.youtubeUrl || '',
            tiktokUrl: links.tiktokUrl || '',
            vkUrl: links.vkUrl || '',
            socialLinks: links.socialLinks || [],
            sourceUrl: el.querySelector('a')?.href || location.href,
            industry: activity || '',
            tags: activity ? [activity] : []
        };

        return passesRelevanceGate(lead) ? lead : null;
    }

    // ============================================================================
    // LAYER 1: TABLE DETECTOR — for registries, government portals
    // ============================================================================
    function extractFromTables() {
        const leads = [];
        const tables = document.querySelectorAll('table');
        console.log(`[Leadiya L1-Table] Found ${tables.length} tables`);

        for (const table of tables) {
            if (isPageChrome(table)) continue;

            const rows = table.querySelectorAll('tbody tr, tr');
            if (rows.length < 2) continue; // Need data rows, not just header

            console.log(`[Leadiya L1-Table] Table with ${rows.length} rows`);

            // Detect header columns
            const headerRow = table.querySelector('thead tr, tr:first-child');
            const headers = headerRow ? Array.from(headerRow.querySelectorAll('th, td')).map(
                th => th.textContent?.trim()?.toLowerCase() || ''
            ) : [];

            // Find column indices for key fields (first-match priority — don't overwrite)
            const colMap = {};
            headers.forEach((h, i) => {
                // Skip number/index columns for name (e.g. "№ участника")
                const isNumberCol = /^[№#]\s/.test(h) || /^(id|index|row)\b/i.test(h);
                if (colMap.name === undefined && !isNumberCol &&
                    (COMPANY_LABELS.test(h) || /^наименование$|^название$|^name$/i.test(h))) colMap.name = i;
                // For BIN: prefer БИН-containing column over ИИН (ИИН is often empty for legal entities)
                if (/бин|bin\b/i.test(h) && colMap.bin === undefined) colMap.bin = i;
                else if (colMap.bin === undefined && BIN_LABELS.test(h)) colMap.bin = i;
                if (colMap.phone === undefined && PHONE_LABELS.test(h)) colMap.phone = i;
                if (colMap.email === undefined && EMAIL_LABELS.test(h)) colMap.email = i;
                if (colMap.director === undefined && DIRECTOR_LABELS.test(h)) colMap.director = i;
                if (colMap.address === undefined && ADDRESS_LABELS.test(h)) colMap.address = i;
            });

            for (const row of rows) {
                if (row === headerRow) continue;
                const cells = row.querySelectorAll('td');
                if (cells.length < 2) continue;

                // Try mapped columns first, then fall back to full-row extraction
                let companyName = colMap.name !== undefined ? cells[colMap.name]?.textContent?.trim() : '';
                let bin = colMap.bin !== undefined ? cells[colMap.bin]?.textContent?.trim() : '';
                let phone = colMap.phone !== undefined ? cells[colMap.phone]?.textContent?.trim() : '';
                let email = colMap.email !== undefined ? cells[colMap.email]?.textContent?.trim() : '';
                let director = colMap.director !== undefined ? cells[colMap.director]?.textContent?.trim() : '';
                let address = colMap.address !== undefined ? cells[colMap.address]?.textContent?.trim() : '';

                // If no mapped columns, extract from full row text
                const rowText = row.innerText || '';
                if (!companyName) {
                    // First cell with substantial text that's not a number
                    for (const cell of cells) {
                        const t = cell.textContent?.trim();
                        if (t && t.length >= 3 && t.length < 200 && !/^\d+$/.test(t)) {
                            companyName = t;
                            break;
                        }
                    }
                }

                if (!bin) {
                    const binMatch = rowText.match(/\b\d{12}\b/);
                    if (binMatch) bin = binMatch[0];
                }

                const contacts = extractContactsFromText(rowText);
                if (!phone && contacts.phones.length > 0) phone = contacts.phones[0];
                if (!email && contacts.emails.length > 0) email = contacts.emails[0];

                // Parse director
                let firstName = '', lastName = '';
                if (director) {
                    const parts = director.split(/\s+/).filter(Boolean);
                    lastName = parts[0] || '';
                    firstName = parts.slice(1).join(' ') || '';
                }

                const links = scanCardForLinks(row);

                const lead = {
                    companyName: companyName || '',
                    firstName, lastName,
                    jobTitle: director ? 'Директор' : '',
                    bin: bin || '',
                    address: address || '',
                    phones: (phone ? [phone] : contacts.phones).filter(p => !isNoisePhone(p, row)),
                    emails: (email ? [email] : contacts.emails),
                    website: links.website || '',
                    instagramHandle: links.instagramHandle || '',
                    facebookUrl: links.facebookUrl || '',
                    linkedinUrl: links.linkedinUrl || '',
                    telegramHandle: links.telegramHandle || '',
                    socialLinks: links.socialLinks || [],
                    sourceUrl: row.querySelector('a')?.href || location.href,
                    industry: '',
                    tags: []
                };

                if (passesRelevanceGate(lead)) {
                    leads.push(lead);
                }
            }

            if (leads.length > 0) {
                console.log(`[Leadiya L1-Table] Extracted ${leads.length} leads from table`);
                return leads;
            }
        }
        return leads;
    }

    // ============================================================================
    // LAYER 2: REPEATING ELEMENT DETECTOR — for card/list-based pages
    // ============================================================================
    function extractFromRepeatingElements() {
        const leads = [];

        // Find elements that repeat (same className appearing 3+ times)
        const candidates = document.querySelectorAll('div, article, li, section');
        const classCounts = {};

        for (const el of candidates) {
            const cls = el.className;
            if (!cls || typeof cls !== 'string') continue;
            // Use full className as key for precision
            if (!classCounts[cls]) classCounts[cls] = [];
            classCounts[cls].push(el);
        }

        // Find the best repeating group (3-200 occurrences, has meaningful content)
        let bestGroup = null;
        let bestScore = 0;

        for (const [cls, elements] of Object.entries(classCounts)) {
            if (elements.length < 3 || elements.length > 200) continue;
            if (isPageChrome(elements[0])) continue;

            // Score: prefer groups with more contact data
            let score = 0;
            const sampleText = elements[0].innerText || '';
            if (PHONE_RU.test(sampleText) || PHONE_INTL.test(sampleText)) score += 10;
            if (EMAIL.test(sampleText)) score += 10;
            if (BIN_REGEX.test(sampleText)) score += 5;
            if (sampleText.length > 50 && sampleText.length < 2000) score += 5;
            // Prefer groups with headings (likely card titles)
            if (elements[0].querySelector('h1, h2, h3, h4, [class*="title"], [class*="name"]')) score += 5;
            // Prefer medium-sized groups
            score += Math.min(elements.length, 50);

            // Reset regex lastIndex
            PHONE_RU.lastIndex = 0;
            PHONE_INTL.lastIndex = 0;
            EMAIL.lastIndex = 0;
            BIN_REGEX.lastIndex = 0;

            if (score > bestScore) {
                bestScore = score;
                bestGroup = elements;
            }
        }

        if (!bestGroup) {
            // Fallback: try common listing selectors
            const fallbackSelectors = [
                '[class*="card"]', '[class*="item"]', '[class*="result"]',
                '[class*="listing"]', '[class*="company"]', '[class*="search"]',
                'article', '.row'
            ];
            for (const sel of fallbackSelectors) {
                const found = document.querySelectorAll(sel);
                if (found.length >= 3 && found.length <= 200) {
                    const nonChrome = Array.from(found).filter(el => !isPageChrome(el));
                    if (nonChrome.length >= 3) {
                        bestGroup = nonChrome;
                        break;
                    }
                }
            }
        }

        if (!bestGroup) return leads;

        console.log(`[Leadiya L2-Repeating] Found ${bestGroup.length} repeating elements`);

        for (const el of bestGroup) {
            const lead = buildLeadFromElement(el);
            if (lead) leads.push(lead);
        }

        return leads;
    }

    // ============================================================================
    // LAYER 3: LABELED FIELD DETECTOR — for single detail pages
    // ============================================================================
    function extractFromLabeledFields() {
        const leads = [];

        // This is for detail pages (one company's full profile)
        const mainContent = document.querySelector('main, [role="main"], .content, .app__content, #content, article') || document.body;
        if (isPageChrome(mainContent)) return leads;

        const text = mainContent.innerText || '';
        if (text.length < 30) return leads;

        // Look for structured label:value data
        const director = extractLabeledValue(mainContent, DIRECTOR_LABELS);
        const address = extractLabeledValue(mainContent, ADDRESS_LABELS);
        const activity = extractLabeledValue(mainContent, ACTIVITY_LABELS);
        const contacts = extractContactsFromText(text);

        // Find company name — on detail pages, it's usually in h1
        let companyName = '';
        const h1 = mainContent.querySelector('h1');
        if (h1) companyName = h1.textContent?.trim() || '';
        if (!companyName) companyName = extractLabeledValue(mainContent, COMPANY_LABELS);
        if (!companyName) companyName = document.title.split(/[|–—-]/)[0].trim();

        // BIN
        let bin = '';
        const binLabeled = extractLabeledValue(mainContent, BIN_LABELS);
        if (binLabeled && /^\d{12}$/.test(binLabeled.trim())) {
            bin = binLabeled.trim();
        } else if (contacts.bins.length > 0 && BIN_LABELS.test(text)) {
            bin = contacts.bins[0];
        }

        // Must pass minimum bar
        if (!companyName || companyName.length < 3) return leads;
        if (contacts.phones.length === 0 && contacts.emails.length === 0 && !bin && !director) return leads;

        let firstName = '', lastName = '';
        if (director) {
            const parts = director.split(/\s+/).filter(Boolean);
            lastName = parts[0] || '';
            firstName = parts.slice(1).join(' ') || '';
        }

        const cleanPhones = contacts.phones.filter(p => !isNoisePhone(p, mainContent));
        const links = scanCardForLinks(mainContent);

        leads.push({
            companyName,
            firstName, lastName,
            jobTitle: director ? 'Директор' : '',
            bin,
            address: address || '',
            phones: cleanPhones,
            emails: contacts.emails,
            website: links.website || '',
            instagramHandle: links.instagramHandle || '',
            facebookUrl: links.facebookUrl || '',
            linkedinUrl: links.linkedinUrl || '',
            telegramHandle: links.telegramHandle || '',
            youtubeUrl: links.youtubeUrl || '',
            tiktokUrl: links.tiktokUrl || '',
            vkUrl: links.vkUrl || '',
            socialLinks: links.socialLinks || [],
            sourceUrl: location.href,
            industry: activity || '',
            tags: activity ? [activity] : []
        });

        return leads;
    }

    // ============================================================================
    // RUN EXTRACTION LAYERS (priority: tables > repeating > labeled)
    // ============================================================================
    let leads = [];
    let detectionMethod = 'none';

    // Layer 1: Tables
    leads = extractFromTables();
    if (leads.length > 0) {
        detectionMethod = 'table';
        console.log(`[Leadiya Extract] Layer 1 (Table): ${leads.length} leads`);
    }

    // Layer 2: Repeating elements
    if (leads.length === 0) {
        leads = extractFromRepeatingElements();
        if (leads.length > 0) {
            detectionMethod = 'repeating';
            console.log(`[Leadiya Extract] Layer 2 (Repeating): ${leads.length} leads`);
        }
    }

    // Layer 3: Labeled fields (detail page)
    if (leads.length === 0) {
        leads = extractFromLabeledFields();
        if (leads.length > 0) {
            detectionMethod = 'labeled';
            console.log(`[Leadiya Extract] Layer 3 (Labeled): ${leads.length} leads`);
        }
    }

    if (leads.length === 0) {
        console.log('[Leadiya Extract] No leads found by any layer');
    }

    // Deduplicate by phone > email > BIN > company name
    const seen = new Set();
    const uniqueLeads = leads.filter(lead => {
        const key = lead.phones?.[0] || lead.emails?.[0] || lead.bin || lead.companyName;
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
    });

    // ============================================================================
    // DETAIL PAGE AUTO-ENRICHMENT — fetch detail pages for leads missing contacts
    // ============================================================================
    async function enrichLeadsFromDetailPages(leads) {
        const currentOrigin = location.origin;
        // Only enrich leads that: (1) need contacts, (2) have a detail page URL on same origin
        const toEnrich = leads.filter(l => {
            const hasContact = (l.phones?.length > 0) || (l.emails?.length > 0);
            if (hasContact) return false; // Already has contacts, skip
            if (!l.sourceUrl) return false;
            try {
                return new URL(l.sourceUrl).origin === currentOrigin;
            } catch { return false; }
        });

        if (toEnrich.length === 0) {
            console.log('[Leadiya Enrich] No leads need detail page enrichment');
            return leads;
        }

        console.log(`[Leadiya Enrich] Enriching ${toEnrich.length}/${leads.length} leads from detail pages...`);

        // Batch fetch — 2 at a time to be polite
        const BATCH_SIZE = 2;
        const TIMEOUT_MS = 5000;

        for (let i = 0; i < toEnrich.length; i += BATCH_SIZE) {
            const batch = toEnrich.slice(i, i + BATCH_SIZE);
            console.log(`[Leadiya Enrich] Batch ${Math.floor(i / BATCH_SIZE) + 1}: fetching ${batch.length} pages...`);

            await Promise.all(batch.map(async (lead) => {
                try {
                    const controller = new AbortController();
                    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

                    const resp = await fetch(lead.sourceUrl, {
                        signal: controller.signal,
                        credentials: 'same-origin'
                    });
                    clearTimeout(timer);

                    if (!resp.ok) {
                        console.warn(`[Leadiya Enrich] ${resp.status} for ${lead.sourceUrl}`);
                        return;
                    }

                    const html = await resp.text();
                    const doc = new DOMParser().parseFromString(html, 'text/html');

                    // Strip portal chrome (header/footer/nav) to avoid hotline contamination
                    doc.querySelectorAll('header, footer, nav, [role="banner"], [role="contentinfo"], [role="navigation"]').forEach(el => el.remove());
                    const chromeClasses = ['header', 'footer', 'navbar', 'hotline', 'support-phone', 'top-bar'];
                    chromeClasses.forEach(cls => {
                        doc.querySelectorAll(`[class*="${cls}"]`).forEach(el => el.remove());
                    });

                    const mainContent = doc.querySelector('main, [role="main"], .content, .app__content, #content, article') || doc.body;
                    // DOMParser docs don't support innerText — use textContent
                    const text = mainContent?.textContent || '';

                    if (text.length < 30) return;

                    // Extract contacts from detail page
                    const detailContacts = extractContactsFromText(text);
                    const detailPhones = detailContacts.phones.filter(p => !isNoisePhone(p, mainContent));

                    // Extract labeled fields
                    const detailDirector = extractLabeledValue(mainContent, DIRECTOR_LABELS);
                    const detailAddress = extractLabeledValue(mainContent, ADDRESS_LABELS);
                    const detailActivity = extractLabeledValue(mainContent, ACTIVITY_LABELS);

                    // BIN from detail page
                    let detailBin = '';
                    const binLabeled = extractLabeledValue(mainContent, BIN_LABELS);
                    if (binLabeled && /^\d{12}$/.test(binLabeled.trim())) {
                        detailBin = binLabeled.trim();
                    } else if (detailContacts.bins.length > 0 && BIN_LABELS.test(text)) {
                        detailBin = detailContacts.bins[0];
                    }

                    // Social links from detail page
                    const detailLinks = scanCardForLinks(mainContent);

                    // MERGE — only fill empty fields, don't overwrite
                    if (detailPhones.length > 0 && (!lead.phones || lead.phones.length === 0)) {
                        lead.phones = detailPhones;
                    }
                    if (detailContacts.emails.length > 0 && (!lead.emails || lead.emails.length === 0)) {
                        lead.emails = detailContacts.emails;
                    }
                    if (detailBin && !lead.bin) lead.bin = detailBin;
                    if (detailDirector && !lead.firstName && !lead.lastName) {
                        const parts = detailDirector.split(/\s+/).filter(Boolean);
                        lead.lastName = parts[0] || '';
                        lead.firstName = parts.slice(1).join(' ') || '';
                        lead.jobTitle = 'Директор';
                    }
                    if (detailAddress && !lead.address) lead.address = detailAddress;
                    if (detailActivity && !lead.industry) lead.industry = detailActivity;
                    if (detailActivity && (!lead.tags || lead.tags.length === 0)) lead.tags = [detailActivity];
                    if (detailLinks.website && !lead.website) lead.website = detailLinks.website;
                    if (detailLinks.instagramHandle && !lead.instagramHandle) lead.instagramHandle = detailLinks.instagramHandle;
                    if (detailLinks.telegramHandle && !lead.telegramHandle) lead.telegramHandle = detailLinks.telegramHandle;

                    // Recalculate completeness
                    const nowHasContact = (lead.phones?.length > 0) || (lead.emails?.length > 0);
                    if (nowHasContact) {
                        lead.needsResearch = false;
                        lead.dataCompleteness = lead.bin ? 'full' : 'partial';
                        lead.tags = (lead.tags || []).filter(t => t !== 'needs-research');
                        lead.tags.push('enriched-from-detail');
                    }

                    console.log(`[Leadiya Enrich] ✅ ${lead.companyName}: +${detailPhones.length} phones, +${detailContacts.emails.length} emails`);

                } catch (err) {
                    if (err.name === 'AbortError') {
                        console.warn(`[Leadiya Enrich] Timeout for ${lead.sourceUrl}`);
                    } else {
                        console.warn(`[Leadiya Enrich] Error for ${lead.sourceUrl}:`, err.message);
                    }
                }
            }));

            // Small delay between batches
            if (i + BATCH_SIZE < toEnrich.length) {
                await new Promise(r => setTimeout(r, 300));
            }
        }

        const enriched = leads.filter(l => l.tags?.includes('enriched-from-detail')).length;
        console.log(`[Leadiya Enrich] Done. ${enriched}/${toEnrich.length} successfully enriched.`);
        return leads;
    }

    // Run enrichment
    await enrichLeadsFromDetailPages(uniqueLeads);

    // Stats
    const withPhones = uniqueLeads.filter(l => l.phones?.length > 0).length;
    const withEmails = uniqueLeads.filter(l => l.emails?.length > 0).length;
    const withBin = uniqueLeads.filter(l => l.bin).length;
    const withDirector = uniqueLeads.filter(l => l.firstName || l.lastName).length;
    const enrichedCount = uniqueLeads.filter(l => l.tags?.includes('enriched-from-detail')).length;
    console.log(`[Leadiya Extract] Final: ${uniqueLeads.length} leads via ${detectionMethod} (${withPhones} phones, ${withEmails} emails, ${withBin} BINs, ${withDirector} directors, ${enrichedCount} enriched)`);

    return {
        leads: uniqueLeads.slice(0, 200),
        metadata: {
            url: location.href,
            title: document.title,
            timestamp: new Date().toISOString(),
            site: detectionMethod,
            totalFound: uniqueLeads.length,
            enriched: enrichedCount
        }
    };
}


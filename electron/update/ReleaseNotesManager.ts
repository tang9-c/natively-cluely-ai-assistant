
import { net } from "electron";

export interface ReleaseNoteSection {
    title: string;
    items: string[];
}

export interface ParsedReleaseNotes {
    version: string;
    summary: string;
    sections: ReleaseNoteSection[];
    fullBody: string; // Fallback
    url: string;
    assets: ReleaseAsset[];
}

export interface ReleaseAsset {
    name: string;
    downloadUrl: string;
    size: number;
}

export function extractReleaseSemver(tag: string): string | null {
    const match = String(tag).match(/(?:^|v)(\d+\.\d+\.\d+)(?:$|[-+])/);
    return match?.[1] ?? null;
}

export function selectMacDmgAsset(assets: ReleaseAsset[], arch: string): ReleaseAsset | undefined {
    const dmgAssets = assets.filter(asset => asset.name.toLowerCase().endsWith('.dmg'));
    if (arch === 'arm64') {
        return dmgAssets.find(asset => /-arm64\.dmg$/i.test(asset.name));
    }
    if (arch === 'x64') {
        return dmgAssets.find(asset => !/-arm64\.dmg$/i.test(asset.name));
    }
    return undefined;
}

export class ReleaseNotesManager {
    private static instance: ReleaseNotesManager;
    private cachedNotes: ParsedReleaseNotes | null = null;
    private cachedAt: number = 0;
    // 10 minutes — keeps the cache useful for repeated UI lookups in a single
    // session but ensures autoUpdater-triggered fetches don't read stale data.
    private static readonly CACHE_TTL_MS = 10 * 60 * 1000;
    private readonly repoOwner = "tang9-c";
    private readonly repoName = "natively-cluely-ai-assistant";

    private constructor() { }

    public static getInstance(): ReleaseNotesManager {
        if (!ReleaseNotesManager.instance) {
            ReleaseNotesManager.instance = new ReleaseNotesManager();
        }
        return ReleaseNotesManager.instance;
    }

    public async fetchReleaseNotes(version: string, forceRefresh = false): Promise<ParsedReleaseNotes | null> {
        const cacheFresh =
            this.cachedNotes &&
            this.cachedNotes.version === version &&
            Date.now() - this.cachedAt < ReleaseNotesManager.CACHE_TTL_MS;

        if (!forceRefresh && cacheFresh) {
            console.log("[ReleaseNotesManager] Returning cached release notes for", version);
            return this.cachedNotes;
        }

        console.log(`[ReleaseNotesManager] Fetching release notes for ${version}...`);

        try {
            // We'll fetch the 'latest' release and check if it matches the version we are updating to.
            // If the update is not 'latest' (e.g. strict version), we might need to search specific tags,
            // but for now 'latest' is the standard flow for auto-updates.
            // However, to be safe and robust, let's try to fetch by tag if possible, or just latest.
            // GitHub API: GET /repos/{owner}/{repo}/releases/tags/{tag}
            // If version starts with 'v', use it, else add 'v'.
            // If version is 'latest', fetch from /releases/latest
            // Otherwise, fetch by tag
            let url = "";
            if (version === 'latest') {
                url = `https://api.github.com/repos/${this.repoOwner}/${this.repoName}/releases/latest`;
            } else {
                const tag = version.startsWith('v') ? version : `v${version}`;
                url = `https://api.github.com/repos/${this.repoOwner}/${this.repoName}/releases/tags/${tag}`;
            }

            const response = await this.makeRequest(url);

            if (!response) {
                console.warn("[ReleaseNotesManager] Failed to fetch release notes from API.");
                return null;
            }

            const data = JSON.parse(response);
            const body = data.body || "";
            const htmlUrl = data.html_url || "";
            const tagName = data.tag_name || version; // Use tag_name from API if available
            const assets: ReleaseAsset[] = Array.isArray(data.assets)
                ? data.assets.flatMap((asset: any) => {
                    const name = typeof asset?.name === 'string' ? asset.name : '';
                    const downloadUrl = typeof asset?.browser_download_url === 'string'
                        ? asset.browser_download_url
                        : '';
                    const validUrlPrefix = `https://github.com/${this.repoOwner}/${this.repoName}/releases/download/`;
                    if (!name || !downloadUrl.startsWith(validUrlPrefix)) return [];
                    return [{ name, downloadUrl, size: Number(asset?.size) || 0 }];
                })
                : [];

            const parsed = this.parseReleaseNotes(body, tagName, htmlUrl, assets);
            this.cachedNotes = parsed;
            this.cachedAt = Date.now();
            return parsed;

        } catch (error) {
            console.error("[ReleaseNotesManager] Error fetching release notes:", error);
            return null;
        }
    }

    private parseReleaseNotes(body: string, version: string, url: string, assets: ReleaseAsset[]): ParsedReleaseNotes {
        console.log(`[ReleaseNotesManager] Parsing body for ${version}. Length: ${body.length}`);
        const allowedHeaders = ['Summary', "What's New", "Improvements", "Fixes", "Technical"];
        const bulletSections = ["What's New", "Improvements", "Fixes", "Technical"];

        const sections: ReleaseNoteSection[] = [];
        let summary = "";

        // Normalize newlines
        const normalizedBody = body.replace(/\r\n/g, "\n");

        // Split by H2 headers (## )
        const rawSections = normalizedBody.split(/^## /m);

        for (const raw of rawSections) {
            const sectionText = raw.trim();
            if (!sectionText) continue;

            const lines = sectionText.split('\n');
            const title = lines[0].trim();

            // STRICTNESS: Only process allowed headers
            if (!allowedHeaders.includes(title)) {
                continue;
            }

            const contentLines = lines.slice(1);
            const content = contentLines.join('\n').trim();

            if (title === 'Summary') {
                // Summary: Capture text content (single line description)
                summary = content.replace(/\n/g, ' ').trim();
                console.log(`[ReleaseNotesManager] Found Summary: "${summary.substring(0, 50)}..."`);
            } else if (bulletSections.includes(title)) {
                // Bullet Sections: Capture ONLY lines starting with - or *
                const items: string[] = [];
                for (const line of contentLines) {
                    const trimmedLine = line.trim();
                    if (trimmedLine.startsWith('- ') || trimmedLine.startsWith('* ')) {
                        items.push(trimmedLine.substring(2).trim());
                    }
                }

                if (items.length > 0) {
                    sections.push({ title, items });
                    console.log(`[ReleaseNotesManager] Found Section: "${title}" (${items.length} items)`);
                } else {
                    console.warn(`[ReleaseNotesManager] Section "${title}" found but no valid bullet points extracted.`);
                }
            }
        }

        return {
            version,
            summary,
            sections,
            fullBody: body, // Keep raw body for reference/logging
            url,
            assets,
        };
    }

    private makeRequest(url: string): Promise<string | null> {
        return new Promise((resolve) => {
            const request = net.request(url);

            request.on('response', (response) => {
                if (response.statusCode !== 200) {
                    console.warn(`[ReleaseNotesManager] HTTP ${response.statusCode} for ${url}`);
                    resolve(null);
                    return;
                }

                let data = '';
                response.on('data', (chunk) => {
                    data += chunk.toString();
                });

                response.on('end', () => {
                    resolve(data);
                });

                response.on('error', (err) => {
                    console.error("[ReleaseNotesManager] Stream error:", err);
                    resolve(null);
                });
            });

            request.on('error', (err) => {
                console.error("[ReleaseNotesManager] Request error:", err);
                resolve(null);
            });

            request.end();
        });
    }

    public getCachedNotes(): ParsedReleaseNotes | null {
        return this.cachedNotes;
    }
}

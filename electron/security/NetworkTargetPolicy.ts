import { promises as dns } from 'dns';
import * as https from 'https';
import { BlockList, isIP } from 'net';

export interface ResolvedAddress {
    address: string;
    family: number;
}

export type DnsLookup = (hostname: string) => Promise<ResolvedAddress[]>;

const blockedAddresses = new BlockList();

for (const [address, prefix, family] of [
    ['0.0.0.0', 8, 'ipv4'],
    ['10.0.0.0', 8, 'ipv4'],
    ['100.64.0.0', 10, 'ipv4'],
    ['127.0.0.0', 8, 'ipv4'],
    ['169.254.0.0', 16, 'ipv4'],
    ['172.16.0.0', 12, 'ipv4'],
    ['192.0.0.0', 24, 'ipv4'],
    ['192.0.2.0', 24, 'ipv4'],
    ['192.88.99.0', 24, 'ipv4'],
    ['192.168.0.0', 16, 'ipv4'],
    ['198.18.0.0', 15, 'ipv4'],
    ['198.51.100.0', 24, 'ipv4'],
    ['203.0.113.0', 24, 'ipv4'],
    ['224.0.0.0', 4, 'ipv4'],
    ['240.0.0.0', 4, 'ipv4'],
    ['::', 128, 'ipv6'],
    ['::1', 128, 'ipv6'],
    ['64:ff9b:1::', 48, 'ipv6'],
    ['100::', 64, 'ipv6'],
    ['2001::', 23, 'ipv6'],
    ['2002::', 16, 'ipv6'],
    ['fc00::', 7, 'ipv6'],
    ['fe80::', 10, 'ipv6'],
    ['ff00::', 8, 'ipv6'],
    ['2001:db8::', 32, 'ipv6'],
] as const) {
    blockedAddresses.addSubnet(address, prefix, family);
}

function normalizeAddress(address: string): { address: string; family: 'ipv4' | 'ipv6' } | null {
    const withoutZone = address.replace(/%.+$/, '').replace(/^\[|\]$/g, '');
    const mapped = withoutZone.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
    if (mapped) return { address: mapped[1], family: 'ipv4' };
    const family = isIP(withoutZone);
    if (family === 4) return { address: withoutZone, family: 'ipv4' };
    if (family === 6) return { address: withoutZone, family: 'ipv6' };
    return null;
}

export function isBlockedNetworkAddress(address: string): boolean {
    const normalized = normalizeAddress(address);
    return !normalized || blockedAddresses.check(normalized.address, normalized.family);
}

export function parseSafeHttpsUrl(urlString: string): URL {
    let parsed: URL;
    try {
        parsed = new URL(urlString);
    } catch {
        throw new Error('Invalid OpenAI STT base URL');
    }
    if (parsed.protocol !== 'https:') {
        throw new Error('OpenAI STT base URL must use HTTPS');
    }
    if (parsed.username || parsed.password) {
        throw new Error('OpenAI STT base URL must not contain credentials');
    }
    if (!parsed.hostname || parsed.hostname.toLowerCase() === 'localhost' || parsed.hostname.toLowerCase().endsWith('.localhost')) {
        throw new Error('OpenAI STT base URL targets a blocked host');
    }
    return parsed;
}

async function defaultLookup(hostname: string): Promise<ResolvedAddress[]> {
    return dns.lookup(hostname, { all: true, verbatim: true });
}

function assertResolvedAddresses(addresses: ResolvedAddress[]): void {
    if (addresses.length === 0 || addresses.some(({ address }) => isBlockedNetworkAddress(address))) {
        throw new Error('OpenAI STT base URL resolves to a blocked private or reserved address');
    }
}

export async function assertSafeHttpsUrl(urlString: string, lookup: DnsLookup = defaultLookup): Promise<URL> {
    const parsed = parseSafeHttpsUrl(urlString);
    const literal = normalizeAddress(parsed.hostname);
    const addresses = literal
        ? [{ address: literal.address, family: literal.family === 'ipv4' ? 4 : 6 }]
        : await lookup(parsed.hostname);
    assertResolvedAddresses(addresses);
    return parsed;
}

export function createSsrfSafeHttpsAgent(): https.Agent {
    const safeLookup = (hostname: string, _options: unknown, callback: (error: Error | null, address?: string, family?: number) => void): void => {
        defaultLookup(hostname)
            .then((addresses) => {
                assertResolvedAddresses(addresses);
                const selected = addresses[0];
                callback(null, selected.address, selected.family);
            })
            .catch((error) => callback(error instanceof Error ? error : new Error(String(error))));
    };
    return new https.Agent({ lookup: safeLookup as any });
}

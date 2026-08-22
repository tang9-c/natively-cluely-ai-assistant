import { randomBytes } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

export type FileAccessPurpose = 'chat-image' | 'profile-document';

interface FileAccessGrant {
    path: string;
    purpose: FileAccessPurpose;
    ownerWebContentsId: number;
    expiresAt: number;
    device: number;
    inode: number;
}

const DEFAULT_TTL_MS = 5 * 60_000;
const MAX_ACTIVE_GRANTS = 2_048;

export class FileAccessGrantStore {
    private readonly grants = new Map<string, FileAccessGrant>();

    issue(
        filePath: string,
        purpose: FileAccessPurpose,
        ownerWebContentsId: number,
        ttlMs = DEFAULT_TTL_MS,
    ): string {
        const now = Date.now();
        for (const [token, grant] of this.grants) {
            if (grant.expiresAt < now) this.grants.delete(token);
        }
        while (this.grants.size >= MAX_ACTIVE_GRANTS) {
            const oldestToken = this.grants.keys().next().value;
            if (!oldestToken) break;
            this.grants.delete(oldestToken);
        }

        const canonicalPath = fs.realpathSync(filePath);
        const stat = fs.lstatSync(canonicalPath);
        if (!stat.isFile()) {
            throw new Error('File grant target must be a regular file');
        }
        if (
            purpose === 'profile-document'
            && !['.pdf', '.docx', '.txt', '.md', '.markdown'].includes(path.extname(canonicalPath).toLowerCase())
        ) {
            throw new Error('Unsupported profile document type');
        }

        const token = randomBytes(32).toString('base64url');
        this.grants.set(token, {
            path: canonicalPath,
            purpose,
            ownerWebContentsId,
            expiresAt: now + Math.max(1, ttlMs),
            device: stat.dev,
            inode: stat.ino,
        });
        return token;
    }

    consume(token: string, purpose: FileAccessPurpose, ownerWebContentsId: number): string {
        const grant = typeof token === 'string' ? this.grants.get(token) : undefined;
        if (typeof token === 'string') this.grants.delete(token);

        if (!grant || grant.expiresAt < Date.now()) {
            throw new Error('Invalid or expired file grant');
        }
        if (grant.purpose !== purpose || grant.ownerWebContentsId !== ownerWebContentsId) {
            throw new Error('File grant is not valid for this request');
        }

        let currentPath: string;
        try {
            currentPath = fs.realpathSync(grant.path);
        } catch {
            throw new Error('File grant target is no longer available');
        }
        const stat = fs.lstatSync(currentPath);
        if (
            currentPath !== grant.path
            || !stat.isFile()
            || stat.dev !== grant.device
            || stat.ino !== grant.inode
        ) {
            throw new Error('File grant target changed');
        }
        return currentPath;
    }
}

let sharedStore: FileAccessGrantStore | null = null;

export function getFileAccessGrantStore(): FileAccessGrantStore {
    if (!sharedStore) sharedStore = new FileAccessGrantStore();
    return sharedStore;
}

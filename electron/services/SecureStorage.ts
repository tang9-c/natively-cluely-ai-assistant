import { app } from 'electron';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { loadNativeModule } from '../audio/nativeModuleLoader';

const MAGIC_HEADER = Buffer.from('NATIVELY:', 'utf8');
const FORMAT_VERSION = 0x02;
const IV_LENGTH = 16;
const TAG_LENGTH = 16;
const MASTER_KEY_FILE = 'master.key.enc';
const MASTER_HWID_FILE = 'master.hwid';
const DERIVATION_SALT = 'natively.v2.secure-storage.v1';

let initialized = false;
let userDataPath: string | null = null;
let deviceFingerprint: string | null = null;
let deviceKey: Buffer | null = null;
let masterKey: Buffer | null = null;
let nativePreloaded = false;
let deviceKeyLost = false;

// TODO: If we ever support cross-device credential migration, add an
// explicit recovery/export flow instead of stretching this device-bound design.

export function init(): void {
    if (initialized) return;

    userDataPath = app.getPath('userData');
    fs.mkdirSync(userDataPath, { recursive: true });

    if (!nativePreloaded) {
        nativePreloaded = true;
        loadNativeModuleForStorage();
    }

    deviceFingerprint = getDeviceFingerprint();
    deviceKey = crypto.pbkdf2Sync(deviceFingerprint, DERIVATION_SALT, 100_000, 32, 'sha256');

    ensureMasterKey();
    initialized = true;
}

export function encryptJSON<T>(filePath: string, value: T): void {
    init();
    const serialized = JSON.stringify(value);
    const blob = encryptBuffer(Buffer.from(serialized, 'utf8'), getMasterKeyOrThrow());
    atomicWrite(filePath, blob);
}

export function decryptJSON<T>(filePath: string): T | undefined {
    init();
    if (!fs.existsSync(filePath)) return undefined;

    const blob = fs.readFileSync(filePath);
    if (!hasCurrentHeader(blob)) {
        safeUnlink(filePath);
        return undefined;
    }

    try {
        const plaintext = decryptBuffer(blob, getMasterKeyOrThrow());
        return JSON.parse(plaintext.toString('utf8')) as T;
    } catch (error) {
        safeUnlink(filePath);
        handleKeyLoss(filePath, '[SecureStorage] secure_storage_key_lost');
        return undefined;
    }
}

export function getDeviceKeyLost(): boolean {
    return deviceKeyLost;
}

function ensureMasterKey(): void {
    const currentUserData = getUserDataPathOrThrow();
    const masterKeyPath = path.join(currentUserData, MASTER_KEY_FILE);
    const masterHwidPath = path.join(currentUserData, MASTER_HWID_FILE);
    const currentHwid = getHardwareMarker();

    if (fs.existsSync(masterHwidPath)) {
        const storedHwid = fs.readFileSync(masterHwidPath, 'utf8').trim();
        if (storedHwid && storedHwid !== currentHwid) {
            handleKeyLoss(path.join(currentUserData, 'credentials.enc'), '[SecureStorage] secure_storage_key_lost');
        }
    }

    if (fs.existsSync(masterKeyPath)) {
        const wrapped = fs.readFileSync(masterKeyPath);
        if (!hasCurrentHeader(wrapped)) {
            handleKeyLoss(path.join(currentUserData, 'credentials.enc'), '[SecureStorage] secure_storage_key_lost');
        } else {
            try {
                masterKey = decryptBuffer(wrapped, getDeviceKeyOrThrow());
                atomicWrite(masterHwidPath, Buffer.from(currentHwid, 'utf8'));
                return;
            } catch {
                handleKeyLoss(path.join(currentUserData, 'credentials.enc'), '[SecureStorage] secure_storage_key_lost');
            }
        }
    }

    masterKey = crypto.randomBytes(32);
    atomicWrite(masterKeyPath, encryptBuffer(masterKey, getDeviceKeyOrThrow()));
    atomicWrite(masterHwidPath, Buffer.from(currentHwid, 'utf8'));
}

function getDeviceFingerprint(): string {
    try {
        const native = loadNativeModuleForStorage();
        const hardwareId = native?.getHardwareId?.();
        if (typeof hardwareId === 'string' && hardwareId.trim().length > 0) {
            return hardwareId.trim();
        }
    } catch {
        // Fall back to a software-derived fingerprint below.
    }

    return `${os.hostname()}|${os.platform()}|${os.arch()}`;
}

function loadNativeModuleForStorage() {
    const override = (globalThis as typeof globalThis & {
        __NATIVELY_SECURE_STORAGE_LOAD_NATIVE_MODULE__?: typeof loadNativeModule;
    }).__NATIVELY_SECURE_STORAGE_LOAD_NATIVE_MODULE__;
    return typeof override === 'function' ? override() : loadNativeModule();
}

function getPlatformForStorage(): NodeJS.Platform {
    const override = (globalThis as typeof globalThis & {
        __NATIVELY_SECURE_STORAGE_PLATFORM__?: NodeJS.Platform;
    }).__NATIVELY_SECURE_STORAGE_PLATFORM__;
    return override || process.platform;
}

function getHardwareMarker(): string {
    return (deviceFingerprint || getDeviceFingerprint()).slice(0, 16);
}

function encryptBuffer(plaintext: Buffer, key: Buffer): Buffer {
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([MAGIC_HEADER, Buffer.from([FORMAT_VERSION]), iv, tag, ciphertext]);
}

function decryptBuffer(blob: Buffer, key: Buffer): Buffer {
    if (!hasCurrentHeader(blob)) {
        throw new Error('legacy_blob');
    }

    const offset = MAGIC_HEADER.length + 1;
    const iv = blob.subarray(offset, offset + IV_LENGTH);
    const tagStart = offset + IV_LENGTH;
    const tag = blob.subarray(tagStart, tagStart + TAG_LENGTH);
    const ciphertext = blob.subarray(tagStart + TAG_LENGTH);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

function hasCurrentHeader(blob: Buffer): boolean {
    if (blob.length < MAGIC_HEADER.length + 1) return false;
    return blob.subarray(0, MAGIC_HEADER.length).equals(MAGIC_HEADER)
        && blob[MAGIC_HEADER.length] === FORMAT_VERSION;
}

function atomicWrite(filePath: string, data: Buffer): void {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const tmpPath = `${filePath}.tmp`;
    fs.writeFileSync(tmpPath, data, { mode: 0o600 });
    const fd = fs.openSync(tmpPath, 'r+');
    try {
        fs.fsyncSync(fd);
    } finally {
        fs.closeSync(fd);
    }
    renameWithReplaceFallback(tmpPath, filePath);
    fs.chmodSync(filePath, 0o600);
}

function renameWithReplaceFallback(tmpPath: string, filePath: string): void {
    try {
        fs.renameSync(tmpPath, filePath);
        return;
    } catch (error) {
        if (!shouldRetryRenameOnWindows(error, filePath)) {
            safeUnlink(tmpPath);
            throw error;
        }
    }

    safeUnlink(filePath);
    try {
        fs.renameSync(tmpPath, filePath);
    } catch (error) {
        safeUnlink(tmpPath);
        throw error;
    }
}

function shouldRetryRenameOnWindows(error: unknown, filePath: string): boolean {
    if (getPlatformForStorage() !== 'win32') return false;
    if (!fs.existsSync(filePath)) return false;
    const code = (error as NodeJS.ErrnoException | undefined)?.code;
    return code === 'EEXIST' || code === 'EPERM' || code === 'EBUSY';
}

function handleKeyLoss(credentialsPath: string, logMessage: string): void {
    deviceKeyLost = true;
    masterKey = null;
    initialized = false;

    const currentUserData = getUserDataPathOrThrow();
    safeUnlink(path.join(currentUserData, MASTER_KEY_FILE));
    safeUnlink(path.join(currentUserData, MASTER_HWID_FILE));
    safeUnlink(credentialsPath);
    console.warn(logMessage);
}

function safeUnlink(filePath: string): void {
    try {
        fs.unlinkSync(filePath);
    } catch {
        // Best-effort cleanup.
    }
}

function getUserDataPathOrThrow(): string {
    if (!userDataPath) {
        throw new Error('SecureStorage.init() must be called before use');
    }
    return userDataPath;
}

function getDeviceKeyOrThrow(): Buffer {
    if (!deviceKey) {
        throw new Error('SecureStorage device key unavailable');
    }
    return deviceKey;
}

function getMasterKeyOrThrow(): Buffer {
    if (!masterKey) {
        throw new Error('SecureStorage master key unavailable');
    }
    return masterKey;
}

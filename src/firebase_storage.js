// =============================================
// Firebase Storage Manager (OPTIONAL)
// Handles temporary cloud storage for rendered clips
// Gracefully degrades if firebase-admin not installed
// =============================================

import fs from 'fs';
import path from 'path';

let admin = null;
let bucket = null;
let firebaseAvailable = false;

// Detect if firebase-admin is available by checking node_modules
function checkFirebaseAvailable() {
  try {
    const packagePath = new URL.resolve(import.meta.url, '../../node_modules/firebase-admin/package.json');
    return fs.existsSync(packagePath);
  } catch {
    return false;
  }
}

firebaseAvailable = checkFirebaseAvailable();

if (!firebaseAvailable) {
  console.log('[Firebase] firebase-admin not installed - cloud storage disabled');
  console.log('[Firebase] Install with: npm install firebase-admin');
}

/**
 * Initialize Firebase Admin SDK
 * Returns bucket or null if firebase-admin not installed
 */
export function initializeFirebase() {
  try {
    if (!firebaseAvailable) {
      return null;
    }

    // Only import if available
    if (!admin) {
      throw new Error('firebase-admin not available');
    }

    // Check if already initialized
    if (admin.apps && admin.apps.length > 0) {
      bucket = admin.storage().bucket();
      return bucket;
    }

    const bucketName = process.env.FIREBASE_BUCKET;
    if (!bucketName) {
      console.log('[Firebase] FIREBASE_BUCKET not set - cloud storage disabled');
      return null;
    }

    // Initialize Firebase Admin SDK
    admin.initializeApp({
      credential: admin.credential.applicationDefault(),
      storageBucket: bucketName,
    });

    bucket = admin.storage().bucket();
    console.log('[Firebase] ✅ Cloud storage enabled');
    return bucket;
  } catch (err) {
    console.warn('[Firebase] Init failed:', err.message);
    return null;
  }
}

/**
 * Upload a file to cloud storage with TTL
 * Throws error if Firebase not available (caller handles fallback)
 */
export async function uploadClipToCloud(localFilePath, fileName, ttlMinutes = 30) {
  if (!bucket || !firebaseAvailable) {
    throw new Error('Firebase storage not available - use local storage');
  }

  if (!fs.existsSync(localFilePath)) {
    throw new Error(`File not found: ${localFilePath}`);
  }

  try {
    const uploadDate = new Date().toISOString().split('T')[0];
    const destination = `temp-clips/${uploadDate}/${Date.now()}/${fileName}`;

    const ttlSeconds = ttlMinutes * 60;
    await bucket.upload(localFilePath, {
      destination,
      metadata: {
        cacheControl: `public, max-age=${ttlSeconds}`,
        metadata: {
          uploadedAt: new Date().toISOString(),
          ttlMinutes: String(ttlMinutes),
        },
      },
    });

    const file = bucket.file(destination);
    const [signedUrl] = await file.getSignedUrl({
      version: 'v4',
      action: 'read',
      expires: Date.now() + ttlSeconds * 1000,
    });

    return {
      url: signedUrl,
      cloudPath: destination,
      expiresAt: new Date(Date.now() + ttlSeconds * 1000).toISOString(),
    };
  } catch (err) {
    console.error('[Firebase] Upload failed:', err.message);
    throw err;
  }
}

/**
 * Download file from cloud storage
 */
export async function downloadClipFromCloud(cloudPath, outputPath) {
  if (!bucket || !firebaseAvailable) {
    throw new Error('Firebase storage not available');
  }

  try {
    await bucket.file(cloudPath).download({ destination: outputPath });
    return outputPath;
  } catch (err) {
    console.error('[Firebase] Download failed:', err.message);
    throw err;
  }
}

/**
 * Clean up expired clips (runs periodically)
 */
export async function cleanupExpiredClips(maxAgeMinutes = 60) {
  if (!bucket || !firebaseAvailable) {
    return; // Firebase not available, skip
  }

  try {
    const maxAgeMs = maxAgeMinutes * 60 * 1000;
    const now = Date.now();
    let deletedCount = 0;

    const [files] = await bucket.getFiles({ prefix: 'temp-clips/' });

    for (const file of files) {
      const metadata = await file.getMetadata();
      const uploadedAt = new Date(metadata[0].metadata?.metadata?.uploadedAt || 0);
      const age = now - uploadedAt.getTime();

      if (age > maxAgeMs) {
        await file.delete();
        deletedCount++;
      }
    }

    if (deletedCount > 0) {
      console.log(`[Firebase] ✅ Cleaned ${deletedCount} expired clips`);
    }
  } catch (err) {
    console.warn('[Firebase] Cleanup failed:', err.message);
  }
}

/**
 * Get signed URL for existing cloud file
 */
export async function getSignedUrl(cloudPath, expiresInMinutes = 30) {
  if (!bucket || !firebaseAvailable) {
    throw new Error('Firebase storage not available');
  }

  try {
    const file = bucket.file(cloudPath);
    const [signedUrl] = await file.getSignedUrl({
      version: 'v4',
      action: 'read',
      expires: Date.now() + expiresInMinutes * 60 * 1000,
    });

    return signedUrl;
  } catch (err) {
    console.error('[Firebase] Failed to get signed URL:', err.message);
    throw err;
  }
}

/**
 * Get file metadata
 */
export async function getFileMetadata(cloudPath) {
  if (!bucket || !firebaseAvailable) {
    throw new Error('Firebase storage not available');
  }

  try {
    const [metadata] = await bucket.file(cloudPath).getMetadata();
    return metadata;
  } catch (err) {
    console.error('[Firebase] Failed to get metadata:', err.message);
    throw err;
  }
}

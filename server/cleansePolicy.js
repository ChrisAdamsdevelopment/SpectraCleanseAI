"use strict";

/**
 * Shared cleanse policy source of truth for backend validation and frontend messaging.
 * Keep this aligned with actual implementation safety guarantees.
 */
const CLEANSE_POLICY = {
  quick: {
    supportedExtensions: ['.mp3'],
    recommendedExtensions: ['.mp3'],
  },
  server: {
    // Server wipe/rewrite is intentionally restricted to formats with stable behavior.
    supportedExtensions: ['.mp4', '.m4a'],
    recommendedExtensions: ['.mp4', '.m4a'],
  },
};

function normalizeExt(filename = '') {
  const dot = filename.lastIndexOf('.');
  return dot >= 0 ? filename.slice(dot).toLowerCase() : '';
}

function isServerSupportedFormat(filename = '', mime = '') {
  const ext = normalizeExt(filename);
  const safeMime = String(mime || '').toLowerCase();
  if (CLEANSE_POLICY.server.supportedExtensions.includes(ext)) return true;
  // Common upload MIME aliases for supported server formats.
  return safeMime === 'video/mp4' || safeMime === 'audio/mp4' || safeMime === 'audio/x-m4a';
}

module.exports = { CLEANSE_POLICY, normalizeExt, isServerSupportedFormat };

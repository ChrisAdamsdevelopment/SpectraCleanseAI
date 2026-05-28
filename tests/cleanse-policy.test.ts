import { describe, it, expect } from 'vitest';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { CLEANSE_POLICY, normalizeExt, isServerSupportedFormat } = require('../server/cleansePolicy');

describe('cleansePolicy', () => {
  it('exposes MP3 only for Quick Cleanse and MP4/M4A only for Full Server Cleanse', () => {
    expect(CLEANSE_POLICY.quick.supportedExtensions).toEqual(['.mp3']);
    expect(CLEANSE_POLICY.server.supportedExtensions).toEqual(['.mp4', '.m4a']);
  });

  it('normalizeExt lowercases and returns leading dot', () => {
    expect(normalizeExt('Song.MP4')).toBe('.mp4');
    expect(normalizeExt('song.m4a')).toBe('.m4a');
    expect(normalizeExt('song')).toBe('');
    expect(normalizeExt('')).toBe('');
  });

  it('isServerSupportedFormat accepts MP4/M4A by extension', () => {
    expect(isServerSupportedFormat('a.mp4', 'video/mp4')).toBe(true);
    expect(isServerSupportedFormat('a.m4a', 'audio/m4a')).toBe(true);
    expect(isServerSupportedFormat('a.M4A', 'audio/x-m4a')).toBe(true);
  });

  it('isServerSupportedFormat accepts common MIME aliases even with missing extension', () => {
    expect(isServerSupportedFormat('blob', 'video/mp4')).toBe(true);
    expect(isServerSupportedFormat('blob', 'audio/mp4')).toBe(true);
    expect(isServerSupportedFormat('blob', 'audio/x-m4a')).toBe(true);
  });

  it('isServerSupportedFormat rejects MP3 (it goes to Quick Cleanse)', () => {
    expect(isServerSupportedFormat('song.mp3', 'audio/mpeg')).toBe(false);
  });

  it('isServerSupportedFormat rejects WAV/FLAC/EXE', () => {
    expect(isServerSupportedFormat('song.wav', 'audio/wav')).toBe(false);
    expect(isServerSupportedFormat('song.flac', 'audio/flac')).toBe(false);
    expect(isServerSupportedFormat('payload.exe', 'application/octet-stream')).toBe(false);
  });
});

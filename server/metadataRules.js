"use strict";

const MARKER_RULES = [
  { id: 'c2pa-jumbf', category: 'AI Provenance', severity: 'critical', patterns: [/jumbf/i, /c2pa/i, /manifest/i, /assertion/i] },
  { id: 'xmp-creator-tool', category: 'XMP Origin', severity: 'high', patterns: [/CreatorTool/i, /DerivedFrom/i, /MetadataDate/i, /HistoryAction/i] },
  { id: 'iptc-synthetic', category: 'Synthetic Media Flag', severity: 'high', patterns: [/DigitalSourceType/i, /trainedAlgorithmicMedia/i] },
  { id: 'ai-brand', category: 'AI Brand Residue', severity: 'high', valueOnly: true, patterns: [/\bSuno\b/i, /\bUdio\b/i, /\bRunway\b/i, /\bLuma\b/i, /\bPika\b/i, /\bSora\b/i, /\bMidjourney\b/i, /\bDALL-E\b/i, /\bOpenAI\b/i, /\bChatGPT\b/i, /\bElevenLabs\b/i, /\bStable Diffusion\b/i, /\bAIVA\b/i, /\bMubert\b/i] },
  { id: 'encoder-software', category: 'Encoder / Software Residue', severity: 'medium', patterns: [/WrittenBy/i, /EncoderSettings/i] },
  { id: 'id3-provenance', category: 'ID3 Provenance Frames', severity: 'medium', patterns: [/^TSSE$/i, /^TXXX$/i] },
  { id: 'xmp-history', category: 'XMP Edit History', severity: 'medium', patterns: [/XMP\.History/i, /HistorySoftwareAgent/i, /HistoryChanged/i] },
];

const BENIGN_TAG_PATTERNS = [
  /^SourceFile$/i, /^ExifToolVersion$/i, /^FileSize$/i, /^FileType$/i, /^FileTypeExtension$/i, /^MIMEType$/i,
  /^FileAccessDate$/i, /^FileModifyDate$/i, /^FileInodeChangeDate$/i, /^errors$/i, /^warnings$/i,
  /^Duration$/i, /^BitRate$/i, /^AvgBitrate$/i, /^MaxBitrate$/i, /^SampleRate$/i, /^AudioSampleRate$/i,
  /^AudioChannels$/i, /^BitsPerSample$/i, /^AudioBitrate$/i, /^Balance$/i, /^EncoderDelay$/i, /^ZeroPadding$/i,
  /^VideoFrameRate$/i, /^ImageWidth$/i, /^ImageHeight$/i, /^MajorBrand$/i, /^MinorVersion$/i,
  /^CompatibleBrands$/i, /^MovieHeaderVersion$/i, /^TrackHeaderVersion$/i, /^MediaHeaderVersion$/i,
  /^CreateDate$/i, /^ModifyDate$/i, /^TrackCreateDate$/i, /^TrackModifyDate$/i, /^MediaCreateDate$/i,
  /^MediaModifyDate$/i, /^TrackDuration$/i, /^MediaDuration$/i, /^HandlerType$/i, /^HandlerDescription$/i,
  /^CompressorID$/i, /^MatrixStructure$/i, /^XResolution$/i, /^YResolution$/i,
];

const ALLOWED_INJECTED_TAGS = new Set(['Title', 'Artist', 'Copyright', 'Keywords', 'Genre', 'Description', 'Comment', 'Album', 'Year', 'Lyrics-eng']);

function isBenign(tagName) {
  return BENIGN_TAG_PATTERNS.some((p) => p.test(String(tagName || '')));
}

function isAllowedInjected(tagName) {
  return ALLOWED_INJECTED_TAGS.has(String(tagName || ''));
}

module.exports = { MARKER_RULES, ALLOWED_INJECTED_TAGS, isBenign, isAllowedInjected };

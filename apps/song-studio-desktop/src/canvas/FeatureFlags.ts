export const CANVAS_LOOP_FEATURE_FLAGS = {
  localMvp: false,
  reports: false,
  aiProviders: false,
  geminiVeo: false,
  paidRequests: false,
} as const;

export const ENABLE_CANVAS_LOOP_ENGINE = CANVAS_LOOP_FEATURE_FLAGS.localMvp;

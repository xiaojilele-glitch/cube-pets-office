const IGNORED_PATTERNS = [
  /Warning: Parameter not found: language_model_ngram_on/,
  /Warning: Parameter not found: segsearch_max_char_wh_ratio/,
  /Warning: Parameter not found: language_model_ngram_space_delimited_language/,
  /Warning: Parameter not found: language_model_use_sigmoidal_certainty/,
  /Warning: Parameter not found: language_model_ngram_nonmatch_score/,
  /Warning: Parameter not found: classify_integer_matcher_multiplier/,
  /Warning: Parameter not found: assume_fixed_pitch_char_segment/,
  /Warning: Parameter not found: allow_blob_division/,
  /Estimating resolution as \d+/,
];

const originalConsoleLog = console.log.bind(console);
const originalConsoleError = console.error.bind(console);

function shouldIgnore(args) {
  const message = args
    .map(arg => (typeof arg === "string" ? arg : ""))
    .join(" ");

  return IGNORED_PATTERNS.some(pattern => pattern.test(message));
}

console.log = (...args) => {
  if (shouldIgnore(args)) {
    return;
  }

  originalConsoleLog(...args);
};

console.error = (...args) => {
  if (shouldIgnore(args)) {
    return;
  }

  originalConsoleError(...args);
};

importScripts(
  "https://cdn.jsdelivr.net/npm/tesseract.js@v7.0.0/dist/worker.min.js"
);

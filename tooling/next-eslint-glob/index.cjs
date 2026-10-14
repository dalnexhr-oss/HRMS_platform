const { globSync } = require('tinyglobby');

// The Next.js plugin only uses globSync for root directories. fast-glob does not
// expand literal directories recursively, while tinyglobby does by default.
exports.globSync = (patterns, options) =>
  globSync(patterns, { ...options, expandDirectories: false });

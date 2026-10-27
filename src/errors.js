'use strict';

/** Application error carrying an HTTP status and a stable machine-readable code. */
class AppError extends Error {
  /**
   * @param {number} status
   * @param {string} code
   * @param {string} message
   * @param {{ cause?: unknown, details?: unknown }} [options]
   */
  constructor(status, code, message, options = {}) {
    super(message, { cause: options.cause });
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = options.details;
  }
}

module.exports = { AppError };

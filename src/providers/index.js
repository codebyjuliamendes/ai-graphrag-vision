'use strict';

const { createDemoProvider } = require('./demoProvider');
const { createAnthropicProvider } = require('./anthropicProvider');

/**
 * @param {{ llmProvider: 'demo' | 'anthropic', anthropicModel: string, llmTimeoutMs: number }} config
 * @returns {import('./types').LlmProvider}
 */
function createProvider(config) {
  if (config.llmProvider === 'anthropic') {
    return createAnthropicProvider({ model: config.anthropicModel, timeoutMs: config.llmTimeoutMs });
  }
  return createDemoProvider();
}

module.exports = { createProvider };

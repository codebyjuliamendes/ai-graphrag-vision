/**
 * @fileoverview MockLLMAdapter acts as a simulated service layer for GraphRAG extraction and querying.
 * Follows clean architecture principles with rigorous validation and JSDoc typings.
 */

class MockLLMAdapter {
  /**
   * Initializes the MockLLMAdapter.
   */
  constructor() {
    /** @type {number} */
    this.simulatedDelay = 1500;
  }

  /**
   * Extracts entities and relationships from a document to build a knowledge graph.
   * @returns {Promise<{nodes: Array<Object>, edges: Array<Object>}>} A promise resolving to the graph structure.
   * @throws {Error} If extraction fails.
   */
  async extractEntities() {
    return new Promise((resolve, reject) => {
      setTimeout(() => {
        try {
          const graphData = {
            nodes: [
              { data: { id: 'NexCorp', label: 'NexCorp (Company)', type: 'company' } },
              { data: { id: 'OmniTech', label: 'OmniTech (Company)', type: 'company' } },
              { data: { id: 'JaneDoe', label: 'Jane Doe (CEO)', type: 'person' } },
              { data: { id: 'Q3Profits', label: 'Q3 Profits ($500M)', type: 'metric' } },
              { data: { id: 'AIPlatform', label: 'AI Platform', type: 'product' } },
              { data: { id: 'MarketShare', label: 'Market Share (+15%)', type: 'metric' } }
            ],
            edges: [
              { data: { source: 'NexCorp', target: 'OmniTech', label: 'ACQUIRED' } },
              { data: { source: 'JaneDoe', target: 'NexCorp', label: 'CEO_OF' } },
              { data: { source: 'JaneDoe', target: 'Q3Profits', label: 'ANNOUNCED' } },
              { data: { source: 'OmniTech', target: 'AIPlatform', label: 'DEVELOPED' } },
              { data: { source: 'AIPlatform', target: 'Q3Profits', label: 'DROVE_GROWTH_IN' } },
              { data: { source: 'NexCorp', target: 'MarketShare', label: 'INCREASED' } },
              { data: { source: 'OmniTech', target: 'MarketShare', label: 'CONTRIBUTED_TO' } }
            ]
          };
          resolve(graphData);
        } catch (error) {
          reject(new Error(`Failed to extract entities: ${error.message}`));
        }
      }, this.simulatedDelay);
    });
  }

  /**
   * Processes a natural language query against the knowledge graph.
   * @param {string} query - The natural language query from the user.
   * @returns {Promise<{answer: string, highlightedNodes: Array<string>}>} The synthesized answer and relevant nodes.
   * @throws {Error} If query is invalid or processing fails.
   */
  async processQuery(query) {
    if (!query || typeof query !== 'string' || query.trim() === '') {
      throw new Error('Invalid query: Query must be a non-empty string.');
    }

    return new Promise((resolve, reject) => {
      setTimeout(() => {
        try {
          let answer = "Based on the financial report, I couldn't find a specific answer.";
          let highlightedNodes = [];
          const normalizedQuery = query.toLowerCase();

          if (normalizedQuery.includes("company y") || normalizedQuery.includes("omnitech") || normalizedQuery.includes("profits")) {
            answer = "The acquisition of OmniTech (Company Y) directly impacted Q3 profits. OmniTech developed an advanced AI Platform, which NexCorp leveraged after the acquisition. This AI Platform was a key driver of growth, leading Jane Doe (CEO) to announce $500M in Q3 Profits and a 15% increase in market share.";
            highlightedNodes = ['NexCorp', 'OmniTech', 'JaneDoe', 'Q3Profits', 'AIPlatform'];
          } else if (normalizedQuery.includes("market share")) {
            answer = "NexCorp saw a 15% increase in market share. This was heavily contributed to by the acquisition of OmniTech and their technologies.";
            highlightedNodes = ['NexCorp', 'OmniTech', 'MarketShare'];
          }

          resolve({
            answer,
            highlightedNodes
          });
        } catch (error) {
          reject(new Error(`Failed to process query: ${error.message}`));
        }
      }, this.simulatedDelay * 1.5);
    });
  }
}

module.exports = MockLLMAdapter;

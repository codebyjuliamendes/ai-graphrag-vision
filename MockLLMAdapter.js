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
    
    /** @type {number} */
    this.contextChunkLimit = 50; // Context chunking limit (e.g., max 50 tokens/nodes)
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
              { data: { id: 'NexCorp', label: 'NexCorp (Company)', type: 'company', valid_from: 2022, valid_until: 2025, zoomLevel: 0.5 }, position: { x: 300, y: 300 } },
              { data: { id: 'OmniTech', label: 'OmniTech (Company)', type: 'company', valid_from: 2020, valid_until: 2023, zoomLevel: 0.5 }, position: { x: 600, y: 300 } },
              { data: { id: 'JaneDoe', label: 'Jane Doe (CEO)', type: 'person', valid_from: 2023, valid_until: 2025, zoomLevel: 1.0 }, position: { x: 300, y: 150 } },
              { data: { id: 'Q3Profits', label: 'Q3 Profits ($500M)', type: 'metric', valid_from: 2023, valid_until: 2024, zoomLevel: 1.5 }, position: { x: 450, y: 450 } },
              { data: { id: 'AIPlatform', label: 'AI Platform', type: 'product', valid_from: 2021, valid_until: 2025, zoomLevel: 1.0 }, position: { x: 600, y: 450 } },
              { data: { id: 'MarketShare', label: 'Market Share (+15%)', type: 'metric', valid_from: 2024, valid_until: 2025, zoomLevel: 1.5 }, position: { x: 450, y: 150 } }
            ],
            edges: [
              { data: { source: 'NexCorp', target: 'OmniTech', label: 'ACQUIRED', valid_from: 2023, valid_until: 2025 } },
              { data: { source: 'JaneDoe', target: 'NexCorp', label: 'CEO_OF', valid_from: 2023, valid_until: 2025 } },
              { data: { source: 'JaneDoe', target: 'Q3Profits', label: 'ANNOUNCED', valid_from: 2023, valid_until: 2024 } },
              { data: { source: 'OmniTech', target: 'AIPlatform', label: 'DEVELOPED', valid_from: 2021, valid_until: 2023 } },
              { data: { source: 'AIPlatform', target: 'Q3Profits', label: 'DROVE_GROWTH_IN', valid_from: 2023, valid_until: 2024 } },
              { data: { source: 'NexCorp', target: 'MarketShare', label: 'INCREASED', valid_from: 2024, valid_until: 2025 } },
              { data: { source: 'OmniTech', target: 'MarketShare', label: 'CONTRIBUTED_TO', valid_from: 2024, valid_until: 2025 } }
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
   * Includes context chunking limit handling.
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
          
          // Context chunking limit logic
          if (highlightedNodes.length > this.contextChunkLimit) {
            highlightedNodes = highlightedNodes.slice(0, this.contextChunkLimit);
            answer += " (Note: Answer truncated due to context chunking limits.)";
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

class MockLLMAdapter {
  constructor() {
    this.simulatedDelay = 1500;
  }

  async extractEntities() {
    return new Promise((resolve) => {
      setTimeout(() => {
        resolve({
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
        });
      }, this.simulatedDelay);
    });
  }

  async processQuery(query) {
    return new Promise((resolve) => {
      setTimeout(() => {
        let answer = "Based on the financial report, I couldn't find a specific answer.";
        let highlightedNodes = [];

        if (query.toLowerCase().includes("company y") || query.toLowerCase().includes("omnitech") || query.toLowerCase().includes("profits")) {
            answer = "The acquisition of OmniTech (Company Y) directly impacted Q3 profits. OmniTech developed an advanced AI Platform, which NexCorp leveraged after the acquisition. This AI Platform was a key driver of growth, leading Jane Doe (CEO) to announce $500M in Q3 Profits and a 15% increase in market share.";
            highlightedNodes = ['NexCorp', 'OmniTech', 'JaneDoe', 'Q3Profits', 'AIPlatform'];
        } else if (query.toLowerCase().includes("market share")) {
            answer = "NexCorp saw a 15% increase in market share. This was heavily contributed to by the acquisition of OmniTech and their technologies.";
            highlightedNodes = ['NexCorp', 'OmniTech', 'MarketShare'];
        }

        resolve({
          answer,
          highlightedNodes
        });
      }, this.simulatedDelay * 1.5);
    });
  }
}

module.exports = MockLLMAdapter;

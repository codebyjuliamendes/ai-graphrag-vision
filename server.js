const express = require('express');
const path = require('path');
const MockLLMAdapter = require('./MockLLMAdapter');

const app = express();
const port = process.env.PORT || 4001;
const llm = new MockLLMAdapter();

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.post('/api/process-document', async (req, res) => {
    try {
        // Simulate document processing delay
        const graphData = await llm.extractEntities();
        res.json({ success: true, graph: graphData });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/api/query', async (req, res) => {
    try {
        const { query } = req.body;
        const result = await llm.processQuery(query);
        res.json({ success: true, data: result });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.listen(port, () => {
    console.log(`Multimodal GraphRAG server running at http://localhost:${port}`);
});

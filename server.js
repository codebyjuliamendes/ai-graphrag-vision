/**
 * @fileoverview Express Server with Clean Architecture and strict error handling.
 */

const express = require('express');
const path = require('path');
const helmet = require('helmet');
const cors = require('cors');
const compression = require('compression');
const MockLLMAdapter = require('./MockLLMAdapter');

const app = express();
const port = process.env.PORT || 4001;
const llmService = new MockLLMAdapter();

app.use(helmet());
app.use(cors());
app.use(compression());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

/**
 * Validates the presence and type of query in request body.
 */
const validateQuery = (req, res, next) => {
    const { query } = req.body;
    if (!query || typeof query !== 'string' || query.trim() === '') {
        return res.status(400).json({
            success: false,
            error: 'Bad Request: "query" must be a non-empty string.'
        });
    }
    next();
};

/**
 * Route: Process Document
 * Triggers graph extraction from document
 */
app.post('/api/process-document', async (req, res, next) => {
    try {
        const graphData = await llmService.extractEntities();
        res.json({ success: true, graph: graphData });
    } catch (error) {
        next(error);
    }
});

/**
 * Route: Query Graph
 * Queries the knowledge graph using natural language
 */
app.post('/api/query', validateQuery, async (req, res, next) => {
    try {
        const { query } = req.body;
        const result = await llmService.processQuery(query);
        res.json({ success: true, data: result });
    } catch (error) {
        next(error);
    }
});

/**
 * Global Error Handling Middleware
 */
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
    console.error(`[Error] ${err.message}`, err.stack);
    res.status(err.status || 500).json({
        success: false,
        error: process.env.NODE_ENV === 'production' ? 'Internal Server Error' : err.message
    });
});

app.listen(port, () => {
    console.log(`[Server] Multimodal GraphRAG running at http://localhost:${port}`);
});

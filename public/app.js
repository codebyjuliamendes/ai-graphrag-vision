let cy;

document.addEventListener('DOMContentLoaded', () => {
    initCytoscape();

    const btnProcess = document.getElementById('btn-process');
    const statusText = document.getElementById('extraction-status');
    const chatSection = document.getElementById('chat-section');
    
    btnProcess.addEventListener('click', async () => {
        // UI updates for processing state
        btnProcess.querySelector('.btn-text').classList.add('hidden');
        btnProcess.querySelector('.loader').classList.remove('hidden');
        btnProcess.disabled = true;
        statusText.classList.remove('hidden');

        try {
            const response = await fetch('/api/process-document', { method: 'POST' });
            const data = await response.json();

            if (data.success) {
                // Load elements into graph
                cy.elements().remove();
                cy.add(data.graph.nodes);
                cy.add(data.graph.edges);
                
                // Run layout
                cy.layout({
                    name: 'cose',
                    animate: true,
                    animationDuration: 1000,
                    padding: 50,
                    nodeRepulsion: 400000,
                    idealEdgeLength: 100
                }).run();

                // Update UI to Chat Mode
                statusText.classList.add('hidden');
                btnProcess.parentElement.classList.add('hidden');
                chatSection.classList.remove('hidden');
                
                document.getElementById('chat-input').disabled = false;
                document.getElementById('btn-send').disabled = false;
                
                addChatMessage('ai', 'Graph constructed successfully. What would you like to know about the document?');
            }
        } catch (error) {
            console.error("Error processing document:", error);
            statusText.textContent = "Error processing document.";
            statusText.style.color = "#ef4444";
        }
    });

    const chatInput = document.getElementById('chat-input');
    const btnSend = document.getElementById('btn-send');

    const handleSend = async () => {
        const query = chatInput.value.trim();
        if (!query) return;

        addChatMessage('user', query);
        chatInput.value = '';
        chatInput.disabled = true;
        btnSend.disabled = true;

        const reasoningOverlay = document.getElementById('reasoning-overlay');
        const reasoningText = document.getElementById('reasoning-text');
        
        reasoningOverlay.classList.remove('hidden');
        reasoningText.textContent = "Traversing knowledge graph...";

        // Reset highlights
        cy.elements().removeClass('highlighted');

        try {
            const response = await fetch('/api/query', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ query })
            });
            const data = await response.json();

            if (data.success) {
                const { answer, highlightedNodes } = data.data;

                // Highlight nodes
                if (highlightedNodes && highlightedNodes.length > 0) {
                    reasoningText.textContent = `Found paths between: ${highlightedNodes.join(', ')}`;
                    
                    highlightedNodes.forEach((nodeId, index) => {
                        setTimeout(() => {
                            cy.$id(nodeId).addClass('highlighted');
                            // Highlight connected edges if target is also highlighted
                            cy.$id(nodeId).connectedEdges().forEach(edge => {
                                if (highlightedNodes.includes(edge.source().id()) && highlightedNodes.includes(edge.target().id())) {
                                    edge.addClass('highlighted');
                                }
                            });
                        }, index * 400); // Stagger animation
                    });
                } else {
                    reasoningText.textContent = "No relevant subgraphs found.";
                }

                setTimeout(() => {
                    addChatMessage('ai', answer);
                    chatInput.disabled = false;
                    btnSend.disabled = false;
                    chatInput.focus();
                    setTimeout(() => reasoningOverlay.classList.add('hidden'), 3000);
                }, highlightedNodes.length * 400 + 500);

            }
        } catch (error) {
            console.error("Query error:", error);
            addChatMessage('ai', 'Sorry, I encountered an error.');
            chatInput.disabled = false;
            btnSend.disabled = false;
            reasoningOverlay.classList.add('hidden');
        }
    };

    btnSend.addEventListener('click', handleSend);
    chatInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') handleSend();
    });
});

function initCytoscape() {
    cy = cytoscape({
        container: document.getElementById('cy'),
        style: [
            {
                selector: 'node',
                style: {
                    'label': 'data(label)',
                    'color': '#fff',
                    'text-valign': 'bottom',
                    'text-halign': 'center',
                    'text-margin-y': 8,
                    'font-family': 'Inter, sans-serif',
                    'font-size': '12px',
                    'width': 40,
                    'height': 40,
                    'border-width': 2,
                    'border-color': 'rgba(255,255,255,0.1)',
                    'transition-property': 'background-color, border-color, width, height',
                    'transition-duration': '0.3s'
                }
            },
            {
                selector: 'node[type="company"]',
                style: { 'background-color': '#3b82f6', 'shadow-color': '#3b82f6', 'shadow-blur': 15, 'shadow-opacity': 0.6 }
            },
            {
                selector: 'node[type="person"]',
                style: { 'background-color': '#8b5cf6', 'shadow-color': '#8b5cf6', 'shadow-blur': 15, 'shadow-opacity': 0.6 }
            },
            {
                selector: 'node[type="metric"]',
                style: { 'background-color': '#10b981', 'shadow-color': '#10b981', 'shadow-blur': 15, 'shadow-opacity': 0.6 }
            },
            {
                selector: 'node[type="product"]',
                style: { 'background-color': '#f59e0b', 'shadow-color': '#f59e0b', 'shadow-blur': 15, 'shadow-opacity': 0.6 }
            },
            {
                selector: 'edge',
                style: {
                    'width': 2,
                    'line-color': 'rgba(255,255,255,0.15)',
                    'target-arrow-color': 'rgba(255,255,255,0.15)',
                    'target-arrow-shape': 'triangle',
                    'curve-style': 'bezier',
                    'label': 'data(label)',
                    'font-size': '10px',
                    'color': '#a0a0b0',
                    'text-rotation': 'autorotate',
                    'text-margin-y': -8,
                    'transition-property': 'line-color, target-arrow-color, width',
                    'transition-duration': '0.3s'
                }
            },
            {
                selector: '.highlighted',
                style: {
                    'border-color': '#fff',
                    'border-width': 4,
                    'width': 50,
                    'height': 50,
                    'shadow-blur': 30,
                    'shadow-opacity': 1,
                    'z-index': 999
                }
            },
            {
                selector: 'edge.highlighted',
                style: {
                    'width': 4,
                    'line-color': '#6366f1',
                    'target-arrow-color': '#6366f1',
                    'z-index': 998
                }
            }
        ],
        elements: [],
        layout: { name: 'preset' },
        userZoomingEnabled: true,
        userPanningEnabled: true,
        boxSelectionEnabled: false
    });
}

function addChatMessage(role, text) {
    const history = document.getElementById('chat-history');
    const msgDiv = document.createElement('div');
    msgDiv.className = `msg ${role}`;
    msgDiv.textContent = text;
    history.appendChild(msgDiv);
    history.scrollTop = history.scrollHeight;
}

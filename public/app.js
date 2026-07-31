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
        document.getElementById('parsing-skeleton').classList.remove('hidden');

        try {
            const response = await fetch('/api/process-document', { method: 'POST' });
            const data = await response.json();

            if (data.success) {
                // Load elements into graph
                cy.elements().remove();
                cy.add(data.graph.nodes);
                cy.add(data.graph.edges);
                
                // Run layout using fixed positions from LLM metadata
                cy.layout({
                    name: 'preset',
                    animate: true,
                    animationDuration: 1000
                }).run();
                
                // Initialize Temporal Slider Logic
                const timeSlider = document.getElementById('time-slider');
                const timeDisplay = document.getElementById('time-display');
                if (timeSlider) {
                    timeSlider.addEventListener('input', (e) => {
                        const year = parseInt(e.target.value);
                        timeDisplay.textContent = `Year: ${year}`;
                        
                        cy.elements().forEach(ele => {
                            const validFrom = ele.data('valid_from');
                            const validUntil = ele.data('valid_until');
                            
                            if (validFrom && validUntil) {
                                if (year >= validFrom && year <= validUntil) {
                                    ele.style('display', 'element');
                                } else {
                                    ele.style('display', 'none');
                                }
                            }
                        });
                    });
                }
                
                // Initialize Semantic Zoom Logic
                cy.on('zoom', () => {
                    const zoom = cy.zoom();
                    cy.nodes().forEach(node => {
                        const minZoom = node.data('zoomLevel') || 0;
                        if (zoom < minZoom) {
                            node.style('display', 'none');
                        } else {
                            // Check time slider before displaying
                            const year = timeSlider ? parseInt(timeSlider.value) : 2025;
                            const validFrom = node.data('valid_from');
                            const validUntil = node.data('valid_until');
                            if (validFrom && validUntil && (year < validFrom || year > validUntil)) {
                                node.style('display', 'none');
                            } else {
                                node.style('display', 'element');
                            }
                        }
                    });
                });

                // Update UI to Chat Mode
                statusText.classList.add('hidden');
                document.getElementById('parsing-skeleton').classList.add('hidden');
                btnProcess.parentElement.classList.add('hidden');
                chatSection.classList.remove('hidden');
                
                document.getElementById('chat-input').disabled = false;
                document.getElementById('btn-send').disabled = false;
                
                addChatMessage('ai', 'Graph constructed successfully. What would you like to know about the document?');
                showToast('Graph built successfully', 'success');
            }
        } catch (error) {
            console.error("Error processing document:", error);
            statusText.textContent = "Error processing document.";
            statusText.style.color = "#ef4444";
            document.getElementById('parsing-skeleton').classList.add('hidden');
            showToast('Failed to process document', 'error');
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
    
    if (role === 'user') {
        msgDiv.className = 'self-end bg-brand-600/30 border border-brand-500/50 text-brand-100 p-3 rounded-2xl rounded-tr-sm text-sm max-w-[85%] shadow-md backdrop-blur-sm';
    } else {
        msgDiv.className = 'self-start bg-slate-800/70 border border-slate-700/80 text-slate-200 p-3 rounded-2xl rounded-tl-sm text-sm max-w-[85%] shadow-md backdrop-blur-sm';
    }
    
    msgDiv.textContent = text;
    history.appendChild(msgDiv);
    history.scrollTop = history.scrollHeight;
}

function showToast(message, type = 'success') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `flex items-center gap-3 glass-panel px-4 py-3 rounded-lg shadow-lg border-l-4 transition-all duration-300 transform translate-y-full opacity-0 ${type === 'success' ? 'border-l-emerald-500' : 'border-l-red-500'}`;
    
    const icon = document.createElement('i');
    icon.setAttribute('data-lucide', type === 'success' ? 'check-circle' : 'alert-circle');
    icon.className = `w-5 h-5 ${type === 'success' ? 'text-emerald-500' : 'text-red-500'}`;
    
    const text = document.createElement('span');
    text.className = 'text-sm font-medium text-slate-200';
    text.textContent = message;
    
    toast.appendChild(icon);
    toast.appendChild(text);
    container.appendChild(toast);
    
    // Initialize the icon
    if (window.lucide) {
        lucide.createIcons({ root: toast });
    }
    
    // Animate in
    requestAnimationFrame(() => {
        toast.classList.remove('translate-y-full', 'opacity-0');
    });
    
    // Remove after 3 seconds
    setTimeout(() => {
        toast.classList.add('opacity-0', 'translate-x-full');
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

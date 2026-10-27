'use strict';

/* GraphRAG Vision UI. All dynamic text is inserted with textContent (never innerHTML). */
(function () {
  const $ = (id) => document.getElementById(id);
  const el = (tag, props = {}, children = []) => {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (k === 'text') node.textContent = v;
      else if (k === 'class') node.className = v;
      else node.setAttribute(k, v);
    }
    for (const c of children) node.append(c);
    return node;
  };

  const state = { status: null, graph: { nodes: [], edges: [] }, busy: false, querying: false, years: null };
  let cy = null;

  // ---------------------------------------------------------------- API ----
  function authHeaders() {
    const token = $('api-token').value.trim();
    return token ? { Authorization: `Bearer ${token}` } : {};
  }

  async function api(path, { method = 'GET', body, auth = false } = {}) {
    const headers = { Accept: 'application/json', ...(auth ? authHeaders() : {}) };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    let res;
    try {
      res = await fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    } catch {
      throw new Error('Network error: could not reach the server.');
    }
    let data = null;
    try {
      data = await res.json();
    } catch {
      /* non-JSON response */
    }
    if (!res.ok || !data || data.success === false) {
      const err = new Error((data && data.error) || `Request failed (${res.status}).`);
      err.status = res.status;
      throw err;
    }
    return data;
  }

  // -------------------------------------------------------------- Theme ----
  function currentTheme() {
    const forced = document.documentElement.getAttribute('data-theme');
    if (forced) return forced;
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  function syncThemeButton() {
    const dark = currentTheme() === 'dark';
    $('theme-toggle').setAttribute('aria-pressed', String(dark));
    $('theme-toggle').setAttribute('aria-label', dark ? 'Switch to light mode' : 'Switch to dark mode');
  }
  $('theme-toggle').addEventListener('click', () => {
    const next = currentTheme() === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    try {
      localStorage.setItem('theme', next);
    } catch {
      /* ignore */
    }
    syncThemeButton();
    applyGraphStyle();
  });
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    syncThemeButton();
    applyGraphStyle();
  });

  // -------------------------------------------------------------- Toasts ---
  function toast(message, type = 'success') {
    const t = el('div', { class: `toast ${type === 'error' ? 'error' : ''}`, role: 'status', text: message });
    $('toasts').append(t);
    setTimeout(() => t.remove(), 4000);
  }

  function setLoading(text) {
    $('graph-loading').hidden = !text;
    $('graph-loading-text').textContent = text || '';
  }

  // --------------------------------------------------------------- Graph ---
  const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

  function graphStyle() {
    const types = ['company', 'person', 'product', 'metric', 'location', 'concept'];
    return [
      {
        selector: 'node',
        style: {
          label: 'data(label)',
          color: cssVar('--node-label'),
          'font-family': 'system-ui, sans-serif',
          'font-size': 12,
          'text-valign': 'bottom',
          'text-margin-y': 6,
          'text-wrap': 'wrap',
          'text-max-width': 120,
          'min-zoomed-font-size': 7,
          width: 'mapData(degree, 0, 8, 24, 52)',
          height: 'mapData(degree, 0, 8, 24, 52)',
          'background-color': cssVar('--t-concept'),
          'border-width': 2,
          'border-color': cssVar('--graph-bg'),
        },
      },
      ...types.map((t) => ({ selector: `node[type="${t}"]`, style: { 'background-color': cssVar(`--t-${t}`) } })),
      {
        selector: 'edge',
        style: {
          width: 1.6,
          'line-color': cssVar('--edge'),
          'target-arrow-color': cssVar('--edge'),
          'target-arrow-shape': 'triangle',
          'curve-style': 'bezier',
          label: 'data(label)',
          'font-size': 9,
          color: cssVar('--edge-label'),
          'text-rotation': 'autorotate',
          'text-background-color': cssVar('--graph-bg'),
          'text-background-opacity': 0.85,
          'text-background-padding': 2,
          'min-zoomed-font-size': 9,
        },
      },
      { selector: '.time-hidden', style: { display: 'none' } },
      { selector: '.dimmed', style: { opacity: 0.25 } },
      {
        selector: 'node.highlighted',
        style: { 'border-color': cssVar('--highlight'), 'border-width': 5, opacity: 1 },
      },
      {
        selector: 'edge.highlighted',
        style: {
          width: 3.5,
          'line-color': cssVar('--highlight'),
          'target-arrow-color': cssVar('--highlight'),
          opacity: 1,
        },
      },
      { selector: 'node:selected', style: { 'border-color': cssVar('--accent'), 'border-width': 5 } },
    ];
  }

  function applyGraphStyle() {
    if (cy) cy.style(graphStyle());
  }

  function initGraph() {
    if (typeof cytoscape !== 'function') {
      $('graph-empty').querySelector('p').textContent = 'The graph library failed to load.';
      return;
    }
    cy = cytoscape({
      container: $('cy'),
      style: graphStyle(),
      elements: [],
      minZoom: 0.2,
      maxZoom: 3,
      boxSelectionEnabled: false,
    });
    cy.on('tap', 'node', (evt) => showNodeDetails(evt.target));
    cy.on('tap', (evt) => {
      if (evt.target === cy) hideNodeDetails();
    });
  }

  function renderGraph(graph) {
    state.graph = graph;
    const empty = graph.nodes.length === 0;
    $('graph-empty').hidden = !empty;
    if (graph.stats) {
      const s = graph.stats;
      $('graph-stats').textContent = `${s.documents} docs · ${s.entities} entities · ${s.relations} relations`;
    }
    if (!cy) return;
    cy.elements().remove();
    cy.add([...graph.nodes, ...graph.edges]);
    if (!empty) {
      cy.layout({
        name: 'cose',
        animate: false,
        randomize: false,
        nodeRepulsion: () => 9000,
        idealEdgeLength: () => 90,
        padding: 40,
      }).run();
      cy.fit(undefined, 40);
    }
    setupTimeFilter();
    hideNodeDetails();
  }

  function setupTimeFilter() {
    const years = [];
    for (const e of state.graph.edges) {
      if (e.data.valid_from != null) years.push(e.data.valid_from);
      if (e.data.valid_until != null) years.push(e.data.valid_until);
    }
    const box = $('time-filter');
    if (years.length === 0) {
      box.hidden = true;
      state.years = null;
      return;
    }
    const min = Math.min(...years);
    const max = Math.max(...years);
    state.years = { min, max };
    const slider = $('time-slider');
    slider.min = String(min);
    slider.max = String(max);
    if (!slider.value || Number(slider.value) < min || Number(slider.value) > max) slider.value = String(max);
    box.hidden = false;
    applyTimeFilter();
  }

  function applyTimeFilter() {
    if (!cy) return;
    const enabled = $('time-enabled').checked;
    const slider = $('time-slider');
    slider.disabled = !enabled;
    const year = Number(slider.value);
    $('time-display').textContent = enabled ? `Year ${year}` : 'All years';
    cy.batch(() => {
      cy.edges().forEach((edge) => {
        const from = edge.data('valid_from');
        const until = edge.data('valid_until');
        const hidden = enabled && ((from != null && year < from) || (until != null && year > until));
        edge.toggleClass('time-hidden', hidden);
      });
    });
  }
  $('time-enabled').addEventListener('change', applyTimeFilter);
  $('time-slider').addEventListener('input', applyTimeFilter);

  function showNodeDetails(node) {
    $('node-name').textContent = node.data('label');
    $('node-type').textContent = `${node.data('type')} · mentioned in ${node.data('mentions')} chunk(s)`;
    $('node-desc').textContent = node.data('description') || '';
    const list = $('node-links');
    list.replaceChildren();
    node.connectedEdges().forEach((edge) => {
      const src = edge.source().data('label');
      const tgt = edge.target().data('label');
      list.append(el('li', { text: `${src} → ${edge.data('label')} → ${tgt}` }));
    });
    $('node-details').hidden = false;
  }
  function hideNodeDetails() {
    $('node-details').hidden = true;
  }
  $('node-close').addEventListener('click', () => {
    hideNodeDetails();
    if (cy) cy.nodes().unselect();
  });

  function highlight(ids) {
    if (!cy) return;
    const set = new Set(ids);
    cy.batch(() => {
      cy.elements().removeClass('highlighted dimmed');
      if (set.size === 0) return;
      cy.nodes().forEach((n) => n.addClass(set.has(n.id()) ? 'highlighted' : 'dimmed'));
      cy.edges().forEach((e) =>
        e.addClass(set.has(e.source().id()) && set.has(e.target().id()) ? 'highlighted' : 'dimmed'),
      );
    });
    const targets = cy.nodes('.highlighted');
    if (targets.length) cy.animate({ center: { eles: targets }, duration: 400 });
  }

  // ----------------------------------------------------------- Documents ---
  function renderDocuments(docs) {
    const list = $('doc-list');
    list.replaceChildren();
    $('doc-empty').hidden = docs.length > 0;
    for (const doc of docs) {
      const remove = el('button', {
        class: 'button small',
        type: 'button',
        text: 'Remove',
        'aria-label': `Remove document ${doc.title}`,
      });
      remove.addEventListener('click', () => deleteDocument(doc, remove));
      list.append(
        el('li', {}, [
          el('div', {}, [
            el('div', { class: 'doc-title', text: doc.title, title: doc.title }),
            el('div', {
              class: 'doc-meta',
              text: `${doc.chunks} chunk(s) · ${new Date(doc.createdAt).toLocaleString()}`,
            }),
          ]),
          remove,
        ]),
      );
    }
    updateChatAvailability();
  }

  function setBusy(busy, label) {
    state.busy = busy;
    $('btn-index').disabled = busy;
    $('btn-sample').disabled = busy;
    document.querySelectorAll('#doc-list button').forEach((b) => (b.disabled = busy));
    setLoading(busy ? label : '');
  }

  function handleAuthError(err) {
    if (err.status === 401) {
      const box = $('token-box');
      box.hidden = false;
      box.open = true;
      $('api-token').focus();
    }
  }

  async function refreshDocuments() {
    const data = await api('/api/documents');
    renderDocuments(data.documents);
  }

  async function afterIngest(data, label) {
    renderGraph(data.graph);
    await refreshDocuments();
    toast(data.created === false ? `${label} was already indexed.` : `${label} indexed.`);
  }

  $('doc-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (state.busy) return;
    const title = $('doc-title').value.trim();
    const text = $('doc-text').value.trim();
    const error = $('doc-error');
    const problems = [];
    if (!title) problems.push('Title is required.');
    if (text.length < 20) problems.push('Text must have at least 20 characters.');
    const max = state.status && state.status.limits ? state.status.limits.maxDocumentChars : Infinity;
    if (text.length > max) problems.push(`Text must have at most ${max} characters.`);
    if (problems.length) {
      error.textContent = problems.join(' ');
      error.hidden = false;
      (title ? $('doc-text') : $('doc-title')).focus();
      return;
    }
    error.hidden = true;
    setBusy(true, 'Extracting entities and relations…');
    try {
      const data = await api('/api/documents', { method: 'POST', body: { title, text }, auth: true });
      $('doc-form').reset();
      await afterIngest(data, `“${title}”`);
    } catch (err) {
      handleAuthError(err);
      error.textContent = err.message;
      error.hidden = false;
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  });

  $('btn-sample').addEventListener('click', async () => {
    if (state.busy) return;
    setBusy(true, 'Indexing the sample report…');
    try {
      const data = await api('/api/process-document', { method: 'POST', auth: true });
      await afterIngest(data, 'Sample report');
    } catch (err) {
      handleAuthError(err);
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  });

  $('doc-file').addEventListener('change', async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    if (file.size > 2_000_000) {
      toast('File is too large (max 2 MB).', 'error');
      e.target.value = '';
      return;
    }
    $('doc-text').value = await file.text();
    if (!$('doc-title').value.trim()) $('doc-title').value = file.name.replace(/\.[^.]+$/, '');
    e.target.value = '';
  });

  async function deleteDocument(doc, button) {
    if (state.busy) return;
    if (!window.confirm(`Remove “${doc.title}” and everything extracted from it?`)) return;
    setBusy(true, 'Removing document…');
    try {
      const data = await api(`/api/documents/${encodeURIComponent(doc.id)}`, { method: 'DELETE', auth: true });
      renderGraph(data.graph);
      await refreshDocuments();
      toast('Document removed.');
    } catch (err) {
      handleAuthError(err);
      toast(err.message, 'error');
      button.focus();
    } finally {
      setBusy(false);
    }
  }

  // ---------------------------------------------------------------- Chat ---
  function updateChatAvailability() {
    const hasDocs = state.graph.stats ? state.graph.stats.documents > 0 : state.graph.nodes.length > 0;
    $('chat-input').disabled = state.querying;
    $('btn-send').disabled = state.querying || !hasDocs;
    $('chat-input').placeholder = hasDocs ? 'e.g. Who acquired OmniTech?' : 'Index a document first…';
  }

  function addMessage(role, content) {
    $('chat-empty').hidden = true;
    const msg = el('div', { class: `msg ${role}` });
    if (typeof content === 'string') msg.textContent = content;
    else msg.append(content);
    $('chat-log').append(msg);
    $('chat-log').scrollTop = $('chat-log').scrollHeight;
    return msg;
  }

  function renderAnswer(data, idPrefix) {
    const frag = document.createDocumentFragment();
    const p = el('p', { class: 'answer' });
    const cited = new Set(data.citations.map((c) => c.n));
    for (const part of data.answer.split(/(\[\d+\])/)) {
      const m = /^\[(\d+)\]$/.exec(part);
      if (m && cited.has(Number(m[1]))) {
        p.append(
          el('a', {
            class: 'cite-ref',
            href: `#${idPrefix}-${m[1]}`,
            text: `[${m[1]}]`,
            'aria-label': `Source ${m[1]}`,
          }),
        );
      } else {
        p.append(document.createTextNode(part));
      }
    }
    frag.append(p);
    if (data.citations.length) {
      const list = el('ol', { class: 'citations', 'aria-label': 'Sources' });
      for (const c of data.citations) {
        list.append(
          el('li', { id: `${idPrefix}-${c.n}`, value: String(c.n) }, [
            el('strong', { text: c.documentTitle }),
            document.createTextNode(` — ${c.excerpt}`),
          ]),
        );
      }
      frag.append(list);
    }
    if (data.demo) {
      frag.append(el('p', { class: 'hint', text: 'Demo mode: extractive answer, no language model used.' }));
    }
    return frag;
  }

  let answerCount = 0;
  $('chat-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (state.querying) return;
    const input = $('chat-input');
    const query = input.value.trim();
    if (!query) return;
    state.querying = true;
    updateChatAvailability();
    addMessage('user', query);
    input.value = '';
    const pending = addMessage(
      'ai',
      el('span', { class: 'typing' }, [el('span', { class: 'spinner' }), 'Searching the graph…']),
    );
    try {
      const { data } = await api('/api/query', { method: 'POST', body: { query } });
      answerCount += 1;
      pending.replaceChildren(renderAnswer(data, `a${answerCount}-src`));
      highlight(data.highlightedNodes);
    } catch (err) {
      pending.classList.add('error');
      pending.textContent = err.message;
    } finally {
      state.querying = false;
      updateChatAvailability();
      input.focus();
    }
  });

  // ---------------------------------------------------------------- Boot ---
  async function boot() {
    syncThemeButton();
    // Keep the graph visible on small screens: start with the legend collapsed.
    if (window.matchMedia('(max-width: 860px)').matches) $('legend').open = false;
    initGraph();
    updateChatAvailability();
    try {
      const status = await api('/api/status');
      state.status = status.data;
      const badge = $('mode-badge');
      if (status.data.demo) {
        badge.textContent = 'Demo mode · rule-based, no LLM';
        badge.classList.add('demo');
      } else {
        badge.textContent = `Claude · ${status.data.model}`;
        badge.classList.add('live');
      }
      if (status.data.authRequired) $('token-box').hidden = false;
      const [graph] = await Promise.all([api('/api/graph'), refreshDocuments()]);
      renderGraph(graph.graph);
      updateChatAvailability();
    } catch (err) {
      $('mode-badge').textContent = 'Offline';
      toast(err.message, 'error');
    }
  }

  boot();
})();

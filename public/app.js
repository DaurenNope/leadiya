// Leadiya - Lead Generation Platform
const API_BASE = '/api';

// State
let allLeads = [];
let currentLeadId = null;
let selectedLeads = new Set();

// DOM Elements
const globalSearch = document.getElementById('global-search');
const refreshBtn = document.getElementById('refresh-btn');
const addLeadBtn = document.getElementById('add-lead-btn');

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    loadStats();
    loadLeads();
    loadChannelStatus();
    setupNavigation();
    setupDrawer();
    setupModals();
    setupFilters();
    setupBulkActions();
    setupOutreach();

    // Auto-refresh every 30 seconds
    setInterval(() => {
        loadStats();
        loadLeads();
        loadChannelStatus();
    }, 30000);

    // Search
    globalSearch.addEventListener('input', debounce(() => {
        renderPipeline();
        renderTable();
    }, 300));

    refreshBtn.addEventListener('click', () => {
        loadStats();
        loadLeads();
    });
});

// Navigation
function setupNavigation() {
    document.querySelectorAll('.nav-item').forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            const view = item.dataset.view;

            document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
            item.classList.add('active');

            document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
            document.getElementById(`${view}-view`).classList.add('active');

            // Toggle body class for full-screen views
            if (view === 'messages') {
                document.body.classList.add('messages-active');
                loadMessagesView();
            } else {
                document.body.classList.remove('messages-active');
                if (view === 'outreach') {
                    loadWhatsAppStatus();
                }
            }
        });
    });
}

// Load Stats
async function loadStats() {
    try {
        const res = await fetch(`${API_BASE}/stats`);
        const stats = await res.json();

        document.getElementById('stat-total').textContent = stats.total || 0;
        document.getElementById('stat-discovered').textContent = stats.byState?.discovered || 0;
        document.getElementById('stat-contacted').textContent = stats.byState?.contacted || 0;
        document.getElementById('stat-qualified').textContent = stats.byState?.qualified || 0;
        document.getElementById('stat-won').textContent = (stats.byState?.closed_won || 0);

        // Load needs-research count
        const dashRes = await fetch(`${API_BASE}/dashboard`);
        const dashData = await dashRes.json();
        const researchEl = document.getElementById('stat-research');
        if (researchEl) researchEl.textContent = dashData.needsResearch || 0;
    } catch (err) {
        console.error('Failed to load stats:', err);
    }
}

// Load Channel Status
async function loadChannelStatus() {
    try {
        const res = await fetch(`${API_BASE}/channels/status`);
        const channels = await res.json();

        document.getElementById('ch-wa').className = `status-dot ${channels.whatsapp?.ready ? 'online' : 'offline'}`;
        document.getElementById('ch-em').className = `status-dot ${channels.email?.ready ? 'online' : 'offline'}`;
        document.getElementById('ch-tg').className = `status-dot ${channels.telegram?.ready ? 'online' : 'offline'}`;

        // Update settings page
        document.getElementById('wa-status').textContent = channels.whatsapp?.ready ? '✅ Подключен' : '❌ ' + (channels.whatsapp?.message || 'Не подключен');
        document.getElementById('email-status').textContent = channels.email?.ready ? '✅ Настроен' : '❌ ' + (channels.email?.message || 'Не настроен');
        document.getElementById('tg-status').textContent = channels.telegram?.ready ? '✅ Подключен' : '❌ ' + (channels.telegram?.message || 'Не подключен');
    } catch (err) {
        console.error('Failed to load channel status:', err);
    }
}

// Load Leads
async function loadLeads() {
    try {
        const res = await fetch(`${API_BASE}/leads`);
        const data = await res.json();
        // API returns { leads: [...], total: N }
        allLeads = data.leads || data || [];

        renderPipeline();
        renderTable();
        updateColumnCounts();
    } catch (err) {
        console.error('Failed to load leads:', err);
    }
}

// Filter leads based on search
function getFilteredLeads() {
    const search = globalSearch.value.toLowerCase();

    return allLeads.filter(lead => {
        if (search) {
            const searchStr = `${lead.companyName} ${lead.firstName} ${lead.lastName} ${lead.email} ${lead.phone}`.toLowerCase();
            if (!searchStr.includes(search)) return false;
        }
        return true;
    });
}

// Render Pipeline View
function renderPipeline() {
    const leads = getFilteredLeads();
    const columns = {
        discovered: [],
        contacted: [],
        qualified: [],
        meeting_booked: [],
        closed_won: []
    };

    leads.forEach(lead => {
        const state = lead.state || 'discovered';
        if (columns[state]) {
            columns[state].push(lead);
        }
    });

    Object.entries(columns).forEach(([state, stateLeads]) => {
        const containerId = state === 'meeting_booked' ? 'cards-meeting' :
            state === 'closed_won' ? 'cards-won' :
                `cards-${state}`;
        const container = document.getElementById(containerId);
        if (!container) return;

        container.innerHTML = stateLeads.slice(0, 50).map(lead => `
            <div class="lead-card" draggable="true" data-lead-id="${lead.id}" onclick="openDrawer('${lead.id}')">
                <div class="lead-card-company">${escapeHtml(lead.companyName || 'Без названия')}</div>
                <div class="lead-card-contact">${escapeHtml(lead.firstName || '')} ${escapeHtml(lead.lastName || '')}</div>
                ${lead.tags?.length ? `
                    <div class="lead-card-tags">
                        ${lead.tags.slice(0, 3).map(t => `<span class="lead-tag">${escapeHtml(t)}</span>`).join('')}
                    </div>
                ` : ''}
                <div class="lead-card-actions">
                    <button onclick="event.stopPropagation(); quickSend('${lead.id}')" title="Отправить">📤</button>
                    <button onclick="event.stopPropagation(); openDrawer('${lead.id}')" title="Открыть">👁</button>
                </div>
            </div>
        `).join('') || '<p style="color: var(--text-muted); text-align: center; padding: 1rem;">Пусто</p>';
    });

    updateColumnCounts();
    setupDragAndDrop();
}

// Setup drag-and-drop for pipeline
function setupDragAndDrop() {
    const cards = document.querySelectorAll('.lead-card[draggable="true"]');
    const columns = document.querySelectorAll('.column-cards');

    cards.forEach(card => {
        card.addEventListener('dragstart', (e) => {
            e.dataTransfer.setData('text/plain', card.dataset.leadId);
            card.classList.add('dragging');
            setTimeout(() => card.style.opacity = '0.5', 0);
        });

        card.addEventListener('dragend', () => {
            card.classList.remove('dragging');
            card.style.opacity = '1';
            columns.forEach(col => col.classList.remove('drag-over'));
        });
    });

    columns.forEach(column => {
        column.addEventListener('dragover', (e) => {
            e.preventDefault();
            column.classList.add('drag-over');
        });

        column.addEventListener('dragleave', () => {
            column.classList.remove('drag-over');
        });

        column.addEventListener('drop', async (e) => {
            e.preventDefault();
            column.classList.remove('drag-over');

            const leadId = e.dataTransfer.getData('text/plain');
            const targetState = column.closest('.pipeline-column')?.dataset.state;

            if (!leadId || !targetState) return;

            // Update lead state via API
            try {
                const response = await fetch(`${API_BASE}/leads/${leadId}/state`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ state: targetState })
                });

                if (response.ok) {
                    // Update local cache and re-render
                    const lead = allLeads.find(l => l.id === leadId);
                    if (lead) lead.state = targetState;
                    renderPipeline();
                } else {
                    alert('Failed to update lead state');
                }
            } catch (err) {
                console.error('Failed to update lead state:', err);
                alert('Failed to update lead state');
            }
        });
    });
}

// Update column counts
function updateColumnCounts() {
    const counts = {
        discovered: 0,
        contacted: 0,
        qualified: 0,
        meeting_booked: 0,
        closed_won: 0
    };

    allLeads.forEach(lead => {
        const state = lead.state || 'discovered';
        if (counts.hasOwnProperty(state)) {
            counts[state]++;
        }
    });

    document.getElementById('col-discovered').textContent = counts.discovered;
    document.getElementById('col-contacted').textContent = counts.contacted;
    document.getElementById('col-qualified').textContent = counts.qualified;
    document.getElementById('col-meeting').textContent = counts.meeting_booked;
    document.getElementById('col-won').textContent = counts.closed_won;
}

// Render Table View
function renderTable() {
    const tbody = document.getElementById('leads-tbody');
    const leads = getFilteredLeads();

    // Apply table filters
    const stateFilter = document.getElementById('filter-state').value;
    const sourceFilter = document.getElementById('filter-source').value;
    const regionFilter = document.getElementById('filter-region').value;
    const contactFilter = document.getElementById('filter-contact')?.value || 'all';

    const filtered = leads.filter(lead => {
        if (stateFilter !== 'all' && lead.state !== stateFilter) return false;
        if (sourceFilter !== 'all' && lead.source !== sourceFilter) return false;

        // Region filter - check location, tags, notes for region/state codes
        if (regionFilter !== 'all') {
            const searchText = `${lead.location || ''} ${lead.signalSummary || ''} ${(lead.tags || []).join(' ')} ${(lead.notes || []).join(' ')} ${lead.address || ''}`.toLowerCase();
            const regionLower = regionFilter.toLowerCase();

            // Map region codes to search terms
            const regionTerms = {
                'us': ['usa', 'united states', 'us'],
                'kz': ['kazakhstan', 'казахстан', 'almaty', 'алматы'],
                'ru': ['russia', 'россия', 'moscow', 'москва'],
                'co': ['colorado', ', co'],
                'ca': ['california', ', ca'],
                'tx': ['texas', ', tx'],
                'ny': ['new york', ', ny']
            };

            const terms = regionTerms[regionLower] || [regionLower];
            const matches = terms.some(term => searchText.includes(term));
            if (!matches) return false;
        }

        // Contact filter
        if (contactFilter !== 'all') {
            const hasPhone = lead.phone && lead.phone.trim() !== '';
            const hasEmail = lead.email && lead.email.trim() !== '';
            const hasWhatsApp = lead.whatsappNumber && lead.whatsappNumber.trim() !== '';

            if (contactFilter === 'has_phone' && !hasPhone) return false;
            if (contactFilter === 'has_email' && !hasEmail) return false;
            if (contactFilter === 'has_contact' && !hasPhone && !hasEmail && !hasWhatsApp) return false;
            if (contactFilter === 'no_contact' && (hasPhone || hasEmail || hasWhatsApp)) return false;
        }

        return true;
    });

    tbody.innerHTML = filtered.slice(0, 100).map(lead => `
        <tr onclick="openDrawer('${lead.id}')">
            <td><input type="checkbox" class="lead-checkbox" data-id="${lead.id}" onclick="event.stopPropagation(); toggleSelect('${lead.id}')"></td>
            <td>
                <strong>${escapeHtml(lead.companyName || '-')}</strong>
                ${lead.industry ? `<br><span style="color: var(--accent); font-size: 0.7rem;">🏭 ${escapeHtml(lead.industry.length > 40 ? lead.industry.substring(0, 40) + '...' : lead.industry)}</span>` : ''}
                ${lead.bin ? `<br><span style="color: var(--text-muted); font-size: 0.7rem;">БИН: ${escapeHtml(lead.bin)}</span>` : ''}
                ${lead.website ? `<br><a href="${lead.website}" target="_blank" onclick="event.stopPropagation()" style="color: var(--text-muted); font-size: 0.75rem;">${new URL(lead.website).hostname}</a>` : ''}
            </td>
            <td>${escapeHtml(lead.firstName || '')} ${escapeHtml(lead.lastName || '')}</td>
            <td>${lead.phone ? `<a href="tel:${lead.phone}" onclick="event.stopPropagation()">${escapeHtml(lead.phone)}</a>` : '-'}</td>
            <td>${lead.email ? `<a href="mailto:${lead.email}" onclick="event.stopPropagation()">${escapeHtml(lead.email)}</a>` : '-'}</td>
            <td>${escapeHtml(lead.source || '-')}</td>
            <td>
                <span class="badge badge-${lead.state || 'discovered'}">${getStateName(lead.state)}</span>
                ${lead.needsResearch ? '<span class="badge" style="margin-left:4px;background:rgba(99,102,241,0.15);color:#6366f1;border:1px solid rgba(99,102,241,0.3);font-size:0.65rem" title="Нужна контактная информация">🔍</span>' : ''}
            </td>
            <td>${lead.lastContactedAt ? formatDate(lead.lastContactedAt) : '-'}</td>
            <td>
                <button class="btn btn-ghost" onclick="event.stopPropagation(); quickSend('${lead.id}')" title="Отправить">📤</button>
                <button class="btn btn-ghost" onclick="event.stopPropagation(); deleteLead('${lead.id}')" title="Удалить">🗑</button>
            </td>
        </tr>
    `).join('') || '<tr><td colspan="9" style="text-align: center; color: var(--text-muted); padding: 2rem;">Нет лидов</td></tr>';
}

// Setup Filters
function setupFilters() {
    document.getElementById('filter-state').addEventListener('change', renderTable);
    document.getElementById('filter-source').addEventListener('change', renderTable);
    document.getElementById('filter-region').addEventListener('change', renderTable);
    document.getElementById('filter-contact')?.addEventListener('change', renderTable);
}

// Bulk Actions
function setupBulkActions() {
    const selectAll = document.getElementById('select-all');
    const bulkActions = document.getElementById('bulk-actions');
    const bulkApply = document.getElementById('bulk-apply');
    const bulkDelete = document.getElementById('bulk-delete');

    selectAll?.addEventListener('change', (e) => {
        const checkboxes = document.querySelectorAll('.lead-checkbox');
        checkboxes.forEach(cb => {
            cb.checked = e.target.checked;
            const id = cb.dataset.id;
            if (e.target.checked) {
                selectedLeads.add(id);
            } else {
                selectedLeads.delete(id);
            }
        });
        updateBulkUI();
    });

    bulkApply?.addEventListener('click', async () => {
        const state = document.getElementById('bulk-state').value;
        if (!state || selectedLeads.size === 0) return;

        try {
            const response = await fetch(`${API_BASE}/leads/bulk/state`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ids: Array.from(selectedLeads), state })
            });

            if (response.ok) {
                selectedLeads.clear();
                updateBulkUI();
                loadLeads();
            } else {
                alert('Failed to update leads');
            }
        } catch (err) {
            console.error('Bulk update error:', err);
            alert('Failed to update leads');
        }
    });

    bulkDelete?.addEventListener('click', async () => {
        if (!confirm(`Удалить ${selectedLeads.size} лидов?`)) return;

        try {
            const response = await fetch(`${API_BASE}/leads/bulk/delete`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ids: Array.from(selectedLeads) })
            });

            if (response.ok) {
                selectedLeads.clear();
                updateBulkUI();
                loadLeads();
            } else {
                alert('Failed to delete leads');
            }
        } catch (err) {
            console.error('Bulk delete error:', err);
            alert('Failed to delete leads');
        }
    });

    // Bulk add tags
    const bulkTagBtn = document.getElementById('bulk-tag-btn');
    const bulkTagInput = document.getElementById('bulk-tag-input');

    bulkTagBtn?.addEventListener('click', async () => {
        const tag = bulkTagInput?.value?.trim();
        if (!tag || selectedLeads.size === 0) return;

        try {
            const response = await fetch(`${API_BASE}/leads/bulk/tags`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ids: Array.from(selectedLeads), tags: [tag] })
            });

            if (response.ok) {
                bulkTagInput.value = '';
                loadLeads();
            } else {
                alert('Failed to add tags');
            }
        } catch (err) {
            console.error('Bulk tag error:', err);
            alert('Failed to add tags');
        }
    });
}

function toggleSelect(id) {
    if (selectedLeads.has(id)) {
        selectedLeads.delete(id);
    } else {
        selectedLeads.add(id);
    }
    updateBulkUI();
}

function updateBulkUI() {
    const bulkActions = document.getElementById('bulk-actions');
    const countEl = document.getElementById('selected-count');

    if (selectedLeads.size > 0) {
        bulkActions.classList.remove('hidden');
        countEl.textContent = `${selectedLeads.size} выбрано`;
    } else {
        bulkActions.classList.add('hidden');
    }
}

// Drawer
function setupDrawer() {
    const drawer = document.getElementById('lead-drawer');
    const closeBtn = document.getElementById('drawer-close');

    closeBtn.addEventListener('click', closeDrawer);

    // Tab switching
    document.querySelectorAll('.drawer-tabs .tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.drawer-tabs .tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));

            tab.classList.add('active');
            document.getElementById(`tab-${tab.dataset.tab}`).classList.add('active');
        });
    });

    // Save button
    document.getElementById('save-lead-btn').addEventListener('click', saveLead);

    // Delete button
    document.getElementById('delete-lead-btn').addEventListener('click', () => {
        if (currentLeadId && confirm('Удалить этот лид?')) {
            deleteLead(currentLeadId);
            closeDrawer();
        }
    });

    // Send message button
    document.getElementById('send-msg-btn').addEventListener('click', () => {
        if (currentLeadId) {
            quickSend(currentLeadId);
        }
    });

    // Add note button
    document.getElementById('add-note-btn').addEventListener('click', addNote);
}

async function openDrawer(leadId) {
    currentLeadId = leadId;
    const lead = allLeads.find(l => l.id === leadId);
    if (!lead) return;

    // Show the detailed lead panel (English with Quick Actions)
    if (typeof openLeadDetail === 'function') {
        openLeadDetail(leadId);
        return; // Don't also show the drawer
    }

    // Fallback to drawer if panel not available
    // Update drawer title
    document.getElementById('drawer-title').textContent = lead.companyName || 'Детали лида';

    // Fill form
    document.getElementById('edit-company').value = lead.companyName || '';
    document.getElementById('edit-firstname').value = lead.firstName || '';
    document.getElementById('edit-lastname').value = lead.lastName || '';
    document.getElementById('edit-email').value = lead.email || '';
    document.getElementById('edit-phone').value = lead.phone || '';
    document.getElementById('edit-whatsapp').value = lead.whatsappNumber || '';
    document.getElementById('edit-website').value = lead.website || lead.rawData?.website || '';
    document.getElementById('edit-instagram').value = lead.rawData?.instagram || '';
    document.getElementById('edit-telegram').value = lead.rawData?.telegram || '';
    document.getElementById('edit-facebook').value = lead.rawData?.facebook || '';
    document.getElementById('edit-state').value = lead.state || 'discovered';
    document.getElementById('edit-tags').value = (lead.tags || []).join(', ');

    // Load activity
    loadActivity(leadId);

    // Load notes
    loadNotes(lead);

    // Show drawer
    document.getElementById('lead-drawer').classList.remove('hidden');
}

function closeDrawer() {
    document.getElementById('lead-drawer').classList.add('hidden');
    currentLeadId = null;
}

async function loadActivity(leadId) {
    const container = document.getElementById('activity-list');
    container.innerHTML = '<p style="color: var(--text-muted)">Загрузка...</p>';

    try {
        const res = await fetch(`${API_BASE}/leads/${leadId}/activity`);
        const data = await res.json();

        if (data.activity?.length) {
            container.innerHTML = data.activity.map(item => `
                <div class="activity-item">
                    <strong>${getActivityIcon(item.type)}</strong> ${escapeHtml(item.note)}
                    <div class="time">${formatDate(item.date)}</div>
                </div>
            `).join('');
        } else {
            container.innerHTML = '<p style="color: var(--text-muted)">Нет активности</p>';
        }
    } catch (err) {
        container.innerHTML = '<p style="color: var(--text-muted)">Ошибка загрузки</p>';
    }
}

function loadNotes(lead) {
    const container = document.getElementById('notes-list');
    const notes = lead.notes || [];

    if (notes.length) {
        container.innerHTML = notes.map(note => `
            <div class="note-item">${escapeHtml(note)}</div>
        `).join('');
    } else {
        container.innerHTML = '<p style="color: var(--text-muted)">Нет заметок</p>';
    }
}

async function addNote() {
    const textarea = document.getElementById('new-note');
    const note = textarea.value.trim();

    if (!note || !currentLeadId) return;

    try {
        await fetch(`${API_BASE}/leads/${currentLeadId}/notes`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ note })
        });

        textarea.value = '';
        const lead = allLeads.find(l => l.id === currentLeadId);
        if (lead) {
            lead.notes = lead.notes || [];
            lead.notes.push(`[${new Date().toISOString()}] ${note}`);
            loadNotes(lead);
        }
    } catch (err) {
        alert('Ошибка добавления заметки');
    }
}

async function saveLead() {
    if (!currentLeadId) return;

    const updates = {
        companyName: document.getElementById('edit-company').value,
        firstName: document.getElementById('edit-firstname').value,
        lastName: document.getElementById('edit-lastname').value,
        email: document.getElementById('edit-email').value,
        phone: document.getElementById('edit-phone').value,
        whatsappNumber: document.getElementById('edit-whatsapp').value,
        website: document.getElementById('edit-website').value,
        state: document.getElementById('edit-state').value,
        tags: document.getElementById('edit-tags').value.split(',').map(t => t.trim()).filter(t => t),
        rawData: {
            instagram: document.getElementById('edit-instagram').value,
            telegram: document.getElementById('edit-telegram').value,
            facebook: document.getElementById('edit-facebook').value,
        }
    };

    try {
        await fetch(`${API_BASE}/leads/${currentLeadId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(updates)
        });

        loadLeads();
        closeDrawer();
    } catch (err) {
        alert('Ошибка сохранения');
    }
}

// Modals
function setupModals() {
    const addLeadBtn = document.getElementById('add-lead-btn');
    const modal = document.getElementById('add-lead-modal');
    const cancelBtn = document.getElementById('cancel-add');
    const submitBtn = document.getElementById('submit-add');
    const closeBtn = modal.querySelector('.modal-close');

    addLeadBtn.addEventListener('click', () => modal.classList.remove('hidden'));
    cancelBtn.addEventListener('click', () => modal.classList.add('hidden'));
    closeBtn.addEventListener('click', () => modal.classList.add('hidden'));

    submitBtn.addEventListener('click', async () => {
        const lead = {
            companyName: document.getElementById('new-company').value,
            firstName: document.getElementById('new-firstname').value,
            lastName: document.getElementById('new-lastname').value,
            email: document.getElementById('new-email').value,
            phone: document.getElementById('new-phone').value,
            website: document.getElementById('new-website').value,
            state: 'discovered',
            source: 'manual'
        };

        if (!lead.companyName) {
            alert('Введите название компании');
            return;
        }

        try {
            await fetch(`${API_BASE}/leads`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(lead)
            });

            modal.classList.add('hidden');
            document.getElementById('add-lead-form').reset();
            loadLeads();
        } catch (err) {
            alert('Ошибка создания лида');
        }
    });
}

// Outreach
function setupOutreach() {
    document.getElementById('process-outreach')?.addEventListener('click', async () => {
        try {
            const res = await fetch(`${API_BASE}/outreach/process`, { method: 'POST' });
            const result = await res.json();
            alert(`Обработано: ${result.processed}, Успешно: ${result.succeeded}, Ошибок: ${result.failed}`);
            loadLeads();
        } catch (err) {
            alert('Ошибка outreach');
        }
    });

    // Load templates for automation panel
    loadAutomationTemplates();

    // Add template button
    document.getElementById('add-template-btn')?.addEventListener('click', () => {
        showToast('Template editor coming soon!', 'info');
    });
}

// Load templates for automation panel
async function loadAutomationTemplates() {
    try {
        const res = await fetch(`${API_BASE}/templates`);
        const data = await res.json();

        const list = document.getElementById('auto-templates-list');
        if (!list) return;

        if (!data.templates || data.templates.length === 0) {
            list.innerHTML = '<div class="template-empty">No templates yet</div>';
            return;
        }

        list.innerHTML = data.templates.map(t => `
            <div class="template-card" data-id="${t.id}">
                <div class="template-card-name">${escapeHtml(t.name)}</div>
                <div class="template-card-preview">${escapeHtml(t.content.substring(0, 60))}...</div>
            </div>
        `).join('');

    } catch (err) {
        console.error('Failed to load templates:', err);
        const list = document.getElementById('auto-templates-list');
        if (list) list.innerHTML = '<div class="template-empty">Failed to load</div>';
    }
}

async function quickSend(leadId) {
    const lead = allLeads.find(l => l.id === leadId);
    if (!lead) return;

    if (!confirm(`Отправить сообщение для ${lead.companyName}?`)) return;

    try {
        // Start sequence
        await fetch(`${API_BASE}/outreach/start/${leadId}`, { method: 'POST' });

        // Execute step
        const res = await fetch(`${API_BASE}/outreach/send/${leadId}`, { method: 'POST' });
        const result = await res.json();

        if (result.success) {
            alert(`✅ Сообщение отправлено через ${result.channel}`);
        } else {
            alert(`❌ Ошибка: ${result.error || 'Не удалось отправить'}`);
        }

        loadLeads();
    } catch (err) {
        alert('Ошибка отправки: ' + err.message);
    }
}

async function deleteLead(leadId) {
    if (!confirm('Удалить этот лид?')) return;

    try {
        await fetch(`${API_BASE}/leads/${leadId}`, { method: 'DELETE' });
        loadLeads();
    } catch (err) {
        alert('Ошибка удаления');
    }
}

// Helpers
function escapeHtml(str) {
    if (!str) return '';
    return str.toString().replace(/[&<>"']/g, m => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[m]);
}

function debounce(fn, ms) {
    let timeout;
    return (...args) => {
        clearTimeout(timeout);
        timeout = setTimeout(() => fn(...args), ms);
    };
}

function formatDate(date) {
    if (!date) return '-';
    const d = new Date(date);
    return d.toLocaleDateString('ru-RU') + ' ' + d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

function getStateName(state) {
    const names = {
        discovered: 'Новый',
        contacted: 'В работе',
        qualified: 'Квалиф.',
        meeting_booked: 'Встреча',
        closed_won: 'Закрыт',
        closed_lost: 'Потерян',
        disqualified: 'Не подходит'
    };
    return names[state] || state || 'Новый';
}

function getActivityIcon(type) {
    const icons = {
        created: '🆕',
        message: '💬',
        note: '📝',
        state_change: '🔄'
    };
    return icons[type] || '📌';
}

// =====================================================
// SOURCES MANAGEMENT
// =====================================================

let allSources = [];

// Load Sources from API
async function loadSources() {
    try {
        const res = await fetch(`${API_BASE}/sources`);
        if (res.ok) {
            const data = await res.json();
            allSources = data.sources || [];
        } else {
            allSources = [];
        }
    } catch (e) {
        allSources = [];
    }
    renderSources();
}

// Render Sources Grid
async function renderSources() {
    const grid = document.getElementById('sources-grid');
    if (!grid) return;

    const typeIcons = {
        directory: '📍',
        telegram: '💬',
        website: '🌐',
        api: '🔗',
        import: '📁'
    };

    const typeLabels = {
        directory: 'Directory',
        telegram: 'Telegram',
        website: 'Website',
        api: 'API',
        import: 'Import'
    };

    let html = '';

    // Section: Built-in Scrapers
    try {
        const scrapersRes = await fetch(`${API_BASE}/scrapers`);
        const scrapers = await scrapersRes.json();

        if (scrapers.length) {
            html += `<div class="sources-section"><h3 class="sources-section-title">🔍 Built-in Scrapers</h3><div class="sources-section-grid">`;

            for (const scraper of scrapers) {
                html += `
                    <div class="source-card scraper-card" data-scraper='${JSON.stringify(scraper)}'>
                        <div class="source-card-header">
                            <div class="source-card-title">
                                <span>🔍</span>
                                <h3>${scraper.displayName}</h3>
                            </div>
                        </div>
                        <p class="source-description">${scraper.description}</p>
                        <div class="source-card-actions">
                            <button class="btn btn-primary run-scraper-btn">▶ Run</button>
                        </div>
                    </div>
                `;
            }

            html += `</div></div>`;
        }
    } catch (err) {
        console.error('Failed to load scrapers:', err);
    }

    // Section: Custom Sources
    if (allSources.length) {
        html += `<div class="sources-section"><h3 class="sources-section-title">📁 Custom Sources</h3><div class="sources-section-grid">`;

        for (const source of allSources) {
            const icon = typeIcons[source.type] || '📌';
            const label = typeLabels[source.type] || source.type;
            const statusClass = source.status || 'active';
            const statusIcon = statusClass === 'active' ? '✅' : statusClass === 'error' ? '❌' : '⏸';

            html += `
                <div class="source-card" data-id="${source.id}">
                    <div class="source-card-header">
                        <div class="source-card-title">
                            <span>${icon}</span>
                            <h3>${escapeHtml(source.name)}</h3>
                        </div>
                        <div class="source-status ${statusClass}">
                            <span>${statusIcon}</span>
                            <span>${statusClass}</span>
                        </div>
                    </div>
                    <span class="source-type-badge">${label}</span>
                    <div class="source-card-stats">
                        <div class="source-stat">
                            <div class="source-stat-value">${source.stats?.totalLeads || 0}</div>
                            <div class="source-stat-label">Leads</div>
                        </div>
                        <div class="source-stat">
                            <div class="source-stat-value">${source.stats?.lastRun ? formatDate(source.stats.lastRun) : 'Never'}</div>
                            <div class="source-stat-label">Last Run</div>
                        </div>
                    </div>
                    <div class="source-card-actions">
                        <button class="btn btn-primary run-source" data-id="${source.id}">▶ Run</button>
                        <button class="btn btn-secondary edit-source" data-id="${source.id}">Edit</button>
                        <button class="btn btn-danger delete-source" data-id="${source.id}">🗑</button>
                    </div>
                </div>
            `;
        }

        html += `</div></div>`;
    }

    // Add New Source card
    html += `
        <div class="source-card add-new" id="add-source-card">
            <span class="plus-icon">+</span>
            <span>Add New Source</span>
        </div>
    `;

    grid.innerHTML = html;

    // Attach event listeners for scrapers
    grid.querySelectorAll('.scraper-card').forEach(card => {
        const scraper = JSON.parse(card.dataset.scraper);
        card.querySelector('.run-scraper-btn')?.addEventListener('click', (e) => {
            e.stopPropagation();
            openScraperModal(scraper);
        });
    });

    // Attach event listeners for custom sources
    grid.querySelectorAll('.run-source').forEach(btn => {
        btn.addEventListener('click', () => runSource(btn.dataset.id));
    });
    grid.querySelectorAll('.edit-source').forEach(btn => {
        btn.addEventListener('click', () => editSource(btn.dataset.id));
    });
    grid.querySelectorAll('.delete-source').forEach(btn => {
        btn.addEventListener('click', () => deleteSource(btn.dataset.id));
    });
    document.getElementById('add-source-card')?.addEventListener('click', openAddSourceModal);
}

// Open Add Source Modal
function openAddSourceModal() {
    const modal = document.getElementById('add-source-modal');
    modal.classList.remove('hidden');
    document.getElementById('add-source-form').reset();
    hideAllSourceConfigs();
}

// Close Add Source Modal
function closeAddSourceModal() {
    document.getElementById('add-source-modal').classList.add('hidden');
}

// Hide all source config sections
function hideAllSourceConfigs() {
    document.querySelectorAll('.source-config').forEach(el => el.classList.add('hidden'));
}

// Show config for selected source type
function showSourceConfig(type) {
    hideAllSourceConfigs();
    const config = document.getElementById(`config-${type}`);
    if (config) config.classList.remove('hidden');
}

// Popular source presets - REAL B2B lead sources
const SOURCE_PRESETS = {
    // === STARTUP & TECH DATABASES ===
    'crunchbase': {
        name: 'Crunchbase - Funded Startups',
        type: 'website',
        config: {
            url: 'https://www.crunchbase.com/discover/organization.companies',
            itemSelector: '.component--grid-row',
            nameSelector: '.identifier-label',
            note: 'Filter by funding, location, industry'
        }
    },
    'producthunt': {
        name: 'ProductHunt - New Products',
        type: 'website',
        config: {
            url: 'https://www.producthunt.com/topics/developer-tools',
            itemSelector: '[data-test="post-item"]',
            nameSelector: 'h3'
        }
    },
    'g2': {
        name: 'G2.com - Software Companies',
        type: 'website',
        config: {
            url: 'https://www.g2.com/categories/crm',
            itemSelector: '.product-listing',
            nameSelector: '.product-name'
        }
    },

    // === AGENCY DIRECTORIES (VERIFIED) ===
    'clutch': {
        name: 'Clutch.co - Top Dev Agencies',
        type: 'website',
        config: {
            url: 'https://clutch.co/developers',
            itemSelector: '[data-provider-id]',
            nameSelector: 'h3.company_info',
            phoneSelector: '.website-link'
        }
    },
    'designrush': {
        name: 'DesignRush - Creative Agencies',
        type: 'website',
        config: {
            url: 'https://www.designrush.com/agency/web-development-companies',
            itemSelector: '.agency-card',
            nameSelector: '.agency-name'
        }
    },
    'toptal': {
        name: 'Toptal - Elite Freelancers',
        type: 'website',
        config: {
            url: 'https://www.toptal.com/developers',
            itemSelector: '.talent-card',
            nameSelector: '.talent-name'
        }
    },

    // === B2B DATA APIS ===
    'apollo': {
        name: 'Apollo.io - B2B Contacts',
        type: 'api',
        config: { provider: 'apollo', note: 'Get free API key at apollo.io' }
    },
    'hunter': {
        name: 'Hunter.io - Email Finder',
        type: 'api',
        config: { provider: 'hunter', note: 'Domain email search' }
    },
    'clearbit': {
        name: 'Clearbit - Company Enrichment',
        type: 'api',
        config: { provider: 'clearbit', note: 'Enrich with firmographics' }
    },

    // === CIS MARKET (Kazakhstan, Russia, Uzbekistan) ===
    '2gis_almaty': {
        name: '2GIS Almaty - B2B',
        type: 'directory',
        config: { service: '2gis', city: 'almaty', category: 'Оптовые компании' }
    },
    '2gis_astana': {
        name: '2GIS Astana - IT',
        type: 'directory',
        config: { service: '2gis', city: 'astana', category: 'IT-компании' }
    },
    'kompra': {
        name: 'Kompra.kz - KZ Registry',
        type: 'website',
        config: {
            url: 'https://kompra.kz/companies',
            itemSelector: '.company-row',
            nameSelector: '.company-name',
            note: 'Official KZ company registry'
        }
    },
    'rusprofile': {
        name: 'Rusprofile.ru - RU Companies',
        type: 'website',
        config: {
            url: 'https://www.rusprofile.ru/codes/681000',
            itemSelector: '.company-item',
            nameSelector: '.company-name'
        }
    },
    'spark': {
        name: 'SPARK-Interfax - RU Business',
        type: 'website',
        config: {
            url: 'https://spark-interfax.ru/',
            itemSelector: '.company-card',
            nameSelector: '.company-name',
            note: 'Premium RU business data'
        }
    },
    'vcru': {
        name: 'VC.ru - RU Startups',
        type: 'website',
        config: {
            url: 'https://vc.ru/companies',
            itemSelector: '.content-card',
            nameSelector: '.content-title'
        }
    },
    'habr': {
        name: 'Habr.com - Tech Companies',
        type: 'website',
        config: {
            url: 'https://habr.com/ru/companies/',
            itemSelector: '.tm-companies-list__item',
            nameSelector: '.tm-company-snippet__title'
        }
    },
    'egov': {
        name: 'Egov.kz - Tenders',
        type: 'website',
        config: {
            url: 'https://goszakup.gov.kz',
            itemSelector: '.tender-item',
            nameSelector: '.tender-title',
            note: 'KZ government procurement'
        }
    },

    // === TELEGRAM CIS GROUPS ===
    'tg_jobs_kz': {
        name: 'TG: IT Jobs KZ',
        type: 'telegram',
        config: { group: 'it_jobs_kz' }
    },
    'tg_vc': {
        name: 'TG: VC.ru Startups',
        type: 'telegram',
        config: { group: 'vcru' }
    },

    // === NICHE/INDUSTRY ===
    'dribbble': {
        name: 'Dribbble - Design Agencies',
        type: 'website',
        config: {
            url: 'https://dribbble.com/designers',
            itemSelector: '.designer-item',
            nameSelector: '.designer-name'
        }
    },
    'builtwith': {
        name: 'BuiltWith - Tech Stacks',
        type: 'website',
        config: {
            url: 'https://trends.builtwith.com/websitelist/Shopify',
            itemSelector: '.website-row',
            nameSelector: '.domain-name',
            note: 'Find companies using specific tech'
        }
    }
};

// Apply preset to form
function applySourcePreset(presetId) {
    const preset = SOURCE_PRESETS[presetId];
    if (!preset) return;

    // Fill name and type
    document.getElementById('source-name').value = preset.name;
    document.getElementById('source-type').value = preset.type;
    showSourceConfig(preset.type);

    // Fill type-specific fields
    if (preset.type === 'directory') {
        document.getElementById('dir-service').value = preset.config.service || '2gis';
        document.getElementById('dir-city').value = preset.config.city || '';
        document.getElementById('dir-category').value = preset.config.category || '';
    } else if (preset.type === 'telegram') {
        document.getElementById('tg-group').value = preset.config.group || '';
    } else if (preset.type === 'website') {
        document.getElementById('web-url').value = preset.config.url || '';
        document.getElementById('web-selector').value = preset.config.itemSelector || '';
        document.getElementById('web-name').value = preset.config.nameSelector || '';
        document.getElementById('web-phone').value = preset.config.phoneSelector || '';
    } else if (preset.type === 'api') {
        document.getElementById('api-provider').value = preset.config.provider || '';
    }

    // Highlight selected preset
    document.querySelectorAll('.preset-btn').forEach(btn => btn.classList.remove('selected'));
    document.querySelector(`[data-preset="${presetId}"]`)?.classList.add('selected');
}

// Setup Source Modal events
function setupSourceModal() {
    const modal = document.getElementById('add-source-modal');
    const typeSelect = document.getElementById('source-type');
    const cancelBtn = document.getElementById('cancel-source');
    const submitBtn = document.getElementById('submit-source');
    const addBtn = document.getElementById('add-source-btn');

    addBtn?.addEventListener('click', openAddSourceModal);

    typeSelect?.addEventListener('change', () => {
        showSourceConfig(typeSelect.value);
    });

    // Preset button click handlers
    document.querySelectorAll('.preset-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const presetId = btn.getAttribute('data-preset');
            applySourcePreset(presetId);
        });
    });

    cancelBtn?.addEventListener('click', closeAddSourceModal);

    modal?.querySelector('.modal-close')?.addEventListener('click', closeAddSourceModal);

    submitBtn?.addEventListener('click', async () => {
        const name = document.getElementById('source-name').value.trim();
        const type = document.getElementById('source-type').value;

        if (!name || !type) {
            alert('Please fill in required fields');
            return;
        }

        const config = getSourceConfig(type);

        const source = {
            name,
            type,
            config,
            schedule: 'manual',
            status: 'active'
        };

        try {
            const res = await fetch(`${API_BASE}/sources`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(source)
            });

            if (res.ok) {
                closeAddSourceModal();
                loadSources();
            } else {
                alert('Failed to add source');
            }
        } catch (e) {
            alert('Error adding source: ' + e.message);
        }
    });
}

// Get config based on type
function getSourceConfig(type) {
    switch (type) {
        case 'directory':
            return {
                service: document.getElementById('dir-service')?.value,
                city: document.getElementById('dir-city')?.value,
                category: document.getElementById('dir-category')?.value
            };
        case 'telegram':
            return {
                group: document.getElementById('tg-group')?.value
            };
        case 'website':
            return {
                url: document.getElementById('web-url')?.value,
                itemSelector: document.getElementById('web-selector')?.value,
                nameSelector: document.getElementById('web-name')?.value,
                phoneSelector: document.getElementById('web-phone')?.value
            };
        case 'api':
            return {
                provider: document.getElementById('api-provider')?.value,
                apiKey: document.getElementById('api-key')?.value,
                query: document.getElementById('api-query')?.value
            };
        case 'import':
            return {
                // File handled separately
                mapping: document.getElementById('import-mapping')?.value
            };
        default:
            return {};
    }
}

// Run Source
async function runSource(id) {
    const btn = document.querySelector(`.run-source[data-id="${id}"]`);
    if (btn) {
        btn.textContent = '⏳ Running...';
        btn.disabled = true;
    }

    try {
        const res = await fetch(`${API_BASE}/sources/${id}/run`, { method: 'POST' });
        const data = await res.json();

        if (res.ok) {
            alert(`Source run complete! Added ${data.leadsAdded || 0} leads.`);
            loadSources();
            loadLeads();
            loadStats();
        } else {
            alert('Run failed: ' + (data.error || 'Unknown error'));
        }
    } catch (e) {
        alert('Error running source: ' + e.message);
    } finally {
        if (btn) {
            btn.textContent = '▶ Run';
            btn.disabled = false;
        }
    }
}

// Edit Source (placeholder)
function editSource(id) {
    alert('Edit source: ' + id + ' (coming soon)');
}

// Delete Source
async function deleteSource(id) {
    if (!confirm('Delete this source?')) return;

    try {
        const res = await fetch(`${API_BASE}/sources/${id}`, { method: 'DELETE' });
        if (res.ok) {
            loadSources();
        } else {
            alert('Failed to delete source');
        }
    } catch (e) {
        alert('Error: ' + e.message);
    }
}

// Initialize Sources on page load
document.addEventListener('DOMContentLoaded', () => {
    setupSourceModal();
    loadSources();
    setupAutomation();
});

// =====================================================
// AUTOMATION CONTROL - ENHANCED
// =====================================================

function setupAutomation() {
    // Run Cycle button
    document.getElementById('run-cycle-btn')?.addEventListener('click', runAutomationCycle);

    // Start button
    document.getElementById('start-auto-btn')?.addEventListener('click', startAutomation);

    // Stop button
    document.getElementById('stop-auto-btn')?.addEventListener('click', stopAutomation);

    // Clear log button
    document.getElementById('clear-log-btn')?.addEventListener('click', clearAutomationLog);

    // Load initial status
    loadAutomationStatus();

    // Poll status every 10 seconds
    setInterval(loadAutomationStatus, 10000);
}

// Add entry to activity log
function addLogEntry(message, type = 'info') {
    const log = document.getElementById('automation-log');
    if (!log) return;

    const time = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const entry = document.createElement('div');
    entry.className = `log-entry log-${type}`;
    entry.innerHTML = `<span class="log-time">[${time}]</span> ${message}`;

    log.appendChild(entry);
    log.scrollTop = log.scrollHeight;

    // Keep only last 50 entries
    while (log.children.length > 50) {
        log.removeChild(log.firstChild);
    }
}

function clearAutomationLog() {
    const log = document.getElementById('automation-log');
    if (log) {
        log.innerHTML = '<div class="log-entry log-info">Log cleared.</div>';
    }
}

async function loadAutomationStatus() {
    try {
        const res = await fetch(`${API_BASE}/automation/status`);
        const status = await res.json();

        // Update status badge
        const badge = document.getElementById('auto-badge');
        const badgeText = document.getElementById('auto-badge-text');
        const statusDot = document.getElementById('auto-status-dot');

        if (badge && badgeText) {
            if (status.running) {
                badge.classList.add('running');
                badgeText.textContent = 'Running';
            } else {
                badge.classList.remove('running');
                badgeText.textContent = 'Stopped';
            }
        }

        // Update stats
        const todayEl = document.getElementById('auto-today-count');
        const cycleEl = document.getElementById('auto-cycle-count');
        const limitEl = document.getElementById('auto-limit');
        const intervalEl = document.getElementById('auto-interval');

        if (todayEl) todayEl.textContent = status.stats?.todayContacted || 0;
        if (cycleEl) cycleEl.textContent = status.stats?.cycleCount || 0;
        if (limitEl) limitEl.textContent = status.config?.maxOutreachPerDay || 50;
        if (intervalEl) intervalEl.textContent = `${status.config?.intervalMinutes || 60}m`;

        // Toggle button states
        const startBtn = document.getElementById('start-auto-btn');
        const stopBtn = document.getElementById('stop-auto-btn');

        if (startBtn && stopBtn) {
            startBtn.disabled = status.running;
            stopBtn.disabled = !status.running;
        }

        // Show last cycle result if available
        if (status.lastCycle) {
            showCycleResult(status.lastCycle);
        }
    } catch (err) {
        console.error('Failed to load automation status:', err);
    }
}

async function runAutomationCycle() {
    const btn = document.getElementById('run-cycle-btn');
    const btnText = btn?.querySelector('.btn-text');
    const btnIcon = btn?.querySelector('.btn-icon');

    if (btn) {
        btn.disabled = true;
        if (btnIcon) btnIcon.textContent = '⏳';
        if (btnText) btnText.textContent = 'Running...';
    }

    addLogEntry('Starting automation cycle...', 'step');

    try {
        const res = await fetch(`${API_BASE}/automation/run-cycle`, { method: 'POST' });
        const result = await res.json();

        // Log the results
        const stats = result.stats || {};
        addLogEntry(`Discovered ${stats.leadsDiscovered || 0} leads from 2GIS`, 'info');
        addLogEntry(`Qualified ${stats.leadsQualified || 0} leads`, 'info');
        addLogEntry(`Contacted ${stats.leadsContacted || 0} leads`, 'info');

        if (stats.errors && stats.errors.length > 0) {
            stats.errors.forEach(err => addLogEntry(err, 'error'));
        }

        addLogEntry(`Cycle complete in ${result.duration || 0}ms`, 'success');

        showCycleResult(result);

        // Refresh data
        loadLeads();
        loadStats();
        loadAutomationStatus();
    } catch (err) {
        addLogEntry(`Cycle failed: ${err.message}`, 'error');
    } finally {
        if (btn) {
            btn.disabled = false;
            if (btnIcon) btnIcon.textContent = '▶';
            if (btnText) btnText.textContent = 'Run Cycle';
        }
    }
}

async function startAutomation() {
    const interval = prompt('Interval in minutes (default 60):', '60');
    if (interval === null) return;

    const btn = document.getElementById('start-auto-btn');
    if (btn) btn.disabled = true;

    addLogEntry(`Starting automation with ${interval}min interval...`, 'step');

    try {
        await fetch(`${API_BASE}/automation/start`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ intervalMinutes: parseInt(interval) || 60 })
        });

        addLogEntry('Automation started successfully', 'success');
        loadAutomationStatus();
    } catch (err) {
        addLogEntry(`Failed to start: ${err.message}`, 'error');
        if (btn) btn.disabled = false;
    }
}

async function stopAutomation() {
    const btn = document.getElementById('stop-auto-btn');
    if (btn) btn.disabled = true;

    addLogEntry('Stopping automation...', 'step');

    try {
        await fetch(`${API_BASE}/automation/stop`, { method: 'POST' });
        addLogEntry('Automation stopped', 'warning');
        loadAutomationStatus();
    } catch (err) {
        addLogEntry(`Failed to stop: ${err.message}`, 'error');
        if (btn) btn.disabled = false;
    }
}

function showCycleResult(result) {
    const container = document.getElementById('last-cycle-result');
    const discovered = document.getElementById('cycle-discovered');
    const qualified = document.getElementById('cycle-qualified');
    const contacted = document.getElementById('cycle-contacted');

    if (container && result.stats) {
        if (discovered) discovered.textContent = result.stats.leadsDiscovered || 0;
        if (qualified) qualified.textContent = result.stats.leadsQualified || 0;
        if (contacted) contacted.textContent = result.stats.leadsContacted || 0;
        container.classList.remove('hidden');
    }
}

// =====================================================
// WHATSAPP INBOX
// =====================================================

let currentConversationJid = null;

// Setup WhatsApp inbox handlers
document.addEventListener('DOMContentLoaded', () => {
    setupWhatsAppInbox();
    loadWhatsAppStatus();
    loadConversations();

    // Poll for updates every 5 seconds
    setInterval(() => {
        loadWhatsAppStatus();
        loadConversations();
        if (currentConversationJid) {
            loadMessages(currentConversationJid);
        }
    }, 5000);
});

function setupWhatsAppInbox() {
    const connectBtn = document.getElementById('wa-connect-btn');
    const replyBtn = document.getElementById('wa-reply-btn');
    const replyInput = document.getElementById('wa-reply-input');

    connectBtn?.addEventListener('click', connectWhatsApp);
    replyBtn?.addEventListener('click', sendReply);

    replyInput?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendReply();
        }
    });
}

async function loadWhatsAppStatus() {
    try {
        const res = await fetch(`${API_BASE}/whatsapp/status`);
        if (!res.ok) return;

        const status = await res.json();

        const dot = document.getElementById('wa-conn-dot');
        const text = document.getElementById('wa-conn-text');
        const connectBtn = document.getElementById('wa-connect-btn');
        const qrContainer = document.getElementById('wa-qr-container');
        const qrCode = document.getElementById('wa-qr-code');
        const inboxBody = document.querySelector('.wa-inbox-body');

        if (status.connected) {
            dot?.classList.remove('offline');
            dot?.classList.add('online');
            if (text) text.textContent = 'Connected';
            if (connectBtn) {
                connectBtn.textContent = 'Reconnect';
                connectBtn.classList.remove('btn-success');
                connectBtn.classList.add('btn-secondary');
            }
            // Hide QR, show inbox
            if (qrContainer) qrContainer.style.display = 'none';
            if (inboxBody) inboxBody.style.display = 'flex';
        } else if (status.qr) {
            // Show QR code for scanning
            dot?.classList.remove('online');
            dot?.classList.add('offline');
            if (text) text.textContent = 'Scan QR Code';
            if (connectBtn) connectBtn.style.display = 'none';

            // Render QR code
            if (qrContainer && qrCode) {
                qrContainer.style.display = 'block';
                if (inboxBody) inboxBody.style.display = 'none';

                // Clear previous QR
                qrCode.innerHTML = '';

                // Create canvas for QR
                const canvas = document.createElement('canvas');
                canvas.id = 'wa-qr-canvas';
                qrCode.appendChild(canvas);

                // Render QR using QRious
                if (typeof QRious !== 'undefined') {
                    new QRious({
                        element: canvas,
                        value: status.qr,
                        size: 256,
                        background: '#ffffff',
                        foreground: '#000000',
                        level: 'M'
                    });
                }
            }
        } else {
            dot?.classList.remove('online');
            dot?.classList.add('offline');
            if (text) text.textContent = 'Disconnected';
            if (connectBtn) {
                connectBtn.style.display = 'inline-block';
                connectBtn.textContent = 'Connect';
                connectBtn.classList.add('btn-success');
                connectBtn.classList.remove('btn-secondary');
            }
            // Hide QR, show inbox
            if (qrContainer) qrContainer.style.display = 'none';
            if (inboxBody) inboxBody.style.display = 'flex';
        }
    } catch (err) {
        console.error('Failed to load WhatsApp status:', err);
    }
}

async function loadConversations() {
    try {
        const res = await fetch(`${API_BASE}/whatsapp/conversations`);
        if (!res.ok) return;

        const data = await res.json();
        const container = document.getElementById('wa-conversations');
        if (!container) return;

        // Update unread badge
        const totalUnread = data.conversations.reduce((sum, c) => sum + (c.unreadCount || 0), 0);
        const unreadBadge = document.getElementById('wa-unread-badge');
        if (unreadBadge) {
            unreadBadge.textContent = totalUnread;
            unreadBadge.style.display = totalUnread > 0 ? 'inline-block' : 'none';
        }

        if (data.conversations.length === 0) {
            container.innerHTML = `
                <div class="wa-conv-empty">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                    </svg>
                    <p>No conversations yet</p>
                    <small>Send outreach messages to see them here</small>
                </div>
            `;
            return;
        }

        container.innerHTML = data.conversations.map(conv => {
            const name = conv.leadName || conv.phone;
            const initial = name.charAt(0).toUpperCase();
            const time = formatRelativeTime(conv.lastMessageTime);
            const isActive = conv.jid === currentConversationJid;

            return `
                <div class="wa-conv-item ${isActive ? 'active' : ''}" onclick="openConversation('${conv.jid}', '${escapeHtml(name)}', '${conv.phone}')">
                    <span class="wa-avatar">${initial}</span>
                    <div class="wa-conv-info">
                        <div class="wa-conv-name">${escapeHtml(name)}</div>
                        <div class="wa-conv-preview">${escapeHtml(conv.lastMessage || '')}</div>
                    </div>
                    <div class="wa-conv-meta">
                        <div class="wa-conv-time">${time}</div>
                        ${conv.unreadCount > 0 ? `<span class="wa-conv-unread">${conv.unreadCount}</span>` : ''}
                    </div>
                </div>
            `;
        }).join('');

    } catch (err) {
        console.error('Failed to load conversations:', err);
    }
}

async function openConversation(jid, name, phone) {
    currentConversationJid = jid;

    // Highlight active conversation
    document.querySelectorAll('.wa-conv-item').forEach(el => el.classList.remove('active'));
    event?.target?.closest('.wa-conv-item')?.classList.add('active');

    // Show chat components
    document.querySelector('.wa-chat-empty')?.classList.add('hidden');
    document.getElementById('wa-chat-header')?.classList.remove('hidden');
    document.getElementById('wa-reply')?.classList.remove('hidden');

    // Update header
    document.getElementById('wa-chat-avatar').textContent = name.charAt(0).toUpperCase();
    document.getElementById('wa-chat-name').textContent = name;
    document.getElementById('wa-chat-phone').textContent = phone;

    await loadMessages(jid);
}

async function loadMessages(jid) {
    try {
        const res = await fetch(`${API_BASE}/whatsapp/messages/${encodeURIComponent(jid)}`);
        if (!res.ok) return;

        const data = await res.json();
        const container = document.getElementById('wa-messages');
        if (!container) return;

        container.innerHTML = data.messages.map(msg => {
            const time = new Date(msg.timestamp).toLocaleTimeString('en-US', {
                hour: '2-digit',
                minute: '2-digit'
            });

            return `
                <div class="wa-message ${msg.direction}">
                    <div class="wa-message-content">${escapeHtml(msg.content)}</div>
                    <div class="wa-message-time">${time}</div>
                </div>
            `;
        }).join('');

        container.scrollTop = container.scrollHeight;

    } catch (err) {
        console.error('Failed to load messages:', err);
    }
}

async function sendReply() {
    if (!currentConversationJid) return;

    const input = document.getElementById('wa-reply-input');
    const message = input?.value?.trim();
    if (!message) return;

    const btn = document.getElementById('wa-reply-btn');
    if (btn) btn.disabled = true;
    input.value = '';

    try {
        const res = await fetch(`${API_BASE}/whatsapp/reply/${encodeURIComponent(currentConversationJid)}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message })
        });

        const result = await res.json();

        if (result.success) {
            await loadMessages(currentConversationJid);
            await loadConversations();
        } else {
            alert('Failed to send: ' + (result.error || 'Unknown error'));
        }

    } catch (err) {
        alert('Error: ' + err.message);
    } finally {
        if (btn) btn.disabled = false;
        input?.focus();
    }
}

async function connectWhatsApp() {
    const modal = document.getElementById('qr-modal');
    const loading = document.getElementById('qr-loading');
    const display = document.getElementById('qr-display');
    const connected = document.getElementById('qr-connected');
    const qrContainer = document.getElementById('qr-code');

    // Show modal
    modal?.classList.remove('hidden');
    loading?.classList.remove('hidden');
    display?.classList.add('hidden');
    connected?.classList.add('hidden');

    // Close button handler
    document.getElementById('close-qr-modal')?.addEventListener('click', () => {
        modal?.classList.add('hidden');
    });

    try {
        // Trigger connect
        await fetch(`${API_BASE}/whatsapp/connect`, { method: 'POST' });

        let attempts = 0;
        let lastQR = '';

        // Poll for QR code and status
        const poll = setInterval(async () => {
            attempts++;

            // Check status
            const statusRes = await fetch(`${API_BASE}/whatsapp/status`);
            const status = await statusRes.json();

            if (status.connected) {
                clearInterval(poll);
                loading?.classList.add('hidden');
                display?.classList.add('hidden');
                connected?.classList.remove('hidden');
                await loadMsgStatus();
                setTimeout(() => modal?.classList.add('hidden'), 2000);
                return;
            }

            // Get QR code
            const qrRes = await fetch(`${API_BASE}/whatsapp/qr`);
            const qrData = await qrRes.json();

            if (qrData.hasQR && qrData.qr !== lastQR) {
                lastQR = qrData.qr;
                loading?.classList.add('hidden');
                display?.classList.remove('hidden');

                // Generate QR code using qrcode library or simple text
                if (qrContainer) {
                    // Use a simple approach - create image from QR API
                    qrContainer.innerHTML = `<img src="https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(qrData.qr)}" alt="QR Code" style="width: 200px; height: 200px;">`;
                }
            }

            if (attempts > 60) { // 2 minutes timeout
                clearInterval(poll);
                showToast('Connection timed out', 'error');
                modal?.classList.add('hidden');
            }
        }, 2000);

    } catch (err) {
        showToast('Failed to connect: ' + err.message, 'error');
        modal?.classList.add('hidden');
    }
}

function formatRelativeTime(timestamp) {
    const now = Date.now();
    const diff = now - timestamp;

    if (diff < 60000) return 'now';
    if (diff < 3600000) return Math.floor(diff / 60000) + 'm';
    if (diff < 86400000) return Math.floor(diff / 3600000) + 'h';
    return Math.floor(diff / 86400000) + 'd';
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// ========== MESSAGES VIEW ==========

let currentMsgConversation = null;

// Load messages view
async function loadMessagesView() {
    await loadMsgStatus();
    await loadMsgConversations();
}

// Load connection status for Messages view
async function loadMsgStatus() {
    try {
        // WhatsApp status
        const waRes = await fetch(`${API_BASE}/whatsapp/status`);
        const waStatus = await waRes.json();

        // Telegram status
        let tgStatus = { connected: false };
        try {
            const tgRes = await fetch(`${API_BASE}/telegram/status`);
            tgStatus = await tgRes.json();
        } catch (e) { /* Telegram might not be configured */ }

        const dot = document.getElementById('msg-conn-dot');
        const text = document.getElementById('msg-conn-text');
        const connectBtn = document.getElementById('msg-connect-btn');

        // Build status text
        const statuses = [];
        if (waStatus.connected) statuses.push('💬 WhatsApp');
        if (tgStatus.connected) statuses.push('✈️ Telegram');

        if (statuses.length > 0) {
            dot?.classList.add('online');
            if (text) text.textContent = statuses.join(' • ');
            // Update button to show connected state
            if (connectBtn) {
                connectBtn.textContent = '✓ Connected';
                connectBtn.classList.remove('btn-success');
                connectBtn.classList.add('btn-secondary');
                connectBtn.disabled = true;
            }
        } else {
            dot?.classList.remove('online');
            if (text) text.textContent = waStatus.qr ? 'Scan QR' : 'Disconnected';
            // Show Connect button
            if (connectBtn) {
                connectBtn.textContent = 'Connect';
                connectBtn.classList.remove('btn-secondary');
                connectBtn.classList.add('btn-success');
                connectBtn.disabled = false;
            }
        }
    } catch (err) {
        console.error('Failed to load msg status:', err);
    }
}

// Load conversations for Messages view
async function loadMsgConversations() {
    try {
        const res = await fetch(`${API_BASE}/whatsapp/conversations`);
        const data = await res.json();

        const list = document.getElementById('msg-conversation-list');
        if (!list) return;

        // Clear empty state
        const emptyState = list.querySelector('.msg-empty-state');

        if (!data.conversations || data.conversations.length === 0) {
            if (emptyState) emptyState.style.display = 'flex';
            return;
        }

        if (emptyState) emptyState.style.display = 'none';

        // Remove existing items (keep empty state)
        list.querySelectorAll('.msg-conv-item').forEach(el => el.remove());

        // Render conversations
        data.conversations.forEach(conv => {
            const cleanedPhone = cleanPhone(conv.phone);
            const displayName = conv.contactName || cleanedPhone;
            const initials = getInitials(displayName);
            const color = getAvatarColor(cleanedPhone);

            const item = document.createElement('div');
            item.className = 'msg-conv-item' + (currentMsgConversation === conv.jid ? ' active' : '');
            item.dataset.jid = conv.jid;

            item.innerHTML = `
                <div class="msg-conv-avatar" style="background: ${color}">${initials}</div>
                <div class="msg-conv-content">
                    <div class="msg-conv-name">
                        <span class="channel-badge whatsapp" title="WhatsApp">💬</span>
                        ${escapeHtml(displayName)}
                    </div>
                    <div class="msg-conv-preview">${escapeHtml(conv.lastMessage || '')}</div>
                </div>
                <div class="msg-conv-meta">
                    <div class="msg-conv-time">${formatRelativeTime(conv.lastMessageTime)}</div>
                    ${conv.unreadCount > 0 ? `<div class="msg-conv-unread">${conv.unreadCount}</div>` : ''}
                </div>
            `;

            item.addEventListener('click', () => selectMsgConversation(conv));
            list.appendChild(item);
        });

        // Update nav badge
        const totalUnread = data.conversations.reduce((sum, c) => sum + (c.unreadCount || 0), 0);
        const badge = document.getElementById('nav-messages-badge');
        if (badge) {
            badge.textContent = totalUnread;
            badge.style.display = totalUnread > 0 ? 'inline-block' : 'none';
        }

    } catch (err) {
        console.error('Failed to load conversations:', err);
    }
}

// Select a conversation
async function selectMsgConversation(conv) {
    currentMsgConversation = conv.jid;

    // Update active state
    document.querySelectorAll('.msg-conv-item').forEach(el => {
        el.classList.toggle('active', el.dataset.jid === conv.jid);
    });

    // Show chat header
    const header = document.getElementById('msg-chat-header');
    const input = document.getElementById('msg-chat-input');
    if (header) header.style.display = 'block';
    if (input) input.style.display = 'flex';

    // Update header info
    const cleanedPhone = cleanPhone(conv.phone);
    const displayName = conv.contactName || cleanedPhone;
    const avatar = document.getElementById('msg-avatar');
    const name = document.getElementById('msg-contact-name');
    const phone = document.getElementById('msg-contact-phone');

    if (avatar) {
        avatar.textContent = getInitials(displayName);
        avatar.style.background = getAvatarColor(conv.phone);
    }
    if (name) name.textContent = displayName;
    if (phone) phone.textContent = conv.contactName ? conv.phone : '';

    // Load messages
    await loadMsgMessages(conv.jid);
}

// Load messages for a conversation
async function loadMsgMessages(jid) {
    try {
        const res = await fetch(`${API_BASE}/whatsapp/messages/${encodeURIComponent(jid)}`);
        const data = await res.json();

        const container = document.getElementById('msg-chat-messages');
        if (!container) return;

        // Clear select prompt
        container.innerHTML = '';

        if (!data.messages || data.messages.length === 0) {
            container.innerHTML = '<div class="msg-select-prompt"><p>No messages yet</p></div>';
            return;
        }

        // Render messages
        data.messages.forEach(msg => {
            const bubble = document.createElement('div');
            bubble.className = `msg-bubble ${msg.direction}`;
            bubble.innerHTML = `
                ${escapeHtml(msg.content)}
                <div class="msg-bubble-time">${formatRelativeTime(msg.timestamp)}</div>
            `;
            container.appendChild(bubble);
        });

        // Scroll to bottom
        container.scrollTop = container.scrollHeight;

        // Refresh conversations to update unread
        await loadMsgConversations();

    } catch (err) {
        console.error('Failed to load messages:', err);
    }
}

// Send message
async function sendMsgMessage() {
    if (!currentMsgConversation) return;

    const input = document.getElementById('msg-input-field');
    const message = input?.value?.trim();
    if (!message) return;

    input.value = '';

    try {
        await fetch(`${API_BASE}/whatsapp/reply/${encodeURIComponent(currentMsgConversation)}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message })
        });

        // Reload messages
        await loadMsgMessages(currentMsgConversation);

    } catch (err) {
        console.error('Failed to send message:', err);
        alert('Failed to send message');
    }
}

// Clean phone number for display - remove WhatsApp suffixes
function cleanPhone(phone) {
    if (!phone) return '';
    return phone
        .replace(/@s\.whatsapp\.net/g, '')
        .replace(/@lid/g, '')
        .replace(/@c\.us/g, '')
        .replace(/@g\.us/g, '');
}

// Get initials from name
function getInitials(name) {
    if (!name) return '?';

    // Handle phone numbers
    if (name.startsWith('+')) {
        return name.slice(-2);
    }

    const parts = name.trim().split(/\s+/);
    if (parts.length === 1) {
        return parts[0].substring(0, 2).toUpperCase();
    }
    return (parts[0][0] + (parts[1]?.[0] || '')).toUpperCase();
}

// Get consistent color for avatar based on phone
function getAvatarColor(phone) {
    const colors = [
        'linear-gradient(135deg, #6366f1, #8b5cf6)',
        'linear-gradient(135deg, #f472b6, #ec4899)',
        'linear-gradient(135deg, #14b8a6, #0d9488)',
        'linear-gradient(135deg, #f59e0b, #d97706)',
        'linear-gradient(135deg, #3b82f6, #2563eb)',
        'linear-gradient(135deg, #22c55e, #16a34a)',
        'linear-gradient(135deg, #ef4444, #dc2626)',
        'linear-gradient(135deg, #8b5cf6, #7c3aed)'
    ];

    const hash = phone.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
    return colors[hash % colors.length];
}

// Setup Messages view event handlers
function setupMessagesView() {
    // Connect button
    const connectBtn = document.getElementById('msg-connect-btn');
    connectBtn?.addEventListener('click', async () => {
        await connectWhatsApp();
        await loadMsgStatus();
        await loadMsgConversations();
    });

    // New Message button
    const newMsgBtn = document.getElementById('msg-new-btn');
    const newMsgModal = document.getElementById('new-msg-modal');
    const closeNewMsgBtn = document.getElementById('close-new-msg-modal');
    const cancelNewMsgBtn = document.getElementById('cancel-new-msg');
    const sendNewMsgBtn = document.getElementById('send-new-msg');

    newMsgBtn?.addEventListener('click', () => {
        newMsgModal?.classList.remove('hidden');
        document.getElementById('new-msg-phone')?.focus();
    });

    closeNewMsgBtn?.addEventListener('click', () => {
        newMsgModal?.classList.add('hidden');
    });

    cancelNewMsgBtn?.addEventListener('click', () => {
        newMsgModal?.classList.add('hidden');
    });

    sendNewMsgBtn?.addEventListener('click', async () => {
        const phoneInput = document.getElementById('new-msg-phone');
        const textInput = document.getElementById('new-msg-text');
        const phone = phoneInput?.value?.trim();
        const message = textInput?.value?.trim();

        if (!phone) {
            showToast('Please enter a phone number', 'error');
            return;
        }
        if (!message) {
            showToast('Please enter a message', 'error');
            return;
        }

        try {
            sendNewMsgBtn.disabled = true;
            sendNewMsgBtn.textContent = 'Sending...';

            const res = await fetch(`${API_BASE}/whatsapp/reply/${encodeURIComponent(phone)}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message })
            });
            const result = await res.json();

            if (result.success) {
                showToast('Message sent!', 'success');
                phoneInput.value = '';
                textInput.value = '';
                newMsgModal?.classList.add('hidden');
                // Reload conversations to show the new one
                await loadMsgConversations();
                // Select the new conversation
                currentMsgConversation = phone;
                await loadMsgMessages(phone);
            } else {
                showToast('Failed to send: ' + (result.error || 'Unknown error'), 'error');
            }
        } catch (err) {
            showToast('Failed to send message', 'error');
        } finally {
            sendNewMsgBtn.disabled = false;
            sendNewMsgBtn.textContent = 'Send Message';
        }
    });

    // Send button
    const sendBtn = document.getElementById('msg-send-btn');
    sendBtn?.addEventListener('click', sendMsgMessage);

    // Enter key to send
    const inputField = document.getElementById('msg-input-field');
    inputField?.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            sendMsgMessage();
        }
    });

    // Search
    const searchInput = document.getElementById('msg-search-input');
    searchInput?.addEventListener('input', (e) => {
        const query = e.target.value.toLowerCase();
        document.querySelectorAll('.msg-conv-item').forEach(item => {
            const name = item.querySelector('.msg-conv-name')?.textContent?.toLowerCase() || '';
            const preview = item.querySelector('.msg-conv-preview')?.textContent?.toLowerCase() || '';
            item.style.display = (name.includes(query) || preview.includes(query)) ? 'flex' : 'none';
        });
    });

    // Template picker
    const templateBtn = document.getElementById('msg-template-btn');
    const templatePicker = document.getElementById('msg-template-picker');
    const templateClose = document.getElementById('msg-template-close');
    const templateList = document.getElementById('msg-template-list');

    templateBtn?.addEventListener('click', async () => {
        if (templatePicker.style.display === 'none') {
            await loadTemplates();
            templatePicker.style.display = 'block';
        } else {
            templatePicker.style.display = 'none';
        }
    });

    templateClose?.addEventListener('click', () => {
        templatePicker.style.display = 'none';
    });

    async function loadTemplates() {
        try {
            const res = await fetch(`${API_BASE}/templates`);
            const data = await res.json();

            templateList.innerHTML = data.templates.map(t => `
                <div class="template-item" data-id="${t.id}" data-content="${encodeURIComponent(t.content)}">
                    <div class="template-item-name">
                        ${t.name}
                        <span class="template-item-category">${t.category}</span>
                    </div>
                    <div class="template-item-preview">${t.content.substring(0, 60)}...</div>
                </div>
            `).join('');

            // Add click handlers
            templateList.querySelectorAll('.template-item').forEach(item => {
                item.addEventListener('click', () => {
                    const content = decodeURIComponent(item.dataset.content);
                    const inputField = document.getElementById('msg-input-field');
                    inputField.value = content;
                    inputField.focus();
                    templatePicker.style.display = 'none';
                });
            });
        } catch (err) {
            console.error('Failed to load templates:', err);
            templateList.innerHTML = '<div class="template-item">Failed to load templates</div>';
        }
    }

    // Attachment handling
    const attachBtn = document.getElementById('msg-attach-btn');
    const fileInput = document.getElementById('msg-file-input');
    const attachmentPreview = document.getElementById('msg-attachment-preview');
    const attachmentName = document.getElementById('attachment-name');
    const attachmentRemove = document.getElementById('attachment-remove');

    let selectedFile = null;

    attachBtn?.addEventListener('click', () => {
        fileInput?.click();
    });

    fileInput?.addEventListener('change', (e) => {
        const file = e.target.files?.[0];
        if (file) {
            selectedFile = file;
            attachmentName.textContent = file.name;
            attachmentPreview.style.display = 'flex';
        }
    });

    attachmentRemove?.addEventListener('click', () => {
        selectedFile = null;
        fileInput.value = '';
        attachmentPreview.style.display = 'none';
    });

    // Override send to support media
    const originalSendBtn = document.getElementById('msg-send-btn');
    if (originalSendBtn) {
        originalSendBtn.removeEventListener('click', sendMsgMessage);
        originalSendBtn.addEventListener('click', async () => {
            if (selectedFile) {
                await sendMediaMessage();
            } else {
                await sendMsgMessage();
            }
        });
    }

    async function sendMediaMessage() {
        if (!currentMsgConversation || !selectedFile) return;

        const caption = document.getElementById('msg-input-field')?.value?.trim() || '';

        try {
            // Read file as base64
            const reader = new FileReader();
            reader.onload = async (e) => {
                const base64Data = e.target.result.split(',')[1]; // Remove data URL prefix

                const response = await fetch(`${API_BASE}/whatsapp/media/${encodeURIComponent(currentMsgConversation)}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        data: base64Data,
                        mimetype: selectedFile.type,
                        filename: selectedFile.name,
                        caption: caption
                    })
                });

                const result = await response.json();
                if (result.success) {
                    // Clear input and reload messages
                    document.getElementById('msg-input-field').value = '';
                    selectedFile = null;
                    fileInput.value = '';
                    attachmentPreview.style.display = 'none';
                    await loadMsgMessages(currentMsgConversation);
                } else {
                    alert('Failed to send media: ' + (result.error || 'Unknown error'));
                }
            };
            reader.readAsDataURL(selectedFile);
        } catch (err) {
            console.error('Failed to send media:', err);
            alert('Failed to send media');
        }
    }
}

// Initialize on load
document.addEventListener('DOMContentLoaded', () => {
    setupMessagesView();
    setupLeadDetailPanel();
    setupScraperModal();
    setupSettingsView();
});

// Setup Settings view handlers
function setupSettingsView() {
    // WhatsApp connect button in settings
    const waConnectBtn = document.getElementById('settings-wa-connect');
    waConnectBtn?.addEventListener('click', async () => {
        await connectWhatsApp();
        await loadSettingsStatus();
    });

    // Load initial status
    loadSettingsStatus();
}

// Load channel status for Settings page
async function loadSettingsStatus() {
    try {
        // WhatsApp status
        const waRes = await fetch(`${API_BASE}/whatsapp/status`);
        const waStatus = await waRes.json();

        const waDot = document.getElementById('settings-wa-dot');
        const waText = document.getElementById('settings-wa-text');
        const waConnectBtn = document.getElementById('settings-wa-connect');

        if (waStatus.connected) {
            waDot?.classList.add('online');
            waDot?.classList.remove('offline');
            if (waText) waText.textContent = 'Подключен ✓';
            if (waConnectBtn) {
                waConnectBtn.textContent = '✓ Подключено';
                waConnectBtn.disabled = true;
                waConnectBtn.classList.remove('btn-success');
                waConnectBtn.classList.add('btn-secondary');
            }
        } else {
            waDot?.classList.remove('online');
            waDot?.classList.add('offline');
            if (waText) waText.textContent = 'Не подключен';
            if (waConnectBtn) {
                waConnectBtn.textContent = 'Подключить WhatsApp';
                waConnectBtn.disabled = false;
                waConnectBtn.classList.add('btn-success');
                waConnectBtn.classList.remove('btn-secondary');
            }
        }

        // Telegram status
        try {
            const tgRes = await fetch(`${API_BASE}/telegram/status`);
            const tgStatus = await tgRes.json();
            const tgDot = document.querySelector('#tg-status .status-indicator');
            if (tgStatus.connected) {
                tgDot?.classList.add('online');
                tgDot?.classList.remove('offline');
            }
        } catch (e) { /* Telegram might not be configured */ }

    } catch (err) {
        console.error('Failed to load settings status:', err);
    }
}

// ===== Toast Notifications =====
function showToast(message, type = 'success') {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `
        <span>${message}</span>
        <button onclick="this.parentElement.remove()" style="background:none;border:none;color:var(--text-muted);cursor:pointer;">×</button>
    `;
    container.appendChild(toast);

    setTimeout(() => toast.remove(), 4000);
}

// ===== Lead Detail Panel =====
let currentDetailLead = null;

function setupLeadDetailPanel() {
    const panel = document.getElementById('lead-detail-panel');
    const closeBtn = document.getElementById('close-lead-detail');

    closeBtn?.addEventListener('click', () => {
        panel?.classList.add('hidden');
        currentDetailLead = null;
    });

    // State change handler
    document.getElementById('lead-detail-state')?.addEventListener('change', async (e) => {
        if (!currentDetailLead) return;
        try {
            await fetch(`${API_BASE}/leads/${currentDetailLead.id}/state`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ state: e.target.value })
            });
            showToast('Status updated');
            loadLeads();
        } catch (err) {
            showToast('Failed to update status', 'error');
        }
    });

    // Enrich button
    document.getElementById('lead-enrich-btn')?.addEventListener('click', async () => {
        if (!currentDetailLead) return;
        try {
            const res = await fetch(`${API_BASE}/leads/${currentDetailLead.id}/enrich`, { method: 'POST' });
            const data = await res.json();
            showToast(data.enriched ? `Enriched: ${data.fieldsUpdated.join(', ')}` : 'No changes');
            loadLeads();
        } catch (err) {
            showToast('Enrichment failed', 'error');
        }
    });

    // Start sequence button
    document.getElementById('lead-start-sequence')?.addEventListener('click', async () => {
        if (!currentDetailLead) return;
        try {
            await fetch(`${API_BASE}/leads/${currentDetailLead.id}/sequence`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sequence: 'cold_outreach' })
            });
            showToast('Sequence started');
        } catch (err) {
            showToast('Failed to start sequence', 'error');
        }
    });

    // Add tag
    document.getElementById('lead-add-tag-btn')?.addEventListener('click', async () => {
        const input = document.getElementById('lead-add-tag-input');
        const tag = input?.value?.trim();
        if (!tag || !currentDetailLead) return;

        try {
            await fetch(`${API_BASE}/leads/bulk/tags`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ids: [currentDetailLead.id], tags: [tag] })
            });
            input.value = '';
            showToast('Tag added');
            loadLeads();
            openLeadDetail(currentDetailLead.id);
        } catch (err) {
            showToast('Failed to add tag', 'error');
        }
    });
}

function openLeadDetail(leadId) {
    const lead = allLeads.find(l => l.id === leadId);
    if (!lead) return;

    currentDetailLead = lead;
    const panel = document.getElementById('lead-detail-panel');

    // Populate header
    document.getElementById('lead-detail-name').textContent =
        lead.companyName || `${lead.firstName} ${lead.lastName || ''}`.trim() || 'Unnamed Lead';

    // Populate form fields
    document.getElementById('detail-company').value = lead.companyName || '';
    document.getElementById('detail-firstname').value = lead.firstName || '';
    document.getElementById('detail-lastname').value = lead.lastName || '';
    document.getElementById('detail-email').value = lead.email || '';
    document.getElementById('detail-phone').value = lead.phone || '';
    document.getElementById('detail-whatsapp').value = lead.whatsappNumber || lead.phone || '';
    document.getElementById('detail-website').value = lead.website || '';
    document.getElementById('detail-instagram').value = lead.instagramHandle || '';
    document.getElementById('detail-telegram').value = lead.telegramHandle || '';
    document.getElementById('detail-facebook').value = lead.facebookUrl || '';

    // State
    document.getElementById('lead-detail-state').value = lead.state || 'discovered';

    // Tags
    const tagsEl = document.getElementById('lead-detail-tags');
    tagsEl.innerHTML = (lead.tags || []).map(t =>
        `<span class="tag">${t}</span>`
    ).join('');

    // Notes
    const notesEl = document.getElementById('lead-detail-notes');
    notesEl.innerHTML = (lead.notes || []).map(n =>
        `<div class="note-item">${n}</div>`
    ).join('') || '<div class="note-item" style="color:var(--text-muted)">No notes</div>';

    // Setup action button handlers
    setupLeadDetailActions(lead);

    // Show panel
    panel?.classList.remove('hidden');
}

// Setup action buttons for lead detail panel
function setupLeadDetailActions(lead) {
    // WhatsApp button
    const waBtn = document.getElementById('lead-send-message');
    waBtn.onclick = () => {
        const phone = lead.whatsappNumber || lead.phone;
        if (phone) {
            // Open new message modal with phone prefilled
            document.getElementById('new-msg-modal')?.classList.remove('hidden');
            document.getElementById('new-msg-phone').value = phone;
            document.getElementById('new-msg-text')?.focus();
        } else {
            showToast('No phone number available', 'error');
        }
    };

    // Call button
    const callBtn = document.getElementById('lead-call-btn');
    callBtn.onclick = () => {
        const phone = lead.phone || lead.whatsappNumber;
        if (phone) {
            window.open(`tel:${phone}`, '_self');
        } else {
            showToast('No phone number available', 'error');
        }
    };

    // Email button
    const emailBtn = document.getElementById('lead-email-btn');
    emailBtn.onclick = () => {
        if (lead.email) {
            window.open(`mailto:${lead.email}`, '_self');
        } else {
            showToast('No email available', 'error');
        }
    };

    // Save button
    const saveBtn = document.getElementById('save-lead-detail');
    saveBtn.onclick = async () => {
        const updates = {
            companyName: document.getElementById('detail-company').value,
            firstName: document.getElementById('detail-firstname').value,
            lastName: document.getElementById('detail-lastname').value,
            email: document.getElementById('detail-email').value,
            phone: document.getElementById('detail-phone').value,
            whatsappNumber: document.getElementById('detail-whatsapp').value,
            website: document.getElementById('detail-website').value,
            instagramHandle: document.getElementById('detail-instagram').value,
            telegramHandle: document.getElementById('detail-telegram').value,
            facebookUrl: document.getElementById('detail-facebook').value,
            state: document.getElementById('lead-detail-state').value
        };

        try {
            saveBtn.disabled = true;
            saveBtn.textContent = 'Saving...';

            const res = await fetch(`${API_BASE}/leads/${lead.id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(updates)
            });
            const result = await res.json();

            if (result.success) {
                showToast('Lead saved!', 'success');
                // Update local copy
                Object.assign(lead, updates);
                await loadLeads(); // Refresh list
            } else {
                showToast('Failed to save: ' + (result.error || 'Unknown error'), 'error');
            }
        } catch (err) {
            showToast('Failed to save lead', 'error');
        } finally {
            saveBtn.disabled = false;
            saveBtn.textContent = 'Save Changes';
        }
    };
}

// ===== Scraper Modal =====
let currentScraperRunId = null;
let scraperPollingInterval = null;

async function setupScraperModal() {
    const modal = document.getElementById('run-scraper-modal');
    const closeBtn = document.getElementById('close-run-scraper');
    const cancelBtn = document.getElementById('cancel-scraper');
    const startBtn = document.getElementById('start-scraper');
    const stopBtn = document.getElementById('stop-scraper');

    closeBtn?.addEventListener('click', () => closeScraperModal());
    cancelBtn?.addEventListener('click', () => closeScraperModal());

    startBtn?.addEventListener('click', async () => {
        const form = document.getElementById('run-scraper-form');
        const formData = new FormData(form);
        const params = Object.fromEntries(formData.entries());
        const scraperName = modal.dataset.scraperName;

        try {
            const res = await fetch(`${API_BASE}/scrapers/${scraperName}/run`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(params)
            });
            const data = await res.json();

            if (data.success && data.runId) {
                currentScraperRunId = data.runId;
                startBtn.classList.add('hidden');
                stopBtn.classList.remove('hidden');
                document.getElementById('scraper-output-container').classList.remove('hidden');
                startScraperPolling();
                showToast('Scraper started');
            } else {
                showToast(data.error || 'Failed to start', 'error');
            }
        } catch (err) {
            showToast('Failed to start scraper', 'error');
        }
    });

    stopBtn?.addEventListener('click', async () => {
        if (!currentScraperRunId) return;
        try {
            await fetch(`${API_BASE}/scrapers/stop/${currentScraperRunId}`, { method: 'POST' });
            showToast('Scraper stopped');
        } catch (err) {
            showToast('Failed to stop', 'error');
        }
    });
}

function openScraperModal(scraper) {
    const modal = document.getElementById('run-scraper-modal');
    modal.dataset.scraperName = scraper.name;

    document.getElementById('run-scraper-title').textContent = `Run ${scraper.displayName}`;

    // Build params form
    const container = document.getElementById('scraper-params-container');
    if (scraper.params?.length) {
        container.innerHTML = scraper.params.map(p => `
            <div class="form-group">
                <label>${p.label}</label>
                <input type="text" name="${p.name}" class="form-input" value="${p.default || ''}" placeholder="${p.label}">
            </div>
        `).join('');
    } else {
        container.innerHTML = '<p style="color:var(--text-muted)">No parameters required</p>';
    }

    // Reset state
    document.getElementById('scraper-output-container').classList.add('hidden');
    document.getElementById('scraper-output').textContent = '';
    document.getElementById('start-scraper').classList.remove('hidden');
    document.getElementById('stop-scraper').classList.add('hidden');
    currentScraperRunId = null;

    modal.classList.remove('hidden');
}

function closeScraperModal() {
    document.getElementById('run-scraper-modal')?.classList.add('hidden');
    stopScraperPolling();
    currentScraperRunId = null;
    loadLeads(); // Refresh leads after scraping
}

function startScraperPolling() {
    scraperPollingInterval = setInterval(async () => {
        if (!currentScraperRunId) return;

        try {
            const res = await fetch(`${API_BASE}/scrapers/status/${currentScraperRunId}`);
            const data = await res.json();

            const outputEl = document.getElementById('scraper-output');
            outputEl.textContent = data.output?.join('\n') || '';
            outputEl.scrollTop = outputEl.scrollHeight;

            if (data.status !== 'running') {
                stopScraperPolling();
                document.getElementById('start-scraper').classList.remove('hidden');
                document.getElementById('stop-scraper').classList.add('hidden');
                showToast(`Scraper ${data.status}`);
            }
        } catch (err) {
            console.error('Polling error:', err);
        }
    }, 2000);
}

function stopScraperPolling() {
    if (scraperPollingInterval) {
        clearInterval(scraperPollingInterval);
        scraperPollingInterval = null;
    }
}

// Make functions globally accessible
window.openLeadDetail = openLeadDetail;
window.openScraperModal = openScraperModal;
window.showToast = showToast;

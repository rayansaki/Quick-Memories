import { saveSettingsDebounced, eventSource, event_types } from '../../../../script.js';
import { extension_settings } from '../../../extensions.js';
import { loadWorldInfo, saveWorldInfo, reloadEditor, createWorldInfoEntry, world_names } from '../../../world-info.js';

const KEY = 'quick_memory';
const PIN_ORDER = 9999; // highest Order SillyTavern allows; higher = closer to the bottom of its section
const NEW_ENTRY_TITLE = 'Pinned Memories';
const CREATE_VALUE = '__create__';
const defaults = { book: '', uid: null, pin: true };
const settings = extension_settings[KEY] = Object.assign({}, defaults, extension_settings[KEY] || {});

// ---------- per-browser UI state ----------
const LS = 'qm_ui';
function loadUi() { try { return JSON.parse(localStorage.getItem(LS)) || {}; } catch { return {}; } }
function saveUi(patch) { try { localStorage.setItem(LS, JSON.stringify({ ...loadUi(), ...patch })); } catch { /* ignore */ } }

let statusTimer;
function setStatus(msg, sticky = false) {
    $('#qm_status').text(msg);
    clearTimeout(statusTimer);
    if (msg && !sticky) statusTimer = setTimeout(() => $('#qm_status').text(''), 3000);
}

// ---------- lorebook helpers ----------
const toLines = (content) => String(content || '').split('\n').map(s => s.trim()).filter(Boolean);
const oneLine = (text) => String(text || '').replace(/\s*\n\s*/g, ' ').trim();

async function getTarget() {
    if (!settings.book || settings.uid === null || settings.uid === undefined) return { error: 'Choose a lorebook and entry in Extensions → Quick Memory.' };
    const data = await loadWorldInfo(settings.book);
    if (!data?.entries) return { error: `Lorebook "${settings.book}" not found.` };
    const entry = data.entries[settings.uid];
    if (!entry) return { error: 'The selected entry no longer exists.' };
    return { data, entry };
}

/** Load the entry, let `mutate(lines)` change its memory lines, then save. */
async function modifyLines(mutate) {
    const t = await getTarget();
    if (t.error) { setStatus(t.error, true); return false; }
    const lines = toLines(t.entry.content);
    if (mutate(lines) === false) return false;
    t.entry.content = lines.join('\n');
    if (settings.pin) t.entry.order = PIN_ORDER;
    await saveWorldInfo(settings.book, t.data, true);
    reloadEditor(settings.book);
    return true;
}

// ---------- window: list rendering ----------
async function renderList({ scrollToEnd = false } = {}) {
    const list = $('#qm_list');
    if (!list.length) return;
    updateTarget();
    hideMenu();
    const t = await getTarget();
    list.empty();
    if (t.error) { list.append($('<div class="qm-empty">').text(t.error)); return; }
    const lines = toLines(t.entry.content);
    if (!lines.length) list.append($('<div class="qm-empty">').text('No memories yet.'));
    lines.forEach((line, i) => {
        const item = $('<div class="qm-item">').attr('data-i', i);
        item.append($('<div class="qm-item-text">').text(line));
        item.append($('<span class="qm-icon qm-dots fa-solid fa-ellipsis-vertical" title="Options">'));
        list.append(item);
    });
    if (scrollToEnd) list.scrollTop(list[0].scrollHeight);
}

function updateTarget() {
    $('#qm_target').text(settings.book && settings.uid !== null ? `${settings.book} / ${entryLabelCache || '#' + settings.uid}` : '');
}
let entryLabelCache = '';

// ---------- item menu ----------
let menuIndex = null;
function hideMenu() { $('#qm_menu').addClass('qm-hidden'); menuIndex = null; }
function showMenu(dots, index) {
    const win = $('#qm_window')[0].getBoundingClientRect();
    const r = dots.getBoundingClientRect();
    const menu = $('#qm_menu').removeClass('qm-hidden');
    const top = Math.min(r.bottom - win.top + 2, win.height - menu.outerHeight() - 4);
    menu.css({ top: Math.max(4, top) + 'px', right: Math.max(4, win.right - r.right) + 'px' });
    menuIndex = index;
}

function startEdit(index) {
    const item = $(`#qm_list .qm-item[data-i="${index}"]`);
    const original = item.find('.qm-item-text').text();
    const box = $('<div class="qm-item-edit">');
    const ta = $('<textarea class="text_pole">').val(original);
    const row = $('<div class="qm-row">');
    const cancel = $('<button class="menu_button">Cancel</button>');
    const save = $('<button class="menu_button">Save</button>');
    row.append(cancel, save);
    box.append(ta, row);
    item.empty().append(box);
    ta.trigger('focus');

    cancel.on('click', () => renderList());
    const doSave = async () => {
        const text = oneLine(ta.val());
        if (!text) return;
        const ok = await modifyLines(lines => {
            if (lines[index] !== original) { setStatus('Entry changed elsewhere — refreshed.'); return false; }
            lines[index] = text;
        });
        if (ok) setStatus('Saved ✓');
        renderList();
    };
    save.on('click', doSave);
    ta.on('keydown', e => {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); doSave(); }
        if (e.key === 'Escape') renderList();
    });
}

function startDelete(index) {
    const item = $(`#qm_list .qm-item[data-i="${index}"]`);
    const original = item.find('.qm-item-text').text();
    const box = $('<div class="qm-confirm">');
    box.append($('<div class="qm-item-text">').text(original).css('opacity', 0.6));
    const row = $('<div class="qm-row">').append(
        $('<span class="qm-danger" style="margin-right:auto">Delete this memory?</span>'),
        $('<button class="menu_button">Cancel</button>').on('click', () => renderList()),
        $('<button class="menu_button qm-danger">Delete</button>').on('click', async () => {
            const ok = await modifyLines(lines => {
                if (lines[index] !== original) { setStatus('Entry changed elsewhere — refreshed.'); return false; }
                lines.splice(index, 1);
            });
            if (ok) setStatus('Deleted');
            renderList();
        }),
    );
    box.append(row);
    item.empty().append(box);
}

async function addMemory() {
    const text = oneLine($('#qm_text').val());
    if (!text) return;
    const btn = $('#qm_add').prop('disabled', true);
    try {
        const ok = await modifyLines(lines => { lines.push(text); });
        if (ok) { $('#qm_text').val(''); setStatus('Added ✓'); await renderList({ scrollToEnd: true }); }
    } catch (err) {
        console.error('[Quick Memory]', err);
        setStatus('Error: ' + err.message, true);
    } finally {
        btn.prop('disabled', false);
    }
}

// ---------- window: build, drag, resize ----------
function clampIntoView(win) {
    const el = win[0];
    const r = el.getBoundingClientRect();
    el.style.left = Math.min(Math.max(0, r.left), Math.max(0, window.innerWidth - Math.min(r.width, window.innerWidth))) + 'px';
    el.style.top = Math.min(Math.max(0, r.top), Math.max(0, window.innerHeight - 40)) + 'px';
}

function buildPanel() {
    const ui = loadUi();
    const tab = $('<div id="qm_tab" title="Quick Memory">Memories</div>');
    const win = $(`
        <div id="qm_window">
            <div id="qm_header">
                <span id="qm_title">Memories</span>
                <span id="qm_refresh" class="qm-icon fa-solid fa-rotate" title="Refresh"></span>
                <span id="qm_close" class="qm-icon fa-solid fa-minus" title="Minimise"></span>
            </div>
            <div id="qm_target"></div>
            <div id="qm_list"></div>
            <div id="qm_split" title="Drag to resize"></div>
            <div id="qm_input">
                <textarea id="qm_text" class="text_pole" placeholder="Something worth remembering… (Ctrl+Enter to add)"></textarea>
                <div id="qm_footer">
                    <div id="qm_status"></div>
                    <button id="qm_add" class="menu_button">Add</button>
                </div>
            </div>
            <div id="qm_menu" class="qm-hidden">
                <div class="qm-menu-item" data-act="edit"><span>Edit Memory</span><span class="fa-solid fa-pencil"></span></div>
                <div class="qm-menu-item qm-danger" data-act="delete"><span>Delete Memory</span><span class="fa-solid fa-trash-can"></span></div>
            </div>
        </div>`);
    $('body').append(tab, win);

    win.css({
        left: ui.left ?? Math.max(0, window.innerWidth - 380) + 'px',
        top: ui.top ?? '15%',
        width: ui.width ?? '',
        height: ui.height ?? '',
    });
    if (ui.listHeight) $('#qm_list').css('height', ui.listHeight);

    const show = (open) => {
        win.toggleClass('qm-hidden', !open);
        tab.toggleClass('qm-hidden', open);
        if (open) { clampIntoView(win); renderList({ scrollToEnd: true }); }
        saveUi({ open });
    };
    show(!!ui.open);
    tab.on('click', () => show(true));
    $('#qm_close').on('click', () => show(false));
    $('#qm_refresh').on('click', () => renderList());

    // drag window by header
    const header = $('#qm_header')[0];
    let drag = null;
    header.addEventListener('pointerdown', (e) => {
        if ($(e.target).hasClass('qm-icon')) return;
        const r = win[0].getBoundingClientRect();
        drag = { dx: e.clientX - r.left, dy: e.clientY - r.top };
        header.setPointerCapture(e.pointerId);
    });
    header.addEventListener('pointermove', (e) => {
        if (!drag) return;
        const w = win[0].offsetWidth;
        win[0].style.left = Math.min(Math.max(0, e.clientX - drag.dx), window.innerWidth - Math.min(w, 60)) + 'px';
        win[0].style.top = Math.min(Math.max(0, e.clientY - drag.dy), window.innerHeight - 40) + 'px';
    });
    const endDrag = () => { if (drag) { drag = null; saveUi({ left: win[0].style.left, top: win[0].style.top }); } };
    header.addEventListener('pointerup', endDrag);
    header.addEventListener('pointercancel', endDrag);

    // splitter between list and input
    const split = $('#qm_split')[0];
    const list = $('#qm_list')[0];
    let sp = null;
    split.addEventListener('pointerdown', (e) => {
        sp = { y: e.clientY, h: list.offsetHeight };
        split.setPointerCapture(e.pointerId);
    });
    split.addEventListener('pointermove', (e) => {
        if (!sp) return;
        const inputMin = 90;
        const max = win[0].clientHeight - list.offsetTop - split.offsetHeight - inputMin;
        list.style.height = Math.max(40, Math.min(max, sp.h + e.clientY - sp.y)) + 'px';
    });
    const endSplit = () => { if (sp) { sp = null; saveUi({ listHeight: list.style.height }); } };
    split.addEventListener('pointerup', endSplit);
    split.addEventListener('pointercancel', endSplit);

    // remember window size; keep the list from swallowing the input area when shrunk
    new ResizeObserver(() => {
        if (win.hasClass('qm-hidden')) return;
        const max = win[0].clientHeight - list.offsetTop - split.offsetHeight - 90;
        if (list.offsetHeight > max) list.style.height = Math.max(40, max) + 'px';
        saveUi({ width: win[0].offsetWidth + 'px', height: win[0].offsetHeight + 'px' });
    }).observe(win[0]);
    window.addEventListener('resize', () => { if (!win.hasClass('qm-hidden')) clampIntoView(win); });

    // item menu
    $('#qm_list').on('click', '.qm-dots', function (e) {
        e.stopPropagation();
        const i = Number($(this).closest('.qm-item').attr('data-i'));
        if (menuIndex === i) hideMenu(); else showMenu(this, i);
    });
    $('#qm_menu').on('click', '.qm-menu-item', function (e) {
        e.stopPropagation();
        const i = menuIndex;
        hideMenu();
        if (i === null) return;
        if (this.dataset.act === 'edit') startEdit(i); else startDelete(i);
    });
    $(document).on('pointerdown', (e) => { if (!$(e.target).closest('#qm_menu, .qm-dots').length) hideMenu(); });
    $('#qm_list').on('wheel touchmove', hideMenu);

    $('#qm_add').on('click', addMemory);
    $('#qm_text').on('keydown', e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); addMemory(); } });
}

// ---------- settings drawer ----------
function fillBooks() {
    const sel = $('#qm_set_book').empty();
    sel.append($('<option value="">').text('— choose a lorebook —'));
    [...(world_names || [])].sort((a, b) => a.localeCompare(b)).forEach(n => sel.append($('<option>').val(n).text(n)));
    if (settings.book && !(world_names || []).includes(settings.book)) sel.append($('<option>').val(settings.book).text(settings.book + ' (missing)'));
    sel.val(settings.book || '');
}

async function fillEntries() {
    const sel = $('#qm_set_entry').empty();
    entryLabelCache = '';
    if (!settings.book) { sel.append($('<option value="">').text('— choose a lorebook first —')).prop('disabled', true); updateTarget(); return; }
    sel.prop('disabled', false);
    sel.append($('<option value="">').text('— choose an entry —'));
    const data = await loadWorldInfo(settings.book);
    const entries = Object.values(data?.entries || {}).sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.uid - b.uid);
    entries.forEach(e => sel.append($('<option>').val(String(e.uid)).text(`${e.comment || '(untitled)'}  [#${e.uid}]`)));
    sel.append($('<option>').val(CREATE_VALUE).text(`+ Create "${NEW_ENTRY_TITLE}" entry`));
    const cur = entries.find(e => e.uid === settings.uid);
    if (cur) { sel.val(String(cur.uid)); entryLabelCache = cur.comment || '(untitled)'; } else sel.val('');
    updateTarget();
}

async function createPinnedEntry() {
    const data = await loadWorldInfo(settings.book);
    if (!data?.entries) { toastr.error('Could not load that lorebook.'); return null; }
    const existing = Object.values(data.entries);
    // Use the same insertion position most entries in this book use (e.g. MemoryBooks' entries),
    // because Order only sorts entries within the same position.
    const counts = {};
    existing.forEach(e => { counts[e.position] = (counts[e.position] || 0) + 1; });
    const commonPos = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];

    const entry = createWorldInfoEntry(settings.book, data);
    if (!entry) { toastr.error('Could not create entry.'); return null; }
    entry.comment = NEW_ENTRY_TITLE;
    entry.content = '';
    entry.constant = true;
    entry.disable = false;
    entry.order = PIN_ORDER;
    if (commonPos !== undefined) entry.position = Number(commonPos);
    await saveWorldInfo(settings.book, data, true);
    reloadEditor(settings.book);
    toastr.success(`Created "${NEW_ENTRY_TITLE}" in ${settings.book}`);
    return entry.uid;
}

function buildSettings() {
    const html = $(`
        <div class="inline-drawer">
            <div class="inline-drawer-toggle inline-drawer-header">
                <b>Quick Memory</b>
                <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
            </div>
            <div class="inline-drawer-content">
                <label for="qm_set_book">Lorebook</label>
                <select id="qm_set_book" class="text_pole"></select>
                <label for="qm_set_entry">Entry</label>
                <select id="qm_set_entry" class="text_pole"></select>
                <label class="checkbox_label">
                    <input id="qm_set_pin" type="checkbox">
                    <span>Pin entry to the bottom (Order ${PIN_ORDER}, set on every change)</span>
                </label>
            </div>
        </div>`);
    $('#extensions_settings2').append(html);

    fillBooks();
    fillEntries();
    // lorebooks may be created/renamed later: refresh the list whenever the dropdown is opened
    $('#qm_set_book').on('mousedown focus', () => { const v = $('#qm_set_book').val(); fillBooks(); $('#qm_set_book').val(v); });
    $('#qm_set_book').on('change', async (e) => {
        settings.book = e.target.value;
        settings.uid = null;
        saveSettingsDebounced();
        await fillEntries();
        renderList();
    });
    $('#qm_set_entry').on('change', async (e) => {
        const v = e.target.value;
        if (v === CREATE_VALUE) {
            const uid = await createPinnedEntry();
            settings.uid = uid ?? null;
        } else {
            settings.uid = v === '' ? null : Number(v);
        }
        saveSettingsDebounced();
        await fillEntries();
        renderList({ scrollToEnd: true });
    });
    $('#qm_set_pin').prop('checked', settings.pin).on('change', e => { settings.pin = e.target.checked; saveSettingsDebounced(); });
}

// migrate v1.0/1.1 settings (entry stored by title)
async function migrate() {
    if (settings.uid === null && settings.entry && settings.book) {
        const data = await loadWorldInfo(settings.book);
        const e = Object.values(data?.entries || {}).find(x => (x.comment || '').trim() === settings.entry.trim());
        if (e) settings.uid = e.uid;
    }
    delete settings.entry;
    delete settings.prefix;
    saveSettingsDebounced();
}

jQuery(async () => {
    await migrate();
    buildSettings();
    buildPanel();
    // keep in sync when the lorebook is edited elsewhere (WI editor, MemoryBooks)
    eventSource.on(event_types.WORLDINFO_UPDATED, (name) => {
        if (name !== settings.book) return;
        if ($('#qm_list .qm-item-edit, #qm_list .qm-confirm').length) return; // don't clobber an open edit
        renderList();
        fillEntries();
    });
});

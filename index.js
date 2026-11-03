import { saveSettingsDebounced } from '../../../../script.js';
import { extension_settings } from '../../../extensions.js';
import { loadWorldInfo, saveWorldInfo, reloadEditor } from '../../../world-info.js';

const KEY = 'quick_memory';
const PIN_ORDER = 9999; // highest Order SillyTavern allows; higher = closer to the bottom
const defaults = { book: '', entry: '', prefix: '- ', pin: true };
const settings = extension_settings[KEY] = Object.assign({}, defaults, extension_settings[KEY] || {});

// --- per-browser UI state (position, size, open/closed) ---
const LS = 'qm_ui';
function loadUi() { try { return JSON.parse(localStorage.getItem(LS)) || {}; } catch { return {}; } }
function saveUi(patch) { try { localStorage.setItem(LS, JSON.stringify({ ...loadUi(), ...patch })); } catch { /* ignore */ } }

function setStatus(msg) { $('#qm_status').text(msg); }
function updateTarget() {
    $('#qm_target').text(settings.book && settings.entry
        ? `→ ${settings.book} / ${settings.entry}`
        : 'Set lorebook + entry in Extensions → Quick Memory');
}

async function addMemory() {
    const text = String($('#qm_text').val() || '').trim();
    if (!text) return;
    if (!settings.book || !settings.entry) { setStatus('Set lorebook and entry title first.'); return; }

    const btn = $('#qm_add').prop('disabled', true);
    try {
        const data = await loadWorldInfo(settings.book);
        if (!data?.entries) { setStatus(`Lorebook "${settings.book}" not found.`); return; }

        const entry = Object.values(data.entries).find(e => (e.comment || '').trim() === settings.entry.trim());
        if (!entry) { setStatus(`Entry "${settings.entry}" not found.`); return; }

        const line = settings.prefix + text;
        entry.content = entry.content && entry.content.trim() ? `${entry.content.replace(/\s+$/, '')}\n${line}` : line;
        if (settings.pin) entry.order = PIN_ORDER;

        await saveWorldInfo(settings.book, data, true);
        reloadEditor(settings.book);
        $('#qm_text').val('');
        setStatus('Added ✓');
        setTimeout(() => setStatus(''), 3000);
    } catch (err) {
        console.error('[Quick Memory]', err);
        setStatus('Error: ' + err.message);
    } finally {
        btn.prop('disabled', false);
    }
}

function clampIntoView(win) {
    const el = win[0];
    const r = el.getBoundingClientRect();
    const maxL = Math.max(0, window.innerWidth - Math.min(r.width, window.innerWidth));
    const maxT = Math.max(0, window.innerHeight - 40);
    el.style.left = Math.min(Math.max(0, r.left), maxL) + 'px';
    el.style.top = Math.min(Math.max(0, r.top), maxT) + 'px';
}

function buildPanel() {
    const ui = loadUi();
    const tab = $('<div id="qm_tab" title="Quick Memory">Memory</div>');
    const win = $(`
        <div id="qm_window">
            <div id="qm_header">
                <span id="qm_title">Quick Memory</span>
                <span id="qm_close" class="fa-solid fa-minus" title="Minimise"></span>
            </div>
            <div id="qm_body">
                <div id="qm_target"></div>
                <textarea id="qm_text" class="text_pole" placeholder="Something worth remembering… (Ctrl+Enter to add)"></textarea>
                <div id="qm_footer">
                    <div id="qm_status"></div>
                    <button id="qm_add" class="menu_button">Add</button>
                </div>
            </div>
        </div>`);
    $('body').append(tab, win);

    // restore position/size
    win.css({
        left: ui.left ?? Math.max(0, window.innerWidth - 320) + 'px',
        top: ui.top ?? '30%',
        width: ui.width ?? '',
        height: ui.height ?? '',
    });
    const open = !!ui.open;
    win.toggleClass('qm-hidden', !open);
    tab.toggleClass('qm-hidden', open);
    if (open) clampIntoView(win);

    const show = (o) => {
        win.toggleClass('qm-hidden', !o);
        tab.toggleClass('qm-hidden', o);
        if (o) { clampIntoView(win); $('#qm_text').trigger('focus'); }
        saveUi({ open: o });
    };
    tab.on('click', () => show(true));
    $('#qm_close').on('click', () => show(false));

    // drag by header
    const header = $('#qm_header')[0];
    let drag = null;
    header.addEventListener('pointerdown', (e) => {
        if (e.target.id === 'qm_close') return;
        const r = win[0].getBoundingClientRect();
        drag = { dx: e.clientX - r.left, dy: e.clientY - r.top };
        header.setPointerCapture(e.pointerId);
    });
    header.addEventListener('pointermove', (e) => {
        if (!drag) return;
        const w = win[0].offsetWidth;
        const left = Math.min(Math.max(0, e.clientX - drag.dx), window.innerWidth - Math.min(w, 60));
        const top = Math.min(Math.max(0, e.clientY - drag.dy), window.innerHeight - 40);
        win[0].style.left = left + 'px';
        win[0].style.top = top + 'px';
    });
    const endDrag = () => {
        if (!drag) return;
        drag = null;
        saveUi({ left: win[0].style.left, top: win[0].style.top });
    };
    header.addEventListener('pointerup', endDrag);
    header.addEventListener('pointercancel', endDrag);

    // remember size after the native resize handle is used
    new ResizeObserver(() => {
        if (win.hasClass('qm-hidden')) return;
        saveUi({ width: win[0].offsetWidth + 'px', height: win[0].offsetHeight + 'px' });
    }).observe(win[0]);

    window.addEventListener('resize', () => { if (!win.hasClass('qm-hidden')) clampIntoView(win); });

    $('#qm_add').on('click', addMemory);
    $('#qm_text').on('keydown', e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); addMemory(); } });
    updateTarget();
}

function buildSettings() {
    const html = $(`
        <div class="inline-drawer">
            <div class="inline-drawer-toggle inline-drawer-header">
                <b>Quick Memory</b>
                <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
            </div>
            <div class="inline-drawer-content">
                <label>Lorebook name</label>
                <input id="qm_set_book" class="text_pole" type="text">
                <label>Entry title (the entry's Title/Memo)</label>
                <input id="qm_set_entry" class="text_pole" type="text">
                <label>Line prefix</label>
                <input id="qm_set_prefix" class="text_pole" type="text">
                <label class="checkbox_label">
                    <input id="qm_set_pin" type="checkbox">
                    <span>Pin entry to the bottom (sets Order to ${PIN_ORDER} on each Add)</span>
                </label>
            </div>
        </div>`);
    $('#extensions_settings2').append(html);

    $('#qm_set_book').val(settings.book).on('input', e => { settings.book = e.target.value.trim(); updateTarget(); saveSettingsDebounced(); });
    $('#qm_set_entry').val(settings.entry).on('input', e => { settings.entry = e.target.value; updateTarget(); saveSettingsDebounced(); });
    $('#qm_set_prefix').val(settings.prefix).on('input', e => { settings.prefix = e.target.value; saveSettingsDebounced(); });
    $('#qm_set_pin').prop('checked', settings.pin).on('change', e => { settings.pin = e.target.checked; saveSettingsDebounced(); });
}

jQuery(() => {
    buildSettings();
    buildPanel();
});

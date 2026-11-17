/*
 * Outlet Inventory Card — a Home Assistant Lovelace card
 * Count power strips, smart plugs, multi-plugs and adapters, and see at a glance what is free.
 * Data lives in normal To-do lists (e.g. Local To-do): one list per category, one item per TYPE.
 * Item description holds the counts, e.g.:
 *   Totale: 2 / In uso: 1 / Collegamento: Wi-Fi / Attacco: Schuko / Posti: 6 / Lunghezza: 3 m / Note: ...
 * (English keys are understood too: Total / In use / Connection / Plug / Sockets / Length / Notes)
 * A completed item = no piece free.
 * License: MIT
 */
const OIC_VERSION = "0.1.1";

const I18N = {
  it: {
    free_now: "Libere adesso", nothing_free: "Niente di libero: è tutto in uso.", loading: "Carico…",
    free_of: (f, t) => `${f === 1 ? "libera" : "libere"} su ${t}`, cat_free: (f, t) => `${f} libere su ${t}`,
    total: "In tutto", in_use: "In uso", add: "+ Aggiungi", edit: "Modifica", del: "Elimina", del_q: "Eliminare questo tipo?",
    yes: "Sì", no: "No", save: "Salva", cancel: "Annulla", empty: "Ancora niente qui. Tocca “+ Aggiungi”.",
    f_name: "Descrizione", f_conn: "Collegamento", f_plug: "Attacco", f_sockets: "Posti", f_len: "Lunghezza cavo",
    f_tot: "Quante ne hai", f_use: "Di cui in uso", f_notes: "Note", sockets: "posti", normal: "Normale", other: "Altro",
    no_entity: "Lista non trovata", err: "Non sono riuscito a salvare",
    plugs: ["Schuko", "Italiana 10A", "Italiana 16A", "Universale (Schuko + italiana)", "Con USB", "Altro"],
    keys: { tot: "Totale", use: "In uso", proto: "Collegamento", plug: "Attacco", posti: "Posti", len: "Lunghezza", notes: "Note" },
  },
  en: {
    free_now: "Free right now", nothing_free: "Nothing free: everything is in use.", loading: "Loading…",
    free_of: (f, t) => `free of ${t}`, cat_free: (f, t) => `${f} free of ${t}`,
    total: "Total", in_use: "In use", add: "+ Add", edit: "Edit", del: "Delete", del_q: "Delete this type?",
    yes: "Yes", no: "No", save: "Save", cancel: "Cancel", empty: "Nothing here yet. Tap “+ Add”.",
    f_name: "Description", f_conn: "Connection", f_plug: "Plug", f_sockets: "Sockets", f_len: "Cable length",
    f_tot: "How many you have", f_use: "Of which in use", f_notes: "Notes", sockets: "sockets", normal: "Normal", other: "Other",
    no_entity: "List not found", err: "Could not save",
    plugs: ["Schuko (Type F)", "Type L 10A", "Type L 16A", "Type G", "Type A/B", "With USB", "Other"],
    keys: { tot: "Total", use: "In use", proto: "Connection", plug: "Plug", posti: "Sockets", len: "Length", notes: "Notes" },
  },
};
const KEYMAP = {
  totale: "tot", total: "tot", "in uso": "use", "in use": "use", collegamento: "proto", connection: "proto",
  protocollo: "proto", attacco: "plug", plug: "plug", spina: "plug", posti: "posti", sockets: "posti",
  lunghezza: "len", length: "len", note: "notes", notes: "notes",
};
const ICONS = {
  smart: "mdi:lightning-bolt-circle", strip: "mdi:power-socket-eu", multi: "mdi:power-plug-outline", adapter: "mdi:power-plug",
};

class OutletInventoryCard extends HTMLElement {
  static getStubConfig() {
    return {
      categories: [
        { entity: "todo.smart_plugs", name: "Smart plugs", icon: ICONS.smart, color: "#e0b030", connections: ["Zigbee", "Wi-Fi", "Matter / Thread"] },
        { entity: "todo.power_strips", name: "Power strips", icon: ICONS.strip, color: "#4cc38a", connections: ["Normal", "Smart Wi-Fi", "Smart Zigbee"], sockets: true },
      ],
    };
  }
  setConfig(config) {
    if (!config || !Array.isArray(config.categories) || !config.categories.length)
      throw new Error("outlet-inventory-card: add at least one entry under 'categories' (each with an 'entity' todo list)");
    this._config = { show_free: true, ...config };
    this._items = this._items || {};
    this._form = null; this._confirm = null; this._timers = this._timers || {};
    if (this._subs) { this._unsubAll(); }
    if (this._hass) this._subscribeAll();
    this._render();
  }
  set hass(hass) {
    const first = !this._hass;
    this._hass = hass;
    if (first && this._config) { this._subscribeAll(); this._render(); }
  }
  connectedCallback() { if (this._hass && this._config && !this._subs) this._subscribeAll(); }
  disconnectedCallback() { this._unsubAll(); }
  getCardSize() { return 6; }
  getGridOptions() { return { columns: "full", min_columns: 6 }; }

  get _t() {
    const l = (this._hass?.locale?.language || this._hass?.language || "en").slice(0, 2);
    return I18N[this._config?.language] || I18N[l] || I18N.en;
  }

  /* ---------- data ---------- */
  _subscribeAll() {
    this._subs = [];
    for (const cat of this._config.categories) {
      const id = cat.entity;
      if (!this._hass.states[id]) { this._items[id] = null; continue; }
      const p = this._hass.connection
        .subscribeMessage((msg) => {
          const prev = this._items[id] || [];
          this._items[id] = (msg.items || []).map((r) => (this._timers[r.uid] && prev.find((x) => x.uid === r.uid)) || this._parse(r)); // keep pending +/− taps
          this._render();
        },
          { type: "todo/item/subscribe", entity_id: id })
        .catch(async () => { // older HA: one-shot read
          try { const r = await this._hass.callWS({ type: "todo/item/list", entity_id: id }); this._items[id] = r.items.map((x) => this._parse(x)); this._render(); } catch (e) { /* ignore */ }
          return () => {};
        });
      this._subs.push(p);
    }
  }
  _unsubAll() { (this._subs || []).forEach((p) => p.then((u) => typeof u === "function" && u()).catch(() => {})); this._subs = null; }

  _parse(r) {
    const it = { uid: r.uid, name: r.summary || "", tot: 1, use: 0, proto: "", plug: "", posti: "", len: "", notes: "" };
    const extra = [];
    String(r.description || "").split(/\r?\n/).forEach((line) => {
      const m = line.match(/^\s*([^:]+):\s*(.*)$/); const k = m && KEYMAP[m[1].trim().toLowerCase()];
      if (!k) { if (line.trim()) extra.push(line.trim()); return; }
      it[k] = k === "tot" || k === "use" ? Math.max(0, parseInt(m[2], 10) || 0) : m[2].trim();
    });
    if (extra.length) it.notes = [it.notes, ...extra].filter(Boolean).join(" · ");
    if (it.use > it.tot) it.tot = it.use;
    return it;
  }
  _serialize(it) {
    const K = this._t.keys, L = [`${K.tot}: ${it.tot}`, `${K.use}: ${it.use}`];
    if (!this._isNormal(it.proto)) L.push(`${K.proto}: ${it.proto}`);
    if (it.plug) L.push(`${K.plug}: ${it.plug}`);
    if (it.posti) L.push(`${K.posti}: ${it.posti}`);
    if (it.len) L.push(`${K.len}: ${it.len}`);
    if (it.notes) L.push(`${K.notes}: ${it.notes}`);
    return L.join("\n");
  }
  _free(it) { return Math.max(0, it.tot - it.use); }
  _status(it) { return this._free(it) > 0 ? "needs_action" : "completed"; }
  _call(service, entity, data) { return this._hass.callService("todo", service, data, { entity_id: entity }); }
  _toast(msg) { this.dispatchEvent(new CustomEvent("hass-notification", { detail: { message: msg }, bubbles: true, composed: true })); }

  _saveLater(entity, it) {
    clearTimeout(this._timers[it.uid]);
    this._timers[it.uid] = setTimeout(() => {
      delete this._timers[it.uid];
      this._call("update_item", entity, { item: it.uid, description: this._serialize(it), status: this._status(it) })
        .catch((e) => this._toast(`${this._t.err}: ${e.message || e}`));
    }, 600);
  }

  /* ---------- actions ---------- */
  _onClick(ev) {
    const b = ev.composedPath().find((n) => n.dataset && n.dataset.a); if (!b) return;
    const { a, e: entity, u: uid } = b.dataset;
    const list = this._items[entity] || []; const it = list.find((x) => x.uid === uid);
    if (a === "add") { this._form = { entity, uid: null }; this._confirm = null; return this._render(); }
    if (a === "cancel") { this._form = null; return this._render(); }
    if (a === "save") return this._submit();
    if (!it) return;
    if (a === "edit") { this._form = { entity, uid }; this._confirm = null; return this._render(); }
    if (a === "del") { this._confirm = uid; return this._render(); }
    if (a === "delno") { this._confirm = null; return this._render(); }
    if (a === "delok") {
      this._items[entity] = list.filter((x) => x.uid !== uid); this._confirm = null; this._render();
      return this._call("remove_item", entity, { item: uid }).catch((e) => this._toast(`${this._t.err}: ${e.message || e}`));
    }
    const n = { ...it };
    if (a === "tot+") n.tot++;
    if (a === "tot-" && n.tot > n.use) n.tot--;
    if (a === "use+" && n.use < n.tot) n.use++;
    if (a === "use-" && n.use > 0) n.use--;
    this._items[entity] = list.map((x) => (x.uid === uid ? n : x));
    this._render(); this._saveLater(entity, n);
  }
  async _submit() {
    const f = this._form; const root = this.shadowRoot; const v = (id) => (root.getElementById(id)?.value || "").trim();
    const cat = this._config.categories.find((c) => c.entity === f.entity);
    const n = { name: v("f_name"), proto: cat.connections ? v("f_conn") : "", plug: v("f_plug"),
      posti: cat.sockets ? v("f_sockets") : "", len: cat.sockets ? v("f_len") : "",
      tot: Math.max(0, parseInt(v("f_tot"), 10) || 0), use: Math.max(0, parseInt(v("f_use"), 10) || 0), notes: v("f_notes").replace(/\n/g, " ") };
    if (!n.name) { root.getElementById("f_name")?.focus(); return; }
    if (n.use > n.tot) n.tot = n.use;
    this._form = null; this._render();
    try {
      if (f.uid) {
        const old = (this._items[f.entity] || []).find((x) => x.uid === f.uid);
        const data = { item: f.uid, description: this._serialize(n), status: this._status(n) };
        if (old && old.name !== n.name) data.rename = n.name;
        await this._call("update_item", f.entity, data);
      } else {
        await this._call("add_item", f.entity, { item: n.name, description: this._serialize(n) });
        if (this._status(n) === "completed") await this._call("update_item", f.entity, { item: n.name, status: "completed" });
      }
    } catch (e) { this._toast(`${this._t.err}: ${e.message || e}`); }
  }

  /* ---------- render ---------- */
  _esc(s) { return String(s ?? "").replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m])); }
  _connClass(p) { return /zig/i.test(p) ? "zb" : /wi-?fi/i.test(p) ? "wf" : /matter|thread/i.test(p) ? "mt" : ""; }
  _isNormal(p) { return !p || /^(normale|normal)$/i.test(p); }

  _chips(it) {
    const t = this._t, e = this._esc.bind(this), c = [];
    if (!this._isNormal(it.proto)) c.push(`<span class="chip ${this._connClass(it.proto)}">${e(it.proto)}</span>`);
    if (it.plug) c.push(`<span class="chip">${e(it.plug)}</span>`);
    if (it.posti) c.push(`<span class="chip">${e(it.posti)} ${t.sockets}</span>`);
    if (it.len) c.push(`<span class="chip">${e(it.len)}</span>`);
    return c.length ? `<div class="chips">${c.join("")}</div>` : "";
  }
  _card(cat, it) {
    const t = this._t, e = this._esc.bind(this), f = this._free(it), E = e(cat.entity), U = e(it.uid);
    return `<div class="item" style="--c:${e(cat.color || "var(--primary-color)")}">
      <div class="name">${e(it.name)}</div>${this._chips(it)}
      <div class="big ${f ? "" : "zero"}"><b>${f}</b><span>${t.free_of(f, it.tot)}</span></div>
      <div class="ctr">
        <div><label>${t.total}</label><span class="pm"><button data-a="tot-" data-e="${E}" data-u="${U}" ${it.tot <= it.use ? "disabled" : ""}>−</button><span class="n">${it.tot}</span><button data-a="tot+" data-e="${E}" data-u="${U}">+</button></span></div>
        <div><label>${t.in_use}</label><span class="pm"><button data-a="use-" data-e="${E}" data-u="${U}" ${it.use <= 0 ? "disabled" : ""}>−</button><span class="n">${it.use}</span><button data-a="use+" data-e="${E}" data-u="${U}" ${it.use >= it.tot ? "disabled" : ""}>+</button></span></div>
      </div>
      ${it.notes ? `<div class="note">${e(it.notes)}</div>` : ""}
      ${this._confirm === it.uid
        ? `<div class="acts warn">${t.del_q} <button data-a="delok" data-e="${E}" data-u="${U}">${t.yes}</button><button data-a="delno" data-e="${E}" data-u="${U}">${t.no}</button></div>`
        : `<div class="acts"><button data-a="edit" data-e="${E}" data-u="${U}">${t.edit}</button><button data-a="del" data-e="${E}" data-u="${U}">${t.del}</button></div>`}
    </div>`;
  }
  _formHtml(cat) {
    const t = this._t, e = this._esc.bind(this), f = this._form;
    const it = f.uid ? (this._items[cat.entity] || []).find((x) => x.uid === f.uid) || {} : { tot: 1, use: 0 };
    const opt = (list, cur) => list.map((o) => `<option ${o === cur ? "selected" : ""}>${e(o)}</option>`).join("");
    const plugs = this._config.plugs || t.plugs;
    return `<div class="form" style="--c:${e(cat.color || "var(--primary-color)")}">
      <label class="full">${t.f_name}<input id="f_name" value="${e(it.name || "")}" placeholder="${e(cat.placeholder || "")}"></label>
      ${cat.connections ? `<label>${t.f_conn}<select id="f_conn">${opt(cat.connections, it.proto)}</select></label>` : ""}
      <label>${t.f_plug}<select id="f_plug"><option value="">—</option>${opt(plugs.includes(it.plug) || !it.plug ? plugs : [...plugs, it.plug], it.plug)}</select></label>
      ${cat.sockets ? `<label>${t.f_sockets}<input id="f_sockets" type="number" min="1" value="${e(it.posti || "")}"></label><label>${t.f_len}<input id="f_len" value="${e(it.len || "")}" placeholder="3 m"></label>` : ""}
      <label>${t.f_tot}<input id="f_tot" type="number" min="0" value="${it.tot ?? 1}"></label>
      <label>${t.f_use}<input id="f_use" type="number" min="0" value="${it.use ?? 0}"></label>
      <label class="full">${t.f_notes}<input id="f_notes" value="${e(it.notes || "")}"></label>
      <div class="full fa"><button class="btn" data-a="cancel">${t.cancel}</button><button class="btn pri" data-a="save">${t.save}</button></div>
    </div>`;
  }
  _section(cat) {
    const t = this._t, e = this._esc.bind(this), list = this._items[cat.entity];
    const color = e(cat.color || "var(--primary-color)");
    const head = (sub) => `<div class="cat-h"><div class="cat-t"><span class="ico" style="--c:${color}"><ha-icon icon="${e(cat.icon || ICONS.strip)}"></ha-icon></span>${e(cat.name || this._hass.states[cat.entity]?.attributes.friendly_name || cat.entity)}<small>${sub}</small></div>
      <button class="btn" data-a="add" data-e="${e(cat.entity)}">${t.add}</button></div>`;
    if (list === null) return `<div class="cat">${head("")}<div class="empty">${t.no_entity}: ${e(cat.entity)}</div></div>`;
    if (list === undefined) return `<div class="cat">${head("")}<div class="empty">${t.loading}</div></div>`;
    const sorted = [...list].sort((a, b) => a.name.localeCompare(b.name));
    const tot = sorted.reduce((s, i) => s + i.tot, 0), fr = sorted.reduce((s, i) => s + this._free(i), 0);
    const form = this._form && this._form.entity === cat.entity ? this._formHtml(cat) : "";
    let body;
    if (!sorted.length) body = form ? "" : `<div class="empty">${t.empty}</div>`;
    else if (cat.connections && sorted.some((i) => !this._isNormal(i.proto))) {
      const groups = {}; sorted.forEach((i) => { const g = i.proto || t.normal; (groups[g] = groups[g] || []).push(i); });
      const order = [...cat.connections, ...Object.keys(groups)].filter((g, i, a) => groups[g] && a.indexOf(g) === i);
      body = order.map((g) => `<div class="sub-h"><span class="sw ${this._connClass(g)}"></span>${e(g)}</div><div class="grid">${groups[g].map((i) => this._card(cat, i)).join("")}</div>`).join("");
    } else body = `<div class="grid">${sorted.map((i) => this._card(cat, i)).join("")}</div>`;
    return `<div class="cat">${head(t.cat_free(fr, tot))}${form}${body}</div>`;
  }
  _freeHtml() {
    const t = this._t, e = this._esc.bind(this), rows = [];
    let ready = true;
    for (const cat of this._config.categories) {
      const l = this._items[cat.entity]; if (l === undefined) { ready = false; continue; } if (!l) continue;
      l.filter((i) => this._free(i) > 0).forEach((i) => rows.push(`<li><span class="sw" style="background:${e(cat.color || "var(--primary-color)")}"></span><b>${this._free(i)}</b> ${e(i.name)}${!this._isNormal(i.proto) ? ` · ${e(i.proto)}` : ""}${i.plug ? ` · ${e(i.plug)}` : ""}</li>`));
    }
    return `<div class="free"><div class="free-t">${t.free_now}</div>${rows.length ? `<ul>${rows.join("")}</ul>` : `<div class="muted">${ready ? t.nothing_free : t.loading}</div>`}</div>`;
  }
  _render() {
    if (!this._config) return;
    if (!this.shadowRoot) { this.attachShadow({ mode: "open" }); this.shadowRoot.addEventListener("click", (ev) => this._onClick(ev)); }
    if (!this._hass) return;
    const active = this.shadowRoot.activeElement; if (active && this._form && /^f_/.test(active.id)) return; // don't wipe a form being typed
    const c = this._config;
    this.shadowRoot.innerHTML = `<style>${OutletInventoryCard.css}</style><ha-card>
      ${c.title ? `<div class="title">${this._esc(c.title)}</div>` : ""}
      ${c.show_free ? this._freeHtml() : ""}
      ${c.categories.map((cat) => this._section(cat)).join("")}
    </ha-card>`;
    if (this._form) setTimeout(() => this.shadowRoot.getElementById("f_name")?.focus(), 0);
  }
}
OutletInventoryCard.css = `
ha-card{padding:16px;display:flex;flex-direction:column;gap:18px;color:var(--primary-text-color)}
.title{font-size:20px;font-weight:700}
.muted{color:var(--secondary-text-color);font-size:13px}
.free{background:color-mix(in srgb,var(--primary-text-color) 5%,transparent);border-radius:14px;padding:12px 14px}
.free-t{font-weight:700;font-size:14px;margin-bottom:8px}
.free ul{list-style:none;margin:0;padding:0;display:flex;flex-wrap:wrap;gap:6px}
.free li{display:flex;align-items:center;gap:7px;background:color-mix(in srgb,var(--primary-text-color) 7%,transparent);border-radius:999px;padding:6px 11px;font-size:13px;font-weight:600}
.free li b{font-size:15px}
.sw{width:9px;height:9px;border-radius:3px;display:inline-block;background:var(--secondary-text-color)}
.sw.zb,.chip.zb{background:#c9900e}.sw.wf,.chip.wf{background:#2f6fd6}.sw.mt,.chip.mt{background:#7b52c9}
.cat-h{display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:8px}
.cat-t{display:flex;align-items:center;gap:9px;font-size:16px;font-weight:700}
.cat-t small{color:var(--secondary-text-color);font-weight:500;font-size:12.5px}
.ico{width:30px;height:30px;border-radius:9px;display:grid;place-items:center;background:color-mix(in srgb,var(--c) 22%,transparent);color:var(--c);--mdc-icon-size:18px}
.sub-h{font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--secondary-text-color);margin:10px 2px 6px;display:flex;align-items:center;gap:6px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:8px}
.item{border-radius:14px;padding:11px 12px;display:flex;flex-direction:column;gap:8px;background:color-mix(in srgb,var(--c) 10%,transparent);border:1px solid color-mix(in srgb,var(--c) 28%,transparent)}
.name{font-weight:700;font-size:14px;line-height:1.25}
.chips{display:flex;flex-wrap:wrap;gap:4px}
.chip{font-size:10.5px;font-weight:700;padding:2px 7px;border-radius:6px;background:color-mix(in srgb,var(--primary-text-color) 9%,transparent);color:var(--secondary-text-color)}
.chip.zb,.chip.wf,.chip.mt{color:#fff}
.big{display:flex;align-items:baseline;gap:7px}.big b{font-size:28px;font-weight:800;color:var(--c);line-height:1}
.big.zero b{color:var(--secondary-text-color)}.big span{font-size:12.5px;color:var(--secondary-text-color)}
.ctr{display:grid;grid-template-columns:1fr;gap:5px}
.ctr>div{display:flex;align-items:center;justify-content:space-between;gap:4px;background:color-mix(in srgb,var(--primary-text-color) 6%,transparent);border-radius:10px;padding:5px 7px}
.ctr label{font-size:12px;font-weight:700;color:var(--secondary-text-color)}
.pm{display:flex;align-items:center;gap:2px}.n{font-weight:800;min-width:18px;text-align:center}
.pm button{width:26px;height:26px;border-radius:8px;border:1px solid var(--divider-color);background:transparent;color:var(--primary-text-color);font-size:15px;font-weight:800;cursor:pointer;line-height:1;padding:0}
.pm button:disabled{opacity:.3;cursor:default}
.note{font-size:11.5px;color:var(--secondary-text-color);font-style:italic}
.acts{display:flex;gap:6px;align-items:center}
.acts button{flex:1;border:1px solid var(--divider-color);background:transparent;color:var(--secondary-text-color);border-radius:9px;padding:5px;font-size:12px;font-weight:600;cursor:pointer}
.acts.warn{color:var(--error-color,#c2410c);font-size:12px;font-weight:700}
.btn{border:1px solid var(--divider-color);background:transparent;color:var(--primary-text-color);border-radius:999px;padding:6px 13px;font-size:13px;font-weight:600;cursor:pointer}
.btn.pri{background:var(--primary-color);border-color:var(--primary-color);color:var(--text-primary-color,#fff)}
.empty{border:1.5px dashed var(--divider-color);border-radius:14px;padding:14px;text-align:center;color:var(--secondary-text-color);font-size:13px}
.form{display:grid;grid-template-columns:1fr 1fr;gap:8px;padding:12px;border-radius:14px;margin-bottom:8px;border:1px solid color-mix(in srgb,var(--c) 40%,transparent);background:color-mix(in srgb,var(--c) 8%,transparent)}
.form label{display:flex;flex-direction:column;gap:4px;font-size:11.5px;font-weight:700;color:var(--secondary-text-color)}
.form .full{grid-column:1/-1}
.form input,.form select{font:inherit;font-size:14px;padding:8px 10px;border-radius:9px;border:1px solid var(--divider-color);background:var(--card-background-color,var(--ha-card-background));color:var(--primary-text-color)}
.fa{display:flex;justify-content:flex-end;gap:8px}
`;
if (!customElements.get("outlet-inventory-card")) customElements.define("outlet-inventory-card", OutletInventoryCard);
window.customCards = window.customCards || [];
if (!window.customCards.some((c) => c.type === "outlet-inventory-card")) window.customCards.push({ type: "outlet-inventory-card", name: "Outlet Inventory Card", description: "Count power strips, smart plugs and adapters and see what is free.", preview: false, documentationURL: "https://github.com/Diess-tech/outlet-inventory-card" });
console.info(`%c OUTLET-INVENTORY-CARD %c ${OIC_VERSION} `, "background:#e0b030;color:#000;font-weight:700", "background:#333;color:#fff");

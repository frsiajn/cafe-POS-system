// ---------- Data ----------
  const PRODUCTS = [
    { id:'espresso',   name:'Espresso',   cat:'coffee', base:80,  code:'ES' },
    { id:'americano',  name:'Americano',  cat:'coffee', base:90,  code:'AM' },
    { id:'latte',      name:'Latte',      cat:'coffee', base:120, code:'LT' },
    { id:'cappuccino', name:'Cappuccino', cat:'coffee', base:120, code:'CP' },
    { id:'mocha',      name:'Mocha',      cat:'coffee', base:135, code:'MC' },
    { id:'matcha',     name:'Matcha Latte', cat:'coffee', base:130, code:'MT' },

    { id:'muffin',     name:'Blueberry Muffin', cat:'pastry', base:90,  code:'BM' },
    { id:'croissant',  name:'Butter Croissant', cat:'pastry', base:85,  code:'BC' },
    { id:'cookie',     name:'Choco Chip Cookie', cat:'pastry', base:65, code:'CC' },
    { id:'cheesecake', name:'Slice of Cheesecake', cat:'pastry', base:150, code:'SC' },
  ];

  const SIZES = [
    { id:'S', label:'Small',  delta:-20 },
    { id:'M', label:'Medium', delta:0 },
    { id:'L', label:'Large',  delta:20 },
  ];

  const ADDONS = [
    { id:'extrashot', label:'Extra Shot',   price:25 },
    { id:'oatmilk',   label:'Oat Milk',     price:20 },
    { id:'vanilla',   label:'Vanilla Syrup',price:15 },
    { id:'whip',      label:'Whipped Cream',price:15 },
  ];

  const TAX_RATE = 0.12;

  let cart = [];
  let orderCounter = 124;
  let activeCat = 'coffee';
  let selectedProduct = null;
  let pendingSize = 'M';
  let pendingAddons = [];
  let pendingQty = 1;

  const grid = document.getElementById('productGrid');
  const orderItemsEl = document.getElementById('orderItems');
  const itemCountEl = document.getElementById('itemCount');
  const subtotalVal = document.getElementById('subtotalVal');
  const taxVal = document.getElementById('taxVal');
  const totalVal = document.getElementById('totalVal');
  const checkoutBtn = document.getElementById('checkoutBtn');
  const overlay = document.getElementById('overlay');
  const receiptEl = document.getElementById('receipt');

  function peso(n){ return '₱' + n.toLocaleString('en-PH', { minimumFractionDigits:2, maximumFractionDigits:2 }); }

  function renderGrid(){
    grid.querySelectorAll('.product, .option-panel').forEach(n => n.remove());
    const items = PRODUCTS.filter(p => p.cat === activeCat);
    items.forEach(p => {
      const card = document.createElement('div');
      card.className = 'product' + (selectedProduct === p.id ? ' selected' : '');
      card.innerHTML = `
        <div class="swatch ${p.cat}">${p.code}</div>
        <div class="name">${p.name}</div>
        <div class="price">From ${peso(p.cat === 'coffee' ? p.base - 20 : p.base)}</div>
      `;
      card.addEventListener('click', () => openOptionPanel(p));
      grid.appendChild(card);

      if (selectedProduct === p.id) {
        grid.appendChild(buildOptionPanel(p));
      }
    });
  }

  function openOptionPanel(p){
    selectedProduct = p.id;
    pendingSize = 'M';
    pendingAddons = [];
    pendingQty = 1;
    renderGrid();
  }

  function buildOptionPanel(p){
    const panel = document.createElement('div');
    panel.className = 'option-panel';

    let sizeHtml = '';
    if (p.cat === 'coffee') {
      sizeHtml = `
        <div class="option-row">
          <div class="label">Size</div>
          <div class="pill-row" id="sizeRow">
            ${SIZES.map(s => `<button type="button" class="pill ${s.id===pendingSize?'on':''}" data-size="${s.id}">${s.label}</button>`).join('')}
          </div>
        </div>
        <div class="option-row">
          <div class="label">Add-ons</div>
          <div class="pill-row" id="addonRow">
            ${ADDONS.map(a => `<button type="button" class="pill ${pendingAddons.includes(a.id)?'on':''}" data-addon="${a.id}">${a.label} (+${a.price})</button>`).join('')}
          </div>
        </div>
      `;
    }

    panel.innerHTML = `
      <h3>${p.name}</h3>
      ${sizeHtml}
      <div class="panel-footer">
        <div class="qty-stepper">
          <button type="button" id="qtyMinus">−</button>
          <span id="qtyVal">${pendingQty}</span>
          <button type="button" id="qtyPlus">+</button>
        </div>
        <div style="display:flex; gap:16px; align-items:center;">
          <button type="button" class="cancel-link" id="cancelOpt">Cancel</button>
          <button type="button" class="add-btn" id="addOpt">Add — ${peso(calcLinePrice(p))}</button>
        </div>
      </div>
    `;

    panel.querySelectorAll('[data-size]').forEach(btn => {
      btn.addEventListener('click', () => { pendingSize = btn.dataset.size; renderGrid(); });
    });
    panel.querySelectorAll('[data-addon]').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.addon;
        pendingAddons = pendingAddons.includes(id) ? pendingAddons.filter(a=>a!==id) : [...pendingAddons, id];
        renderGrid();
      });
    });
    panel.querySelector('#qtyMinus').addEventListener('click', () => { pendingQty = Math.max(1, pendingQty-1); renderGrid(); });
    panel.querySelector('#qtyPlus').addEventListener('click', () => { pendingQty += 1; renderGrid(); });
    panel.querySelector('#cancelOpt').addEventListener('click', () => { selectedProduct = null; renderGrid(); });
    panel.querySelector('#addOpt').addEventListener('click', () => { confirmAdd(p); });

    return panel;
  }

  function calcLinePrice(p){
    let unit = p.base;
    if (p.cat === 'coffee') {
      unit += SIZES.find(s => s.id === pendingSize).delta;
      unit += pendingAddons.reduce((sum,id) => sum + ADDONS.find(a=>a.id===id).price, 0);
    }
    return unit * pendingQty;
  }

  function confirmAdd(p){
    const sizeLabel = p.cat === 'coffee' ? SIZES.find(s=>s.id===pendingSize).label : null;
    const addonLabels = pendingAddons.map(id => ADDONS.find(a=>a.id===id).label);
    let unit = p.base;
    if (p.cat === 'coffee') {
      unit += SIZES.find(s => s.id === pendingSize).delta;
      unit += pendingAddons.reduce((sum,id) => sum + ADDONS.find(a=>a.id===id).price, 0);
    }
    cart.push({
      name: p.name,
      size: sizeLabel,
      addons: addonLabels,
      qty: pendingQty,
      unit: unit,
    });
    selectedProduct = null;
    renderGrid();
    renderOrder();
  }

  function renderOrder(){
    orderItemsEl.innerHTML = '';
    cart.forEach((item, idx) => {
      const row = document.createElement('div');
      row.className = 'line-item';
      const subLabel = [item.size, ...(item.addons||[])].filter(Boolean).join(' · ');
      row.innerHTML = `
        <div class="li-main">
          <div class="li-name">${item.name}</div>
          ${subLabel ? `<div class="li-sub">${subLabel}</div>` : ''}
          <div class="li-controls">
            <button type="button" data-act="minus">−</button>
            <span>${item.qty}</span>
            <button type="button" data-act="plus">+</button>
          </div>
        </div>
        <div class="li-right">
          <div class="li-price">${peso(item.unit * item.qty)}</div>
          <button type="button" class="li-remove" data-act="remove">Remove</button>
        </div>
      `;
      row.querySelector('[data-act="minus"]').addEventListener('click', () => {
        item.qty = Math.max(1, item.qty - 1); renderOrder();
      });
      row.querySelector('[data-act="plus"]').addEventListener('click', () => {
        item.qty += 1; renderOrder();
      });
      row.querySelector('[data-act="remove"]').addEventListener('click', () => {
        cart.splice(idx,1); renderOrder();
      });
      orderItemsEl.appendChild(row);
    });

    const totalQty = cart.reduce((s,i) => s + i.qty, 0);
    itemCountEl.textContent = totalQty + (totalQty === 1 ? ' ITEM' : ' ITEMS');

    const subtotal = cart.reduce((s,i) => s + i.unit * i.qty, 0);
    const tax = subtotal * TAX_RATE;
    subtotalVal.textContent = peso(subtotal);
    taxVal.textContent = peso(tax);
    totalVal.textContent = peso(subtotal + tax);
    checkoutBtn.disabled = cart.length === 0;
  }

  document.querySelectorAll('.cat-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.cat-btn').forEach(b=>b.classList.remove('active'));
      btn.classList.add('active');
      activeCat = btn.dataset.cat;
      selectedProduct = null;
      renderGrid();
    });
  });

  document.getElementById('clearBtn').addEventListener('click', () => {
    cart = []; renderOrder();
  });

  document.getElementById('checkoutBtn').addEventListener('click', () => {
    buildReceipt();
    overlay.classList.add('show');
  });

  document.getElementById('newOrderBtn').addEventListener('click', () => {
    cart = [];
    orderCounter += 1;
    renderOrder();
    updateOrderPreview();
    overlay.classList.remove('show');
  });

  document.getElementById('printBtn').addEventListener('click', () => window.print());

  function buildReceipt(){
    const now = new Date();
    const dateStr = now.toLocaleDateString('en-PH', { month:'2-digit', day:'2-digit', year:'numeric' });
    const timeStr = now.toLocaleTimeString('en-PH', { hour:'2-digit', minute:'2-digit' });
    const subtotal = cart.reduce((s,i) => s + i.unit * i.qty, 0);
    const tax = subtotal * TAX_RATE;
    const orderNo = String(orderCounter).padStart(5,'0');

    const itemsHtml = cart.map(item => {
      const subLabel = [item.size, ...(item.addons||[])].filter(Boolean).join(' · ');
      return `
        <div class="r-line">
          <div class="r-row1"><span>${item.name} x${item.qty}</span><span>${peso(item.unit*item.qty)}</span></div>
          ${subLabel ? `<div class="r-row2">${subLabel}</div>` : ''}
        </div>
      `;
    }).join('');

    receiptEl.innerHTML = `
      <div class="r-brand">Bloom &amp; Brew</div>
      <div class="r-tag">Official Receipt</div>
      <div class="r-address">123 Aroma Street, Davao City · (02) 8123 4567</div>
      <hr class="r-divider">
      <div class="r-meta"><span>Order No.</span><span>#${orderNo}</span></div>
      <div class="r-meta"><span>Date</span><span>${dateStr}</span></div>
      <div class="r-meta"><span>Time</span><span>${timeStr}</span></div>
      <div class="r-meta"><span>Cashier</span><span>Counter 1</span></div>
      <hr class="r-divider">
      <div class="r-table-head"><span>Item</span><span>Amount</span></div>
      ${itemsHtml}
      <hr class="r-divider">
      <div class="r-totals">
        <div class="row"><span>Subtotal</span><span>${peso(subtotal)}</span></div>
        <div class="row"><span>VAT (12%)</span><span>${peso(tax)}</span></div>
        <div class="row grand"><span>Total</span><span>${peso(subtotal + tax)}</span></div>
      </div>
      <div class="r-foot">
        <div class="r-thanks">Thank you for your visit</div>
        This serves as your official receipt.<br>Please keep for your records.
      </div>
    `;
  }

  function updateOrderPreview(){
    document.getElementById('orderNoPreview').textContent = '#' + String(orderCounter).padStart(5,'0');
  }
  function tickClock(){
    const now = new Date();
    document.getElementById('clockPreview').textContent = now.toLocaleTimeString('en-PH', { hour:'2-digit', minute:'2-digit' });
  }
  tickClock();
  setInterval(tickClock, 1000 * 30);

  renderGrid();
  renderOrder();
  updateOrderPreview();

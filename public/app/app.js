// --- helpers ---
function money(n){ return n != null ? `£${Number(n).toLocaleString('en-GB',{maximumFractionDigits:0})}` : 'N/A'; }
function escapeHtml(s){ return String(s||'').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m])); }
function qs(name, fallback=''){ const u=new URL(location.href); return u.searchParams.get(name) ?? fallback; }

// --- load data ---
async function loadBikesJSON(url = '/bikes.json') {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Failed to load bikes.json: ${res.status}`);
  const data = await res.json();
  return Array.isArray(data.items) ? data.items : [];
}

// --- scoring & matching ---
function scoreBike(bike, answers) {
  let score = 0;

  if (answers.max_budget != null) {
    const price = bike.price_sale_gbp ?? bike.price_rrp_gbp ?? Infinity;
    if (price > answers.max_budget) return -1;
  }

  const useCases = (bike.use_cases || '').toLowerCase().split(',').map(s => s.trim()).filter(Boolean);
  const surfaces = (bike.surfaces || '').toLowerCase().split(',').map(s => s.trim()).filter(Boolean);

  if (answers.use_case && useCases.includes(answers.use_case.toLowerCase())) score += 1;
  if (answers.terrain && surfaces.includes(answers.terrain.toLowerCase())) score += 1;

  if (answers.range && bike.battery_wh) {
    const wh = Number(bike.battery_wh);
    const inferred = wh >= 600 ? 'long' : wh >= 450 ? 'medium' : 'short';
    if (answers.range.toLowerCase() === inferred) score += 1;
  }

  if (answers.equipped && answers.equipped !== 'unsure') {
    const want = answers.equipped.toLowerCase() === 'yes';
    const equippedFlags = [
      bike.equipped_lights, bike.equipped_mudguards,
      bike.equipped_rear_rack, bike.equipped_kickstand, bike.equipped_chainguard
    ].map(v => String(v || '').toLowerCase() === 'true');
    const isEquipped = equippedFlags.some(Boolean);
    if ((want && isEquipped) || (!want && !isEquipped)) score += 1;
  }

  return score;
}

function findTopMatches(bikes, answers, limit = 8, minScore = 0) {
  const scored = [];
  for (const b of bikes) {
    const s = scoreBike(b, answers);
    if (s >= minScore) scored.push({ bike: b, score: s });
  }
  scored.sort((a, b) =>
    b.score - a.score ||
    (a.bike.price_sale_gbp ?? a.bike.price_rrp_gbp ?? 0) -
    (b.bike.price_sale_gbp ?? b.bike.price_rrp_gbp ?? 0)
  );
  return scored.slice(0, limit);
}

// --- rendering ---
function renderResults(scoredList, mountId='bike-results'){
  const el = document.getElementById(mountId);
  el.innerHTML = '';
  if (!scoredList.length){ el.textContent = 'No matches. Try increasing your budget or relaxing filters.'; return; }

  for (const {bike, score} of scoredList){
    const price = bike.price_sale_gbp ?? bike.price_rrp_gbp;
    const card = document.createElement('div');
    card.className = 'bike-card';
    card.innerHTML = `
      <img src="${bike.image_url || ''}" alt="${escapeHtml(bike.model_name || bike.brand || 'Bike')}"/>
      <div class="bike-meta">
        <div><strong>${escapeHtml(bike.brand || '')}</strong> – ${escapeHtml(bike.model_name || '')}</div>
        <div class="tags">${[bike.frame_style, bike.frame_size_label, bike.colour].filter(Boolean).join(' • ')}</div>
        <div class="price">${money(price)}</div>
        <div class="tags">score: ${score} / 4</div>
        <div><a class="btn" href="${bike.product_url}" target="_blank" rel="noopener">View &nbsp;→</a></div>
      </div>
    `;
    card.querySelector('.btn')?.addEventListener('click', () => {
      // let host page know (for analytics) if embedded
      parent?.postMessage?.({ type:'widget:purchaseClick', payload:{ sku_id: bike.sku_id, product_url: bike.product_url } }, '*');
    });
    el.appendChild(card);
  }

  // notify host
  parent?.postMessage?.({ type:'widget:resultsShown', payload:{ count: scoredList.length } }, '*');
}

// --- init ---
(async function init(){
  // read optional params from loader (retailer, theme, budget, etc.)
  const initialBudget = Number(qs('budget')) || undefined;

  const BIKES = await loadBikesJSON();
  window.__BIKES__ = BIKES;

  // preload demo form from query string
  if (initialBudget) document.getElementById('budget').value = String(initialBudget);

  document.getElementById('apply').addEventListener('click', runSearch);

  // run once on load
  runSearch();

  function runSearch(){
    const answers = {
      use_case: val('#use_case'),
      terrain: val('#terrain'),
      range: val('#range'),
      equipped: val('#equipped'),
      max_budget: num('#budget')
    };
    const top = findTopMatches(BIKES, answers, 8, 0);
    renderResults(top);
  }

  function val(sel){ return (document.querySelector(sel)?.value || '').trim() || undefined; }
  function num(sel){ const v = Number(document.querySelector(sel)?.value || ''); return Number.isFinite(v) ? v : undefined; }

  // let host know widget is ready
  parent?.postMessage?.({ type:'widget:loaded' }, '*');
})().catch(console.error);

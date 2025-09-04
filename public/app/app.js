const root = document.getElementById("quiz-root");

const RANGE_BANDS = [
  { key: "short",  label: "Up to ~20 miles (<400Wh)",  isIn: (wh) => wh > 0 && wh < 400 },
  { key: "medium", label: "20–40 miles (400–550Wh)",   isIn: (wh) => wh >= 400 && wh <= 550 },
  { key: "long",   label: "40+ miles (>550Wh)",        isIn: (wh) => wh > 550 }
];
const BUDGET_BANDS = [
  { key: "b1", label: "Under £1,500", max: 1500 },
  { key: "b2", label: "£1,500–£2,000", max: 2000 },
  { key: "b3", label: "£2,000–£2,500", max: 2500 },
  { key: "b4", label: "£2,500–£3,000", max: 3000 },
  { key: "b5", label: "£3,000–£4,000", max: 4000 },
  { key: "b6", label: "£4,000+",       max: Infinity },
  { key: "unsure", label: "I'm not sure", max: Infinity }
];
const EQUIPPED_KEYS = ["equipped_lights","equipped_mudguards","equipped_rear_rack","equipped_kickstand","equipped_chainguard"];

function currency(n){ return n || n === 0 ? `£${Number(n).toLocaleString()}` : "—"; }
function isEquipped3Plus(bike){ return EQUIPPED_KEYS.reduce((n,k)=> n + (String(bike[k]).toLowerCase()==="true" ? 1:0), 0) >= 3; }
function deriveRangeKey(wh){ for (const b of RANGE_BANDS) if (b.isIn(Number(wh))) return b.key; return "unknown"; }

// Load bikes.json
async function loadBikes(){
  try { const r = await fetch("/bikes.json"); return await r.json(); }
  catch { return { items: [] }; }
}

// Quiz state
let step   = -1; // -1=intro, 0..4=questions, 5=results
let closed = false;
const answers = { use_case:"", terrain:"", range:"", equipped:"unsure", budget_band:"unsure" };
let results = [];

// Navigation helpers
function doRestart(){ step = -1; render(); }
function doClose(){ closed = true; render(); }
function goBack(){
  if (step === -1) return;     // already intro
  if (step === 0) { step = -1; render(); return; } // from Q1 back to intro
  if (step > 0 && step <= 5) { step -= 1; render(); }
}

function render(){
  root.innerHTML = "";

  // Closed state
  if (closed){
    const msg = document.createElement("div");
    msg.className = "closed";
    msg.innerHTML = `<p>Quiz closed. <button class="control-btn" id="reopen">Restart</button></p>`;
    msg.querySelector("#reopen").onclick = () => { closed = false; doRestart(); };
    root.appendChild(msg);
    return;
  }

  // --- Top-right controls (show/hide by step) ---
  const controls = document.createElement("div");
  controls.className = "quiz-controls";

  // Back: only during questions & results (not on intro)
  if (step >= 0 && step <= 5){
    const backBtn = document.createElement("button");
    backBtn.className = "control-btn ghost";
    backBtn.textContent = "Back";
    backBtn.onclick = goBack;
    controls.appendChild(backBtn);
  }

  // Restart: only after quiz has started (not on intro)
  if (step >= 0){
    const restartBtn = document.createElement("button");
    restartBtn.className = "control-btn";
    restartBtn.textContent = "Restart";
    restartBtn.onclick = doRestart;
    controls.appendChild(restartBtn);
  }

  // Close: always visible
  const closeBtn = document.createElement("button");
  closeBtn.className = "control-btn close";
  closeBtn.setAttribute("aria-label","Close quiz");
  closeBtn.textContent = "×";
  closeBtn.onclick = doClose;
  controls.appendChild(closeBtn);

  root.appendChild(controls);

  // --- Intro ---
  if (step === -1){
    const container = document.createElement("div");
    container.className = "intro";
    container.innerHTML = `
      <h1>Find Your Perfect E-Bike 🚴‍♀️</h1>
      <p>Answer 5 quick questions and we’ll match you with the best bikes in stock right now.</p>
      <button class="start-btn">Start Quiz</button>
    `;
    container.querySelector(".start-btn").onclick = () => { step = 0; render(); };
    root.appendChild(container);
    return;
  }

  // --- Questions ---
  if (step === 0){
    renderQuestion("How will you most commonly use your e-bike?",
      ["commuting","leisure","hills","offroad","unsure"], "use_case");
  }
  else if (step === 1){
    renderQuestion("Where will you most commonly use your e-bike?",
      ["road","mixed","offroad","unsure"], "terrain", (val)=>{
        if (val==="road") return "Roads";
        if (val==="mixed") return "Trails";
        if (val==="offroad") return "Mountains";
        return "Don't mind";
      });
  }
  else if (step === 2){
    renderQuestion("How far will you typically go on a single charge?",
      RANGE_BANDS.map(b=>b.key).concat("unsure"), "range", (val)=>{
        const band = RANGE_BANDS.find(b=>b.key===val);
        return band ? band.label : "I'm not sure / Don't mind";
      });
  }
  else if (step === 3){
    renderQuestion("Are you looking for a fully equipped bike?",
      ["yes","no","unsure"], "equipped", (val)=> val.charAt(0).toUpperCase()+val.slice(1));
  }
  else if (step === 4){
    renderQuestion("Do you have a budget in mind?",
      BUDGET_BANDS.map(b=>b.key), "budget_band", (val)=> BUDGET_BANDS.find(b=>b.key===val)?.label || val);
  }
  else if (step === 5){
    renderResults();
  }
}

function renderQuestion(title, options, field, labelFn=(x)=>x){
  const container = document.createElement("div");
  const h2 = document.createElement("h2");
  h2.textContent = title;
  container.appendChild(h2);

  const btns = document.createElement("div");
  btns.className = "buttons";
  options.forEach(opt=>{
    const btn = document.createElement("button");

    // Capitalise first letter unless labelFn overrides
    const rawLabel = labelFn(opt);
    const finalLabel = rawLabel.charAt(0).toUpperCase() + rawLabel.slice(1);

    btn.textContent = finalLabel;
    if (answers[field]===opt) btn.classList.add("active");
    btn.onclick = ()=>{
      answers[field]=opt;
      step++;
      if (step<=4) render();
      else scoreAndShow();
    };
    btns.appendChild(btn);
  });
  container.appendChild(btns);
  root.appendChild(container);
}


function scoreAndShow(){
  loadBikes().then(data=>{
    const items = data.items || [];
    results = scoreBikes(items, answers);
    step = 5;
    render();
  });
}

function scoreBikes(items, answers){
  const budget = BUDGET_BANDS.find(b=>b.key===answers.budget_band);
  const budgetMax = budget ? budget.max : Infinity;

  return items
    .filter(b=>b.in_stock)
    .map(b=>({
      ...b,
      _use_cases:(b.use_cases||"").split(",").map(s=>s.trim().toLowerCase()),
      _terrain:(b.surfaces||"").toLowerCase(),
      _range:deriveRangeKey(b.battery_wh),
      _equipped:isEquipped3Plus(b),
      _price:Number(b.price_sale_gbp||b.price_rrp_gbp||0)
    }))
    .filter(b=>b._price<=budgetMax)
    .map(b=>{
      let score=0, missed=[];
      if (answers.use_case!=="unsure" && b._use_cases.includes(answers.use_case)) score++; else if(answers.use_case!=="unsure") missed.push("Use case");
      if (answers.terrain!=="unsure" && b._terrain===answers.terrain) score++; else if(answers.terrain!=="unsure") missed.push("Terrain");
      if (answers.range!=="unsure" && b._range===answers.range) score++; else if(answers.range!=="unsure") missed.push("Range");
      if (answers.equipped!=="unsure"){
        const want = answers.equipped==="yes";
        if (b._equipped===want) score++; else missed.push("Equipped");
      }
      return { ...b, score, missed };
    })
    .sort((a,b)=> b.score-a.score || a._price-b._price)
    .slice(0,5);
}

function renderResults(){
  const container = document.createElement("div");
  const h2 = document.createElement("h2");
  h2.textContent = "Top Matches";
  container.appendChild(h2);

  const grid = document.createElement("div");
  grid.className="results";

  if (results.length===0){
    grid.textContent="No matches found.";
  } else {
    results.forEach(r=>{
      const card=document.createElement("div");
      card.className="result-card";

      const img=document.createElement("img");
      img.src=r.image_url;
      card.appendChild(img);

      const info=document.createElement("div");
      info.className="info";
      info.innerHTML=`
        <div><strong>${r.brand} ${r.model_name}</strong> <span style="font-size:0.8em;opacity:0.6">Score ${r.score}/4</span></div>
        <div>${currency(r.price_sale_gbp||r.price_rrp_gbp)}</div>
        ${r.motor_brand?`<div>Motor: ${r.motor_brand}</div>`:""}
        ${r.battery_wh?`<div>Battery: ${r.battery_wh}Wh</div>`:""}
        ${r.frame_style?`<div>${r.frame_style}</div>`:""}
        ${r.missed&&r.missed.length?`<div class="missed">Missed: ${r.missed.join(", ")}</div>`:""}
        <a href="${r.product_url}" target="_blank">View bike</a>
      `;
      card.appendChild(info);
      grid.appendChild(card);
    });
  }
  container.appendChild(grid);
  root.appendChild(container);
}

// Kick off
render();

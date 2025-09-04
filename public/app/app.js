const root = document.getElementById("quiz-root");

const RANGE_BANDS = [
  { key: "short", label: "Up to ~20 miles (<400Wh)", isIn: (wh) => wh > 0 && wh < 400 },
  { key: "medium", label: "20–40 miles (400–550Wh)", isIn: (wh) => wh >= 400 && wh <= 550 },
  { key: "long", label: "40+ miles (>550Wh)", isIn: (wh) => wh > 550 }
];
const BUDGET_BANDS = [
  { key: "b1", label: "Under £1,500", max: 1500 },
  { key: "b2", label: "£1,500–£2,000", max: 2000 },
  { key: "b3", label: "£2,000–£2,500", max: 2500 },
  { key: "b4", label: "£2,500–£3,000", max: 3000 },
  { key: "b5", label: "£3,000–£4,000", max: 4000 },
  { key: "b6", label: "£4,000+", max: Infinity },
  { key: "unsure", label: "I'm not sure", max: Infinity }
];
const EQUIPPED_KEYS = ["equipped_lights","equipped_mudguards","equipped_rear_rack","equipped_kickstand","equipped_chainguard"];

function currency(n) {
  return n ? `£${Number(n).toLocaleString()}` : "—";
}

function isEquipped3Plus(bike) {
  return EQUIPPED_KEYS.reduce((n, k) => n + (String(bike[k]).toLowerCase() === "true" ? 1 : 0), 0) >= 3;
}

function deriveRangeKey(wh) {
  for (const band of RANGE_BANDS) if (band.isIn(Number(wh))) return band.key;
  return "unknown";
}

// Load bikes.json
async function loadBikes() {
  try {
    const res = await fetch("/bikes.json");
    return await res.json();
  } catch {
    return { items: [] };
  }
}

// Quiz state
let step = -1; // start at intro
let closed = false; // track closed state
const answers = { use_case:"", terrain:"", range:"", equipped:"unsure", budget_band:"unsure" };
let results = [];

function render() {
  root.innerHTML = "";

  // If closed
  if (closed) {
    const msg = document.createElement("div");
    msg.className = "closed";
    msg.innerHTML = `<p>Quiz closed. <button class="restart-btn">Restart</button></p>`;
    msg.querySelector(".restart-btn").onclick = () => { closed = false; step = -1; render(); };
    root.appendChild(msg);
    return;
  }

  // Header with restart + close buttons
  const header = document.createElement("div");
  header.className = "quiz-header";

  const restartBtn = document.createElement("button");
  restartBtn.textContent = "Restart";
  restartBtn.className = "header-btn";
  restartBtn.onclick = () => { step = -1; render(); };

  const closeBtn = document.createElement("button");
  closeBtn.textContent = "×";
  closeBtn.className = "header-btn close";
  closeBtn.onclick = () => { closed = true; render(); };

  header.appendChild(restartBtn);
  header.appendChild(closeBtn);
  root.appendChild(header);

  // Intro screen
  if (step === -1) {
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

  // Questions
  if (step === 0) {
    renderQuestion("How will you most commonly use your e-bike?", 
      ["commuting","leisure","hills","offroad","unsure"], "use_case");
  }
  else if (step === 1) {
    renderQuestion("Where will you most commonly use your e-bike?", 
      ["road","mixed","offroad","unsure"], "terrain", (val) => {
        if (val==="road") return "Roads";
        if (val==="mixed") return "Trails";
        if (val==="offroad") return "Mountains";
        return "Don't mind";
      });
  }
  else if (step === 2) {
    renderQuestion("How far will you typically go on a single charge?", 
      RANGE_BANDS.map(b=>b.key).concat("unsure"), "range", (val) => {
        const band = RANGE_BANDS.find(b=>b.key===val);
        return band ? band.label : "I'm not sure / Don't mind";
      });
  }
  else if (step === 3) {
    renderQuestion("Are you looking for a fully equipped bike?", 
      ["yes","no","unsure"], "equipped", (val) => val.charAt(0).toUpperCase()+val.slice(1));
  }
  else if (step === 4) {
    renderQuestion("Do you have a budget in mind?", 
      BUDGET_BANDS.map(b=>b.key), "budget_band", (val)=>{
        return BUDGET_BANDS.find(b=>b.key===val)?.label || val;
      });
  }
  else if (step === 5) {
    renderResults();
  }
}

function renderQuestion(title, options, field, labelFn=(x)=>x) {
  const container = document.createElement("div");
  const h2 = document.createElement("h2");
  h2.textContent = title;
  container.appendChild(h2);

  const btns = document.createElement("div");
  btns.className = "buttons";
  options.forEach(opt=>{
    const btn = document.createElement("button");
    btn.textContent = labelFn(opt);
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

function scoreAndShow() {
  loadBikes().then(data=>{
    const items = data.items||[];
    results = scoreBikes(items, answers);
    step=5;
    render();
  });
}

function scoreBikes(items, answers) {
  const budget = BUDGET_BANDS.find(b=>b.key===answers.budget_band);
  const budgetMax = budget? budget.max:Infinity;

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
      if (answers.equipped!=="unsure") {
        const want = answers.equipped==="yes";
        if (b._equipped===want) score++; else missed.push("Equipped");
      }
      return { ...b, score, missed };
    })
    .sort((a,b)=> b.score-a.score || a._price-b._price)
    .slice(0,5);
}

function renderResults() {
  const container = document.createElement("div");
  const h2 = document.createElement("h2");
  h2.textContent = "Top Matches";
  container.appendChild(h2);

  const grid = document.createElement("div");
  grid.className="results";

  if (results.length===0) {
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

// Start
render();

import 'dotenv/config';
import fs from 'fs/promises';
import { parse } from 'csv-parse/sync';
import fetch from 'node-fetch';
import crypto from 'crypto';

const MODELS_SRC   = process.env.MODELS_CSV;
const SKU_SRC      = process.env.SKU_CSV;
const RETAILER_SRC = process.env.RETAILER_CSV;
const OUTPUT_JSON  = process.env.OUTPUT_JSON || './public/bikes.json';

if (!MODELS_SRC || !SKU_SRC || !RETAILER_SRC) {
  console.error('Missing env: MODELS_CSV, SKU_CSV, RETAILER_CSV');
  process.exit(1);
}

const isHttp = (s) => /^https?:\/\//i.test(s);

async function readCSV(src) {
  if (isHttp(src)) {
    const res = await fetch(src, {
      // Some Google publish links return HTML unless a UA is present
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
      redirect: 'follow',
      cache: 'no-store'
    });
    const buf = Buffer.from(await res.arrayBuffer());
    // Quick guard: if it looks like HTML, fail fast with a helpful message
    const head = buf.slice(0, 100).toString('utf8');
    if (/<!doctype html/i.test(head) || /<html/i.test(head)) {
      throw new Error(`Expected CSV but got HTML from: ${src}
Tip: ensure the link ends with output=csv (Publish to web → CSV) or use the export?format=csv&gid=... form.`);
    }
    return parse(buf, { columns: true, skip_empty_lines: true });
  } else {
    const buf = await fs.readFile(src);
    return parse(buf, { columns: true, skip_empty_lines: true });
  }
}


// helpers
const norm = (s) => (s ?? '').toString().trim();
const nlower = (s) => norm(s).toLowerCase();
const toNum = (s) => {
  const m = norm(s).match(/-?\d[\d,]*\.?\d*/);
  if (!m) return null;
  const n = parseFloat(m[0].replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
};
const validGTIN = (code) => {
  const s = norm(code);
  if (!/^\d{8}$|^\d{12}$|^\d{13}$|^\d{14}$/.test(s)) return false;
  const digits = [...s].map(d => +d);
  const chk = digits.pop();
  let sum = 0, w = 3;
  for (let i = digits.length - 1; i >= 0; i--) {
    sum += digits[i] * w;
    w = (w === 3 ? 1 : 3);
  }
  const exp = (10 - (sum % 10)) % 10;
  return exp === chk;
};
const hash8 = (s) => crypto.createHash('md5').update(s).digest('hex').slice(0, 8);
const csvHas = (row, key) => Object.prototype.hasOwnProperty.call(row, key);

// Build retailer-agnostic CSID
function makeCSID({ gtin, mpn, brand, model_name, size, colour }) {
  const sizeKey = nlower(size);
  const colKey  = nlower(colour);
  if (validGTIN(gtin)) return `${gtin}|${sizeKey}|${colKey}`;
  if (mpn) return `${nlower(brand)}|${norm(mpn)}|${sizeKey}|${colKey}`;
  return `csid_${hash8(`${nlower(brand)}|${nlower(model_name)}|${sizeKey}|${colKey}`)}`;
}

try {
  // Load CSVs
  const [modelsCSV, skusCSV, retailCSV] = await Promise.all([
    readCSV(MODELS_SRC),
    readCSV(SKU_SRC),
    readCSV(RETAILER_SRC)
  ]);

  // Index models by model_id
  const modelsById = new Map();
  for (const m of modelsCSV) modelsById.set(norm(m.model_id), m);

  // Index retailer rows by sku_id (this is g:id in your pipeline)
  const retailBySkuId = new Map();
  for (const r of retailCSV) retailBySkuId.set(norm(r.sku_id), r);

  // Build output
  const items = [];
  const seenCSID = new Set();

  for (const s of skusCSV) {
    const skuId = norm(s.sku_id);           // g:id
    const modelId = norm(s.model_id);
    if (!skuId || !modelId) continue;

    const model = modelsById.get(modelId);
    const retail = retailBySkuId.get(skuId);
    if (!model || !retail) continue;

    // Only in-stock for MVP
    if (nlower(retail.in_stock) !== 'true') continue;

    // Optional mpn/gtin (from either CSV if present)
    const mpn  = csvHas(s, 'mpn') ? norm(s.mpn) :
                 (csvHas(retail, 'mpn') ? norm(retail.mpn) : '');
    const gtin = csvHas(s, 'gtin') ? norm(s.gtin) :
                 (csvHas(retail, 'gtin') ? norm(retail.gtin) : '');

    const brand = norm(model.brand);
    const model_name = norm(model.model_name);
    const size = norm(s.frame_size_label);
    const colour = norm(s.colour);

    const csid = makeCSID({ gtin, mpn, brand, model_name, size, colour });
    if (seenCSID.has(csid)) continue; // skip duplicates for MVP
    seenCSID.add(csid);

    const price_rrp = toNum(retail.price_rrp_gbp);
    const price_sale = toNum(retail.price_sale_gbp);

    items.push({
      // IDs
      sku_id: csid,                 // portable ID for your app
      retailer_join_id: skuId,      // g:id (join back to retailer rows)
      mpn: mpn || undefined,
      gtin: gtin || undefined,

      // Descriptive
      brand,
      model_name,
      model_year: norm(model.model_year) || undefined,
      category: norm(model.category) || undefined,

      // Fit / usage
      use_cases: norm(model.use_cases) || undefined,
      surfaces: norm(model.surfaces) || undefined,
      frame_style: norm(s.frame_style) || undefined,
      frame_styles: norm(model.frame_styles) || undefined,
      frame_size_label: size || undefined,
      colour: colour || undefined,

      // Motor/battery
      motor_brand: norm(model.motor_brand) || undefined,
      motor_system: norm(model.motor_system) || undefined,
      motor_torque_nm: toNum(model.motor_torque_nm) ?? undefined,
      battery_wh: toNum(s.battery_wh) ?? toNum(model.battery_default_wh) ?? undefined,
      battery_removable: norm(model.battery_removable) || undefined,

      // Retail
      in_stock: true,
      price_rrp_gbp: price_rrp ?? undefined,
      price_sale_gbp: price_sale ?? undefined,
      product_url: norm(retail.product_url),
      image_url: norm(retail.image_url),

      // Equipped
      equipped_lights: norm(model.equipped_lights) || undefined,
      equipped_mudguards: norm(model.equipped_mudguards) || undefined,
      equipped_rear_rack: norm(model.equipped_rear_rack) || undefined,
      equipped_kickstand: norm(model.equipped_kickstand) || undefined,
      equipped_chainguard: norm(model.equipped_chainguard) || undefined,

      // Meta
      weight_kg: toNum(model.weight_kg) ?? undefined,
      notes: norm(model.notes) || undefined,
      _model_id: modelId
    });
  }

  // Sort for stable output
  items.sort((a, b) =>
    (nlower(a.brand).localeCompare(nlower(b.brand)) ||
     nlower(a.model_name).localeCompare(nlower(b.model_name)) ||
     ((a.price_sale_gbp ?? a.price_rrp_gbp ?? 0) - (b.price_sale_gbp ?? b.price_rrp_gbp ?? 0)))
  );

  // Ensure dir exists and write file
  await fs.mkdir('public', { recursive: true });
  await fs.writeFile(OUTPUT_JSON, JSON.stringify({ generated_at: new Date().toISOString(), items }, null, 2));
  console.log(`Wrote ${items.length} bikes to ${OUTPUT_JSON}`);
} catch (err) {
  console.error(err);
  process.exit(1);
}

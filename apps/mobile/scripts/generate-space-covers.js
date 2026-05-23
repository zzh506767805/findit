#!/usr/bin/env node
const fs = require('node:fs/promises');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'assets', 'space-covers');
const SIZE = '1024x640';
const QUALITY = 'low';
const OUTPUT_COMPRESSION = 58;
const API_VERSION = '2025-04-01-preview';
const DEPLOYMENT = process.env.IMAGE_DEPLOYMENT || 'gpt-image-2';

const resource = process.env.ANTHROPIC_FOUNDRY_RESOURCE || process.env.AZURE_FOUNDRY_RESOURCE || 'zihao250424';
const apiKey = process.env.ANTHROPIC_FOUNDRY_API_KEY || process.env.AZURE_API_KEY || process.env.AZURE_OPENAI_API_KEY;

if (!apiKey) {
  console.error('Missing API key: set ANTHROPIC_FOUNDRY_API_KEY, AZURE_API_KEY, or AZURE_OPENAI_API_KEY.');
  process.exit(1);
}

const force = process.argv.includes('--force');

const endpoints = [
  {
    name: 'azure-openai-deployment',
    url: `https://${resource}.cognitiveservices.azure.com/openai/deployments/${DEPLOYMENT}/images/generations?api-version=${API_VERSION}`,
    headers: { 'api-key': apiKey }
  },
  {
    name: 'foundry-openai-v1',
    url: `https://${resource}.services.ai.azure.com/openai/v1/images/generations`,
    headers: { Authorization: `Bearer ${apiKey}` }
  }
];

const common = [
  'Realistic editorial interior photo for a home organization mobile app space card cover.',
  'Tidy, organized, warm natural daylight, calm lived-in home, premium but practical.',
  'No people, no text, no logos, no watermark. Clear visual cues for the named space.',
  'Horizontal mobile card background, natural colors, photographic realism.'
].join(' ');

const jobs = [
  ['living_1.jpg', 'Living room with sofa, coffee table, TV console, soft rug, plants, morning light.'],
  ['living_2.jpg', 'Living room corner with sectional sofa, side table, media cabinet, neatly arranged everyday items.'],
  ['living_3.jpg', 'Open living room with bookshelf, lounge chair, low table, layered textiles, bright natural light.'],
  ['living_4.jpg', 'Compact apartment living area with sofa, media wall, storage baskets, plants, tidy daily objects.'],
  ['bedroom_1.jpg', 'Bedroom with bed, pillows, bedside table, wardrobe detail, soft bedding, warm daylight.'],
  ['bedroom_2.jpg', 'Bedroom storage area with made bed, nightstand, closet doors, folded blanket, quiet cozy mood.'],
  ['bedroom_3.jpg', 'Small bedroom with bed, reading lamp, dresser, soft curtains, organized personal items.'],
  ['bedroom_4.jpg', 'Minimal bedroom with wardrobe, bedside shelf, clean bedding, warm lamp, restful practical mood.'],
  ['kitchen_1.jpg', 'Kitchen with countertop, cabinets, sink, stove, organized utensils, clean practical surfaces.'],
  ['kitchen_2.jpg', 'Kitchen and dining corner with counter, shelves, table edge, tidy cookware, warm daylight.'],
  ['kitchen_3.jpg', 'Galley kitchen with clean counters, hanging utensils, small appliances, cabinets, realistic home light.'],
  ['kitchen_4.jpg', 'Dining kitchen with wooden table, pantry shelves, bright window, bowls and cookware neatly arranged.'],
  ['entry_1.jpg', 'Entryway with shoe cabinet, console table, keys tray, mirror, clean doorway light.'],
  ['entry_2.jpg', 'Home foyer with coat hooks, shoe storage, umbrella stand, small bench, welcoming light.'],
  ['entry_3.jpg', 'Narrow entry area with shoe bench, wall hooks, tote bags, mirror, tidy landing zone.'],
  ['entry_4.jpg', 'Apartment doorway with slim console, organized shoes, key bowl, soft hallway light.'],
  ['hallway_1.jpg', 'Apartment hallway with warm wall lighting, clean floor, simple storage cabinet, calm depth.'],
  ['hallway_2.jpg', 'Narrow home corridor with framed wall, runner rug, side cabinet, organized passage.'],
  ['hallway_3.jpg', 'Bright hallway with built-in cabinet, framed art, wooden floor, clear path, warm depth.'],
  ['hallway_4.jpg', 'Home corridor leading to rooms, small shelf, runner rug, tidy walls, soft afternoon light.'],
  ['bathroom_1.jpg', 'Bathroom sink area with vanity, mirror, towels, skincare tray, clean spa-like materials.'],
  ['bathroom_2.jpg', 'Bathroom with shower glass, wash basin, storage shelf, folded towels, bright clean light.'],
  ['bathroom_3.jpg', 'Compact bathroom vanity with mirror cabinet, toothbrush cup, towels, clean tile, daylight.'],
  ['bathroom_4.jpg', 'Modern bathroom storage nook with sink, shelves, towels, bath products, calm neutral materials.'],
  ['study_1.jpg', 'Home study with desk, chair, books, laptop area, shelves, focused tidy workspace.'],
  ['study_2.jpg', 'Office corner with writing desk, bookcase, lamp, organized stationery, warm daylight.'],
  ['study_3.jpg', 'Reading and work nook with desk, bookshelf, task lamp, notebooks, organized home office feeling.'],
  ['study_4.jpg', 'Compact study space with laptop desk, wall shelves, books, plant, calm productive light.'],
  ['balcony_1.jpg', 'Small apartment balcony with plants, sunlight, cozy chair, clean outdoor storage.'],
  ['balcony_2.jpg', 'Balcony laundry and plant corner with sunlight, railing, tidy shelves, urban home feeling.'],
  ['balcony_3.jpg', 'Sunny balcony with potted plants, small table, floor tiles, tidy outdoor corner.'],
  ['balcony_4.jpg', 'Narrow balcony with drying rack, plants, storage cabinet, bright city apartment light.'],
  ['storage_1.jpg', 'Storage room with shelves, labeled boxes, folded textiles, organized home supplies.'],
  ['storage_2.jpg', 'Walk-in closet or storage closet with hanging clothes, drawers, boxes, tidy organization.'],
  ['storage_3.jpg', 'Utility storage closet with shelves, baskets, cleaning supplies, folded linens, tidy labels.'],
  ['storage_4.jpg', 'Organized pantry and storage area with boxes, jars, bins, shelves, practical home order.']
];

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function existsGood(file) {
  try {
    const stat = await fs.stat(file);
    return stat.size > 20_000;
  } catch {
    return false;
  }
}

function requestBody(prompt) {
  return JSON.stringify({
    model: DEPLOYMENT,
    prompt: `${common} ${prompt}`,
    size: SIZE,
    n: 1,
    quality: QUALITY,
    output_format: 'jpeg',
    output_compression: OUTPUT_COMPRESSION
  });
}

async function generateOnce(job) {
  const [filename, prompt] = job;
  const body = requestBody(prompt);
  let lastError = null;

  for (const endpoint of endpoints) {
    try {
      const response = await fetch(endpoint.url, {
        method: 'POST',
        headers: {
          ...endpoint.headers,
          'Content-Type': 'application/json'
        },
        body,
        signal: AbortSignal.timeout(300_000)
      });

      const text = await response.text();
      if (!response.ok) {
        lastError = `${endpoint.name} HTTP ${response.status}: ${text.slice(0, 240)}`;
        continue;
      }

      const json = JSON.parse(text);
      const b64 = json.data?.[0]?.b64_json;
      if (!b64) {
        lastError = `${endpoint.name} returned no image data`;
        continue;
      }

      const file = path.join(OUT_DIR, filename);
      const tmp = `${file}.tmp`;
      await fs.writeFile(tmp, Buffer.from(b64, 'base64'));
      await fs.rename(tmp, file);
      console.log(`wrote ${filename} via ${endpoint.name}`);
      return true;
    } catch (err) {
      lastError = `${endpoint.name}: ${err.message}`;
    }
  }

  throw new Error(lastError || 'unknown generation failure');
}

async function main() {
  await fs.mkdir(OUT_DIR, { recursive: true });
  let attempt = 0;

  while (true) {
    const missing = [];
    for (const job of jobs) {
      const file = path.join(OUT_DIR, job[0]);
      if (force || !(await existsGood(file))) missing.push(job);
    }

    if (!missing.length) {
      console.log(`all ${jobs.length} space covers are present`);
      return;
    }

    console.log(`missing ${missing.length}/${jobs.length}: ${missing.map(job => job[0]).join(', ')}`);

    for (const job of missing) {
      const file = path.join(OUT_DIR, job[0]);
      if (!force && await existsGood(file)) continue;

      attempt += 1;
      try {
        console.log(`generating ${job[0]} attempt ${attempt}`);
        await generateOnce(job);
        await sleep(10_000);
      } catch (err) {
        const waitMs = Math.min(180_000, 20_000 + attempt * 10_000);
        console.warn(`failed ${job[0]}: ${err.message}`);
        console.warn(`waiting ${Math.round(waitMs / 1000)}s before continuing`);
        await sleep(waitMs);
      }
    }
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});

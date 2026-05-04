/**
 * Downloads the IEEE MA-L OUI registry and compiles it into a compact JSON
 * lookup map at server/data/oui-ieee.json.
 *
 * Run with:  node server/scripts/update-oui-db.js
 * Add to CI: npm run update-oui
 *
 * Output format: { "AABBCC": "Apple Inc.", "DDEEFF": "Samsung Electronics Co.,Ltd", ... }
 * ~37,000 entries, ~2.5 MB on disk.
 */

const https = require('https');
const fs    = require('fs');
const path  = require('path');

const OUI_CSV_URL   = 'https://standards-oui.ieee.org/oui/oui.csv';
const OUTPUT_FILE   = path.join(__dirname, '../data/oui-ieee.json');

function fetchUrl(url) {
    return new Promise((resolve, reject) => {
        https.get(url, { headers: { 'User-Agent': 'NetAIQ-OUI-Updater/1.0' } }, (res) => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                return resolve(fetchUrl(res.headers.location));
            }
            if (res.statusCode !== 200) {
                return reject(new Error(`HTTP ${res.statusCode} from ${url}`));
            }
            const chunks = [];
            res.on('data', c => chunks.push(c));
            res.on('end',  () => resolve(Buffer.concat(chunks).toString('utf8')));
            res.on('error', reject);
        }).on('error', reject);
    });
}

function parseCsv(csv) {
    const map = {};
    const lines = csv.split('\n');
    // Skip header row
    for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;

        // Format: Registry,Assignment,Organization Name,Organization Address
        // Assignment is always 6 uppercase hex chars (no colons)
        const firstComma  = line.indexOf(',');
        const secondComma = line.indexOf(',', firstComma + 1);
        if (firstComma === -1 || secondComma === -1) continue;

        const assignment = line.slice(firstComma + 1, secondComma).trim().toUpperCase();
        if (!/^[0-9A-F]{6}$/.test(assignment)) continue;

        // Organisation name may be quoted
        let rest = line.slice(secondComma + 1);
        let orgName = '';
        if (rest.startsWith('"')) {
            const closeQuote = rest.indexOf('"', 1);
            orgName = closeQuote !== -1 ? rest.slice(1, closeQuote) : rest.slice(1);
        } else {
            const nextComma = rest.indexOf(',');
            orgName = nextComma !== -1 ? rest.slice(0, nextComma) : rest;
        }

        orgName = orgName.trim();
        if (orgName) map[assignment] = orgName;
    }
    return map;
}

async function main() {
    console.log('Downloading IEEE OUI registry…');
    const csv  = await fetchUrl(OUI_CSV_URL);
    const lines = csv.split('\n').length - 1;
    console.log(`Downloaded ${lines} lines.`);

    console.log('Parsing…');
    const map    = parseCsv(csv);
    const count  = Object.keys(map).length;
    console.log(`Parsed ${count} OUI entries.`);

    fs.mkdirSync(path.dirname(OUTPUT_FILE), { recursive: true });
    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(map));
    const kb = Math.round(fs.statSync(OUTPUT_FILE).size / 1024);
    console.log(`Saved to ${OUTPUT_FILE} (${kb} KB, ${count} entries).`);
}

main().catch(err => {
    console.error('Failed to update OUI database:', err.message);
    process.exit(1);
});

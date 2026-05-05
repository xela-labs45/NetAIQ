/**
 * Downloads all three IEEE OUI registries and compiles them into a single
 * flat JSON lookup map at server/data/oui-ieee.json.
 *
 *   MA-L  (oui.csv)    — 6-char assignments, ~39 000 entries
 *   MA-M  (mam.csv)    — 7-char assignments, ~5 000 entries
 *   MA-S  (oui36.csv)  — 9-char assignments, ~6 000 entries
 *
 * All keys are uppercase hex strings of their respective lengths stored in
 * one flat object.  lookupMac() tries 9-char first, then 7-char, then 6-char
 * so the most specific assignment always wins.
 *
 * Run with:  npm run update-oui
 */

const https = require('https');
const fs    = require('fs');
const path  = require('path');

const SOURCES = [
    { url: 'https://standards-oui.ieee.org/oui/oui.csv',    assignmentLen: 6, label: 'MA-L' },
    { url: 'https://standards-oui.ieee.org/oui28/mam.csv',   assignmentLen: 7, label: 'MA-M' },
    { url: 'https://standards-oui.ieee.org/oui36/oui36.csv', assignmentLen: 9, label: 'MA-S' },
];

const OUTPUT_FILE = path.join(__dirname, '../data/oui-ieee.json');

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

// Parse a single CSV field, advancing pos past the field and any trailing comma.
// Handles RFC 4180 double-quote escaping ("").
function parseCsvField(line, pos) {
    if (pos >= line.length) return { value: '', pos };
    if (line[pos] === '"') {
        let value = '';
        pos++; // skip opening quote
        while (pos < line.length) {
            if (line[pos] === '"') {
                if (line[pos + 1] === '"') { value += '"'; pos += 2; }
                else { pos++; break; }
            } else {
                value += line[pos++];
            }
        }
        if (line[pos] === ',') pos++;
        return { value, pos };
    } else {
        const end = line.indexOf(',', pos);
        if (end === -1) return { value: line.slice(pos), pos: line.length };
        return { value: line.slice(pos, end), pos: end + 1 };
    }
}

function parseCsv(csv, assignmentLen) {
    const map = {};
    const assignmentRe = new RegExp(`^[0-9A-F]{${assignmentLen}}$`);
    const lines = csv.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
    // Skip header row
    for (let i = 1; i < lines.length; i++) {
        const line = lines[i];
        if (!line.trim()) continue;

        // Format: Registry,Assignment,Organization Name,Organization Address
        const f1 = parseCsvField(line, 0);       // Registry (ignored)
        const f2 = parseCsvField(line, f1.pos);   // Assignment
        const f3 = parseCsvField(line, f2.pos);   // Organization Name

        const assignment = f2.value.trim().toUpperCase();
        if (!assignmentRe.test(assignment)) continue;

        const orgName = f3.value.trim();
        if (orgName) map[assignment] = orgName;
    }
    return map;
}

async function main() {
    const merged = {};
    let totalEntries = 0;

    for (const source of SOURCES) {
        console.log(`Downloading ${source.label} (${source.url})…`);
        try {
            const csv = await fetchUrl(source.url);
            const entries = parseCsv(csv, source.assignmentLen);
            const count = Object.keys(entries).length;
            console.log(`  ${source.label}: ${count} entries (${source.assignmentLen}-char keys)`);
            Object.assign(merged, entries);
            totalEntries += count;
        } catch (err) {
            console.warn(`  ${source.label}: FAILED (${err.message}) — skipping`);
        }
    }

    console.log(`Total: ${Object.keys(merged).length} unique entries across all registries.`);

    fs.mkdirSync(path.dirname(OUTPUT_FILE), { recursive: true });
    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(merged));
    const kb = Math.round(fs.statSync(OUTPUT_FILE).size / 1024);
    console.log(`Saved to ${OUTPUT_FILE} (${kb} KB, ${totalEntries} source entries).`);
}

main().catch(err => {
    console.error('Failed to update OUI database:', err.message);
    process.exit(1);
});

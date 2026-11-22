// Fit team ratings so simulated title odds match FanDuel's devigged pre-tournament prices (June 8, 2026).
const sim = require("../sim.js");
const fs = require("fs");

const ODDS = {
  "Spain": 450, "France": 470, "England": 650, "Brazil": 850, "Portugal": 900, "Argentina": 950,
  "Germany": 1400, "Netherlands": 1700, "Belgium": 2200, "Norway": 3300, "Japan": 3500, "Colombia": 4000,
  "USA": 5000, "Morocco": 5500, "Mexico": 5500, "Uruguay": 5500, "Switzerland": 7500, "Turkiye": 8000,
  "Croatia": 8000, "Ecuador": 8000, "Austria": 10000, "Senegal": 15000, "Canada": 17500, "Sweden": 17500,
  "Scotland": 17500, "Ivory Coast": 20000, "Paraguay": 20000, "Algeria": 25000, "Egypt": 40000, "Ghana": 40000,
  "South Korea": 40000, "Czechia": 50000, "Iran": 50000, "Bosnia and Herzegovina": 50000, "Tunisia": 150000,
  "Cape Verde": 250000, "Uzbekistan": 250000, "Haiti": 250000, "Panama": 250000, "Curacao": 250000,
  "Qatar": 250000, "Saudi Arabia": 250000, "New Zealand": 250000, "Australia": 250000, "DR Congo": 250000,
  "Iraq": 250000, "Jordan": 250000, "South Africa": 250000,
};
const teams = Object.keys(ODDS);
const implied = {}; let total = 0;
teams.forEach((t) => { implied[t] = 100 / (ODDS[t] + 100); total += implied[t]; });
const market = {};
teams.forEach((t) => { market[t] = implied[t] / total; });
console.log("Overround:", total.toFixed(3));

// Start from log odds, then adjust.
const R = {};
teams.forEach((t) => { R[t] = 0.25 * Math.log(market[t] / 0.02); });

const N = 40000;
for (let it = 0; it < 40; it++) {
  const p = sim.simulate(R, N, 1, 1000 + it);
  let err = 0;
  teams.forEach((t) => {
    const ps = Math.max(p[t].reach[5], 0.5 / N);
    const step = 0.35 * (Math.log(market[t]) - Math.log(ps));
    R[t] += Math.max(-0.3, Math.min(0.3, step)) * (market[t] < 0.001 ? 0.5 : 1);
    err += Math.abs(ps - market[t]);
  });
  // Re-center ratings around zero.
  const m = teams.reduce((s, t) => s + R[t], 0) / teams.length;
  teams.forEach((t) => { R[t] -= m; });
  if (it % 5 === 0 || it === 39) console.log("iter", it, "total abs error", err.toFixed(4));
}

const final = sim.simulate(R, 200000, 1, 777);
const rows = teams.map((t) => [t, market[t], final[t].reach[5]]).sort((a, b) => b[1] - a[1]);
rows.slice(0, 14).forEach(([t, m, s]) => console.log(t.padEnd(24), (m * 100).toFixed(1).padStart(5), (s * 100).toFixed(1).padStart(6)));
const out = {};
teams.forEach((t) => { out[t] = { rating: +R[t].toFixed(4), odds: ODDS[t], market: +market[t].toFixed(5) }; });
fs.writeFileSync("ratings.json", JSON.stringify(out, null, 1));

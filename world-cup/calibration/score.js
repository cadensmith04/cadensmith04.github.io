const sim = require("../sim.js");
const fs = require("fs");
const ratings = JSON.parse(fs.readFileSync("ratings.json"));
const R = {}; Object.keys(ratings).forEach((t) => { R[t] = ratings[t].rating; });

const R32 = ["Canada","South Africa","Brazil","Japan","Paraguay","Germany","Morocco","Netherlands","Norway","Ivory Coast","France","Sweden","Mexico","Ecuador","England","DR Congo","Belgium","Senegal","USA","Bosnia and Herzegovina","Spain","Austria","Portugal","Croatia","Switzerland","Algeria","Egypt","Australia","Argentina","Cape Verde","Colombia","Ghana"];
const R16 = ["Canada","Brazil","Paraguay","Morocco","Norway","France","Mexico","England","Belgium","USA","Spain","Portugal","Switzerland","Egypt","Argentina","Colombia"];
const QF = ["France","Morocco","Norway","England","Spain","Belgium","Argentina","Switzerland"];
const SF = ["France","Spain","England","Argentina"];
const FIN = ["Spain","Argentina"];
const CH = ["Spain"];
const sets = [R32, R16, QF, SF, FIN, CH];
const teams = Object.keys(R);
const actual = {};
teams.forEach((t) => { actual[t] = sets.map((s) => (s.includes(t) ? 1 : 0)); });

const Ms = [0.6, 0.8, 1.0, 1.2, 1.5];
Ms.forEach((temp) => {
  const p = sim.simulate(R, 50000, temp, 4242);
  let b = 0, bn = 0, ll = 0, n = 0;
  sets.forEach((s, k) => {
    const base = s.length / 48;
    teams.forEach((t) => {
      const q = Math.min(Math.max(p[t].reach[k], 1e-4), 1 - 1e-4), o = actual[t][k];
      b += (q - o) ** 2; bn += (base - o) ** 2; ll += -(o * Math.log(q) + (1 - o) * Math.log(1 - q)); n++;
    });
  });
  console.log("temp", temp, "Brier", (b / n).toFixed(4), "naive", (bn / n).toFixed(4), "skill", (1 - b / bn).toFixed(3), "logloss", (ll / n).toFixed(4));
});

const p = sim.simulate(R, 200000, 1, 99);
const rows = teams.map((t) => ({ t, p: p[t].reach, g: p[t].group }));
rows.sort((a, b) => b.p[5] - a.p[5]);
rows.slice(0, 10).forEach((r) => console.log(r.t.padEnd(22), r.p.map((x) => (x * 100).toFixed(1).padStart(6)).join(""), (r.g * 100).toFixed(1).padStart(6)));
// surprises: actual outcomes with lowest prob
const ev = [];
teams.forEach((t) => sets.forEach((s, k) => {
  const o = actual[t][k], q = p[t].reach[k];
  ev.push({ t, k, o, q: o ? q : 1 - q });
}));
ev.sort((a, b) => a.q - b.q);
ev.slice(0, 14).forEach((e) => console.log(e.t, sim.ROUNDS[e.k], e.o ? "made it" : "missed", (e.q * 100).toFixed(1)));

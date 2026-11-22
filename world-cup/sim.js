// 2026 World Cup Monte Carlo engine. Shared by the browser page and the offline calibration script.
(function (root) {
  const GROUPS = {
    A: ["Mexico", "South Africa", "South Korea", "Czechia"],
    B: ["Canada", "Bosnia and Herzegovina", "Qatar", "Switzerland"],
    C: ["Brazil", "Morocco", "Haiti", "Scotland"],
    D: ["USA", "Paraguay", "Australia", "Turkiye"],
    E: ["Germany", "Curacao", "Ivory Coast", "Ecuador"],
    F: ["Netherlands", "Japan", "Sweden", "Tunisia"],
    G: ["Belgium", "Egypt", "Iran", "New Zealand"],
    H: ["Spain", "Cape Verde", "Saudi Arabia", "Uruguay"],
    I: ["France", "Senegal", "Iraq", "Norway"],
    J: ["Argentina", "Algeria", "Austria", "Jordan"],
    K: ["Portugal", "DR Congo", "Uzbekistan", "Colombia"],
    L: ["England", "Croatia", "Ghana", "Panama"],
  };
  const HOSTS = ["USA", "Mexico", "Canada"];

  // Groups whose third place team can fill each group winner's Round of 32 slot.
  const THIRD_SLOTS = {
    A: "CEFHI", B: "EFGIJ", D: "BEFIJ", E: "ABCDF",
    G: "AEHIJ", I: "CDFGH", K: "DEIJL", L: "EHIJK",
  };

  // Round of 32 matches in bracket order. "1A" = winner of A, "2B" = runner up, "3:I" = third place team in group I winner's slot.
  const R32 = [
    ["1I", "3:I"], ["1E", "3:E"], ["1F", "2C"], ["2A", "2B"],
    ["1H", "2J"], ["2K", "2L"], ["1G", "3:G"], ["1D", "3:D"],
    ["1L", "3:L"], ["1A", "3:A"], ["2E", "2I"], ["1C", "2F"],
    ["1J", "2H"], ["2G", "2D"], ["1B", "3:B"], ["1K", "3:K"],
  ];

  const ROUNDS = ["Advance from group", "Round of 16", "Quarterfinal", "Semifinal", "Final", "Champion"];

  function makeRng(seed) {
    let s = seed >>> 0 || 1;
    return function () {
      s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0;
      return s / 4294967296;
    };
  }

  function poisson(lam, rng) {
    const L = Math.exp(-lam);
    let k = 0, p = 1;
    do { k++; p *= rng(); } while (p > L);
    return k - 1;
  }

  // Ratings are in log goal units. temp scales rating gaps (1 = market calibrated).
  function goals(ra, rb, temp, rng, frac) {
    const mu = Math.log(1.3);
    const d = (ra - rb) * temp / 2;
    return [poisson(frac * Math.exp(mu + d), rng), poisson(frac * Math.exp(mu - d), rng)];
  }

  function knockout(a, b, R, temp, rng) {
    let [ga, gb] = goals(R[a], R[b], temp, rng, 1);
    if (ga === gb) {
      const [ea, eb] = goals(R[a], R[b], temp, rng, 1 / 3);
      ga += ea; gb += eb;
      if (ga === gb) return rng() < 0.5 ? a : b;
    }
    return ga > gb ? a : b;
  }

  function assignThirds(qualGroups) {
    const winners = Object.keys(THIRD_SLOTS);
    const used = {}, out = {};
    function solve(i) {
      if (i === winners.length) return true;
      const w = winners[i];
      for (const g of THIRD_SLOTS[w]) {
        if (qualGroups.includes(g) && !used[g]) {
          used[g] = true; out[w] = g;
          if (solve(i + 1)) return true;
          used[g] = false;
        }
      }
      return false;
    }
    if (solve(0)) return out;
    // Fallback (should be rare): fill in order.
    winners.forEach((w, i) => { out[w] = qualGroups[i]; });
    return out;
  }

  // Simulate one tournament. Returns { reach: {team: roundIndex}, groupWinners: [...] }.
  // roundIndex: 0 group exit, 1 R32, 2 R16, 3 QF, 4 SF, 5 final, 6 champion.
  function simulateOnce(R, temp, rng) {
    const reach = {};
    const pos = {};
    const thirds = [];
    for (const g in GROUPS) {
      const t = GROUPS[g];
      const st = t.map((name) => ({ name, pts: 0, gd: 0, gf: 0, tb: rng() }));
      for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) {
        const hi = HOSTS.includes(t[i]) ? 0.25 : 0, hj = HOSTS.includes(t[j]) ? 0.25 : 0;
        const [a, b] = goals(R[t[i]] + hi, R[t[j]] + hj, temp, rng, 1);
        st[i].gf += a; st[j].gf += b; st[i].gd += a - b; st[j].gd += b - a;
        if (a > b) st[i].pts += 3; else if (b > a) st[j].pts += 3; else { st[i].pts++; st[j].pts++; }
      }
      st.sort((x, y) => y.pts - x.pts || y.gd - x.gd || y.gf - x.gf || y.tb - x.tb);
      pos["1" + g] = st[0].name; pos["2" + g] = st[1].name;
      thirds.push({ ...st[2], g });
      st.forEach((s) => { reach[s.name] = 0; });
    }
    thirds.sort((x, y) => y.pts - x.pts || y.gd - x.gd || y.gf - x.gf || y.tb - x.tb);
    const qual = thirds.slice(0, 8);
    const slot = assignThirds(qual.map((q) => q.g));
    const thirdByGroup = {};
    qual.forEach((q) => { thirdByGroup[q.g] = q.name; });
    const resolve = (code) => code[0] === "3" ? thirdByGroup[slot[code.slice(2)]] : pos[code];

    let field = [];
    R32.forEach(([x, y]) => { field.push(resolve(x), resolve(y)); });
    field.forEach((t) => { reach[t] = 1; });
    let round = 1;
    while (field.length > 1) {
      const next = [];
      for (let i = 0; i < field.length; i += 2) next.push(knockout(field[i], field[i + 1], R, temp, rng));
      round++;
      next.forEach((t) => { reach[t] = round; });
      field = next;
    }
    return { reach, groupWinners: Object.keys(GROUPS).map((g) => pos["1" + g]) };
  }

  // Run n tournaments. Returns per team probabilities of reaching each round (index 1..6) and of winning the group.
  function simulate(R, n, temp, seed) {
    const rng = makeRng(seed || 12345);
    const teams = Object.values(GROUPS).flat();
    const counts = {}, gw = {};
    teams.forEach((t) => { counts[t] = [0, 0, 0, 0, 0, 0, 0]; gw[t] = 0; });
    for (let s = 0; s < n; s++) {
      const { reach, groupWinners } = simulateOnce(R, temp, rng);
      for (const t of teams) for (let k = 1; k <= reach[t]; k++) counts[t][k]++;
      groupWinners.forEach((t) => { gw[t]++; });
    }
    const probs = {};
    teams.forEach((t) => {
      probs[t] = { reach: counts[t].slice(1).map((c) => c / n), group: gw[t] / n };
    });
    return probs;
  }

  const api = { GROUPS, HOSTS, R32, ROUNDS, simulate, simulateOnce, makeRng };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.WCSim = api;
})(typeof globalThis !== "undefined" ? globalThis : this);

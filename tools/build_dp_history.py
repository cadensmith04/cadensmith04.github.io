"""Build weekly DynastyProcess value history keyed by Sleeper player ID.

Usage: python tools/build_dp_history.py /path/to/dynastyprocess-data-clone out.json
The clone can be a blob:none partial clone; blobs are fetched in one batch.
Pick values are derived from pick ECR using that week's player ECR to value curve.
"""
import bisect, csv, io, json, re, subprocess, sys
from collections import defaultdict

repo, out = sys.argv[1], sys.argv[2]
since = sys.argv[3] if len(sys.argv) > 3 else '2021-01-01'
git = lambda *a: subprocess.run(['git', '-C', repo, *a], capture_output=True, text=True, check=True).stdout

def read_csv(text):
    return list(csv.DictReader(io.StringIO(text)))

def num(x):
    try:
        return float(x)
    except (TypeError, ValueError):
        return None

# fantasypros id -> sleeper id, from the newest db_playerids
head = git('rev-parse', 'origin/HEAD' if git('branch', '-r').strip() else 'HEAD').strip()
fp2sl = {}
for r in read_csv(git('show', f'{head}:files/db_playerids.csv')):
    if r.get('fantasypros_id') and r.get('sleeper_id') and r['sleeper_id'] not in ('NA', ''):
        fp2sl[r['fantasypros_id']] = r['sleeper_id']

commits = [l.split() for l in git('log', f'--since={since}', '--format=%H %cs', '--', 'files/values-players.csv').splitlines()]
commits.reverse()
want = []
for c, d in commits:
    for line in git('ls-tree', c, 'files/values-players.csv', 'files/values-picks.csv').splitlines():
        want.append(line.split()[2])
subprocess.run(['git', '-C', repo, 'fetch', '-q', 'origin', *sorted(set(want))], check=False)

dates, players, picks = [], defaultdict(lambda: {'sf': {}, 'oq': {}}), defaultdict(lambda: {'sf': {}, 'oq': {}})
TIER = {'early': 'early', 'mid': 'mid', 'late': 'late'}
ORD = {'1st': 1, '2nd': 2, '3rd': 3, '4th': 4, '5th': 5}

def curve(rows, ek, vk):
    pts = sorted((num(r[ek]), num(r[vk])) for r in rows if num(r[ek]) is not None and num(r[vk]) is not None)
    xs, ys = [p[0] for p in pts], [p[1] for p in pts]
    def f(e):
        if not xs or e is None:
            return None
        i = bisect.bisect_left(xs, e)
        if i <= 0:
            return ys[0]
        if i >= len(xs):
            return ys[-1]
        x0, x1, y0, y1 = xs[i - 1], xs[i], ys[i - 1], ys[i]
        return y0 + (y1 - y0) * (e - x0) / (x1 - x0 or 1)
    return f

last_date = None
for c, d in commits:
    if d == last_date:
        dates.pop()
    last_date = d
    idx = len(dates)
    dates.append(d)
    prow = read_csv(git('show', f'{c}:files/values-players.csv'))
    for r in prow:
        sid = fp2sl.get(str(r.get('fp_id', '')).strip('"'))
        if not sid:
            continue
        for key, col in (('sf', 'value_2qb'), ('oq', 'value_1qb')):
            v = num(r.get(col))
            if v is not None:
                players[sid][key][idx] = round(v)
    try:
        krow = read_csv(git('show', f'{c}:files/values-picks.csv'))
    except subprocess.CalledProcessError:
        krow = []
    f2, f1 = curve(prow, 'ecr_2qb', 'value_2qb'), curve(prow, 'ecr_1qb', 'value_1qb')
    agg = defaultdict(lambda: {'sf': [], 'oq': []})
    for r in krow:
        name = r['player']
        m = re.match(r'(\d{4}) Pick (\d)\.(\d{2})', name)
        m2 = re.match(r'(\d{4}) (Early|Mid|Late) (\d)\w\w', name)
        m3 = re.match(r'(\d{4}) (\d)\w\w$', name)
        keys = []
        if m:
            s, rd, sl = m.group(1), int(m.group(2)), int(m.group(3))
            tier = 'early' if sl <= 4 else 'mid' if sl <= 8 else 'late'
            keys = [f'{s}-{rd}-{tier}', f'{s}-{rd}']
        elif m2:
            keys = [f'{m2.group(1)}-{m2.group(3)}-{m2.group(2).lower()}']
        elif m3:
            keys = [f'{m3.group(1)}-{m3.group(2)}']
        for k in keys:
            if int(k.split('-')[1]) > 4:
                continue
            agg[k]['sf'].append(f2(num(r.get('ecr_2qb'))))
            agg[k]['oq'].append(f1(num(r.get('ecr_1qb'))))
    for k, v in agg.items():
        for key in ('sf', 'oq'):
            vals = [x for x in v[key] if x is not None]
            if vals:
                picks[k][key][idx] = round(sum(vals) / len(vals))

def series(dct):
    return [dct.get(i) for i in range(len(dates))]

# keep players that were ever worth something
res = {'source': 'DynastyProcess values-players.csv weekly history', 'dates': dates,
       'players': {sid: {k: series(v[k]) for k in ('sf', 'oq')} for sid, v in players.items() if max(list(v['sf'].values()) + [0]) >= 300},
       'picks': {k: {kk: series(v[kk]) for kk in ('sf', 'oq')} for k, v in picks.items()}}
with open(out, 'w') as fh:
    json.dump(res, fh, separators=(',', ':'))
print(len(dates), 'weeks', len(res['players']), 'players', len(res['picks']), 'pick keys', dates[0], dates[-1])

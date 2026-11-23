"""Daily Trade Lab collector, run by .github/workflows/collect.yml.

1. Saves the newest dynasty trades FantasyCalc publishes for common formats.
2. Appends today's FantasyCalc and RosterAudit values to running histories.
3. Crawls public Sleeper dynasty leagues (snowballing out from seed leagues) and saves their trades.
   League ids are hashed and no usernames are stored.
Everything lands in trade-lab/data/. Standard library only.
"""
import datetime as dt, hashlib, json, os, time, urllib.request

ROOT = os.path.join(os.path.dirname(__file__), '..', 'trade-lab', 'data')
TODAY = dt.date.today().isoformat()
UA = {'User-Agent': 'TradeLab/1.0 (+https://cadensmith04.github.io/trade-lab/)'}
SEEDS = ['1347700056865665024', '1336780775789445120']
LEAGUES_PER_RUN = int(os.environ.get('LEAGUES_PER_RUN', '120'))
calls = 0


def get(url, tries=3):
    global calls
    for i in range(tries):
        try:
            calls += 1
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=30) as r:
                return json.loads(r.read().decode())
        except Exception as e:  # noqa: BLE001
            if i == tries - 1:
                print('fail', url, e)
                return None
            time.sleep(2 * (i + 1))


def path(*p):
    full = os.path.join(ROOT, *p)
    os.makedirs(os.path.dirname(full), exist_ok=True)
    return full


def load(p, default):
    try:
        with open(path(p)) as fh:
            return json.load(fh)
    except (FileNotFoundError, json.JSONDecodeError):
        return default


def save(p, obj):
    with open(path(p), 'w') as fh:
        json.dump(obj, fh, separators=(',', ':'))


def append_jsonl(p, rows, key='id'):
    full = path(p)
    seen = set()
    if os.path.exists(full):
        with open(full) as fh:
            for line in fh:
                try:
                    seen.add(json.loads(line)[key])
                except (json.JSONDecodeError, KeyError):
                    pass
    new = [r for r in rows if r[key] not in seen]
    with open(full, 'a') as fh:
        for r in new:
            fh.write(json.dumps(r, separators=(',', ':')) + '\n')
    return len(new)


def add_column(hist_file, today_vals, today_picks=None):
    """today_vals: {sid: {'sf': v, 'oq': v}}. Keeps one column per day."""
    h = load(hist_file, {'dates': [], 'players': {}, 'picks': {}})
    if h['dates'] and h['dates'][-1] == TODAY:
        idx = len(h['dates']) - 1
    else:
        h['dates'].append(TODAY)
        idx = len(h['dates']) - 1
    n = len(h['dates'])
    for group, vals in (('players', today_vals), ('picks', today_picks or {})):
        g = h.setdefault(group, {})
        for k in set(g) | set(vals):
            row = g.setdefault(k, {'sf': [], 'oq': []})
            for f in ('sf', 'oq'):
                s = row.setdefault(f, [])
                s.extend([None] * (n - len(s)))
                if k in vals and vals[k].get(f) is not None:
                    s[idx] = round(vals[k][f])
    save(hist_file, h)
    return len(today_vals)


def fantasycalc():
    vals, picks = {}, {}
    for qbs, f in ((2, 'sf'), (1, 'oq')):
        data = get(f'https://api.fantasycalc.com/values/current?isDynasty=true&numQbs={qbs}&numTeams=12&ppr=1') or []
        for x in data:
            p = x['player']
            if p['position'] == 'PICK':
                picks.setdefault(p['name'], {})[f] = x['value']
            elif p.get('sleeperId'):
                vals.setdefault(p['sleeperId'], {})[f] = x['value']
    print('fc values', add_column('fc-history.json', vals, picks))
    rows = []
    for qbs in (1, 2):
        for teams in (10, 12, 14):
            for ppr in (0.5, 1):
                for t in get(f'https://api.fantasycalc.com/trades?isDynasty=true&numQbs={qbs}&numTeams={teams}&ppr={ppr}') or []:
                    side = lambda s: [p.get('sleeperId') or p.get('name') for p in s]
                    rows.append({'id': t['id'], 'date': t['date'], 'teams': t.get('numTeams'), 'qbs': t.get('numQbs'), 'ppr': t.get('ppr'),
                                 'tep': t.get('tePremium'), 'sf': t.get('numSuperflex'), 'starters': t.get('numStarters'),
                                 'roster': t.get('rosterSize'), 'a': side(t['side1']), 'b': side(t['side2'])})
    print('fc trades new', append_jsonl(f'trades/fc-{TODAY[:7]}.jsonl', rows))


def rosteraudit():
    data = get('https://rosteraudit.com/wp-json/ra/v1/rankings/values') or {}
    vals = {sid: {'sf': v.get('sf'), 'oq': v.get('1qb')} for sid, v in data.items() if isinstance(v, dict)}
    picks = {}
    for p in (get('https://rosteraudit.com/wp-json/ra/v1/picks') or {}).get('picks', []):
        key = f"{p['pick_season']}-{p['pick_round']}" + (f"-{p['pick_slot']}" if p.get('pick_slot') else '')
        picks[key] = {'sf': p.get('val_sf'), 'oq': p.get('val_1qb')}
    print('ra values', add_column('ra-history.json', vals, picks))


def sleeper_crawl():
    state = load('crawl/state.json', {'queue': list(SEEDS), 'done': {}})
    nfl = get('https://api.sleeper.app/v1/state/nfl') or {}
    season = nfl.get('league_season') or nfl.get('season') or TODAY[:4]
    week = int(nfl.get('leg') or nfl.get('week') or 1)
    queue, done = state['queue'], state['done']
    # re-crawl leagues not visited in 7 days, after the queue drains
    stale = [l for l, ts in done.items() if (time.time() - ts) > 7 * 86400]
    rows, expanded, n = [], 0, 0
    while n < LEAGUES_PER_RUN and (queue or stale):
        lid = queue.pop(0) if queue else stale.pop(0)
        n += 1
        lg = get(f'https://api.sleeper.app/v1/league/{lid}')
        if not lg or (lg.get('settings') or {}).get('type') != 2:
            done[lid] = time.time()
            continue
        rp = lg.get('roster_positions') or []
        fmt = {'teams': lg.get('total_rosters'), 'sf': int('SUPER_FLEX' in rp), 'qbs': rp.count('QB'),
               'ppr': (lg.get('scoring_settings') or {}).get('rec'), 'tep': (lg.get('scoring_settings') or {}).get('bonus_rec_te', 0),
               'starters': len([r for r in rp if r not in ('BN',)])}
        lh = hashlib.sha1(lid.encode()).hexdigest()[:12]
        for w in range(0, min(week, 18) + 1):
            for tx in get(f'https://api.sleeper.app/v1/league/{lid}/transactions/{w}') or []:
                if tx.get('type') != 'trade' or tx.get('status') != 'complete':
                    continue
                sides = {}
                for sid, rid in (tx.get('adds') or {}).items():
                    sides.setdefault(str(rid), {'p': [], 'k': [], 'f': 0})['p'].append(sid)
                for pk in tx.get('draft_picks') or []:
                    sides.setdefault(str(pk['owner_id']), {'p': [], 'k': [], 'f': 0})['k'].append([pk['season'], pk['round'], pk['roster_id']])
                for fb in tx.get('waiver_budget') or []:
                    sides.setdefault(str(fb['receiver']), {'p': [], 'k': [], 'f': 0})['f'] += fb['amount']
                rows.append({'id': tx['transaction_id'], 'lg': lh, 'season': lg.get('season'), 't': tx.get('created'), **fmt, 'sides': sides})
        done[lid] = time.time()
        # snowball: managers in this league, their other dynasty leagues
        if len(queue) < 5000:
            users = get(f'https://api.sleeper.app/v1/league/{lid}/users') or []
            for u in users[:12]:
                for l2 in get(f"https://api.sleeper.app/v1/user/{u['user_id']}/leagues/nfl/{season}") or []:
                    if (l2.get('settings') or {}).get('type') == 2 and l2['league_id'] not in done and l2['league_id'] not in queue:
                        queue.append(l2['league_id'])
                        expanded += 1
        time.sleep(0.05)
    state['queue'] = queue
    save('crawl/state.json', state)
    print('sleeper leagues', n, 'trades new', append_jsonl(f'trades/sleeper-{TODAY[:7]}.jsonl', rows), 'queued', expanded, 'queue', len(queue), 'done', len(done))


if __name__ == '__main__':
    for step in (fantasycalc, rosteraudit, sleeper_crawl):
        try:
            step()
        except Exception as e:  # noqa: BLE001
            print('step failed', step.__name__, e)
    print('api calls', calls)

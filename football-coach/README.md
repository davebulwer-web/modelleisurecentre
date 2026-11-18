# Angry Andy - Football Coach

The third Angry Andy game, after *Angry Andy Gets The Gig* and *Model Leisure Centre*. Andy's new gig: **Head Coach at Model Rovers JFC**, coaching the Under-8s, Under-10s and Under-12s on the rec ground. He is still permanently annoyed. Get through the day (09:00 to 17:00, about 5 real minutes) without his anger hitting 100%.

Same engine, art style and controls as the Leisure Centre game (this folder started as a copy of it).

## The rec ground

The pitch (with three training groups doing their drills), the clubhouse (office, tea hut, changing rooms and loos), the car park, the park gate where the dogs get in, and three back gardens over the fence: Mr Grimshaw's, Mrs Pemberton's and Nosey Nigel's.

Brenda runs the tea hut and Gaz is (supposedly) the assistant coach. The Under-8s are Little Alfie, Poppy and Mia; the Under-10s Tyler, Jayden and Ruby; the Under-12s Kyle, Harvey and Ollie.

## How it plays

Random **tasks** pop up in the panel on the right, each with a timer. Walk to the marker and **hold the action key** until the bar fills. Miss the timer and Andy's anger goes up; finish it and he calms down a little and scores points.

- **Bored training group**: a squad has stopped playing ("Coach! What do we do?"). Run their passing, shooting or dribbling drill.
- **New kid to sign in**: check their registration card at the sign-in table, then **Sign in** or **Send home**. The photo must be theirs, the card must cover the squad they want, and their subs must be paid up. A wrong call costs anger.
- **Dog on the pitch**: Biscuit, Tyson or Princess gets in through the park gate and does zoomies while Dog Walker Doreen shouts "He's FRIENDLY!". Catch the dog to chase it off. If it gets away it usually leaves a present.
- **Dog mess**: scoop the poop before somebody slides in it.
- **Changing rooms**: muddy boot prints, a lost property mountain, a tap left running, and a blocked loo (miss that one and the loos are out of order, for Andy too).
- **Ball over the fence**: walk through the neighbour's gate and fetch it back from their garden.
- **Neighbour complaining** at their garden gate: **Fob off** calms Andy; **Say sorry** is safe but winds him up a little.
- **Touchline parents**: Dad-bod Darren, Screaming Sandra and Touchline Terry "coaching" from the side. Having a word calms Andy the most.
- **Kids being kids**: climbing the goal, kicking balls at the clubhouse windows, a scrap in the centre circle, or legging it to the ice cream van.
- **Man down**: run on with the magic sponge.
- **Ripped goal net** and **flat balls** (pump them up in the office).
- **Alistair's back**: still banned, now nicking tea and biscuits from the tea hut hatch.
- **Lycra Lee** is doing laps of the touchline on his bike. Stop him.
- **Gaz is on his phone**: nobody is watching the kids.
- **Collector Matt** is in the changing rooms trying to buy the kids' shirts off the pegs. They are NOT for sale.
- **Someone on the pitch**: Shortcut Sue or Headphones Harry wandering straight through training. Get them off.
- **Burst ball**: BANG. A training group's ball has popped; bin it and get a spare out.
- **Bad-mouthing Leeds**: Banter Bob, Gobby Gav or one of the kids slagging off Leeds United. Andy takes this very personally: ignoring it costs the most anger, and putting them right calms him the most.
- **Phone**: the office phone, Andy's mobile, or the **parents' WhatsApp group** (Mute it or Reply). Hang up on cold callers.
- **The Club Chairman**: every third fob-off in a day (or at random) he wants a meeting in the office. Andy is stuck there for a few seconds while the other timers keep running.
- **Bladder** and **thirst** rise slowly. Use the **loos** and make **tea** at the tea hut urn.
- The day starts gently and gets busier. Each day (Monday to Sunday, round again) is harder, and half of Andy's anger carries over.

**Controls:** WASD or arrow keys to move. Hold E or Space to act. A/D (or 1/2) for the two buttons on a card check or call. P pauses, M mutes. On a phone or tablet, an on-screen joystick and ACT button appear when you touch the screen.

## Run it

From this folder:

```bash
npm install
```

```bash
npm run dev
```

Open the printed URL. `npm run build` makes a static site in `dist/`.

```bash
npm test
```

```bash
npm run smoke
```

`npm test` runs the unit tests, including headless simulations of full days. `npm run smoke` drives the real page in headless Chromium and saves screenshots to `smoke-output/` (it needs Playwright).

## Share it

```bash
npm run package
```

This makes **one file**, `release/AngryAndyFootballCoach.html`, with the game, the pictures and the fonts inside it. People double-click it to play in their browser. High scores are saved in each person's own browser.

## Changing things

Everything you'd want to tweak is in `src/data/`:

| File | What it holds |
|---|---|
| `catchphrases.json` | Andy's catchphrases and grumbles, kids' excuses, Collector Matt's offers, pitch walkers, the Leeds banter and Andy's replies, trouble shouts, touchline parents, dogs and their owner, the Chairman's lines, Alistair's lines, neighbours' complaints, drill shouts and the WhatsApp messages. |
| `phonecalls.json` | Who rings, what they want, Andy's fob-offs, plus the cold callers and their pitches. |
| `tuning.json` | Hours, day length, walking speeds (Andy, kids, dogs, Lycra Lee), bladder and thirst, difficulty ramp. |
| `events.json` | Each task type: how often it appears, time limit, hold time, anger penalty, calm reward, points. |
| `characters.json` | The cast, which squad each kid is in, where everyone stands, and the looks used to draw the placeholder art (`kid` and `dog` looks too). |
| `map.json` | The floor plan (`#` clubhouse wall, `f` fence, `H` houses, `g` gate, `.` floor), rooms, furniture and named spots. |

Art: see [ASSETS.md](ASSETS.md). All pictures are generated by `tools/make-placeholder-art.mjs` (`npm run art`).

## Code layout

- `src/main.ts`: boot and the game loop.
- `src/game/`: rules, as plain TypeScript with no DOM. `game.ts` (tasks, needs, scoring), `spawner.ts` (random tasks and difficulty), `membership.ts` (the registration card check), `meters.ts`, `catchphrases.ts`.
- `src/world/map.ts`: the tile map, collision and A* pathfinding.
- `src/entities/person.ts`: Andy and everyone else (dogs included).
- `src/render/renderer.ts`: draws the rec ground, the HUD, the task panel and the pop-ups on one canvas.
- `src/core/`: assets loader, keyboard and touch input, synthesised sound effects.

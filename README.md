# Cypher Business

*A weekly business engine for **Foundry VTT 14+** (Cypher System or any system).*

Somewhere between the dragon hoard and the tavern deed, your party became management. **Cypher Business** is the ledger that remembers what the GM would rather forget: payrolls, rivals, leaky roofs, and the exact week the crew realized they were being paid in "exposure."

One button runs the week. The engine does the math. You do the voices.

## What's in the box

- **Six attributes (0–10)** — Profit, Marketing, Personnel, Leadership, Morale, Danger — on a live radar, each with a documented list of things that move it
- **A weekly run that means it** — wages, upkeep, sales per product line, facility wear, morale drift, rival moves, one fresh story event, and a chat card your treasurer can frame
- **A real economy** — products have *value* (margin), *demand* (this week's pull), *base demand* (the market's resting appetite) and *workers demand* (heads the line needs). Cheap sells volume, dear sells margin, understaffing throttles everything proportionally
- **Leadership with teeth** — drag NPC actors onto role cards across five domains. Marketing pulls customers, Finance discounts all spending, Security soothes rivals and Danger. (Leadership and Operations are honorary titles pending the guild's recognition — the hook is reserved.)
- **People, not spreadsheets** — every hire arrives with a rolled name, age, background, and three traits. They have morale, it sags, they quit over the wages. You were warned.
- **Story events with deadlines** — 60+ categorized situations (crisis to paperwork), each with three named solutions, table-logged steps, and stakes the GM declares — never rolls
- **Rivals who hold grudges** — strength, aggression, a pressure meter, and at max pressure an aggressive move you'll feel
- **Facilities & products** — condition that drags morale down when it rots, capacity you can overcrowd, renovation priced by size, scene-linked visits, and item-sheet-linked product lines
- **Two manuals built in** — a 📖 button in the nav opens the *GM Edition* (full engine rules, every button explained, where the bodies are buried) for GMs, and *The Player's Handbook* (what you can see, push, and roll) for everyone else
- **Calendaria-aware** — in-world week labels when [Calendaria](https://github.com/Sayshal/Calendaria) is active; the date advances 7 days per run. Otherwise, weeks are numbered, as the ancestors intended
- **Six themes** — Noir, Velvet, Corporate, Crimson, Emerald, Paper. Per user. No table argument required
- **A floating brass medallion** on the canvas — draggable, opens the books from anywhere, badges unresolved events like a conscience with a counter

## Install

Copy `cypher-business` into `Data/modules/` (or install from the manifest URL), enable it in **Manage Modules**, and open the books via the token-controls button, the medallion, or a macro.

## The weekly ritual

1. **GM** creates a business, hires a crew (they come with personas and opinions), adds facilities and product lines
2. **Players** read the books, argue about the plan, and make their case
3. **Anyone allowed** clicks **Run Week** — players request, the GM confirms — and the week resolves: income, wages, wear, rivals, one new event
4. **Events resolve at the table, not in the dice tray** — each card lists three approaches. The GM logs steps as scenes play out, then declares success or failure; consequences post to chat. Or arm a **Link Roll** and let the player's own skill roll decide, total vs DC. Ignore a deadline, and the failure version of the stakes applies itself — the ledger forgives, the calendar doesn't

## Macros

```js
game.cypherBusiness.open();            // picker
game.cypherBusiness.open('biz-id');    // specific business
```

## Safety

The whole ledger is **one world setting** with forward migration on load, plus **Export / Import JSON** buttons. Export before experiments. Future-you will be grateful.

## Development

```bash
node --test tests/        # engine + render smoke tests (no Foundry required)
node --input-type=module --check < scripts/<file>.mjs   # ESM syntax gate
python3 tools/pack.py     # build dist zip (runtime files only)
```

The in-app manuals are hardcoded English (documentation, not UI chrome); the window titles and button labels localize through `lang/en.json`.

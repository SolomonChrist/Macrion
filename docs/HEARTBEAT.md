# Agent Heartbeat Protocol

**Every agent writes a heartbeat file. No exceptions.**

Two mass agent deaths on 2026-08-13 destroyed hours of work — not because the code was lost
(it was on disk) but because the *reasoning* was lost. Nobody knew what had been diagnosed,
what had been verified, or what was half-done. A replacement had to start cold.

The heartbeat fixes that. If an agent dies, its successor reads the heartbeat and resumes.

---

## For agents — what you must do

Write to **`heartbeats/<your-name>.md`** — the exact filename is given in your brief.

**Update it every 3–5 tool calls, and always immediately before any long operation** (a
capture run, a big file write, a long search). You cannot literally act on a 5-minute timer —
you only exist between tool calls — so cadence is measured in tool calls. Roughly every 3–5
calls lands close to 5 minutes of wall-clock.

**Update it the moment you learn something a successor would need.** A diagnosis is worth more
than a status.

### Format — overwrite the whole file each time

```markdown
# <agent-name>
updated: 2026-08-13T22:41:00Z
status: working | blocked | done
task: <one line — what you were sent to do>

## Done
- <completed item, specific>
- <completed item, specific>

## In progress
<what you are doing right now, one or two lines>

## Findings
<what you have DIAGNOSED. The most valuable section. Root causes, measurements,
things you ruled out, approaches that failed and why.>

## Next
<the next concrete step you intended to take>

## Successor notes
<what someone replacing you cold needs to know to not repeat your work.
Files you changed. Approaches already ruled out. Traps you hit.>
```

Write the timestamp in UTC ISO 8601. Get it with `date -u +%Y-%m-%dT%H:%M:%SZ`.

### Rules

- **Never skip a heartbeat to save tool calls.** It is cheaper than dying silently.
- **Findings and Successor notes are the point.** Status alone is nearly worthless — the lead
  can already see file writes. Write what you *learned*.
- Set `status: blocked` with the reason if you are stuck. Do not silently work around a
  blocker for twenty tool calls.
- Set `status: done` when you write your final report, so the lead knows you finished rather
  than died.

---

## For the lead — monitoring

```bash
node tools/heartbeat.mjs           # show all agents, flag anything stale
node tools/heartbeat.mjs --stale 5 # custom staleness threshold in minutes
```

Output flags each agent `OK` / `STALE` / `DONE` / `BLOCKED` with the age of its last beat.

### The rule

**More than 5 minutes without a heartbeat = presumed dead.**

When an agent goes stale:
1. Read its heartbeat file. That is its dying testimony.
2. Commit and push whatever it left on disk.
3. Spawn a replacement whose brief includes the stale heartbeat verbatim, and which is told
   to read `heartbeats/<name>.md` first and continue rather than restart.
4. The replacement writes to the **same filename**, continuing the record.

Never let a stale agent's slot sit empty. The project should never be idle.

### Why replacements resume rather than restart

The expensive part of an agent is not the code it writes — it is the diagnosis. An agent that
spent 40 tool calls determining that the mesh corruption came from unnormalized skin weights
has produced something valuable even if it never fixed it. The heartbeat carries that forward.

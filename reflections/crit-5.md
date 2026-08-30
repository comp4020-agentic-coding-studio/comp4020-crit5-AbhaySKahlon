# Crit 5 reflection

**What was the breakthrough that moved the work forward?**

The breakthrough was realising that "requires jumping" and "looks like a
skier" both need to be verified against the actual game, not against my
mental model of it. The three-rock wall only became a real, provable
mechanic once I stopped trusting that jump timing "felt right" and instead
wrote a deterministic Node simulation of the pure physics/collision
functions alongside a real-browser test — the two agreeing exactly (same
score, same distance, same outcome) is what made me confident the win path
and the wall's jump requirement were genuine, not an artifact of one lucky
run. The same instinct caught the last real bug: during final verification I
watched the finished game at true gameplay scale, not a zoomed screenshot,
and noticed the trailing arm and ski pole visually disappeared into the
trailing leg. Every earlier check of that pose had been a close-up crop,
which is exactly why it survived so long — the close-up was answering a
different question than "does this read as a skier from a normal viewing
distance."

**What did this work change about who I want to be as a software developer?**

It sharpened my sense that a check can pass and still be checking the wrong
thing. A cropped screenshot, a scripted key-press with Node-side timing, a
"looks fine" pass at the wrong zoom level — each gave a green result while
answering a narrower question than the one that actually mattered. I want to
be the kind of developer who asks what a passing check is actually evidence
of before trusting it, and who treats "I looked at it and it seemed fine" as
the start of verification, not the end of it.

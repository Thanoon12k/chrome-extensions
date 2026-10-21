DOCX MANUAL REPHRASE WORKBENCH v4.0
====================================

THIS VERSION FIXES THE ISSUE SHOWN IN YOUR SCREENSHOT.

V3 behavior:
- 274 words
- heading skipped -> HARD BREAK
- 599 words
- caption/equation skipped -> HARD BREAK
- 432 words
etc.

That produced many small boxes.

V4 behavior:
Excluded items DO NOT break the packing anymore.

The program scans forward through the whole manuscript and keeps only eligible
normal prose for the queue. It keeps adding the NEXT ELIGIBLE prose paragraph
while the total is <= 1000 words.

Example from your screenshot:

274 + 599 = 873
=> ONE BOX

Next eligible paragraph = 432
873 + 432 = 1305
=> too large, so Box 1 stops at 873.

Then:
432 + 308 + 105 + 93 = 938
=> ONE BOX

If the next eligible paragraph is 500:
938 + 500 = 1438
=> Box 2 stops at 938 and 500 starts Box 3.

IMPORTANT:
Headings, section names, captions, equations, images/objects, lists, front matter,
and References are STILL NOT sent for rephrasing and are STILL NOT changed.

They are simply ignored for grouping purposes.

The program remembers the original Word paragraph index of every included prose
paragraph. Therefore even when Box 1 contains prose located on both sides of a
heading/caption/equation, each rewritten paragraph is returned to its own exact
original paragraph position. The excluded material stays between them untouched.

SEPARATOR
---------
The chosen separator is inserted only between included prose paragraphs.

Keep exactly the same separator in the rephrased result. On Replace, v4 splits
the result and puts each part back into the correct original Word paragraph.

Maximum words per merged box: 1000.


v4.1: AUTOMATIC MODE WITH STEALTHWRITER (Chrome extension)
----------------------------------------------------------
The workbench now runs a small local bridge (http://127.0.0.1:8765) for the
"StealthWriter Auto Bridge" Chrome extension in the stealthwriter_extension folder.

1. chrome://extensions -> Developer mode -> Load unpacked -> choose stealthwriter_extension
2. Run the workbench and Load / Scan your DOCX
3. Open StealthWriter (logged in) and press Start on the purple panel

The extension sends every queue box to StealthWriter, waits for the result and
replaces the paragraphs in the output DOCX automatically. See
stealthwriter_extension/README.md for details.
